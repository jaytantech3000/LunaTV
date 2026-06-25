use axum::{
    body::{Body, to_bytes},
    extract::{Request, State},
    http::{
        HeaderValue, StatusCode,
        header::{CACHE_CONTROL, CONTENT_TYPE},
    },
    response::Response,
};
use moontv_sync::{
    ProfileSyncError, ProfileSyncErrorKind, ProfileSyncForwardRequest, ProfileSyncStatusResponse,
    session_from_login_response,
};

use crate::{AppError, AppResult, AppState, ServiceConfig};

pub(crate) async fn proxy_profile_sync_login(
    State(state): State<AppState>,
    request: Request,
) -> AppResult<Response> {
    let upstream_response = send_profile_sync_request(&state, request).await?;
    let upstream_status = upstream_response.status();
    let status = StatusCode::from_u16(upstream_status.as_u16()).unwrap_or(StatusCode::BAD_GATEWAY);
    let content_type = upstream_response.headers().get(CONTENT_TYPE).cloned();
    let body = upstream_response
        .bytes()
        .await
        .map_err(|error| AppError::new(StatusCode::BAD_GATEWAY, error.to_string()))?;

    if let Some(session) = session_from_login_response(upstream_status, &body) {
        *state.profile_sync_session.write().await = Some(session);
    } else if status == StatusCode::UNAUTHORIZED {
        *state.profile_sync_session.write().await = None;
    }

    response_from_parts(status, content_type.as_ref(), body.to_vec())
}

pub(crate) async fn proxy_profile_sync_logout(
    State(state): State<AppState>,
    request: Request,
) -> AppResult<Response> {
    let upstream_response = send_profile_sync_request(&state, request).await?;
    *state.profile_sync_session.write().await = None;
    response_from_upstream(upstream_response).await
}

pub(crate) async fn proxy_profile_sync_change_password(
    State(state): State<AppState>,
    request: Request,
) -> AppResult<Response> {
    let upstream_response = send_profile_sync_request(&state, request).await?;
    response_from_upstream(upstream_response).await
}

pub(crate) async fn proxy_profile_sync_passthrough(
    state: &AppState,
    request: Request,
) -> AppResult<Response> {
    let upstream_response = send_profile_sync_request(state, request).await?;
    if upstream_response.status() == reqwest::StatusCode::UNAUTHORIZED {
        *state.profile_sync_session.write().await = None;
    }

    response_from_upstream(upstream_response).await
}

pub(crate) async fn send_profile_sync_request(
    state: &AppState,
    request: Request,
) -> AppResult<reqwest::Response> {
    let config = state
        .load_config()
        .map_err(|error| AppError::internal(error.to_string()))?;
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

    state
        .profile_sync
        .send(config.profile_sync_api_base_url.as_deref(), forward_request)
        .await
        .map_err(map_profile_sync_error)
}

pub(crate) async fn build_profile_sync_status_payload(
    state: &AppState,
    config: &ServiceConfig,
) -> ProfileSyncStatusResponse {
    let session = state.profile_sync_session.read().await.clone();
    state
        .profile_sync
        .build_status_response(
            config.profile_sync_api_base_url.as_deref(),
            session.as_ref(),
        )
        .await
}

pub(crate) async fn response_from_upstream(
    upstream_response: reqwest::Response,
) -> AppResult<Response> {
    let status = StatusCode::from_u16(upstream_response.status().as_u16())
        .unwrap_or(StatusCode::BAD_GATEWAY);
    let content_type = upstream_response.headers().get(CONTENT_TYPE).cloned();
    let body = upstream_response
        .bytes()
        .await
        .map_err(|error| AppError::new(StatusCode::BAD_GATEWAY, error.to_string()))?;

    response_from_parts(status, content_type.as_ref(), body.to_vec())
}

pub(crate) fn response_from_parts(
    status: StatusCode,
    content_type: Option<&HeaderValue>,
    body: Vec<u8>,
) -> AppResult<Response> {
    let mut response = Response::builder()
        .status(status)
        .body(Body::from(body))
        .map_err(|error| AppError::internal(error.to_string()))?;

    if let Some(content_type) = content_type {
        response
            .headers_mut()
            .insert(CONTENT_TYPE, content_type.clone());
    }

    response
        .headers_mut()
        .insert(CACHE_CONTROL, HeaderValue::from_static("no-store"));

    Ok(response)
}

fn map_profile_sync_error(error: ProfileSyncError) -> AppError {
    let status = match error.kind {
        ProfileSyncErrorKind::NotConfigured => StatusCode::NOT_IMPLEMENTED,
        ProfileSyncErrorKind::InvalidBaseUrl => StatusCode::BAD_REQUEST,
        ProfileSyncErrorKind::Unreachable
        | ProfileSyncErrorKind::Unauthorized
        | ProfileSyncErrorKind::ProtocolIncompatible
        | ProfileSyncErrorKind::UpstreamFailure => StatusCode::BAD_GATEWAY,
    };

    AppError::new(status, error.message)
}
