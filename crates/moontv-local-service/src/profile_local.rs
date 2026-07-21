use axum::{
    body::to_bytes,
    extract::Request,
    http::{HeaderMap, Method, StatusCode, header::COOKIE},
    response::Response,
};
use moontv_profile::{
    Favorite, FollowRecord, LocalDesktopProfileStore, PlayRecord, ProfileDomain, ProfileMutation,
    SkipConfig,
};
use serde::{Deserialize, Serialize};
use serde_json::json;
use url::form_urlencoded;

use crate::{
    AppError, AppResult, AppState, DEFAULT_DESKTOP_OWNER_USERNAME, build_local_auth_status_payload,
    current_timestamp_ms, no_store_json_response, resolve_owner_username_for_import,
};

const SEARCH_HISTORY_LIMIT: usize = 20;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DesktopAuthCookiePayload {
    username: Option<String>,
    session_mode: Option<String>,
}

#[derive(Debug, Deserialize)]
struct SavePlayRecordPayload {
    key: String,
    record: PlayRecord,
}

#[derive(Debug, Deserialize)]
struct SaveFavoritePayload {
    key: String,
    favorite: Favorite,
}

#[derive(Debug, Deserialize)]
struct SaveFollowRecordPayload {
    key: String,
    follow: FollowRecord,
}

#[derive(Debug, Deserialize)]
struct SaveSearchHistoryPayload {
    keyword: String,
}

#[derive(Debug, Deserialize)]
struct SaveSkipConfigPayload {
    key: String,
    config: SkipConfig,
}

pub(crate) async fn handle_profile_playrecords(
    state: &AppState,
    request: Request,
) -> AppResult<Response> {
    let username = resolve_local_profile_username(state, request.headers()).await?;
    let store = state.profile_store();
    let lock = state.acquire_profile_mutation_lock(&username, ProfileDomain::PlayRecords);
    let _guard = lock.lock().await;

    match *request.method() {
        Method::GET => {
            let records = store
                .load_play_records(&username)
                .map_err(|error| AppError::internal(error.to_string()))?;
            no_store_json_response(&records)
        }
        Method::POST => {
            let payload = parse_request_json::<SavePlayRecordPayload>(request).await?;
            let key = require_composite_key(&payload.key, "Invalid key format")?;
            validate_play_record(&payload.record)?;
            let mut records = store
                .load_play_records(&username)
                .map_err(|error| AppError::internal(error.to_string()))?;
            let mut record = payload.record;
            if record.save_time == 0 {
                record.save_time = current_timestamp_ms() as i64;
            }
            records.insert(key.clone(), record.clone());
            persist_local_profile_mutation(
                state,
                &store,
                &username,
                ProfileDomain::PlayRecords,
                &records,
                ProfileMutation::Upsert {
                    entity_key: key,
                    value: serde_json::to_value(record)
                        .map_err(|error| AppError::internal(error.to_string()))?,
                },
            )?;
            success_response()
        }
        Method::DELETE => {
            let key = request_query_param(&request, "key");
            if let Some(key) = key {
                let mut records = store
                    .load_play_records(&username)
                    .map_err(|error| AppError::internal(error.to_string()))?;
                records.remove(&key);
                persist_local_profile_mutation(
                    state,
                    &store,
                    &username,
                    ProfileDomain::PlayRecords,
                    &records,
                    ProfileMutation::Delete { entity_key: key },
                )?;
            } else {
                let mut records = store
                    .load_play_records(&username)
                    .map_err(|error| AppError::internal(error.to_string()))?;
                records.clear();
                persist_local_profile_mutation(
                    state,
                    &store,
                    &username,
                    ProfileDomain::PlayRecords,
                    &records,
                    ProfileMutation::ClearDomain,
                )?;
            }

            success_response()
        }
        _ => Err(AppError::new(
            StatusCode::METHOD_NOT_ALLOWED,
            "Method not allowed",
        )),
    }
}

pub(crate) async fn handle_profile_favorites(
    state: &AppState,
    request: Request,
) -> AppResult<Response> {
    let username = resolve_local_profile_username(state, request.headers()).await?;
    let store = state.profile_store();
    let lock = state.acquire_profile_mutation_lock(&username, ProfileDomain::Favorites);
    let _guard = lock.lock().await;

    match *request.method() {
        Method::GET => {
            let favorites = store
                .load_favorites(&username)
                .map_err(|error| AppError::internal(error.to_string()))?;
            if let Some(key) = request_query_param(&request, "key") {
                no_store_json_response(&favorites.get(&key).cloned())
            } else {
                no_store_json_response(&favorites)
            }
        }
        Method::POST => {
            let payload = parse_request_json::<SaveFavoritePayload>(request).await?;
            let key = require_composite_key(&payload.key, "Invalid key format")?;
            validate_favorite(&payload.favorite)?;
            let mut favorites = store
                .load_favorites(&username)
                .map_err(|error| AppError::internal(error.to_string()))?;
            let mut favorite = payload.favorite;
            if favorite.save_time == 0 {
                favorite.save_time = current_timestamp_ms() as i64;
            }
            favorites.insert(key.clone(), favorite.clone());
            persist_local_profile_mutation(
                state,
                &store,
                &username,
                ProfileDomain::Favorites,
                &favorites,
                ProfileMutation::Upsert {
                    entity_key: key,
                    value: serde_json::to_value(favorite)
                        .map_err(|error| AppError::internal(error.to_string()))?,
                },
            )?;
            success_response()
        }
        Method::DELETE => {
            let key = request_query_param(&request, "key");
            if let Some(key) = key {
                let mut favorites = store
                    .load_favorites(&username)
                    .map_err(|error| AppError::internal(error.to_string()))?;
                favorites.remove(&key);
                persist_local_profile_mutation(
                    state,
                    &store,
                    &username,
                    ProfileDomain::Favorites,
                    &favorites,
                    ProfileMutation::Delete { entity_key: key },
                )?;
            } else {
                let mut favorites = store
                    .load_favorites(&username)
                    .map_err(|error| AppError::internal(error.to_string()))?;
                favorites.clear();
                persist_local_profile_mutation(
                    state,
                    &store,
                    &username,
                    ProfileDomain::Favorites,
                    &favorites,
                    ProfileMutation::ClearDomain,
                )?;
            }

            success_response()
        }
        _ => Err(AppError::new(
            StatusCode::METHOD_NOT_ALLOWED,
            "Method not allowed",
        )),
    }
}

pub(crate) async fn handle_profile_follows(
    state: &AppState,
    request: Request,
) -> AppResult<Response> {
    let username = resolve_local_profile_username(state, request.headers()).await?;
    let store = state.profile_store();
    let lock = state.acquire_profile_mutation_lock(&username, ProfileDomain::Follows);
    let _guard = lock.lock().await;

    match *request.method() {
        Method::GET => {
            let follows = store
                .load_follow_records(&username)
                .map_err(|error| AppError::internal(error.to_string()))?;
            if let Some(key) = request_query_param(&request, "key") {
                no_store_json_response(&follows.get(&key).cloned())
            } else {
                no_store_json_response(&follows)
            }
        }
        Method::POST => {
            let payload = parse_request_json::<SaveFollowRecordPayload>(request).await?;
            let key = require_composite_key(&payload.key, "Invalid key format")?;
            validate_follow_record(&payload.follow)?;
            let mut follows = store
                .load_follow_records(&username)
                .map_err(|error| AppError::internal(error.to_string()))?;
            let now = current_timestamp_ms() as i64;
            let followed_episode_count = payload.follow.followed_episode_count.max(1);
            let acknowledged_episode_count = payload
                .follow
                .acknowledged_episode_count
                .max(followed_episode_count)
                .max(1);
            let latest_episode_count = payload
                .follow
                .latest_episode_count
                .max(followed_episode_count)
                .max(acknowledged_episode_count);

            let follow = FollowRecord {
                title: payload.follow.title,
                source_name: payload.follow.source_name,
                year: payload.follow.year,
                cover: payload.follow.cover,
                search_title: payload.follow.search_title,
                followed_at: if payload.follow.followed_at > 0 {
                    payload.follow.followed_at
                } else {
                    now
                },
                followed_episode_count,
                acknowledged_episode_count,
                latest_episode_count,
                last_checked_at: if payload.follow.last_checked_at > 0 {
                    payload.follow.last_checked_at
                } else {
                    now
                },
            };

            follows.insert(key.clone(), follow.clone());
            persist_local_profile_mutation(
                state,
                &store,
                &username,
                ProfileDomain::Follows,
                &follows,
                ProfileMutation::Upsert {
                    entity_key: key,
                    value: serde_json::to_value(follow)
                        .map_err(|error| AppError::internal(error.to_string()))?,
                },
            )?;
            success_response()
        }
        Method::DELETE => {
            let key = request_query_param(&request, "key");
            if let Some(key) = key {
                let mut follows = store
                    .load_follow_records(&username)
                    .map_err(|error| AppError::internal(error.to_string()))?;
                follows.remove(&key);
                persist_local_profile_mutation(
                    state,
                    &store,
                    &username,
                    ProfileDomain::Follows,
                    &follows,
                    ProfileMutation::Delete { entity_key: key },
                )?;
            } else {
                let mut follows = store
                    .load_follow_records(&username)
                    .map_err(|error| AppError::internal(error.to_string()))?;
                follows.clear();
                persist_local_profile_mutation(
                    state,
                    &store,
                    &username,
                    ProfileDomain::Follows,
                    &follows,
                    ProfileMutation::ClearDomain,
                )?;
            }

            success_response()
        }
        _ => Err(AppError::new(
            StatusCode::METHOD_NOT_ALLOWED,
            "Method not allowed",
        )),
    }
}

pub(crate) async fn handle_profile_search_history(
    state: &AppState,
    request: Request,
) -> AppResult<Response> {
    let username = resolve_local_profile_username(state, request.headers()).await?;
    let store = state.profile_store();
    let lock = state.acquire_profile_mutation_lock(&username, ProfileDomain::SearchHistory);
    let _guard = lock.lock().await;

    match *request.method() {
        Method::GET => {
            let history = store
                .load_search_history(&username)
                .map_err(|error| AppError::internal(error.to_string()))?;
            no_store_json_response(&history)
        }
        Method::POST => {
            let payload = parse_request_json::<SaveSearchHistoryPayload>(request).await?;
            let keyword = normalize_optional_string(Some(payload.keyword))
                .ok_or_else(|| AppError::bad_request("Keyword is required"))?;
            let mut history = store
                .load_search_history(&username)
                .map_err(|error| AppError::internal(error.to_string()))?;
            history.retain(|item| item != &keyword);
            history.insert(0, keyword.clone());
            history.truncate(SEARCH_HISTORY_LIMIT);
            persist_local_profile_mutation(
                state,
                &store,
                &username,
                ProfileDomain::SearchHistory,
                &history,
                ProfileMutation::Upsert {
                    entity_key: keyword.clone(),
                    value: serde_json::Value::String(keyword),
                },
            )?;
            no_store_json_response(&history)
        }
        Method::DELETE => {
            let keyword = request_query_param(&request, "keyword")
                .and_then(|value| normalize_optional_string(Some(value)));
            if let Some(keyword) = keyword {
                let mut history = store
                    .load_search_history(&username)
                    .map_err(|error| AppError::internal(error.to_string()))?;
                history.retain(|item| item != &keyword);
                persist_local_profile_mutation(
                    state,
                    &store,
                    &username,
                    ProfileDomain::SearchHistory,
                    &history,
                    ProfileMutation::Delete {
                        entity_key: keyword,
                    },
                )?;
            } else {
                let mut history = store
                    .load_search_history(&username)
                    .map_err(|error| AppError::internal(error.to_string()))?;
                history.clear();
                persist_local_profile_mutation(
                    state,
                    &store,
                    &username,
                    ProfileDomain::SearchHistory,
                    &history,
                    ProfileMutation::ClearDomain,
                )?;
            }

            success_response()
        }
        _ => Err(AppError::new(
            StatusCode::METHOD_NOT_ALLOWED,
            "Method not allowed",
        )),
    }
}

pub(crate) async fn handle_profile_skip_configs(
    state: &AppState,
    request: Request,
) -> AppResult<Response> {
    let username = resolve_local_profile_username(state, request.headers()).await?;
    let store = state.profile_store();
    let lock = state.acquire_profile_mutation_lock(&username, ProfileDomain::SkipConfigs);
    let _guard = lock.lock().await;

    match *request.method() {
        Method::GET => {
            let configs = store
                .load_skip_configs(&username)
                .map_err(|error| AppError::internal(error.to_string()))?;
            let source = request_query_param(&request, "source");
            let id = request_query_param(&request, "id");

            if let (Some(source), Some(id)) = (source, id) {
                no_store_json_response(&configs.get(&format!("{source}+{id}")).cloned())
            } else {
                no_store_json_response(&configs)
            }
        }
        Method::POST => {
            let payload = parse_request_json::<SaveSkipConfigPayload>(request).await?;
            let key = require_composite_key(&payload.key, "无效的key格式")?;
            let mut configs = store
                .load_skip_configs(&username)
                .map_err(|error| AppError::internal(error.to_string()))?;
            let config = SkipConfig {
                enable: payload.config.enable,
                intro_time: payload.config.intro_time.max(0),
                outro_time: payload.config.outro_time.max(0),
            };
            configs.insert(key.clone(), config.clone());
            persist_local_profile_mutation(
                state,
                &store,
                &username,
                ProfileDomain::SkipConfigs,
                &configs,
                ProfileMutation::Upsert {
                    entity_key: key,
                    value: serde_json::to_value(config)
                        .map_err(|error| AppError::internal(error.to_string()))?,
                },
            )?;
            success_response()
        }
        Method::DELETE => {
            let key = request_query_param(&request, "key")
                .ok_or_else(|| AppError::bad_request("缺少必要参数"))?;
            let key = require_composite_key(&key, "无效的key格式")?;
            let mut configs = store
                .load_skip_configs(&username)
                .map_err(|error| AppError::internal(error.to_string()))?;
            configs.remove(&key);
            persist_local_profile_mutation(
                state,
                &store,
                &username,
                ProfileDomain::SkipConfigs,
                &configs,
                ProfileMutation::Delete { entity_key: key },
            )?;
            success_response()
        }
        _ => Err(AppError::new(
            StatusCode::METHOD_NOT_ALLOWED,
            "Method not allowed",
        )),
    }
}

async fn resolve_local_profile_username(
    state: &AppState,
    headers: &HeaderMap,
) -> AppResult<String> {
    if let Some(payload) = extract_auth_cookie_payload(headers) {
        if payload.session_mode.as_deref() == Some("desktop-profile-sync") {
            // Remote sync credentials are never an identity for the local SQLite
            // profile. The caller must retain/use the independent desktop-local
            // session so remote account changes cannot switch local namespaces.
            return Err(AppError::new(StatusCode::UNAUTHORIZED, "Unauthorized"));
        }

        let username = normalize_optional_string(payload.username)
            .ok_or_else(|| AppError::new(StatusCode::UNAUTHORIZED, "Unauthorized"))?;
        validate_local_profile_user(state, &username)?;
        return Ok(username);
    }

    let auth_status = build_local_auth_status_payload(state)
        .map_err(|error| AppError::internal(error.to_string()))?;
    if !auth_status.password_required {
        return Ok(auth_status.username);
    }

    Err(AppError::new(StatusCode::UNAUTHORIZED, "Unauthorized"))
}

fn persist_local_profile_mutation<T>(
    state: &AppState,
    store: &LocalDesktopProfileStore,
    username: &str,
    domain: ProfileDomain,
    snapshot: &T,
    mutation: ProfileMutation,
) -> AppResult<()>
where
    T: Serialize + ?Sized,
{
    let config = state
        .load_config()
        .map_err(|error| AppError::internal(error.to_string()))?;
    if config.profile_sync_api_base_url.is_none()
        || !config
            .profile_sync_domains
            .iter()
            .any(|configured_domain| configured_domain == domain.as_str())
    {
        return store
            .save_profile_domain_snapshot(username, domain, snapshot)
            .map_err(|error| AppError::internal(error.to_string()));
    }

    let device_id = store
        .get_or_create_device_id()
        .map_err(|error| AppError::internal(error.to_string()))?;
    store
        .apply_local_mutation_and_enqueue(username, &device_id, domain, snapshot, mutation)
        .map_err(|error| AppError::internal(error.to_string()))?;
    Ok(())
}

fn validate_local_profile_user(state: &AppState, username: &str) -> AppResult<()> {
    let persistence = state
        .load_admin_persistence()
        .map_err(|error| AppError::internal(error.to_string()))?;
    let owner_username = resolve_owner_username_for_import(&persistence.config)
        .unwrap_or_else(|| DEFAULT_DESKTOP_OWNER_USERNAME.to_string());

    if username == owner_username {
        return Ok(());
    }

    let user = persistence
        .config
        .user_config
        .users
        .iter()
        .find(|item| item.username == username)
        .ok_or_else(|| AppError::new(StatusCode::UNAUTHORIZED, "用户不存在"))?;

    if user.banned {
        return Err(AppError::new(StatusCode::UNAUTHORIZED, "用户已被封禁"));
    }

    Ok(())
}

fn extract_auth_cookie_payload(headers: &HeaderMap) -> Option<DesktopAuthCookiePayload> {
    let cookie_header = headers.get(COOKIE)?.to_str().ok()?;

    for cookie in cookie_header.split(';') {
        let trimmed = cookie.trim();
        let Some((key, raw_value)) = trimmed.split_once('=') else {
            continue;
        };

        if key != "auth" {
            continue;
        }

        let decoded = decode_cookie_value(raw_value)?;
        if let Ok(payload) = serde_json::from_str::<DesktopAuthCookiePayload>(&decoded) {
            return Some(payload);
        }
    }

    None
}

fn decode_cookie_value(raw_value: &str) -> Option<String> {
    let first_pass = decode_percent_encoded_value(raw_value)?;
    if first_pass.contains('%') {
        return decode_percent_encoded_value(&first_pass).or(Some(first_pass));
    }

    Some(first_pass)
}

fn decode_percent_encoded_value(raw_value: &str) -> Option<String> {
    let query = format!("value={raw_value}");
    form_urlencoded::parse(query.as_bytes())
        .find_map(|(key, value)| (key == "value").then(|| value.into_owned()))
}

fn request_query_param(request: &Request, key: &str) -> Option<String> {
    request.uri().query().and_then(|query| {
        form_urlencoded::parse(query.as_bytes())
            .find_map(|(name, value)| (name == key).then(|| value.into_owned()))
    })
}

async fn parse_request_json<T>(request: Request) -> AppResult<T>
where
    T: for<'de> Deserialize<'de>,
{
    let body = to_bytes(request.into_body(), usize::MAX)
        .await
        .map_err(|error| AppError::bad_request(format!("请求体格式错误: {error}")))?;
    serde_json::from_slice(&body)
        .map_err(|error| AppError::bad_request(format!("请求体格式错误: {error}")))
}

fn require_key(raw_key: &str, error_message: &str) -> AppResult<String> {
    normalize_optional_string(Some(raw_key.to_string()))
        .ok_or_else(|| AppError::bad_request(error_message))
}

fn require_composite_key(raw_key: &str, error_message: &str) -> AppResult<String> {
    let key = require_key(raw_key, error_message)?;
    let mut parts = key.split('+');
    let source = parts.next().unwrap_or_default();
    let id = parts.next().unwrap_or_default();

    if source.is_empty() || id.is_empty() {
        return Err(AppError::bad_request(error_message));
    }

    Ok(key)
}

fn validate_play_record(record: &PlayRecord) -> AppResult<()> {
    if !has_text(&record.title) || !has_text(&record.source_name) || record.index < 1 {
        return Err(AppError::bad_request("Invalid record data"));
    }

    Ok(())
}

fn validate_favorite(favorite: &Favorite) -> AppResult<()> {
    if !has_text(&favorite.title) || !has_text(&favorite.source_name) {
        return Err(AppError::bad_request("Invalid favorite data"));
    }

    Ok(())
}

fn validate_follow_record(follow: &FollowRecord) -> AppResult<()> {
    if !has_text(&follow.title) || follow.followed_episode_count < 1 {
        return Err(AppError::bad_request("Invalid follow data"));
    }

    Ok(())
}

fn has_text(value: &str) -> bool {
    !value.trim().is_empty()
}

fn normalize_optional_string(value: Option<String>) -> Option<String> {
    value.and_then(|item| {
        let trimmed = item.trim();
        if trimmed.is_empty() {
            None
        } else {
            Some(trimmed.to_string())
        }
    })
}

fn success_response() -> AppResult<Response> {
    no_store_json_response(&json!({ "success": true }))
}
