use std::{
    collections::{BTreeMap, BTreeSet},
    fs,
    str::FromStr,
};

use anyhow::{Context, Result};
use axum::{
    Json,
    extract::State,
    http::{Method, StatusCode},
    response::Response,
};
use moontv_profile::LocalProfileSnapshot;
use moontv_sync::{
    ProfileSyncError, ProfileSyncForwardRequest, ProfileSyncSession, ProfileSyncSessionMutation,
    ProfileSyncStatusResponse, build_profile_sync_target_url,
};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use tracing::warn;

use crate::{
    AppError, AppResult, AppState, DesktopAdminConfig, apply_admin_settings_to_config_file,
    build_admin_settings_sync_snapshot, download_runtime::DesktopDownloadResourceIndexRecord,
    no_store_json_response, normalize_owned_string, persist_admin_config_file_with_subscription,
    profile_sync::build_profile_sync_status_payload, read_json_file, require_owned_string,
    sync_domains_include_adminsettings, validate_profile_sync_selected_domains,
};

const DEFAULT_DESKTOP_PROFILE_SYNC_API_BASE_URL: &str = "https://luna.hkcu.qzz.io";
const AUTO_CREATED_WEB_ACCOUNT_INITIAL_PASSWORD: &str = "123456";
const REMOTE_PROFILE_SYNC_MERGE_ROUTE_PATH: &str = "/api/admin/profile-sync/merge";
const REMOTE_PROFILE_SYNC_RESPONSE_BODY_PREFIX_LIMIT: usize = 160;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub(crate) enum DesktopProfileSyncConflictStrategy {
    WebFirst,
    LocalFirst,
}

impl FromStr for DesktopProfileSyncConflictStrategy {
    type Err = &'static str;

    fn from_str(value: &str) -> std::result::Result<Self, Self::Err> {
        match value.trim() {
            "web-first" => Ok(Self::WebFirst),
            "local-first" => Ok(Self::LocalFirst),
            _ => Err("unsupported conflict strategy"),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DesktopProfileSyncLocalAccountSummary {
    pub(crate) username: String,
    pub(crate) play_record_count: usize,
    pub(crate) favorite_count: usize,
    pub(crate) follow_count: usize,
    pub(crate) search_history_count: usize,
    pub(crate) skip_config_count: usize,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DesktopProfileSyncRemoteAccountState {
    pub(crate) username: String,
    pub(crate) exists: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DesktopProfileSyncOnboardingPlanItem {
    pub(crate) local_username: String,
    pub(crate) remote_username: String,
    pub(crate) requires_account_creation: bool,
    pub(crate) summary: DesktopProfileSyncLocalAccountSummary,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DesktopProfileSyncOnboardingPlan {
    pub(crate) current_local_username: String,
    pub(crate) current_remote_username: String,
    pub(crate) items: Vec<DesktopProfileSyncOnboardingPlanItem>,
}

pub(crate) fn plan_profile_sync_onboarding(
    local_accounts: Vec<DesktopProfileSyncLocalAccountSummary>,
    current_local_username: &str,
    current_remote_username: &str,
    remote_accounts: &[DesktopProfileSyncRemoteAccountState],
) -> DesktopProfileSyncOnboardingPlan {
    let remote_existing_usernames = remote_accounts
        .iter()
        .filter(|account| account.exists)
        .map(|account| account.username.clone())
        .collect::<BTreeSet<_>>();

    let items = local_accounts
        .into_iter()
        .map(|summary| {
            let remote_username = if summary.username == current_local_username {
                current_remote_username.to_string()
            } else {
                summary.username.clone()
            };
            let requires_account_creation = remote_username != current_remote_username
                && !remote_existing_usernames.contains(&remote_username);

            DesktopProfileSyncOnboardingPlanItem {
                local_username: summary.username.clone(),
                remote_username,
                requires_account_creation,
                summary,
            }
        })
        .collect();

    DesktopProfileSyncOnboardingPlan {
        current_local_username: current_local_username.to_string(),
        current_remote_username: current_remote_username.to_string(),
        items,
    }
}

pub(crate) fn apply_profile_sync_settings_to_config_file(
    config_file: &str,
    remote_base_url: Option<&str>,
    sync_domains: Option<&[String]>,
) -> Result<String> {
    let mut config_value = serde_json::from_str::<Value>(config_file.trim())
        .context("failed to parse config file json")?;
    let root = config_value
        .as_object_mut()
        .context("config file root must be an object")?;
    let profile_sync_entry = root
        .entry("profile_sync".to_string())
        .or_insert_with(|| json!({}));

    if !profile_sync_entry.is_object() {
        *profile_sync_entry = json!({});
    }

    let profile_sync_object = profile_sync_entry
        .as_object_mut()
        .context("profile_sync must be an object after normalization")?;

    match remote_base_url
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        Some(remote_base_url) => {
            profile_sync_object.insert(
                "api_base_url".to_string(),
                Value::String(remote_base_url.to_string()),
            );
        }
        None => {
            profile_sync_object.remove("api_base_url");
        }
    }

    if let Some(sync_domains) = sync_domains {
        profile_sync_object.insert(
            "sync_domains".to_string(),
            Value::Array(
                sync_domains
                    .iter()
                    .map(|domain| Value::String(domain.clone()))
                    .collect(),
            ),
        );
    }

    serde_json::to_string_pretty(&config_value).context("failed to encode config file json")
}

#[cfg(test)]
pub(crate) fn apply_profile_sync_api_base_url_to_config_file(
    config_file: &str,
    remote_base_url: Option<&str>,
) -> Result<String> {
    apply_profile_sync_settings_to_config_file(config_file, remote_base_url, None)
}

pub(crate) fn rebind_download_store_snapshot_owner(
    mut snapshot: Value,
    next_owner_username: &str,
) -> Result<Value> {
    let root = snapshot
        .as_object_mut()
        .context("download store snapshot root must be an object")?;
    root.insert(
        "ownerUsername".to_string(),
        Value::String(next_owner_username.to_string()),
    );

    if let Some(library) = root.get_mut("library").and_then(Value::as_object_mut) {
        for item in library.values_mut() {
            if let Some(library_item) = item.as_object_mut() {
                library_item.insert(
                    "ownerUsername".to_string(),
                    Value::String(next_owner_username.to_string()),
                );
            }
        }
    }

    Ok(snapshot)
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DesktopProfileSyncOnboardingPreviewRequest {
    remote_base_url: Option<String>,
    username: Option<String>,
    password: Option<String>,
    current_local_username: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DesktopProfileSyncOnboardingExecuteRequest {
    remote_base_url: Option<String>,
    username: Option<String>,
    password: Option<String>,
    current_local_username: Option<String>,
    strategy: Option<String>,
    sync_domains: Option<Vec<String>>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DesktopProfileSyncSyncNowRequest {
    sync_domains: Option<Vec<String>>,
    strategy: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DesktopProfileSyncDownloadPreview {
    has_downloads: bool,
    current_owner_username: Option<String>,
    target_username: Option<String>,
    task_count: usize,
    library_count: usize,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DesktopProfileSyncOnboardingPreviewResponse {
    remote_base_url: String,
    current_remote_username: String,
    current_remote_role: String,
    plan: DesktopProfileSyncOnboardingPlan,
    download_preview: DesktopProfileSyncDownloadPreview,
    warnings: Vec<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct DesktopProfileSyncMergedSummary {
    play_record_count: usize,
    favorite_count: usize,
    follow_count: usize,
    search_history_count: usize,
    skip_config_count: usize,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DesktopProfileSyncMigratedAccount {
    local_username: String,
    remote_username: String,
    local_summary: DesktopProfileSyncLocalAccountSummary,
    merged_summary: DesktopProfileSyncMergedSummary,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DesktopProfileSyncCreatedAccount {
    username: String,
    initial_password: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DesktopProfileSyncDownloadRebindResult {
    did_rebind: bool,
    previous_owner_username: Option<String>,
    next_owner_username: Option<String>,
    task_count: usize,
    library_count: usize,
    resource_index_count: usize,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DesktopProfileSyncOnboardingExecuteResponse {
    remote_base_url: String,
    current_remote_username: String,
    current_remote_role: String,
    created_accounts: Vec<DesktopProfileSyncCreatedAccount>,
    migrated_accounts: Vec<DesktopProfileSyncMigratedAccount>,
    download_rebind: DesktopProfileSyncDownloadRebindResult,
    warnings: Vec<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct DesktopProfileSyncSyncNowResponse {
    #[serde(flatten)]
    status: ProfileSyncStatusResponse,
    last_sync_error: Option<String>,
}

#[derive(Debug, Deserialize)]
struct RemoteAdminConfigResponse {
    #[serde(rename = "Role")]
    role: String,
    #[serde(rename = "Config")]
    config: Value,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RemoteProfileMergeResponse {
    summary: DesktopProfileSyncMergedSummary,
}

pub(crate) async fn preview_profile_sync_onboarding(
    State(state): State<AppState>,
    Json(payload): Json<DesktopProfileSyncOnboardingPreviewRequest>,
) -> AppResult<Response> {
    ensure_profile_sync_not_enabled(&state)?;

    let remote_base_url = resolve_remote_base_url(payload.remote_base_url)?;
    let username = require_owned_string(payload.username, "缺少 Web 用户名")?;
    let password = require_owned_string(payload.password, "缺少 Web 密码")?;
    let remote_session =
        login_remote_profile_sync(&state, &remote_base_url, &username, &password).await?;
    let local_account_summaries = load_local_account_summaries(&state)?;
    let current_local_username = resolve_current_local_username(
        payload.current_local_username,
        &local_account_summaries,
    )?;
    ensure_current_local_account(&local_account_summaries, &current_local_username)?;
    let remote_admin_config = fetch_remote_admin_config(&state, &remote_base_url).await?;
    ensure_remote_admin_role(&remote_admin_config.role)?;
    let remote_accounts = extract_remote_accounts_from_admin_config(&remote_admin_config.config);
    let plan = plan_profile_sync_onboarding(
        local_account_summaries,
        &current_local_username,
        &remote_session.username,
        &remote_accounts,
    );
    let download_preview = inspect_download_preview(&state, &remote_session.username)?;
    let requires_account_creation = plan.items.iter().any(|item| item.requires_account_creation);

    no_store_json_response(&DesktopProfileSyncOnboardingPreviewResponse {
        remote_base_url,
        current_remote_username: remote_session.username,
        current_remote_role: remote_session.role,
        plan,
        download_preview,
        warnings: preview_onboarding_warnings(requires_account_creation),
    })
}

pub(crate) async fn execute_profile_sync_onboarding(
    State(state): State<AppState>,
    Json(payload): Json<DesktopProfileSyncOnboardingExecuteRequest>,
) -> AppResult<Response> {
    ensure_profile_sync_not_enabled(&state)?;

    let remote_base_url = resolve_remote_base_url(payload.remote_base_url)?;
    let username = require_owned_string(payload.username, "缺少 Web 用户名")?;
    let password = require_owned_string(payload.password, "缺少 Web 密码")?;
    let strategy = parse_required_conflict_strategy(payload.strategy)?;
    let sync_domains = validate_profile_sync_selected_domains(payload.sync_domains)?;
    let remote_session =
        login_remote_profile_sync(&state, &remote_base_url, &username, &password).await?;
    let local_account_summaries = load_local_account_summaries(&state)?;
    let current_local_username = resolve_current_local_username(
        payload.current_local_username,
        &local_account_summaries,
    )?;
    ensure_current_local_account(&local_account_summaries, &current_local_username)?;
    let local_snapshot_map = load_local_snapshot_map(&state, &local_account_summaries)?;
    let should_sync_adminsettings = sync_domains_include_adminsettings(&sync_domains);
    let should_push_local_admin_config =
        should_sync_adminsettings && strategy == DesktopProfileSyncConflictStrategy::LocalFirst;
    let local_admin_config_snapshot = should_push_local_admin_config
        .then(|| load_local_admin_config_snapshot(&state))
        .transpose()?;
    let remote_admin_config = fetch_remote_admin_config(&state, &remote_base_url).await?;
    ensure_remote_admin_role(&remote_admin_config.role)?;
    let remote_accounts = extract_remote_accounts_from_admin_config(&remote_admin_config.config);
    let plan = plan_profile_sync_onboarding(
        local_account_summaries,
        &current_local_username,
        &remote_session.username,
        &remote_accounts,
    );

    let mut created_accounts = Vec::new();
    for item in &plan.items {
        if !item.requires_account_creation {
            continue;
        }

        create_remote_user(&state, &remote_base_url, &item.remote_username).await?;
        created_accounts.push(DesktopProfileSyncCreatedAccount {
            username: item.remote_username.clone(),
            initial_password: AUTO_CREATED_WEB_ACCOUNT_INITIAL_PASSWORD.to_string(),
        });
    }

    let mut migrated_accounts = Vec::new();
    for (index, item) in plan.items.into_iter().enumerate() {
        let snapshot = local_snapshot_map
            .get(&item.local_username)
            .cloned()
            .ok_or_else(|| AppError::internal("missing local profile snapshot during migration"))?;
        let filtered_snapshot = build_local_snapshot_for_sync_domains(&snapshot, &sync_domains);
        let merged_summary = merge_remote_profile_snapshot(
            &state,
            &remote_base_url,
            &item.remote_username,
            strategy,
            &filtered_snapshot,
            &sync_domains,
            (index == 0)
                .then_some(local_admin_config_snapshot.as_ref())
                .flatten(),
        )
        .await?;

        migrated_accounts.push(DesktopProfileSyncMigratedAccount {
            local_username: item.local_username,
            remote_username: item.remote_username,
            local_summary: item.summary,
            merged_summary,
        });
    }

    let download_rebind = rebind_local_offline_downloads(&state, &remote_session.username)?;
    if should_sync_adminsettings && strategy == DesktopProfileSyncConflictStrategy::WebFirst {
        let remote_admin_config = fetch_remote_admin_config(&state, &remote_base_url).await?;
        ensure_remote_admin_role(&remote_admin_config.role)?;
        let remote_admin_config = decode_remote_admin_config_snapshot(remote_admin_config.config)?;
        apply_remote_admin_config_to_local_state(
            &state,
            &remote_base_url,
            &sync_domains,
            remote_admin_config,
        )?;
    } else {
        persist_profile_sync_settings_into_local_config(&state, &remote_base_url, &sync_domains)?;
    }

    no_store_json_response(&DesktopProfileSyncOnboardingExecuteResponse {
        remote_base_url,
        current_remote_username: remote_session.username,
        current_remote_role: remote_session.role,
        warnings: execute_onboarding_warnings(!created_accounts.is_empty()),
        created_accounts,
        migrated_accounts,
        download_rebind,
    })
}

pub(crate) async fn post_profile_sync_sync_now(
    State(state): State<AppState>,
    Json(payload): Json<DesktopProfileSyncSyncNowRequest>,
) -> AppResult<Response> {
    let mut config = state
        .load_config()
        .map_err(|error| AppError::internal(error.to_string()))?;
    let Some(remote_base_url) = config.profile_sync_api_base_url.clone() else {
        return Err(AppError::bad_request("当前桌面尚未开启帐号同步"));
    };
    let sync_domains = validate_profile_sync_selected_domains(payload.sync_domains)?;
    let strategy = parse_optional_conflict_strategy(
        payload.strategy,
        DesktopProfileSyncConflictStrategy::LocalFirst,
    )?;
    let remote_session = require_profile_sync_session(&state).await?;

    if sync_domains_include_adminsettings(&sync_domains) {
        ensure_remote_admin_settings_sync_role(&remote_session.role)?;
    }

    persist_profile_sync_settings_into_local_config(&state, &remote_base_url, &sync_domains)?;
    config.profile_sync_domains = sync_domains.clone();

    let last_sync_error = match sync_profile_now(
        &state,
        &remote_base_url,
        &remote_session,
        &sync_domains,
        strategy,
    )
    .await
    {
        Ok(()) => None,
        Err(error) => Some(error.message),
    };
    let status = build_profile_sync_status_payload(&state, &config).await;

    no_store_json_response(&DesktopProfileSyncSyncNowResponse {
        status,
        last_sync_error,
    })
}

fn build_local_snapshot_for_sync_domains(
    snapshot: &LocalProfileSnapshot,
    sync_domains: &[String],
) -> LocalProfileSnapshot {
    let selected_domains = sync_domains
        .iter()
        .map(String::as_str)
        .collect::<BTreeSet<_>>();

    LocalProfileSnapshot {
        play_records: selected_domains
            .contains("playrecords")
            .then(|| snapshot.play_records.clone())
            .unwrap_or_default(),
        favorites: selected_domains
            .contains("favorites")
            .then(|| snapshot.favorites.clone())
            .unwrap_or_default(),
        follow_records: selected_domains
            .contains("follows")
            .then(|| snapshot.follow_records.clone())
            .unwrap_or_default(),
        search_history: selected_domains
            .contains("searchhistory")
            .then(|| snapshot.search_history.clone())
            .unwrap_or_default(),
        skip_configs: selected_domains
            .contains("skipconfigs")
            .then(|| snapshot.skip_configs.clone())
            .unwrap_or_default(),
    }
}

async fn require_profile_sync_session(state: &AppState) -> AppResult<ProfileSyncSession> {
    state
        .profile_sync_session
        .read()
        .await
        .clone()
        .ok_or_else(|| {
            AppError::new(
                StatusCode::UNAUTHORIZED,
                "当前 Web 帐号未登录，请重新开启同步",
            )
        })
}

async fn sync_profile_now(
    state: &AppState,
    remote_base_url: &str,
    remote_session: &ProfileSyncSession,
    sync_domains: &[String],
    strategy: DesktopProfileSyncConflictStrategy,
) -> AppResult<()> {
    let snapshot = state
        .profile_store()
        .load_snapshot(&remote_session.username)
        .map_err(|error| AppError::internal(error.to_string()))?;
    let filtered_snapshot = build_local_snapshot_for_sync_domains(&snapshot, sync_domains);
    let should_sync_adminsettings = sync_domains_include_adminsettings(sync_domains);
    let admin_config_snapshot = if should_sync_adminsettings
        && strategy == DesktopProfileSyncConflictStrategy::LocalFirst
    {
        Some(load_local_admin_config_snapshot(state)?)
    } else {
        None
    };

    merge_remote_profile_snapshot(
        state,
        remote_base_url,
        &remote_session.username,
        strategy,
        &filtered_snapshot,
        sync_domains,
        admin_config_snapshot.as_ref(),
    )
    .await?;

    if should_sync_adminsettings && strategy == DesktopProfileSyncConflictStrategy::WebFirst {
        let remote_admin_config = fetch_remote_admin_config(state, remote_base_url).await?;
        ensure_remote_admin_role(&remote_admin_config.role)?;
        let remote_admin_config = decode_remote_admin_config_snapshot(remote_admin_config.config)?;
        apply_remote_admin_config_to_local_state(
            state,
            remote_base_url,
            sync_domains,
            remote_admin_config,
        )?;
    }

    Ok(())
}

fn ensure_profile_sync_not_enabled(state: &AppState) -> AppResult<()> {
    let config = state
        .load_config()
        .map_err(|error| AppError::internal(error.to_string()))?;
    if config.profile_sync_api_base_url.is_some() {
        return Err(AppError::bad_request("当前桌面已经开启帐号同步"));
    }

    Ok(())
}

fn resolve_remote_base_url(remote_base_url: Option<String>) -> AppResult<String> {
    Ok(normalize_owned_string(remote_base_url)
        .unwrap_or_else(|| DEFAULT_DESKTOP_PROFILE_SYNC_API_BASE_URL.to_string()))
}

fn parse_required_conflict_strategy(
    strategy: Option<String>,
) -> AppResult<DesktopProfileSyncConflictStrategy> {
    require_owned_string(strategy, "缺少冲突策略")?
        .parse::<DesktopProfileSyncConflictStrategy>()
        .map_err(AppError::bad_request)
}

fn parse_optional_conflict_strategy(
    strategy: Option<String>,
    default_strategy: DesktopProfileSyncConflictStrategy,
) -> AppResult<DesktopProfileSyncConflictStrategy> {
    match normalize_owned_string(strategy) {
        Some(value) => value
            .parse::<DesktopProfileSyncConflictStrategy>()
            .map_err(AppError::bad_request),
        None => Ok(default_strategy),
    }
}

fn map_profile_sync_error_to_app_error(error: ProfileSyncError) -> AppError {
    AppError::new(error.http_status(), error.message)
}

fn is_remote_admin_role(role: &str) -> bool {
    role == "owner" || role == "admin"
}

fn ensure_remote_admin_role(role: &str) -> AppResult<()> {
    if is_remote_admin_role(role) {
        return Ok(());
    }

    Err(AppError::new(
        StatusCode::FORBIDDEN,
        "只有 Web owner/admin 可以开启帐号同步",
    ))
}

fn ensure_remote_admin_settings_sync_role(role: &str) -> AppResult<()> {
    if is_remote_admin_role(role) {
        return Ok(());
    }

    Err(AppError::new(
        StatusCode::FORBIDDEN,
        "只有 Web owner/admin 可以同步管理员设置",
    ))
}

async fn login_remote_profile_sync(
    state: &AppState,
    remote_base_url: &str,
    username: &str,
    password: &str,
) -> AppResult<ProfileSyncSession> {
    let login_body = serde_json::to_vec(&json!({
        "username": username,
        "password": password,
    }))
    .map_err(|error| AppError::internal(error.to_string()))?;
    let outcome = state
        .profile_sync
        .forward_login(
            Some(remote_base_url),
            ProfileSyncForwardRequest::new(Method::POST, "/api/login")
                .with_accept(Some("application/json".to_string()))
                .with_content_type(Some("application/json".to_string()))
                .with_body(login_body),
        )
        .await
        .map_err(map_profile_sync_error_to_app_error)?;

    match outcome.session_mutation {
        ProfileSyncSessionMutation::Set(session) => {
            *state.profile_sync_session.write().await = Some(session.clone());
            ensure_remote_admin_role(&session.role)?;
            Ok(session)
        }
        _ => Err(AppError::new(
            StatusCode::UNAUTHORIZED,
            decode_remote_error_message(&outcome.response.body)
                .unwrap_or_else(|| "Web 帐号或密码错误".to_string()),
        )),
    }
}

async fn fetch_remote_admin_config(
    state: &AppState,
    remote_base_url: &str,
) -> AppResult<RemoteAdminConfigResponse> {
    let response = send_remote_json_request(
        state,
        remote_base_url,
        Method::GET,
        "/api/admin/config",
        None,
    )
    .await?;
    decode_remote_json_response(response, Some("只有 Web owner/admin 可以开启帐号同步")).await
}

fn extract_remote_accounts_from_admin_config(
    config: &Value,
) -> Vec<DesktopProfileSyncRemoteAccountState> {
    config
        .get("UserConfig")
        .and_then(|value| value.get("Users"))
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|user| {
            user.get("username")
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|username| !username.is_empty())
                .map(|username| DesktopProfileSyncRemoteAccountState {
                    username: username.to_string(),
                    exists: true,
                })
        })
        .collect()
}

fn decode_remote_admin_config_snapshot(config: Value) -> AppResult<DesktopAdminConfig> {
    serde_json::from_value(config)
        .map_err(|error| AppError::new(StatusCode::BAD_GATEWAY, error.to_string()))
}

async fn create_remote_user(
    state: &AppState,
    remote_base_url: &str,
    username: &str,
) -> AppResult<()> {
    let response = send_remote_json_request(
        state,
        remote_base_url,
        Method::POST,
        "/api/admin/user",
        Some(json!({
            "action": "add",
            "targetUsername": username,
            "targetPassword": AUTO_CREATED_WEB_ACCOUNT_INITIAL_PASSWORD,
        })),
    )
    .await?;
    decode_remote_json_response::<Value>(response, Some("只有 Web owner/admin 可以创建同步帐号"))
        .await?;
    Ok(())
}

fn web_profile_merge_domains(sync_domains: &[String]) -> Vec<&'static str> {
    sync_domains
        .iter()
        .filter_map(|domain| match domain.as_str() {
            "playrecords" => Some("playRecords"),
            "favorites" => Some("favorites"),
            "follows" => Some("follows"),
            "searchhistory" => Some("searchHistory"),
            "skipconfigs" => Some("skipConfigs"),
            "adminsettings" => None,
            _ => None,
        })
        .collect()
}

async fn merge_remote_profile_snapshot(
    state: &AppState,
    remote_base_url: &str,
    target_username: &str,
    strategy: DesktopProfileSyncConflictStrategy,
    snapshot: &LocalProfileSnapshot,
    sync_domains: &[String],
    admin_config_snapshot: Option<&Value>,
) -> AppResult<DesktopProfileSyncMergedSummary> {
    let target_url =
        build_profile_sync_target_url(remote_base_url, REMOTE_PROFILE_SYNC_MERGE_ROUTE_PATH)
            .map_err(map_profile_sync_error_to_app_error)?;
    let mut payload = json!({
        "targetUsername": target_username,
        "strategy": strategy.as_str(),
        "domains": web_profile_merge_domains(sync_domains),
        "snapshot": {
            "playRecords": snapshot.play_records,
            "favorites": snapshot.favorites,
            "follows": snapshot.follow_records,
            "searchHistory": snapshot.search_history,
            "skipConfigs": snapshot.skip_configs,
        }
    });
    if let Some(admin_config_snapshot) = admin_config_snapshot {
        payload
            .as_object_mut()
            .context("profile sync merge payload must be an object")
            .map_err(|error| AppError::internal(error.to_string()))?
            .insert("adminConfig".to_string(), admin_config_snapshot.clone());
    }
    let response = send_remote_json_request(
        state,
        remote_base_url,
        Method::POST,
        REMOTE_PROFILE_SYNC_MERGE_ROUTE_PATH,
        Some(payload),
    )
    .await?;
    if should_surface_remote_merge_upstream_diagnostics(&response) {
        return Err(build_remote_merge_upstream_diagnostic_error(
            Method::POST,
            target_url.as_str(),
            response,
        )
        .await);
    }
    let payload = decode_remote_json_response::<RemoteProfileMergeResponse>(
        response,
        Some("只有 Web owner/admin 可以执行资料迁移"),
    )
    .await?;

    Ok(payload.summary)
}

async fn send_remote_json_request(
    state: &AppState,
    remote_base_url: &str,
    method: Method,
    path: &str,
    payload: Option<Value>,
) -> AppResult<reqwest::Response> {
    let mut request = ProfileSyncForwardRequest::new(method, path)
        .with_accept(Some("application/json".to_string()));

    if let Some(payload) = payload {
        let body =
            serde_json::to_vec(&payload).map_err(|error| AppError::internal(error.to_string()))?;
        request = request
            .with_content_type(Some("application/json".to_string()))
            .with_body(body);
    }

    let response = state
        .profile_sync
        .send(Some(remote_base_url), request)
        .await
        .map_err(map_profile_sync_error_to_app_error)?;

    if response.status() == StatusCode::UNAUTHORIZED {
        *state.profile_sync_session.write().await = None;
    }

    Ok(response)
}

async fn decode_remote_json_response<T: for<'de> Deserialize<'de>>(
    response: reqwest::Response,
    unauthorized_message: Option<&str>,
) -> AppResult<T> {
    let status = response.status();
    if status == StatusCode::UNAUTHORIZED {
        return Err(AppError::new(
            StatusCode::FORBIDDEN,
            unauthorized_message.unwrap_or("远端权限不足"),
        ));
    }

    if !status.is_success() {
        let message = decode_remote_error_message_from_response(response).await;
        return Err(if status.is_client_error() {
            AppError::bad_request(message)
        } else {
            AppError::new(StatusCode::BAD_GATEWAY, message)
        });
    }

    response
        .json::<T>()
        .await
        .map_err(|error| AppError::new(StatusCode::BAD_GATEWAY, error.to_string()))
}

async fn decode_remote_error_message_from_response(response: reqwest::Response) -> String {
    let fallback = format!(
        "远端接口返回 {} {}",
        response.status().as_u16(),
        response
            .status()
            .canonical_reason()
            .unwrap_or("upstream error")
    );

    match response.bytes().await {
        Ok(body) => decode_remote_error_message(&body).unwrap_or(fallback),
        Err(_) => fallback,
    }
}

fn decode_remote_error_message(body: &[u8]) -> Option<String> {
    if body.is_empty() {
        return None;
    }

    serde_json::from_slice::<Value>(body)
        .ok()
        .and_then(|payload| {
            payload
                .get("error")
                .and_then(Value::as_str)
                .map(str::trim)
                .map(str::to_string)
        })
        .filter(|value| !value.is_empty())
        .or_else(|| {
            String::from_utf8(body.to_vec())
                .ok()
                .map(|value| value.trim().to_string())
                .filter(|value| !value.is_empty() && !looks_like_html_document(value))
        })
}

fn looks_like_html_document(value: &str) -> bool {
    let trimmed = value.trim_start();
    let lowercase = trimmed.to_ascii_lowercase();

    lowercase.starts_with("<!doctype html") || lowercase.starts_with("<html")
}

fn should_surface_remote_merge_upstream_diagnostics(response: &reqwest::Response) -> bool {
    response.status() == StatusCode::NOT_FOUND
        || response
            .headers()
            .get(reqwest::header::CONTENT_TYPE)
            .and_then(|value| value.to_str().ok())
            .is_some_and(|value| value.to_ascii_lowercase().contains("text/html"))
}

async fn build_remote_merge_upstream_diagnostic_error(
    method: Method,
    target_url: &str,
    response: reqwest::Response,
) -> AppError {
    let status = response.status();
    let content_type = response
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .unwrap_or("unknown")
        .to_string();
    let body_prefix = match response.bytes().await {
        Ok(body) => {
            summarize_upstream_body_prefix(&body, REMOTE_PROFILE_SYNC_RESPONSE_BODY_PREFIX_LIMIT)
                .unwrap_or_else(|| "<empty>".to_string())
        }
        Err(error) => format!("<failed to read body: {error}>"),
    };
    let message = format!(
        "远端资料迁移接口异常：{} {} 返回 {}，content-type: {}，body 前缀: {}",
        method.as_str(),
        target_url,
        status,
        content_type,
        body_prefix,
    );

    warn!("{message}");
    AppError::bad_request(message)
}

fn summarize_upstream_body_prefix(body: &[u8], limit: usize) -> Option<String> {
    if body.is_empty() {
        return None;
    }

    let compact = String::from_utf8_lossy(body)
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ");
    if compact.is_empty() {
        return None;
    }

    let mut truncated = String::new();
    let mut char_count = 0usize;
    for ch in compact.chars() {
        if char_count == limit {
            truncated.push_str("...");
            return Some(truncated);
        }
        truncated.push(ch);
        char_count += 1;
    }

    Some(truncated)
}

fn load_local_account_summaries(
    state: &AppState,
) -> AppResult<Vec<DesktopProfileSyncLocalAccountSummary>> {
    let persistence = state
        .load_admin_persistence()
        .map_err(|error| AppError::internal(error.to_string()))?;
    let profile_store = state.profile_store();
    let mut seen_usernames = BTreeSet::new();
    let mut summaries = Vec::new();

    for user in persistence.config.user_config.users {
        if !seen_usernames.insert(user.username.clone()) {
            continue;
        }

        let snapshot = profile_store
            .load_snapshot(&user.username)
            .map_err(|error| AppError::internal(error.to_string()))?;
        summaries.push(DesktopProfileSyncLocalAccountSummary {
            username: user.username,
            play_record_count: snapshot.play_records.len(),
            favorite_count: snapshot.favorites.len(),
            follow_count: snapshot.follow_records.len(),
            search_history_count: snapshot.search_history.len(),
            skip_config_count: snapshot.skip_configs.len(),
        });
    }

    Ok(summaries)
}

fn resolve_current_local_username(
    requested_username: Option<String>,
    local_account_summaries: &[DesktopProfileSyncLocalAccountSummary],
) -> AppResult<String> {
    if let Some(username) = normalize_owned_string(requested_username) {
        ensure_current_local_account(local_account_summaries, &username)?;
        return Ok(username);
    }

    local_account_summaries
        .first()
        .map(|summary| summary.username.clone())
        .ok_or_else(|| AppError::bad_request("桌面本地帐号列表为空"))
}

fn ensure_current_local_account(
    local_account_summaries: &[DesktopProfileSyncLocalAccountSummary],
    current_local_username: &str,
) -> AppResult<()> {
    if local_account_summaries
        .iter()
        .any(|summary| summary.username == current_local_username)
    {
        return Ok(());
    }

    Err(AppError::bad_request("当前本地帐号不存在于桌面帐号列表"))
}

fn load_local_snapshot_map(
    state: &AppState,
    local_account_summaries: &[DesktopProfileSyncLocalAccountSummary],
) -> AppResult<BTreeMap<String, LocalProfileSnapshot>> {
    let profile_store = state.profile_store();
    let mut snapshots = BTreeMap::new();

    for summary in local_account_summaries {
        let snapshot = profile_store
            .load_snapshot(&summary.username)
            .map_err(|error| AppError::internal(error.to_string()))?;
        snapshots.insert(summary.username.clone(), snapshot);
    }

    Ok(snapshots)
}

fn load_local_admin_config_snapshot(state: &AppState) -> AppResult<Value> {
    let persistence = state
        .load_admin_persistence()
        .map_err(|error| AppError::internal(error.to_string()))?;

    let mut snapshot =
        serde_json::to_value(build_admin_settings_sync_snapshot(&persistence.config))
            .map_err(|error| AppError::internal(error.to_string()))?;
    let snapshot_object = snapshot
        .as_object_mut()
        .ok_or_else(|| AppError::internal("admin settings snapshot must be an object"))?;
    snapshot_object.remove("ConfigSubscribtion");
    snapshot_object.remove("ConfigFile");
    snapshot_object.remove("UserConfig");
    Ok(Value::Object(snapshot_object.clone()))
}

fn inspect_download_preview(
    state: &AppState,
    next_owner_username: &str,
) -> AppResult<DesktopProfileSyncDownloadPreview> {
    let snapshot = state
        .read_download_store_snapshot()
        .map_err(|error| AppError::internal(error.to_string()))?;
    let Some(snapshot) = snapshot else {
        return Ok(DesktopProfileSyncDownloadPreview {
            has_downloads: false,
            current_owner_username: None,
            target_username: None,
            task_count: 0,
            library_count: 0,
        });
    };

    let current_owner_username = snapshot
        .get("ownerUsername")
        .and_then(Value::as_str)
        .map(str::to_string);
    let task_count = snapshot
        .get("tasks")
        .and_then(Value::as_object)
        .map(|tasks| tasks.len())
        .unwrap_or(0);
    let library_count = snapshot
        .get("library")
        .and_then(Value::as_object)
        .map(|library| library.len())
        .unwrap_or(0);
    let has_downloads = current_owner_username.is_some() || task_count > 0 || library_count > 0;

    Ok(DesktopProfileSyncDownloadPreview {
        has_downloads,
        current_owner_username,
        target_username: has_downloads.then(|| next_owner_username.to_string()),
        task_count,
        library_count,
    })
}

fn rebind_local_offline_downloads(
    state: &AppState,
    next_owner_username: &str,
) -> AppResult<DesktopProfileSyncDownloadRebindResult> {
    let snapshot = state
        .read_download_store_snapshot()
        .map_err(|error| AppError::internal(error.to_string()))?;
    let Some(snapshot) = snapshot else {
        return Ok(DesktopProfileSyncDownloadRebindResult {
            did_rebind: false,
            previous_owner_username: None,
            next_owner_username: None,
            task_count: 0,
            library_count: 0,
            resource_index_count: 0,
        });
    };

    let previous_owner_username = snapshot
        .get("ownerUsername")
        .and_then(Value::as_str)
        .map(str::to_string);
    let task_count = snapshot
        .get("tasks")
        .and_then(Value::as_object)
        .map(|tasks| tasks.len())
        .unwrap_or(0);
    let library_count = snapshot
        .get("library")
        .and_then(Value::as_object)
        .map(|library| library.len())
        .unwrap_or(0);
    let has_downloads = previous_owner_username.is_some() || task_count > 0 || library_count > 0;
    if !has_downloads {
        return Ok(DesktopProfileSyncDownloadRebindResult {
            did_rebind: false,
            previous_owner_username,
            next_owner_username: None,
            task_count,
            library_count,
            resource_index_count: 0,
        });
    }

    let rebound_snapshot = rebind_download_store_snapshot_owner(snapshot, next_owner_username)
        .map_err(|error| AppError::internal(error.to_string()))?;
    state
        .write_download_store_snapshot(&rebound_snapshot)
        .map_err(|error| AppError::internal(error.to_string()))?;
    let resource_index_count = rebind_download_resource_indexes(state, next_owner_username)
        .map_err(|error| AppError::internal(error.to_string()))?;

    Ok(DesktopProfileSyncDownloadRebindResult {
        did_rebind: true,
        previous_owner_username,
        next_owner_username: Some(next_owner_username.to_string()),
        task_count,
        library_count,
        resource_index_count,
    })
}

fn rebind_download_resource_indexes(state: &AppState, next_owner_username: &str) -> Result<usize> {
    let resource_index_dir = state.download_runtime_resource_index_dir();
    if !resource_index_dir.exists() {
        return Ok(0);
    }

    let mut rewritten_count = 0;
    for entry in fs::read_dir(&resource_index_dir)
        .with_context(|| format!("failed to read {}", resource_index_dir.display()))?
    {
        let entry = entry.with_context(|| {
            format!(
                "failed to read entry under {}",
                resource_index_dir.display()
            )
        })?;
        let path = entry.path();
        if !path.is_file() {
            continue;
        }

        let mut record = read_json_file::<DesktopDownloadResourceIndexRecord>(&path)?;
        record.owner_username = next_owner_username.to_string();
        state.write_resource_index(&record)?;
        rewritten_count += 1;
    }

    Ok(rewritten_count)
}

fn persist_profile_sync_settings_into_local_config(
    state: &AppState,
    remote_base_url: &str,
    sync_domains: &[String],
) -> AppResult<()> {
    let persistence = state
        .load_admin_persistence()
        .map_err(|error| AppError::internal(error.to_string()))?;
    let subscription = persistence.config.config_subscribtion.clone();
    let next_config_file = apply_profile_sync_settings_to_config_file(
        &persistence.config.config_file,
        Some(remote_base_url),
        Some(sync_domains),
    )
    .map_err(|error| AppError::internal(error.to_string()))?;

    persist_admin_config_file_with_subscription(
        state,
        &next_config_file,
        subscription.url,
        subscription.auto_update,
        subscription.last_check,
    )
    .map_err(|error| AppError::internal(error.to_string()))
}

fn apply_remote_admin_config_to_local_state(
    state: &AppState,
    remote_base_url: &str,
    sync_domains: &[String],
    remote_admin_config: DesktopAdminConfig,
) -> AppResult<()> {
    let mut persistence = state
        .load_admin_persistence()
        .map_err(|error| AppError::internal(error.to_string()))?;
    let remote_admin_settings = build_admin_settings_sync_snapshot(&remote_admin_config);
    let next_config_file = apply_admin_settings_to_config_file(
        &persistence.config.config_file,
        &remote_admin_settings,
    )
    .and_then(|config_file| {
        apply_profile_sync_settings_to_config_file(
            &config_file,
            Some(remote_base_url),
            Some(sync_domains),
        )
    })
    .map_err(|error| AppError::internal(error.to_string()))?;

    persistence.config = DesktopAdminConfig {
        config_subscribtion: persistence.config.config_subscribtion,
        config_file: next_config_file.clone(),
        user_config: persistence.config.user_config,
        site_config: remote_admin_settings.site_config,
        source_config: remote_admin_settings.source_config,
        custom_categories: remote_admin_settings.custom_categories,
        live_config: remote_admin_settings.live_config,
        ad_filter_config: remote_admin_settings.ad_filter_config,
        player_enhancement_config: remote_admin_settings.player_enhancement_config,
    };
    persistence.profile_sync_api_base_url = Some(remote_base_url.to_string());
    persistence.profile_sync_sync_domains = sync_domains.to_vec();

    state
        .write_raw_config(&next_config_file)
        .map_err(|error| AppError::internal(error.to_string()))?;
    state
        .save_admin_persistence(&persistence)
        .map_err(|error| AppError::internal(error.to_string()))?;

    let merged_persistence = state
        .load_admin_persistence()
        .map_err(|error| AppError::internal(error.to_string()))?;
    state
        .save_admin_persistence(&merged_persistence)
        .map_err(|error| AppError::internal(error.to_string()))
}

fn base_onboarding_warnings() -> Vec<String> {
    vec!["仅当前仍保留的这套离线下载可以迁移，之前已清理的旧归属无法恢复。".to_string()]
}

fn preview_onboarding_warnings(show_password_warning: bool) -> Vec<String> {
    let mut warnings = base_onboarding_warnings();
    if show_password_warning {
        warnings.push(format!(
            "如果继续执行时需要自动创建 Web 帐号，会生成初始密码 {}。完成后请立即登录修改。",
            AUTO_CREATED_WEB_ACCOUNT_INITIAL_PASSWORD
        ));
    }

    warnings
}

fn execute_onboarding_warnings(show_password_warning: bool) -> Vec<String> {
    let mut warnings = base_onboarding_warnings();
    if show_password_warning {
        warnings.push("如果本次自动创建了 Web 帐号，请登录后立即修改初始密码。".to_string());
    }

    warnings
}

impl DesktopProfileSyncConflictStrategy {
    fn as_str(self) -> &'static str {
        match self {
            Self::WebFirst => "web-first",
            Self::LocalFirst => "local-first",
        }
    }
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::{
        DesktopProfileSyncConflictStrategy, DesktopProfileSyncLocalAccountSummary,
        DesktopProfileSyncOnboardingPlan, DesktopProfileSyncOnboardingPlanItem,
        DesktopProfileSyncRemoteAccountState, apply_profile_sync_api_base_url_to_config_file,
        plan_profile_sync_onboarding, preview_onboarding_warnings,
        rebind_download_store_snapshot_owner,
    };

    #[test]
    fn current_local_account_maps_to_current_web_account_and_others_map_by_same_name() {
        let plan = plan_profile_sync_onboarding(
            vec![
                DesktopProfileSyncLocalAccountSummary {
                    username: "alpha".to_string(),
                    play_record_count: 1,
                    favorite_count: 0,
                    follow_count: 0,
                    search_history_count: 0,
                    skip_config_count: 0,
                },
                DesktopProfileSyncLocalAccountSummary {
                    username: "beta".to_string(),
                    play_record_count: 0,
                    favorite_count: 1,
                    follow_count: 0,
                    search_history_count: 0,
                    skip_config_count: 0,
                },
                DesktopProfileSyncLocalAccountSummary {
                    username: "gamma".to_string(),
                    play_record_count: 0,
                    favorite_count: 0,
                    follow_count: 1,
                    search_history_count: 0,
                    skip_config_count: 0,
                },
            ],
            "alpha",
            "remote-owner",
            &[
                DesktopProfileSyncRemoteAccountState {
                    username: "remote-owner".to_string(),
                    exists: true,
                },
                DesktopProfileSyncRemoteAccountState {
                    username: "beta".to_string(),
                    exists: true,
                },
            ],
        );

        assert_eq!(
            plan,
            DesktopProfileSyncOnboardingPlan {
                current_local_username: "alpha".to_string(),
                current_remote_username: "remote-owner".to_string(),
                items: vec![
                    DesktopProfileSyncOnboardingPlanItem {
                        local_username: "alpha".to_string(),
                        remote_username: "remote-owner".to_string(),
                        requires_account_creation: false,
                        summary: DesktopProfileSyncLocalAccountSummary {
                            username: "alpha".to_string(),
                            play_record_count: 1,
                            favorite_count: 0,
                            follow_count: 0,
                            search_history_count: 0,
                            skip_config_count: 0,
                        },
                    },
                    DesktopProfileSyncOnboardingPlanItem {
                        local_username: "beta".to_string(),
                        remote_username: "beta".to_string(),
                        requires_account_creation: false,
                        summary: DesktopProfileSyncLocalAccountSummary {
                            username: "beta".to_string(),
                            play_record_count: 0,
                            favorite_count: 1,
                            follow_count: 0,
                            search_history_count: 0,
                            skip_config_count: 0,
                        },
                    },
                    DesktopProfileSyncOnboardingPlanItem {
                        local_username: "gamma".to_string(),
                        remote_username: "gamma".to_string(),
                        requires_account_creation: true,
                        summary: DesktopProfileSyncLocalAccountSummary {
                            username: "gamma".to_string(),
                            play_record_count: 0,
                            favorite_count: 0,
                            follow_count: 1,
                            search_history_count: 0,
                            skip_config_count: 0,
                        },
                    },
                ],
            }
        );
    }

    #[test]
    fn preview_warnings_explain_auto_created_account_follow_up() {
        assert_eq!(
            preview_onboarding_warnings(true),
            vec![
                "仅当前仍保留的这套离线下载可以迁移，之前已清理的旧归属无法恢复。"
                    .to_string(),
                "如果继续执行时需要自动创建 Web 帐号，会生成初始密码 123456。完成后请立即登录修改。"
                    .to_string(),
            ]
        );
    }

    #[test]
    fn config_file_is_patched_with_profile_sync_api_base_url() {
        let updated = apply_profile_sync_api_base_url_to_config_file(
            r#"{
  "auth": {
    "username": "owner",
    "password": "123456"
  }
}"#,
            Some("https://luna.hkcu.qzz.io"),
        )
        .expect("patch profile sync config");

        let payload = serde_json::from_str::<serde_json::Value>(&updated).expect("parse updated");
        assert_eq!(
            payload["profile_sync"]["api_base_url"],
            json!("https://luna.hkcu.qzz.io")
        );
    }

    #[test]
    fn download_store_snapshot_owner_is_rebound_without_dropping_tasks_or_library() {
        let rebound = rebind_download_store_snapshot_owner(
            json!({
                "ownerUsername": "local-alpha",
                "tasks": {
                    "demo:1:0": {
                        "id": "demo:1:0"
                    }
                },
                "library": {
                    "demo:1": {
                        "contentId": "demo:1",
                        "ownerUsername": "local-alpha",
                        "episodes": []
                    }
                }
            }),
            "remote-owner",
        )
        .expect("rebind snapshot owner");

        assert_eq!(rebound["ownerUsername"], json!("remote-owner"));
        assert_eq!(
            rebound["library"]["demo:1"]["ownerUsername"],
            json!("remote-owner")
        );
        assert_eq!(rebound["tasks"]["demo:1:0"]["id"], json!("demo:1:0"));
    }

    #[test]
    fn conflict_strategy_parser_accepts_supported_values() {
        assert_eq!(
            "web-first".parse::<DesktopProfileSyncConflictStrategy>(),
            Ok(DesktopProfileSyncConflictStrategy::WebFirst)
        );
        assert_eq!(
            "local-first".parse::<DesktopProfileSyncConflictStrategy>(),
            Ok(DesktopProfileSyncConflictStrategy::LocalFirst)
        );
    }
}
