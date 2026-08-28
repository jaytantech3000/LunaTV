use axum::{
    Json,
    body::Body,
    extract::{Query, State},
    http::{
        HeaderMap, HeaderValue, Method,
        header::{CACHE_CONTROL, CONTENT_TYPE},
    },
    response::{IntoResponse, Response},
};
use serde_json::json;

use crate::{AppError, AppResult, AppState, LivePrecheckQueryParams, LiveProxyQueryParams};

pub(crate) async fn get_live_precheck(
    State(state): State<AppState>,
    Query(params): Query<LivePrecheckQueryParams>,
) -> AppResult<Response> {
    let config = state
        .load_config()
        .map_err(|error| AppError::internal(error.to_string()))?;
    let upstream_url = params.url.unwrap_or_default().trim().to_string();
    let source_key = params.source_key.unwrap_or_default().trim().to_string();

    if upstream_url.is_empty() {
        return Err(AppError::bad_request("Missing url"));
    }

    let live_source = crate::resolve_live_source(&config, &source_key)?;
    let upstream_response = crate::fetch_live_proxy_upstream(
        &state.client,
        Some(&live_source),
        &upstream_url,
        None,
        false,
    )
    .await?;

    if !upstream_response.status().is_success() {
        return Err(AppError::internal(format!(
            "Failed to fetch live stream: {}",
            upstream_response.status()
        )));
    }

    let payload = json!({
      "success": true,
      "type": crate::detect_live_stream_type(
        upstream_response
          .headers()
          .get(CONTENT_TYPE)
          .and_then(|value| value.to_str().ok())
      )
    });
    let mut response = Json(payload).into_response();
    response
        .headers_mut()
        .insert(CACHE_CONTROL, HeaderValue::from_static("no-store"));
    Ok(response)
}

pub(crate) async fn get_live_m3u8(
    method: Method,
    State(state): State<AppState>,
    Query(params): Query<LiveProxyQueryParams>,
) -> AppResult<Response> {
    let config = state
        .load_config()
        .map_err(|error| AppError::internal(error.to_string()))?;
    let upstream_url = params.url.unwrap_or_default().trim().to_string();
    let source_key = params.source_key.unwrap_or_default().trim().to_string();
    let allow_cors = params.allow_cors.unwrap_or(false);
    let live_source = crate::resolve_live_source(&config, &source_key)?;
    let upstream_response = crate::fetch_live_proxy_upstream(
        &state.client,
        Some(&live_source),
        &upstream_url,
        None,
        false,
    )
    .await?;

    if !upstream_response.status().is_success() {
        return Err(AppError::internal(format!(
            "Failed to fetch live manifest: {}",
            upstream_response.status()
        )));
    }

    let meta = crate::upstream_response_meta(&upstream_response);

    if crate::should_rewrite_live_manifest(
        meta.content_type.as_deref(),
        &meta.final_url,
        &upstream_url,
    ) {
        let manifest_content = upstream_response
            .text()
            .await
            .map_err(|error| AppError::internal(error.to_string()))?;
        let rewritten_content = crate::rewrite_live_manifest_content(
            &manifest_content,
            &meta.final_url,
            &source_key,
            &state.public_base_url,
            allow_cors,
        );
        let mut response = if method == Method::HEAD {
            Response::new(Body::empty())
        } else {
            Response::new(Body::from(rewritten_content.clone()))
        };
        *response.status_mut() = meta.status;
        *response.headers_mut() = crate::create_live_proxy_headers(
            &meta,
            meta.content_type
                .as_deref()
                .unwrap_or("application/vnd.apple.mpegurl"),
            Some(rewritten_content.len().to_string()),
            true,
            Some("no-cache"),
        );
        return Ok(response);
    }

    let stream = upstream_response.bytes_stream();
    let mut response = Response::new(Body::from_stream(stream));
    *response.status_mut() = meta.status;
    *response.headers_mut() = crate::create_live_proxy_headers(
        &meta,
        meta.content_type
            .as_deref()
            .unwrap_or("application/octet-stream"),
        meta.content_length.clone(),
        true,
        Some("no-cache"),
    );
    Ok(response)
}

pub(crate) async fn get_live_segment(
    State(state): State<AppState>,
    Query(params): Query<LiveProxyQueryParams>,
    request_headers: HeaderMap,
) -> AppResult<Response> {
    let config = state
        .load_config()
        .map_err(|error| AppError::internal(error.to_string()))?;
    let upstream_url = params.url.unwrap_or_default().trim().to_string();
    let source_key = params.source_key.unwrap_or_default().trim().to_string();
    let live_source = crate::resolve_live_source(&config, &source_key)?;
    let upstream_response = crate::fetch_live_proxy_upstream(
        &state.client,
        Some(&live_source),
        &upstream_url,
        Some(&request_headers),
        true,
    )
    .await?;

    if !upstream_response.status().is_success() {
        return Err(AppError::internal(format!(
            "Failed to fetch live segment: {}",
            upstream_response.status()
        )));
    }

    let meta = crate::upstream_response_meta(&upstream_response);
    let stream = upstream_response.bytes_stream();
    let mut response = Response::new(Body::from_stream(stream));
    *response.status_mut() = meta.status;
    *response.headers_mut() = crate::create_live_proxy_headers(
        &meta,
        meta.content_type.as_deref().unwrap_or("video/mp2t"),
        meta.content_length.clone(),
        true,
        Some("no-cache"),
    );
    Ok(response)
}

pub(crate) async fn get_live_key(
    State(state): State<AppState>,
    Query(params): Query<LiveProxyQueryParams>,
) -> AppResult<Response> {
    let config = state
        .load_config()
        .map_err(|error| AppError::internal(error.to_string()))?;
    let upstream_url = params.url.unwrap_or_default().trim().to_string();
    let source_key = params.source_key.unwrap_or_default().trim().to_string();
    let live_source = crate::resolve_live_source(&config, &source_key)?;
    let upstream_response = crate::fetch_live_proxy_upstream(
        &state.client,
        Some(&live_source),
        &upstream_url,
        None,
        false,
    )
    .await?;

    if !upstream_response.status().is_success() {
        return Err(AppError::internal(format!(
            "Failed to fetch live key: {}",
            upstream_response.status()
        )));
    }

    let meta = crate::upstream_response_meta(&upstream_response);
    let key_bytes = upstream_response
        .bytes()
        .await
        .map_err(|error| AppError::internal(error.to_string()))?;
    let mut response = Response::new(Body::from(key_bytes));
    *response.status_mut() = meta.status;
    *response.headers_mut() = crate::create_live_proxy_headers(
        &meta,
        meta.content_type
            .as_deref()
            .unwrap_or("application/octet-stream"),
        meta.content_length.clone(),
        true,
        Some("public, max-age=3600"),
    );
    Ok(response)
}

pub(crate) async fn get_live_logo(
    State(state): State<AppState>,
    Query(params): Query<LiveProxyQueryParams>,
) -> AppResult<Response> {
    let config = state
        .load_config()
        .map_err(|error| AppError::internal(error.to_string()))?;
    let upstream_url = params.url.unwrap_or_default().trim().to_string();
    let source_key = params.source_key.unwrap_or_default().trim().to_string();
    let live_source = if source_key.is_empty() {
        None
    } else {
        Some(crate::resolve_live_source(&config, &source_key)?)
    };
    let upstream_response = crate::fetch_live_proxy_upstream(
        &state.client,
        live_source.as_ref(),
        &upstream_url,
        None,
        false,
    )
    .await?;

    if !upstream_response.status().is_success() {
        return Err(AppError::internal(format!(
            "Failed to fetch live logo: {}",
            upstream_response.status()
        )));
    }

    let meta = crate::upstream_response_meta(&upstream_response);
    let stream = upstream_response.bytes_stream();
    let mut response = Response::new(Body::from_stream(stream));
    *response.status_mut() = meta.status;
    *response.headers_mut() = crate::create_live_proxy_headers(
        &meta,
        meta.content_type.as_deref().unwrap_or("image/png"),
        meta.content_length.clone(),
        true,
        Some("public, max-age=86400, s-maxage=86400"),
    );
    Ok(response)
}
