use axum::{
    Json,
    body::{Body, to_bytes},
    extract::{Request, State},
    http::{
        HeaderValue, StatusCode,
        header::{CACHE_CONTROL, CONTENT_TYPE},
    },
    response::{IntoResponse, Response},
};
use moontv_sync::{
    ProfileSyncError, ProfileSyncForwardOutcome, ProfileSyncForwardRequest,
    ProfileSyncForwardResponse, ProfileSyncSessionMutation, ProfileSyncStatusResponse,
};
use serde::{Deserialize, Serialize};

use crate::profile_local;
use crate::profile_sync_worker::{profile_outbox_worker_status, wake_profile_outbox_worker};
use crate::{
    AppError, AppResult, AppState, ServiceConfig, build_profile_bootstrap_response,
    no_store_json_response,
};

const PROFILE_SYNC_LAST_SUCCESSFUL_SESSION_METADATA_KEY: &str =
    "desktop:profile-sync-last-successful-session";
const PROFILE_SYNC_ACCOUNT_BINDING_METADATA_KEY: &str = "desktop:profile-sync-account-binding";

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct PersistedProfileSyncSessionMetadata<'a> {
    username: &'a str,
    role: &'a str,
    updated_at_ms: i64,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct PersistedProfileSyncAccountBinding {
    local_username: String,
    remote_username: String,
    updated_at_ms: i64,
}

pub(crate) async fn proxy_profile_sync_login(
    State(state): State<AppState>,
    request: Request,
) -> AppResult<Response> {
    let config = state
        .load_config()
        .map_err(|error| AppError::internal(error.to_string()))?;
    let forward_request = build_profile_sync_forward_request(request).await?;
    let (request_epoch, forward_request) = reserve_profile_sync_request(
        &state,
        config.profile_sync_api_base_url.as_deref(),
        forward_request,
    )
    .await?;
    let outcome = state
        .profile_sync
        .forward_login(config.profile_sync_api_base_url.as_deref(), forward_request)
        .await
        .map_err(map_profile_sync_error)?;

    apply_profile_sync_session_mutation(&state, &outcome, request_epoch).await;
    response_from_forward_response(outcome.response)
}

pub(crate) async fn proxy_profile_sync_logout(
    State(state): State<AppState>,
    request: Request,
) -> AppResult<Response> {
    let config = state
        .load_config()
        .map_err(|error| AppError::internal(error.to_string()))?;
    let forward_request = build_profile_sync_forward_request(request).await?;
    let (request_epoch, forward_request) = reserve_profile_sync_request(
        &state,
        config.profile_sync_api_base_url.as_deref(),
        forward_request,
    )
    .await?;
    let outcome = state
        .profile_sync
        .forward_logout(config.profile_sync_api_base_url.as_deref(), forward_request)
        .await
        .map_err(map_profile_sync_error)?;

    apply_profile_sync_session_mutation(&state, &outcome, request_epoch).await;
    response_from_forward_response(outcome.response)
}

pub(crate) async fn proxy_profile_sync_change_password(
    State(state): State<AppState>,
    request: Request,
) -> AppResult<Response> {
    proxy_profile_sync_passthrough(&state, request).await
}

pub(crate) async fn proxy_profile_sync_passthrough(
    state: &AppState,
    request: Request,
) -> AppResult<Response> {
    let config = state
        .load_config()
        .map_err(|error| AppError::internal(error.to_string()))?;
    let forward_request = build_profile_sync_forward_request(request).await?;
    let (request_epoch, forward_request) = reserve_profile_sync_request(
        state,
        config.profile_sync_api_base_url.as_deref(),
        forward_request,
    )
    .await?;
    let outcome = state
        .profile_sync
        .forward_passthrough(config.profile_sync_api_base_url.as_deref(), forward_request)
        .await
        .map_err(map_profile_sync_error)?;

    apply_profile_sync_session_mutation(state, &outcome, request_epoch).await;
    response_from_forward_response(outcome.response)
}

pub(crate) async fn build_profile_sync_forward_request(
    request: Request,
) -> AppResult<ProfileSyncForwardRequest> {
    let (parts, body) = request.into_parts();
    let request_path = parts
        .uri
        .path_and_query()
        .map(|value| value.as_str())
        .unwrap_or_else(|| parts.uri.path())
        .to_string();
    let body_bytes = to_bytes(body, usize::MAX)
        .await
        .map_err(|error| AppError::bad_request(error.to_string()))?;
    let forward_request = ProfileSyncForwardRequest::new(parts.method, request_path)
        .with_content_type(
            parts
                .headers
                .get(CONTENT_TYPE)
                .and_then(|value| value.to_str().ok())
                .map(str::to_string),
        )
        .with_accept(
            parts
                .headers
                .get("Accept")
                .and_then(|value| value.to_str().ok())
                .map(str::to_string),
        )
        .with_body(body_bytes.to_vec());

    Ok(forward_request)
}

pub(crate) async fn build_profile_sync_status_payload(
    state: &AppState,
    config: &ServiceConfig,
) -> ProfileSyncStatusResponse {
    let session = state.profile_sync_session.read().await.session.clone();
    let last_username = state.profile_sync_last_username.read().await.clone();
    let status_username = match session.as_ref() {
        Some(session) => read_profile_sync_account_binding(state)
            .filter(|(_, remote_username)| remote_username == &session.username)
            .map(|(local_username, _)| local_username)
            .or_else(|| Some(session.username.clone())),
        None => state
            .sqlite
            .latest_auth_blocked_profile_sync_worker_state()
            .map(|worker_state| worker_state.map(|item| item.username))
            .unwrap_or_else(|error| {
                tracing::warn!("failed to find persisted auth-blocked profile for status: {error}");
                None
            })
            .or(last_username),
    };
    let mut payload = state
        .profile_sync
        .build_status_response(
            config.profile_sync_api_base_url.as_deref(),
            session.as_ref(),
            &config.profile_sync_domains,
        )
        .await;
    let worker_status = profile_outbox_worker_status(state, status_username.as_deref());
    payload.pending_outbox_count = worker_status.pending_outbox_count;
    payload.reauth_required = worker_status.reauth_required;
    payload.last_outbox_error = worker_status.last_outbox_error;
    payload.next_outbox_attempt_at = worker_status.next_outbox_attempt_at;
    payload
}

pub(crate) async fn get_profile_bootstrap(State(state): State<AppState>) -> AppResult<Response> {
    let config = state
        .load_config()
        .map_err(|error| AppError::internal(error.to_string()))?;
    let payload = build_profile_bootstrap_response(&state, &config).await?;

    no_store_json_response(&payload)
}

pub(crate) async fn get_profile_sync_status(State(state): State<AppState>) -> AppResult<Response> {
    let config = state
        .load_config()
        .map_err(|error| AppError::internal(error.to_string()))?;
    let payload = build_profile_sync_status_payload(&state, &config).await;

    no_store_json_response(&payload)
}

pub(crate) async fn get_profile_sync_server_config(
    State(state): State<AppState>,
) -> AppResult<Response> {
    let config = state
        .load_config()
        .map_err(|error| AppError::internal(error.to_string()))?;

    let Some(remote_base_url) = config.profile_sync_api_base_url.as_deref() else {
        let mut response = Json(serde_json::json!({
            "StorageType": "localstorage",
            "ProfileMode": "single-user-local",
        }))
        .into_response();
        response
            .headers_mut()
            .insert(CACHE_CONTROL, HeaderValue::from_static("no-store"));
        return Ok(response);
    };

    let upstream_response = state
        .profile_sync
        .forward(
            Some(remote_base_url),
            ProfileSyncForwardRequest::get("/api/server-config"),
        )
        .await
        .map_err(map_profile_sync_error)?;

    response_from_forward_response(upstream_response)
}

macro_rules! define_profile_user_data_proxy {
    ($handler_name:ident, $local_handler:ident) => {
        pub(crate) async fn $handler_name(
            State(state): State<AppState>,
            request: Request,
        ) -> AppResult<Response> {
            // The desktop SQLite profile is authoritative. Sync is performed by
            // the outbox after this local transaction commits, never inline.
            profile_local::$local_handler(&state, request).await
        }
    };
}

define_profile_user_data_proxy!(proxy_profile_sync_playrecords, handle_profile_playrecords);
define_profile_user_data_proxy!(proxy_profile_sync_favorites, handle_profile_favorites);
define_profile_user_data_proxy!(proxy_profile_sync_follows, handle_profile_follows);
define_profile_user_data_proxy!(
    proxy_profile_sync_search_history,
    handle_profile_search_history
);
define_profile_user_data_proxy!(proxy_profile_sync_skip_configs, handle_profile_skip_configs);

pub(crate) fn response_from_forward_response(
    upstream_response: ProfileSyncForwardResponse,
) -> AppResult<Response> {
    response_from_parts(
        upstream_response.status,
        upstream_response.content_type.as_deref(),
        upstream_response.body,
    )
}

pub(crate) fn response_from_parts(
    status: StatusCode,
    content_type: Option<&str>,
    body: Vec<u8>,
) -> AppResult<Response> {
    let mut response = Response::builder()
        .status(status)
        .body(Body::from(body))
        .map_err(|error| AppError::internal(error.to_string()))?;

    if let Some(content_type) = content_type {
        if let Ok(content_type) = HeaderValue::from_str(content_type) {
            response.headers_mut().insert(CONTENT_TYPE, content_type);
        }
    }

    response
        .headers_mut()
        .insert(CACHE_CONTROL, HeaderValue::from_static("no-store"));

    Ok(response)
}

async fn apply_profile_sync_session_mutation(
    state: &AppState,
    outcome: &ProfileSyncForwardOutcome,
    request_epoch: u64,
) {
    let committed_session = {
        let mut current = state.profile_sync_session.write().await;
        if current.generation != request_epoch {
            return;
        }
        state
            .profile_sync
            .commit_response_cookies(&outcome.response);
        match &outcome.session_mutation {
            ProfileSyncSessionMutation::Keep => None,
            ProfileSyncSessionMutation::Clear => {
                current.session = None;
                None
            }
            ProfileSyncSessionMutation::Set(session) => {
                current.session = Some(session.clone());
                Some(session.clone())
            }
        }
    };

    if let Some(session) = committed_session {
        complete_profile_sync_login_commit(state, &session).await;
    }
}

#[cfg(test)]
pub(crate) async fn reserve_profile_sync_session_epoch(state: &AppState) -> u64 {
    let mut current = state.profile_sync_session.write().await;
    current.generation = current.generation.wrapping_add(1);
    current.generation
}

pub(crate) async fn reserve_profile_sync_request(
    state: &AppState,
    remote_base_url: Option<&str>,
    request: ProfileSyncForwardRequest,
) -> AppResult<(u64, ProfileSyncForwardRequest)> {
    let mut current = state.profile_sync_session.write().await;
    current.generation = current.generation.wrapping_add(1);
    let request_epoch = current.generation;
    let request = if let Some(remote_base_url) = remote_base_url {
        let snapshot = state
            .profile_sync
            .cookie_snapshot(remote_base_url, &request.request_path)
            .map_err(map_profile_sync_error)?;
        request.with_cookie_snapshot(snapshot)
    } else {
        request
    };
    Ok((request_epoch, request))
}

pub(crate) async fn commit_profile_sync_session_if_current(
    state: &AppState,
    session: moontv_sync::ProfileSyncSession,
    request_epoch: u64,
) -> bool {
    if !replace_profile_sync_session_if_current(state, session.clone(), request_epoch).await {
        return false;
    }

    complete_profile_sync_login_commit(state, &session).await;
    true
}

pub(crate) async fn commit_profile_sync_response_cookies_if_current(
    state: &AppState,
    response: &ProfileSyncForwardResponse,
    request_epoch: u64,
) -> bool {
    let current = state.profile_sync_session.write().await;
    if current.generation != request_epoch {
        return false;
    }
    state.profile_sync.commit_response_cookies(response);
    true
}

async fn complete_profile_sync_login_commit(
    state: &AppState,
    session: &moontv_sync::ProfileSyncSession,
) {
    *state.profile_sync_last_username.write().await = Some(session.username.clone());
    persist_profile_sync_session_metadata(state, session);
    if let Err(error) = state
        .sqlite
        .clear_profile_sync_auth_block(&session.username, crate::current_timestamp_ms() as i64)
    {
        tracing::warn!("failed to clear profile outbox auth block after login: {error}");
    }
    wake_profile_outbox_worker(state).await;
}

pub(crate) async fn profile_sync_session_snapshot(
    state: &AppState,
) -> (Option<moontv_sync::ProfileSyncSession>, u64) {
    let session = state.profile_sync_session.read().await;
    (session.session.clone(), session.generation)
}

pub(crate) fn persist_profile_sync_account_binding(
    state: &AppState,
    local_username: &str,
    remote_username: &str,
) {
    let binding = PersistedProfileSyncAccountBinding {
        local_username: local_username.to_string(),
        remote_username: remote_username.to_string(),
        updated_at_ms: crate::current_timestamp_ms() as i64,
    };
    if let Err(error) = state
        .sqlite
        .write_app_metadata(PROFILE_SYNC_ACCOUNT_BINDING_METADATA_KEY, &binding)
    {
        tracing::warn!("failed to persist profile sync account binding: {error}");
    }
}

pub(crate) fn read_profile_sync_account_binding(state: &AppState) -> Option<(String, String)> {
    state
        .sqlite
        .read_app_metadata::<PersistedProfileSyncAccountBinding>(
            PROFILE_SYNC_ACCOUNT_BINDING_METADATA_KEY,
        )
        .map_err(|error| {
            tracing::warn!("failed to read profile sync account binding: {error}");
            error
        })
        .ok()
        .flatten()
        .map(|binding| (binding.local_username, binding.remote_username))
}

async fn replace_profile_sync_session_if_current(
    state: &AppState,
    session: moontv_sync::ProfileSyncSession,
    request_epoch: u64,
) -> bool {
    let mut current = state.profile_sync_session.write().await;
    if current.generation != request_epoch {
        return false;
    }
    current.session = Some(session);
    true
}

#[cfg(test)]
async fn clear_profile_sync_session_if_current(state: &AppState, request_epoch: u64) -> bool {
    let mut current = state.profile_sync_session.write().await;
    if current.generation != request_epoch {
        return false;
    }
    current.session = None;
    true
}

pub(crate) async fn block_profile_sync_auth_if_current(
    state: &AppState,
    request_epoch: u64,
    username: &str,
    timestamp_ms: i64,
    error: &str,
) -> anyhow::Result<bool> {
    let mut current = state.profile_sync_session.write().await;
    if current.generation != request_epoch {
        return Ok(false);
    }
    state
        .sqlite
        .block_profile_sync_auth(username, timestamp_ms, error)?;
    current.session = None;
    Ok(true)
}

fn persist_profile_sync_session_metadata(
    state: &AppState,
    session: &moontv_sync::ProfileSyncSession,
) {
    let metadata = PersistedProfileSyncSessionMetadata {
        username: &session.username,
        role: &session.role,
        updated_at_ms: crate::current_timestamp_ms() as i64,
    };
    if let Err(error) = state
        .sqlite
        .write_app_metadata(PROFILE_SYNC_LAST_SUCCESSFUL_SESSION_METADATA_KEY, &metadata)
    {
        tracing::warn!("failed to persist profile sync session metadata: {error}");
    }
}

fn map_profile_sync_error(error: ProfileSyncError) -> AppError {
    AppError::new(error.http_status(), error.message)
}

#[cfg(test)]
mod tests {
    use std::{
        env, fs,
        path::PathBuf,
        sync::atomic::{AtomicU64, Ordering},
    };

    use axum::{
        Json, Router,
        http::{HeaderMap, HeaderValue, StatusCode, header::SET_COOKIE},
        response::IntoResponse,
        routing::{get, post},
    };
    use moontv_sync::ProfileSyncSession;
    use serde_json::{Value, json};

    use super::{
        apply_profile_sync_session_mutation, block_profile_sync_auth_if_current,
        clear_profile_sync_session_if_current, commit_profile_sync_session_if_current,
        reserve_profile_sync_session_epoch,
    };
    use crate::{AppState, DEFAULT_HOST, DEFAULT_PORT};

    static TEST_COUNTER: AtomicU64 = AtomicU64::new(0);

    #[tokio::test]
    async fn newer_login_wins_for_both_response_completion_orders() {
        for newer_completes_first in [false, true] {
            let test_dir = TestDir::new();
            let state = test_dir.state();
            let older_epoch = reserve_profile_sync_session_epoch(&state).await;
            let newer_epoch = reserve_profile_sync_session_epoch(&state).await;

            if newer_completes_first {
                assert!(
                    commit_profile_sync_session_if_current(
                        &state,
                        session("newer-user"),
                        newer_epoch,
                    )
                    .await
                );
                assert!(
                    !commit_profile_sync_session_if_current(
                        &state,
                        session("older-user"),
                        older_epoch,
                    )
                    .await
                );
            } else {
                assert!(
                    !commit_profile_sync_session_if_current(
                        &state,
                        session("older-user"),
                        older_epoch,
                    )
                    .await
                );
                assert!(
                    commit_profile_sync_session_if_current(
                        &state,
                        session("newer-user"),
                        newer_epoch,
                    )
                    .await
                );
            }

            assert_eq!(
                state
                    .profile_sync_session
                    .read()
                    .await
                    .session
                    .as_ref()
                    .map(|session| session.username.as_str()),
                Some("newer-user")
            );
        }
    }

    #[tokio::test]
    async fn logout_started_after_login_wins_even_when_login_finishes_last() {
        let test_dir = TestDir::new();
        let state = test_dir.state();
        let login_epoch = reserve_profile_sync_session_epoch(&state).await;
        let logout_epoch = reserve_profile_sync_session_epoch(&state).await;

        assert!(clear_profile_sync_session_if_current(&state, logout_epoch).await);
        assert!(
            !commit_profile_sync_session_if_current(&state, session("stale-login"), login_epoch,)
                .await
        );
        assert!(state.profile_sync_session.read().await.session.is_none());
    }

    #[tokio::test]
    async fn worker_unauthorized_cannot_clear_a_relogin_started_later() {
        let test_dir = TestDir::new();
        let state = test_dir.state();
        let worker_epoch = state.profile_sync_session.read().await.generation;
        let relogin_epoch = reserve_profile_sync_session_epoch(&state).await;

        assert!(
            commit_profile_sync_session_if_current(
                &state,
                session("relogged-user"),
                relogin_epoch,
            )
            .await
        );
        assert!(
            !block_profile_sync_auth_if_current(&state, worker_epoch, "old-user", 10, "stale 401",)
                .await
                .expect("ignore stale worker 401")
        );
        assert_eq!(
            state
                .profile_sync_session
                .read()
                .await
                .session
                .as_ref()
                .map(|session| session.username.as_str()),
            Some("relogged-user")
        );
    }

    #[tokio::test]
    async fn stale_responses_cannot_pollute_authoritative_sync_cookie() {
        let upstream = MockCookieServer::spawn().await;

        for newer_first in [false, true] {
            let test_dir = TestDir::new();
            let state = test_dir.state();
            let old_epoch = reserve_profile_sync_session_epoch(&state).await;
            let new_epoch = reserve_profile_sync_session_epoch(&state).await;
            let old = login_outcome(&state, &upstream.base_url, "old-user").await;
            let new = login_outcome(&state, &upstream.base_url, "new-user").await;
            if newer_first {
                apply_profile_sync_session_mutation(&state, &new, new_epoch).await;
                apply_profile_sync_session_mutation(&state, &old, old_epoch).await;
            } else {
                apply_profile_sync_session_mutation(&state, &old, old_epoch).await;
                apply_profile_sync_session_mutation(&state, &new, new_epoch).await;
            }
            assert_eq!(
                cookie_echo(&state, &upstream.base_url).await,
                "auth=new-user"
            );
        }

        let test_dir = TestDir::new();
        let state = test_dir.state();
        let login_epoch = reserve_profile_sync_session_epoch(&state).await;
        let logout_epoch = reserve_profile_sync_session_epoch(&state).await;
        let login = login_outcome(&state, &upstream.base_url, "late-login").await;
        let logout = state
            .profile_sync
            .forward_logout(
                Some(&upstream.base_url),
                moontv_sync::ProfileSyncForwardRequest::new(reqwest::Method::POST, "/api/logout"),
            )
            .await
            .expect("logout outcome");
        apply_profile_sync_session_mutation(&state, &logout, logout_epoch).await;
        apply_profile_sync_session_mutation(&state, &login, login_epoch).await;
        assert_eq!(cookie_echo(&state, &upstream.base_url).await, "");

        let test_dir = TestDir::new();
        let state = test_dir.state();
        let initial_epoch = reserve_profile_sync_session_epoch(&state).await;
        let initial = login_outcome(&state, &upstream.base_url, "initial-user").await;
        apply_profile_sync_session_mutation(&state, &initial, initial_epoch).await;
        let stale_epoch = state.profile_sync_session.read().await.generation;
        let stale_401 = state
            .profile_sync
            .forward_passthrough(
                Some(&upstream.base_url),
                moontv_sync::ProfileSyncForwardRequest::get("/api/stale-401"),
            )
            .await
            .expect("stale 401 outcome");
        let relogin_epoch = reserve_profile_sync_session_epoch(&state).await;
        let relogin = login_outcome(&state, &upstream.base_url, "relogin-user").await;
        apply_profile_sync_session_mutation(&state, &relogin, relogin_epoch).await;
        apply_profile_sync_session_mutation(&state, &stale_401, stale_epoch).await;
        assert_eq!(
            cookie_echo(&state, &upstream.base_url).await,
            "auth=relogin-user"
        );

        upstream.task.abort();
    }

    async fn login_outcome(
        state: &AppState,
        base_url: &str,
        username: &str,
    ) -> moontv_sync::ProfileSyncForwardOutcome {
        state
            .profile_sync
            .forward_login(
                Some(base_url),
                moontv_sync::ProfileSyncForwardRequest::new(reqwest::Method::POST, "/api/login")
                    .with_content_type(Some("application/json".to_string()))
                    .with_body(json!({ "username": username }).to_string().into_bytes()),
            )
            .await
            .expect("login outcome")
    }

    async fn cookie_echo(state: &AppState, base_url: &str) -> String {
        let response = state
            .profile_sync
            .forward(
                Some(base_url),
                moontv_sync::ProfileSyncForwardRequest::get("/api/cookie"),
            )
            .await
            .expect("cookie echo");
        serde_json::from_slice::<Value>(&response.body).expect("cookie echo json")["cookie"]
            .as_str()
            .unwrap_or_default()
            .to_string()
    }

    struct MockCookieServer {
        base_url: String,
        task: tokio::task::JoinHandle<()>,
    }

    impl MockCookieServer {
        async fn spawn() -> Self {
            let router = Router::new()
                .route(
                    "/api/login",
                    post(|Json(payload): Json<Value>| async move {
                        let username = payload["username"].as_str().unwrap_or("unknown");
                        response_with_cookie(
                            StatusCode::OK,
                            json!({ "ok": true, "username": username, "role": "user" }),
                            &format!("auth={username}; Path=/"),
                        )
                    }),
                )
                .route(
                    "/api/logout",
                    post(|| async move {
                        response_with_cookie(
                            StatusCode::OK,
                            json!({ "ok": true }),
                            expired_auth_cookie(),
                        )
                    }),
                )
                .route(
                    "/api/stale-401",
                    get(|| async move {
                        response_with_cookie(
                            StatusCode::UNAUTHORIZED,
                            json!({ "error": "expired" }),
                            expired_auth_cookie(),
                        )
                    }),
                )
                .route(
                    "/api/cookie",
                    get(|headers: HeaderMap| async move {
                        Json(json!({
                            "cookie": headers
                                .get("cookie")
                                .and_then(|value| value.to_str().ok())
                                .unwrap_or_default()
                        }))
                    }),
                );
            let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
                .await
                .expect("bind cookie server");
            let address = listener.local_addr().expect("cookie server address");
            let task = tokio::spawn(async move {
                axum::serve(listener, router)
                    .await
                    .expect("serve cookie server");
            });
            Self {
                base_url: format!("http://{address}"),
                task,
            }
        }
    }

    fn response_with_cookie(
        status: StatusCode,
        body: Value,
        cookie: &str,
    ) -> axum::response::Response {
        let mut response = (status, Json(body)).into_response();
        response.headers_mut().insert(
            SET_COOKIE,
            HeaderValue::from_str(cookie).expect("response cookie"),
        );
        response
    }

    fn expired_auth_cookie() -> &'static str {
        "auth=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT"
    }

    fn session(username: &str) -> ProfileSyncSession {
        ProfileSyncSession {
            username: username.to_string(),
            role: "user".to_string(),
        }
    }

    struct TestDir {
        path: PathBuf,
    }

    impl TestDir {
        fn new() -> Self {
            let unique = TEST_COUNTER.fetch_add(1, Ordering::Relaxed);
            let path = env::temp_dir().join(format!("moontv-profile-sync-epoch-test-{unique}"));
            fs::create_dir_all(&path).expect("create test dir");
            Self { path }
        }

        fn state(&self) -> AppState {
            AppState::new(
                DEFAULT_HOST.to_string(),
                DEFAULT_PORT,
                self.path.join("config.json"),
                self.path.join("data"),
                self.path.join("data/moontv.sqlite3"),
            )
        }
    }

    impl Drop for TestDir {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.path);
        }
    }
}
