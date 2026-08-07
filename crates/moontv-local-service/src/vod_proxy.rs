use std::sync::{
    Arc,
    atomic::{AtomicBool, Ordering},
    mpsc::sync_channel,
};

use axum::{
    body::{Body, Bytes},
    extract::{OriginalUri, Query, State},
    http::{HeaderMap, Method, StatusCode, header::RANGE},
    response::Response,
};
use futures::{Stream, StreamExt, stream};
use tracing::warn;
use url::Url;

use crate::{AppError, AppResult, AppState, VodProxyQueryParams};

#[derive(Debug, Clone)]
pub(crate) struct VodProxyFetchedAsset {
    pub(crate) status: StatusCode,
    pub(crate) content_type: Option<String>,
    pub(crate) body: Vec<u8>,
}

const ONLINE_VOD_CACHE_WRITE_CHANNEL_CAPACITY: usize = 32;

enum OnlineVodCacheWriteMessage {
    Chunk(Bytes),
    Complete,
}

fn stream_with_online_vod_cache<S>(
    upstream_stream: S,
    writer: crate::OnlineVodCacheWriter,
) -> impl Stream<Item = Result<Bytes, reqwest::Error>>
where
    S: Stream<Item = Result<Bytes, reqwest::Error>> + Send + Unpin + 'static,
{
    let (sender, receiver) = sync_channel(ONLINE_VOD_CACHE_WRITE_CHANNEL_CAPACITY);
    let caching_aborted = Arc::new(AtomicBool::new(false));
    let writer_aborted = Arc::clone(&caching_aborted);

    let _ = tokio::task::spawn_blocking(move || {
        let mut writer = writer;
        let mut completed = false;

        while let Ok(message) = receiver.recv() {
            match message {
                OnlineVodCacheWriteMessage::Chunk(chunk) => {
                    if writer_aborted.load(Ordering::Relaxed) {
                        continue;
                    }
                    if let Err(error) = writer.write_chunk(&chunk) {
                        writer_aborted.store(true, Ordering::Relaxed);
                        warn!(
                            "online VOD segment cache write failed; continuing the playback stream: {error}"
                        );
                    }
                }
                OnlineVodCacheWriteMessage::Complete => {
                    completed = true;
                    break;
                }
            }
        }

        if completed && !writer_aborted.load(Ordering::Relaxed) {
            if let Err(error) = writer.finish() {
                warn!(
                    "online VOD segment cache finalize failed; playback stream was already delivered: {error}"
                );
            }
        }
    });

    stream::unfold(
        (upstream_stream, sender, caching_aborted),
        |(mut upstream_stream, sender, caching_aborted)| async move {
            match upstream_stream.next().await {
                Some(Ok(chunk)) => {
                    if !caching_aborted.load(Ordering::Relaxed)
                        && sender
                            .try_send(OnlineVodCacheWriteMessage::Chunk(chunk.clone()))
                            .is_err()
                    {
                        caching_aborted.store(true, Ordering::Relaxed);
                    }
                    Some((Ok(chunk), (upstream_stream, sender, caching_aborted)))
                }
                Some(Err(error)) => {
                    caching_aborted.store(true, Ordering::Relaxed);
                    Some((Err(error), (upstream_stream, sender, caching_aborted)))
                }
                None => {
                    if !caching_aborted.load(Ordering::Relaxed)
                        && sender
                            .try_send(OnlineVodCacheWriteMessage::Complete)
                            .is_err()
                    {
                        caching_aborted.store(true, Ordering::Relaxed);
                    }
                    None
                }
            }
        },
    )
}

pub(crate) fn parse_vod_proxy_url(request_url: &str) -> Option<(String, VodProxyQueryParams)> {
    let parsed_url = Url::parse(request_url)
        .ok()
        .or_else(|| Url::parse(&format!("http://moontv.local{request_url}")).ok())?;
    let path = parsed_url.path().to_string();

    if !matches!(
        path.as_str(),
        "/api/proxy/vod/m3u8"
            | "/media/vod/m3u8"
            | "/api/proxy/vod/segment"
            | "/media/vod/segment"
            | "/api/proxy/vod/key"
            | "/media/vod/key"
    ) {
        return None;
    }

    let mut params = VodProxyQueryParams {
        source: None,
        url: None,
        adfilter: None,
    };

    for (key, value) in parsed_url.query_pairs() {
        match key.as_ref() {
            "source" => params.source = Some(value.into_owned()),
            "url" => params.url = Some(value.into_owned()),
            "adfilter" => params.adfilter = Some(value.into_owned()),
            _ => {}
        }
    }

    if params
        .source
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .is_none()
        || params
            .url
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .is_none()
    {
        return None;
    }

    Some((path, params))
}

pub(crate) async fn fetch_vod_proxy_asset_bytes(
    state: &AppState,
    path: &str,
    params: VodProxyQueryParams,
    request_headers: &HeaderMap,
    prefer_identity_encoding: bool,
) -> AppResult<VodProxyFetchedAsset> {
    let config = state
        .load_config()
        .map_err(|error| AppError::internal(error.to_string()))?;
    let ad_filter_query_mode = crate::parse_bool_flag(params.adfilter.as_deref());
    let resolved = crate::resolve_vod_proxy_request(&config, params)?;
    let upstream_response = if prefer_identity_encoding {
        let response = crate::fetch_vod_proxy_upstream_with_identity_encoding(
            &state.download_client,
            &resolved.api_site,
            &resolved.upstream_url,
            request_headers,
        )
        .await?;
        if crate::upstream_response_uses_non_identity_encoding(&response) {
            crate::fetch_vod_proxy_upstream(
                &state.client,
                &resolved.api_site,
                &resolved.upstream_url,
                request_headers,
            )
            .await?
        } else {
            response
        }
    } else {
        crate::fetch_vod_proxy_upstream(
            &state.client,
            &resolved.api_site,
            &resolved.upstream_url,
            request_headers,
        )
        .await?
    };
    let meta = crate::upstream_response_meta(&upstream_response);

    match path {
        "/api/proxy/vod/segment" | "/media/vod/segment" => {
            let body =
                read_vod_proxy_asset_body(upstream_response, prefer_identity_encoding).await?;
            Ok(VodProxyFetchedAsset {
                status: meta.status,
                content_type: meta.content_type,
                body,
            })
        }
        "/api/proxy/vod/key" | "/media/vod/key" => {
            let body =
                read_vod_proxy_asset_body(upstream_response, prefer_identity_encoding).await?;
            Ok(VodProxyFetchedAsset {
                status: meta.status,
                content_type: meta.content_type,
                body,
            })
        }
        "/api/proxy/vod/m3u8" | "/media/vod/m3u8" => {
            let manifest_content = String::from_utf8(
                read_vod_proxy_asset_body(upstream_response, prefer_identity_encoding).await?,
            )
            .map_err(|_| AppError::internal("VOD manifest is not valid UTF-8"))?;
            let rewritten_content = crate::rewrite_vod_manifest_content(
                &manifest_content,
                &meta.final_url,
                &resolved.source,
                &state.public_base_url,
            );
            let ad_filter_result = if crate::should_apply_vod_ad_filter(
                &config,
                &resolved.api_site,
                ad_filter_query_mode,
            ) {
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
                ad_filter_result.filtered
            } else {
                rewritten_content
            };

            Ok(VodProxyFetchedAsset {
                status: meta.status,
                content_type: meta.content_type,
                body: response_content.into_bytes(),
            })
        }
        _ => Err(AppError::bad_request("unsupported vod proxy fetch path")),
    }
}

async fn read_vod_proxy_asset_body(
    response: reqwest::Response,
    prefer_identity_encoding: bool,
) -> AppResult<Vec<u8>> {
    response.bytes().await.map(|body| body.to_vec()).map_err(|error| {
        if prefer_identity_encoding {
            AppError::with_code(
                StatusCode::BAD_GATEWAY,
                crate::DOWNLOAD_RUNTIME_ERROR_RESOURCE_RESPONSE_READ_FAILED,
                format!(
                    "failed to read VOD proxy asset response after identity-encoding fallback: {error}"
                ),
            )
        } else {
            AppError::internal(error.to_string())
        }
    })
}

pub(crate) async fn get_vod_m3u8(
    method: Method,
    original_uri: OriginalUri,
    State(state): State<AppState>,
    Query(params): Query<VodProxyQueryParams>,
    request_headers: HeaderMap,
) -> AppResult<Response> {
    if let Some(response) = crate::try_build_cached_vod_proxy_response(
        &state,
        &method,
        &original_uri,
        &request_headers,
    )? {
        return Ok(response);
    }
    if let Some(response) = crate::try_build_cached_online_vod_proxy_response(
        &state,
        &method,
        &original_uri,
        &request_headers,
    ) {
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
    if method == Method::GET {
        let cache_state = state.clone();
        let cache_request_url =
            crate::build_local_request_url(&state.public_base_url, &original_uri);
        let cache_content_type = meta.content_type.clone();
        let cache_content = response_content.clone().into_bytes();
        let _ = tokio::task::spawn_blocking(move || {
            cache_state.cache_online_vod_asset(
                &cache_request_url,
                meta.status,
                cache_content_type.as_deref(),
                &cache_content,
                crate::OnlineVodCachePolicy::Manifest,
            );
        });
    }
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
    if let Some(response) = crate::try_build_cached_vod_proxy_response(
        &state,
        &method,
        &original_uri,
        &request_headers,
    )? {
        return Ok(response);
    }
    if let Some(response) = crate::try_build_cached_online_vod_proxy_response(
        &state,
        &method,
        &original_uri,
        &request_headers,
    ) {
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
    let cache_writer = (method == Method::GET
        && !request_headers.contains_key(RANGE)
        && meta.status == StatusCode::OK)
        .then(|| {
            let cache_request_url =
                crate::build_local_request_url(&state.public_base_url, &original_uri);
            let expected_body_len = meta
                .content_length
                .as_deref()
                .and_then(|value| value.parse::<u64>().ok());
            state.begin_online_vod_cache_write(
                &cache_request_url,
                meta.status,
                meta.content_type.as_deref(),
                expected_body_len,
                crate::OnlineVodCachePolicy::Segment,
            )
        })
        .flatten();
    let mut response = if method == Method::HEAD {
        Response::new(Body::empty())
    } else if let Some(writer) = cache_writer {
        Response::new(Body::from_stream(stream_with_online_vod_cache(
            stream, writer,
        )))
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
    if let Some(response) = crate::try_build_cached_vod_proxy_response(
        &state,
        &method,
        &original_uri,
        &request_headers,
    )? {
        return Ok(response);
    }
    if let Some(response) = crate::try_build_cached_online_vod_proxy_response(
        &state,
        &method,
        &original_uri,
        &request_headers,
    ) {
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
    if method == Method::GET {
        let cache_state = state.clone();
        let cache_request_url =
            crate::build_local_request_url(&state.public_base_url, &original_uri);
        let cache_content_type = meta.content_type.clone();
        let cache_body = key_bytes.to_vec();
        let _ = tokio::task::spawn_blocking(move || {
            cache_state.cache_online_vod_asset(
                &cache_request_url,
                meta.status,
                cache_content_type.as_deref(),
                &cache_body,
                crate::OnlineVodCachePolicy::Key,
            );
        });
    }
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
