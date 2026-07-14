use std::time::Duration;

use axum::http::{Method, StatusCode};
use moontv_storage::sqlite::{ProfileOutboxRecord, ProfileSyncWorkerState};
use moontv_sync::ProfileSyncForwardRequest;
use serde_json::{Value, json};
use tracing::warn;
use url::form_urlencoded;

use crate::{AppState, current_timestamp_ms};

const PROFILE_OUTBOX_WORKER_TICK_INTERVAL: Duration = Duration::from_secs(1);
const PROFILE_OUTBOX_RETRY_BASE_DELAY_MS: i64 = 1_000;
const PROFILE_OUTBOX_RETRY_MAX_DELAY_MS: i64 = 60_000;

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ProfileOutboxWorkerStatus {
    pub pending_outbox_count: u64,
    pub reauth_required: bool,
    pub last_outbox_error: Option<String>,
    pub next_outbox_attempt_at: Option<i64>,
}

pub(crate) fn spawn_profile_outbox_worker(state: AppState) {
    tokio::spawn(async move {
        let mut interval = tokio::time::interval(PROFILE_OUTBOX_WORKER_TICK_INTERVAL);
        interval.tick().await;

        loop {
            run_profile_outbox_worker_tick(&state).await;
            interval.tick().await;
        }
    });
}

pub(crate) async fn run_profile_outbox_worker_tick(state: &AppState) {
    let Ok(_guard) = state.profile_sync_worker_lock.try_lock() else {
        return;
    };

    if let Err(error) = run_profile_outbox_worker_tick_locked(state).await {
        warn!("profile outbox worker tick failed: {error}");
    }
}

pub(crate) async fn wake_profile_outbox_worker(state: &AppState) {
    let _guard = match state.profile_sync_worker_lock.try_lock() {
        Ok(guard) => guard,
        Err(_) => return,
    };
    if let Err(error) = run_profile_outbox_worker_tick_locked(state).await {
        warn!("profile outbox worker wake failed: {error}");
    }
}

pub(crate) fn profile_outbox_worker_status(
    state: &AppState,
    username: Option<&str>,
) -> ProfileOutboxWorkerStatus {
    let Some(username) = username else {
        return ProfileOutboxWorkerStatus {
            pending_outbox_count: 0,
            reauth_required: false,
            last_outbox_error: None,
            next_outbox_attempt_at: None,
        };
    };

    let pending_outbox_count = state
        .sqlite
        .pending_profile_outbox_count(username)
        .unwrap_or_else(|error| {
            warn!("failed to count profile outbox for status: {error}");
            0
        });
    let worker_state = state
        .sqlite
        .profile_sync_worker_state(username)
        .unwrap_or_else(|error| {
            warn!("failed to read profile outbox worker status: {error}");
            None
        });

    status_from_worker_state(pending_outbox_count, worker_state)
}

fn status_from_worker_state(
    pending_outbox_count: u64,
    worker_state: Option<ProfileSyncWorkerState>,
) -> ProfileOutboxWorkerStatus {
    ProfileOutboxWorkerStatus {
        pending_outbox_count,
        reauth_required: worker_state
            .as_ref()
            .and_then(|item| item.auth_blocked_at_ms)
            .is_some(),
        last_outbox_error: worker_state
            .as_ref()
            .and_then(|item| item.last_sync_error.clone()),
        next_outbox_attempt_at: worker_state.and_then(|item| item.next_attempt_at_ms),
    }
}

async fn run_profile_outbox_worker_tick_locked(state: &AppState) -> anyhow::Result<()> {
    let config = state.load_config()?;
    let Some(remote_base_url) = config.profile_sync_api_base_url.as_deref() else {
        return Ok(());
    };
    let Some(session) = state.profile_sync_session.read().await.clone() else {
        return Ok(());
    };
    let username = session.username;

    let Some(worker_state) = state.sqlite.profile_sync_worker_state(&username)? else {
        return Ok(());
    };
    if worker_state.auth_blocked_at_ms.is_some() {
        return Ok(());
    }

    let now_ms = current_timestamp_ms() as i64;
    let Some(record) = state
        .sqlite
        .list_due_profile_outbox(&username, now_ms, 1)?
        .into_iter()
        .next()
    else {
        return Ok(());
    };

    let request = match build_outbox_request(&record) {
        Ok(request) => request,
        Err(error) => {
            record_retryable_failure(state, &record, now_ms, error.to_string())?;
            return Ok(());
        }
    };

    match state
        .profile_sync
        .forward(Some(remote_base_url), request)
        .await
    {
        Ok(response) if response.status.is_success() => {
            state.sqlite.ack_profile_outbox_head(
                &username,
                &record.op_id,
                record.local_seq,
                now_ms,
            )?;
        }
        Ok(response) if response.status == StatusCode::UNAUTHORIZED => {
            let error = "远端账号同步后端返回 401";
            state
                .sqlite
                .block_profile_sync_auth(&username, now_ms, error)?;
            *state.profile_sync_last_username.write().await = Some(username.clone());
            *state.profile_sync_session.write().await = None;
        }
        Ok(response)
            if response.status == StatusCode::REQUEST_TIMEOUT
                || response.status == StatusCode::TOO_MANY_REQUESTS
                || response.status.is_server_error() =>
        {
            record_retryable_failure(
                state,
                &record,
                now_ms,
                format!("远端账号同步后端返回 {}", response.status.as_u16()),
            )?;
        }
        Ok(response) => {
            record_retryable_failure(
                state,
                &record,
                now_ms,
                format!("远端账号同步后端返回 {}", response.status.as_u16()),
            )?;
        }
        Err(error) => {
            record_retryable_failure(state, &record, now_ms, error.message)?;
        }
    }

    Ok(())
}

fn build_outbox_request(record: &ProfileOutboxRecord) -> anyhow::Result<ProfileSyncForwardRequest> {
    let path = profile_domain_path(&record.domain)
        .ok_or_else(|| anyhow::anyhow!("unsupported profile outbox domain: {}", record.domain))?;
    let request = match record.operation.as_str() {
        "upsert" => {
            let entity_key = record
                .entity_key
                .as_deref()
                .ok_or_else(|| anyhow::anyhow!("profile upsert missing entity key"))?;
            let value = decode_profile_payload(record)?;
            let body = match record.domain.as_str() {
                "playrecords" => json!({ "key": entity_key, "record": value }),
                "favorites" => json!({ "key": entity_key, "favorite": value }),
                "follows" => json!({ "key": entity_key, "follow": value }),
                "skipconfigs" => json!({ "key": entity_key, "config": value }),
                _ => {
                    return Err(anyhow::anyhow!(
                        "upsert is not supported for {}",
                        record.domain
                    ));
                }
            };
            json_request(Method::POST, path, body)?
        }
        "replace-domain" if record.domain == "searchhistory" => {
            let payload = decode_profile_payload(record)?;
            let keyword = payload
                .as_array()
                .and_then(|history| history.first())
                .and_then(Value::as_str)
                .ok_or_else(|| {
                    anyhow::anyhow!("searchhistory replacement missing first keyword")
                })?;
            json_request(Method::POST, path, json!({ "keyword": keyword }))?
        }
        "delete" => {
            let entity_key = record
                .entity_key
                .as_deref()
                .ok_or_else(|| anyhow::anyhow!("profile delete missing entity key"))?;
            let key = match record.domain.as_str() {
                "playrecords" | "favorites" | "follows" | "skipconfigs" => "key",
                _ => {
                    return Err(anyhow::anyhow!(
                        "delete is not supported for {}",
                        record.domain
                    ));
                }
            };
            let path = with_query(path, key, entity_key);
            ProfileSyncForwardRequest::new(Method::DELETE, path)
        }
        "clear-domain" => ProfileSyncForwardRequest::new(Method::DELETE, path),
        _ => {
            return Err(anyhow::anyhow!(
                "unsupported profile outbox operation {} for {}",
                record.operation,
                record.domain
            ));
        }
    };

    Ok(request)
}

fn profile_domain_path(domain: &str) -> Option<&'static str> {
    match domain {
        "playrecords" => Some("/api/playrecords"),
        "favorites" => Some("/api/favorites"),
        "follows" => Some("/api/follows"),
        "searchhistory" => Some("/api/searchhistory"),
        "skipconfigs" => Some("/api/skipconfigs"),
        _ => None,
    }
}

fn decode_profile_payload(record: &ProfileOutboxRecord) -> anyhow::Result<Value> {
    let payload = record
        .payload_json
        .as_deref()
        .ok_or_else(|| anyhow::anyhow!("profile outbox operation missing payload"))?;
    serde_json::from_str(payload).map_err(Into::into)
}

fn json_request(
    method: Method,
    path: &str,
    body: Value,
) -> anyhow::Result<ProfileSyncForwardRequest> {
    Ok(ProfileSyncForwardRequest::new(method, path)
        .with_content_type(Some("application/json".to_string()))
        .with_body(serde_json::to_vec(&body)?))
}

fn with_query(path: &str, key: &str, value: &str) -> String {
    let query = form_urlencoded::Serializer::new(String::new())
        .append_pair(key, value)
        .finish();
    format!("{path}?{query}")
}

fn record_retryable_failure(
    state: &AppState,
    record: &ProfileOutboxRecord,
    failed_at_ms: i64,
    error: String,
) -> anyhow::Result<()> {
    let next_attempt_at_ms = failed_at_ms + retry_delay_ms(record.attempt_count);
    state.sqlite.record_profile_outbox_head_failure(
        &record.username,
        &record.op_id,
        record.local_seq,
        failed_at_ms,
        next_attempt_at_ms,
        &error,
    )?;
    Ok(())
}

fn retry_delay_ms(attempt_count: i64) -> i64 {
    let exponent = attempt_count.clamp(0, 16) as u32;
    PROFILE_OUTBOX_RETRY_BASE_DELAY_MS
        .saturating_mul(1_i64 << exponent)
        .min(PROFILE_OUTBOX_RETRY_MAX_DELAY_MS)
}

#[cfg(test)]
mod tests {
    use super::{retry_delay_ms, with_query};

    #[test]
    fn retry_delay_is_exponential_and_capped() {
        assert_eq!(retry_delay_ms(0), 1_000);
        assert_eq!(retry_delay_ms(1), 2_000);
        assert_eq!(retry_delay_ms(6), 60_000);
        assert_eq!(retry_delay_ms(99), 60_000);
    }

    #[test]
    fn query_values_are_encoded() {
        assert_eq!(
            with_query("/api/favorites", "key", "demo+1"),
            "/api/favorites?key=demo%2B1"
        );
    }
}
