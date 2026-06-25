use axum::{
    body::{Body, to_bytes},
    extract::Request,
    http::{
        HeaderValue, StatusCode,
        header::{CACHE_CONTROL, CONTENT_TYPE},
    },
    response::Response,
};
use reqwest::Url;

use crate::{
    AppError, AppResult, AppState, ProfileSyncStatusResponse, RemoteServerConfigResponse,
    ServiceConfig,
};

pub(crate) async fn proxy_profile_sync_passthrough(
    state: &AppState,
    request: Request,
) -> AppResult<Response> {
    let upstream_response = send_profile_sync_request(state, request).await?;
    let status = upstream_response.status();
    if status == reqwest::StatusCode::UNAUTHORIZED {
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
    let remote_base_url = config
        .profile_sync_api_base_url
        .as_deref()
        .ok_or_else(|| AppError::new(StatusCode::NOT_IMPLEMENTED, "未配置账号同步后端"))?;

    let (parts, body) = request.into_parts();
    let request_path = parts
        .uri
        .path_and_query()
        .map(|value| value.as_str())
        .unwrap_or_else(|| parts.uri.path());
    let target_url = build_profile_sync_target_url(remote_base_url, request_path)?;
    let body_bytes = to_bytes(body, usize::MAX)
        .await
        .map_err(|error| AppError::bad_request(error.to_string()))?;

    let mut upstream_request = state.profile_sync_client.request(parts.method, target_url);

    if let Some(content_type) = parts
        .headers
        .get(CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
    {
        upstream_request = upstream_request.header(CONTENT_TYPE, content_type);
    }

    if let Some(accept) = parts
        .headers
        .get("Accept")
        .and_then(|value| value.to_str().ok())
    {
        upstream_request = upstream_request.header("Accept", accept);
    }

    if !body_bytes.is_empty() {
        upstream_request = upstream_request.body(body_bytes.to_vec());
    }

    upstream_request
        .send()
        .await
        .map_err(|error| AppError::new(StatusCode::BAD_GATEWAY, error.to_string()))
}

pub(crate) fn build_profile_sync_target_url(
    remote_base_url: &str,
    request_path: &str,
) -> AppResult<Url> {
    let base_url = format!("{}/", remote_base_url.trim_end_matches('/'));
    let base = Url::parse(&base_url)
        .map_err(|error| AppError::bad_request(format!("无效的账号同步地址: {error}")))?;
    let target = base
        .join(request_path.trim_start_matches('/'))
        .map_err(|error| AppError::bad_request(format!("无法解析账号同步目标地址: {error}")))?;
    Ok(target)
}

pub(crate) async fn build_profile_sync_status_payload(
    state: &AppState,
    config: &ServiceConfig,
) -> ProfileSyncStatusResponse {
    let session = state.profile_sync_session.read().await.clone();
    let enabled = config.profile_sync_api_base_url.is_some();

    let Some(remote_base_url) = config.profile_sync_api_base_url.as_deref() else {
        return ProfileSyncStatusResponse {
            enabled: false,
            reachable: false,
            authenticated: false,
            username: None,
            role: None,
            storage_type: None,
            profile_mode: None,
            error: None,
        };
    };

    let target_url = match build_profile_sync_target_url(remote_base_url, "/api/server-config") {
        Ok(url) => url,
        Err(error) => {
            return ProfileSyncStatusResponse {
                enabled,
                reachable: false,
                authenticated: session.is_some(),
                username: session.as_ref().map(|item| item.username.clone()),
                role: session.as_ref().map(|item| item.role.clone()),
                storage_type: None,
                profile_mode: None,
                error: Some(error.message),
            };
        }
    };

    match state.profile_sync_client.get(target_url).send().await {
        Ok(response) => match response.json::<RemoteServerConfigResponse>().await {
            Ok(server_config) => ProfileSyncStatusResponse {
                enabled,
                reachable: true,
                authenticated: session.is_some(),
                username: session.as_ref().map(|item| item.username.clone()),
                role: session.as_ref().map(|item| item.role.clone()),
                storage_type: server_config.storage_type,
                profile_mode: server_config.profile_mode,
                error: None,
            },
            Err(error) => ProfileSyncStatusResponse {
                enabled,
                reachable: false,
                authenticated: session.is_some(),
                username: session.as_ref().map(|item| item.username.clone()),
                role: session.as_ref().map(|item| item.role.clone()),
                storage_type: None,
                profile_mode: None,
                error: Some(error.to_string()),
            },
        },
        Err(error) => ProfileSyncStatusResponse {
            enabled,
            reachable: false,
            authenticated: session.is_some(),
            username: session.as_ref().map(|item| item.username.clone()),
            role: session.as_ref().map(|item| item.role.clone()),
            storage_type: None,
            profile_mode: None,
            error: Some(error.to_string()),
        },
    }
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
