use axum::{
    body::Body,
    extract::{OriginalUri, Query, State},
    http::{HeaderMap, Method},
    response::Response,
};

use crate::{AppError, AppResult, AppState, VodProxyQueryParams};

pub(crate) async fn get_vod_m3u8(
    method: Method,
    original_uri: OriginalUri,
    State(state): State<AppState>,
    Query(params): Query<VodProxyQueryParams>,
    request_headers: HeaderMap,
) -> AppResult<Response> {
    if let Some(response) =
        crate::try_build_cached_vod_proxy_response(&state, &method, &original_uri, &request_headers)?
    {
        return Ok(response);
    }

    let config = state
        .load_config()
        .map_err(|error| AppError::internal(error.to_string()))?;
    let ad_filter_query_mode = crate::parse_bool_flag(params.adfilter.as_deref());
    let resolved = crate::resolve_vod_proxy_request(&config, params)?;
    let upstream_response = crate::fetch_vod_proxy_upstream(
        &state.client,
        &resolved.api_site,
        &resolved.upstream_url,
        &request_headers,
    )
    .await?;

    if !upstream_response.status().is_success() {
        return Err(AppError::internal(format!(
            "Failed to fetch manifest: {}",
            upstream_response.status()
        )));
    }

    let meta = crate::upstream_response_meta(&upstream_response);
    let manifest_content = upstream_response
        .text()
        .await
        .map_err(|error| AppError::internal(error.to_string()))?;
    let rewritten_content = crate::rewrite_vod_manifest_content(
        &manifest_content,
        &meta.final_url,
        &resolved.source,
        &state.public_base_url,
    );
    let ad_filter_result =
        if crate::should_apply_vod_ad_filter(&config, &resolved.api_site, ad_filter_query_mode) {
            crate::filter_vod_manifest_ads(
                &rewritten_content,
                &crate::build_vod_ad_filter_config(true),
            )
        } else {
            crate::FilteredVodManifest {
                filtered: rewritten_content.clone(),
                ads_removed: 0,
                ads_duration: 0.0,
                changed: false,
            }
        };
    let response_content = if ad_filter_result.changed {
        ad_filter_result.filtered.clone()
    } else {
        rewritten_content.clone()
    };
    let mut response = if method == Method::HEAD {
        Response::new(Body::empty())
    } else {
        Response::new(Body::from(response_content.clone()))
    };
    *response.status_mut() = meta.status;
    *response.headers_mut() = crate::create_vod_proxy_headers(
        &meta,
        meta.content_type
            .as_deref()
            .unwrap_or("application/vnd.apple.mpegurl"),
        Some(response_content.len().to_string()),
        true,
    );
    crate::append_ad_filter_response_headers(response.headers_mut(), &ad_filter_result);

    Ok(response)
}

pub(crate) async fn get_vod_segment(
    method: Method,
    original_uri: OriginalUri,
    State(state): State<AppState>,
    Query(params): Query<VodProxyQueryParams>,
    request_headers: HeaderMap,
) -> AppResult<Response> {
    if let Some(response) =
        crate::try_build_cached_vod_proxy_response(&state, &method, &original_uri, &request_headers)?
    {
        return Ok(response);
    }

    let config = state
        .load_config()
        .map_err(|error| AppError::internal(error.to_string()))?;
    let resolved = crate::resolve_vod_proxy_request(&config, params)?;
    let upstream_response = crate::fetch_vod_proxy_upstream(
        &state.client,
        &resolved.api_site,
        &resolved.upstream_url,
        &request_headers,
    )
    .await?;

    if !upstream_response.status().is_success() {
        return Err(AppError::internal(format!(
            "Failed to fetch segment: {}",
            upstream_response.status()
        )));
    }

    let meta = crate::upstream_response_meta(&upstream_response);
    let stream = upstream_response.bytes_stream();
    let mut response = if method == Method::HEAD {
        Response::new(Body::empty())
    } else {
        Response::new(Body::from_stream(stream))
    };
    *response.status_mut() = meta.status;
    *response.headers_mut() = crate::create_vod_proxy_headers(
        &meta,
        meta.content_type
            .as_deref()
            .unwrap_or("application/octet-stream"),
        meta.content_length.clone(),
        true,
    );

    Ok(response)
}

pub(crate) async fn get_vod_key(
    method: Method,
    original_uri: OriginalUri,
    State(state): State<AppState>,
    Query(params): Query<VodProxyQueryParams>,
    request_headers: HeaderMap,
) -> AppResult<Response> {
    if let Some(response) =
        crate::try_build_cached_vod_proxy_response(&state, &method, &original_uri, &request_headers)?
    {
        return Ok(response);
    }

    let config = state
        .load_config()
        .map_err(|error| AppError::internal(error.to_string()))?;
    let resolved = crate::resolve_vod_proxy_request(&config, params)?;
    let upstream_response = crate::fetch_vod_proxy_upstream(
        &state.client,
        &resolved.api_site,
        &resolved.upstream_url,
        &request_headers,
    )
    .await?;

    if !upstream_response.status().is_success() {
        return Err(AppError::internal(format!(
            "Failed to fetch key: {}",
            upstream_response.status()
        )));
    }

    let meta = crate::upstream_response_meta(&upstream_response);
    let key_bytes = upstream_response
        .bytes()
        .await
        .map_err(|error| AppError::internal(error.to_string()))?;
    let mut response = if method == Method::HEAD {
        Response::new(Body::empty())
    } else {
        Response::new(Body::from(key_bytes))
    };
    *response.status_mut() = meta.status;
    *response.headers_mut() = crate::create_vod_proxy_headers(
        &meta,
        meta.content_type
            .as_deref()
            .unwrap_or("application/octet-stream"),
        meta.content_length.clone(),
        true,
    );

    Ok(response)
}
