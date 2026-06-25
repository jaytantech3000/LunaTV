use std::{collections::BTreeSet, convert::Infallible, sync::OnceLock, time::Duration};

use axum::{
    Json,
    body::{Body, to_bytes},
    extract::{Path as AxumPath, Query, State},
    http::{
        HeaderMap, HeaderName, HeaderValue, Method, StatusCode,
        header::{
            ACCEPT_RANGES, CACHE_CONTROL, CONTENT_LENGTH, CONTENT_RANGE, CONTENT_TYPE, RANGE,
        },
    },
    response::{
        IntoResponse, Response,
        sse::{Event, Sse},
    },
};
use futures::stream;
use moontv_download::{
    DesktopDownloadEngine, DesktopDownloadEngineSettingsUpdate, DesktopDownloadEngineSnapshot,
    DesktopDownloadTask,
};
use regex::Regex;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use url::Url;

use crate::{
    AppError, AppResult, AppState, apply_cors_headers, no_store_json_response,
    normalize_optional_string, normalize_optional_text,
};

#[derive(Debug, Deserialize)]
pub(crate) struct DesktopDownloadCacheQueryParams {
    url: Option<String>,
}

#[derive(Debug, Deserialize)]
pub(crate) struct DesktopDownloadResourceIndexQueryParams {
    id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DesktopDownloadCacheEntry {
    pub(crate) url: String,
    pub(crate) status: u16,
    pub(crate) content_type: Option<String>,
    pub(crate) size_bytes: u64,
    pub(crate) created_at: u64,
    pub(crate) updated_at: u64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct DesktopDownloadCacheMetaResponse {
    exists: bool,
    url: String,
    status: Option<u16>,
    content_type: Option<String>,
    size_bytes: Option<u64>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct DesktopDownloadRuntimeStorageInfoResponse {
    runtime_kind: &'static str,
    root_dir: String,
    cache_body_dir: String,
    cache_meta_dir: String,
    resource_index_dir: String,
    sqlite_path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DesktopDownloadResourceIndexRecord {
    pub(crate) id: String,
    pub(crate) owner_username: String,
    pub(crate) task_id: String,
    pub(crate) content_id: String,
    pub(crate) source: String,
    pub(crate) vod_id: String,
    pub(crate) episode_index: i64,
    pub(crate) urls: Vec<String>,
    pub(crate) created_at: u64,
    pub(crate) updated_at: u64,
}

const DOWNLOAD_MANIFEST_FETCH_TIMEOUT_MS: u64 = 20_000;
const MAX_DOWNLOAD_MANIFEST_FETCH_RETRIES: usize = 2;
const DOWNLOAD_MANIFEST_REQUEST_INTENT_HEADER: &str = "x-moontv-download-intent";
const BACKGROUND_DOWNLOAD_REQUEST_INTENT: &str = "background";

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DesktopDownloadManifestResolveRequest {
    entry_manifest_urls: Vec<String>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
enum DesktopDownloadManifestResourceType {
    Manifest,
    Segment,
    Key,
    Map,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct DesktopDownloadManifestResource {
    url: String,
    #[serde(rename = "type")]
    resource_type: DesktopDownloadManifestResourceType,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct DesktopDownloadManifestResolveResponse {
    root_manifest_url: String,
    playback_manifest_url: String,
    resources: Vec<DesktopDownloadManifestResource>,
    resource_urls: Vec<String>,
    is_master_playlist: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum DownloadManifestErrorKind {
    Http,
    Network,
    Timeout,
    Invalid,
    Internal,
}

#[derive(Debug, Clone)]
struct DownloadManifestError {
    kind: DownloadManifestErrorKind,
    status: Option<StatusCode>,
    message: String,
}

impl DownloadManifestError {
    fn http(_url: impl Into<String>, status: StatusCode, message: impl Into<String>) -> Self {
        Self {
            kind: DownloadManifestErrorKind::Http,
            status: Some(status),
            message: message.into(),
        }
    }

    fn network(_url: impl Into<String>, message: impl Into<String>) -> Self {
        Self {
            kind: DownloadManifestErrorKind::Network,
            status: None,
            message: message.into(),
        }
    }

    fn timeout(_url: impl Into<String>, message: impl Into<String>) -> Self {
        Self {
            kind: DownloadManifestErrorKind::Timeout,
            status: None,
            message: message.into(),
        }
    }

    fn invalid(_url: impl Into<String>, message: impl Into<String>) -> Self {
        Self {
            kind: DownloadManifestErrorKind::Invalid,
            status: None,
            message: message.into(),
        }
    }

    fn internal(_url: impl Into<String>, message: impl Into<String>) -> Self {
        Self {
            kind: DownloadManifestErrorKind::Internal,
            status: None,
            message: message.into(),
        }
    }

    fn into_app_error(self) -> AppError {
        let status = match self.kind {
            DownloadManifestErrorKind::Invalid => StatusCode::BAD_REQUEST,
            DownloadManifestErrorKind::Http
            | DownloadManifestErrorKind::Network
            | DownloadManifestErrorKind::Timeout => StatusCode::BAD_GATEWAY,
            DownloadManifestErrorKind::Internal => StatusCode::INTERNAL_SERVER_ERROR,
        };

        AppError::new(status, self.message)
    }
}

pub(crate) async fn put_download_runtime_cache(
    State(state): State<AppState>,
    Query(params): Query<DesktopDownloadCacheQueryParams>,
    headers: HeaderMap,
    body: Body,
) -> AppResult<Response> {
    let url = require_download_runtime_url(params.url.as_deref())?;
    let status = parse_download_runtime_status(&headers)?;
    let content_type = headers
        .get(CONTENT_TYPE)
        .and_then(|value| value.to_str().ok());
    let body_bytes = to_bytes(body, usize::MAX)
        .await
        .map_err(|error| AppError::internal(error.to_string()))?;
    let entry = state
        .write_cached_download(&url, status, content_type, body_bytes.as_ref())
        .map_err(|error| AppError::internal(error.to_string()))?;

    no_store_json_response(&entry)
}

pub(crate) async fn get_download_runtime_cache_meta(
    State(state): State<AppState>,
    Query(params): Query<DesktopDownloadCacheQueryParams>,
) -> AppResult<Response> {
    let url = require_download_runtime_url(params.url.as_deref())?;
    let entry = state
        .read_cached_download_entry(&url)
        .map_err(|error| AppError::internal(error.to_string()))?;
    let payload = DesktopDownloadCacheMetaResponse {
        exists: entry.is_some(),
        url,
        status: entry.as_ref().map(|item| item.status),
        content_type: entry.as_ref().and_then(|item| item.content_type.clone()),
        size_bytes: entry.as_ref().map(|item| item.size_bytes),
    };

    no_store_json_response(&payload)
}

pub(crate) async fn get_download_runtime_cache_response(
    method: Method,
    State(state): State<AppState>,
    Query(params): Query<DesktopDownloadCacheQueryParams>,
    request_headers: HeaderMap,
) -> AppResult<Response> {
    let url = require_download_runtime_url(params.url.as_deref())?;
    let entry = state
        .read_cached_download_entry(&url)
        .map_err(|error| AppError::internal(error.to_string()))?
        .ok_or_else(|| AppError::new(StatusCode::NOT_FOUND, "cached download not found"))?;
    let body = state
        .read_cached_download_body(&url)
        .map_err(|error| AppError::internal(error.to_string()))?
        .ok_or_else(|| AppError::new(StatusCode::NOT_FOUND, "cached download body not found"))?;

    Ok(build_cached_download_response(
        &method,
        &request_headers,
        &entry,
        body,
    ))
}

pub(crate) async fn delete_download_runtime_cache(
    State(state): State<AppState>,
    Query(params): Query<DesktopDownloadCacheQueryParams>,
) -> AppResult<Response> {
    let url = require_download_runtime_url(params.url.as_deref())?;
    let deleted = state
        .delete_cached_download(&url)
        .map_err(|error| AppError::internal(error.to_string()))?;

    no_store_json_response(&json!({
        "ok": true,
        "deleted": deleted,
    }))
}

pub(crate) async fn clear_download_runtime_cache(
    State(state): State<AppState>,
) -> AppResult<Response> {
    state
        .clear_cached_downloads()
        .map_err(|error| AppError::internal(error.to_string()))?;
    no_store_json_response(&json!({ "ok": true }))
}

pub(crate) async fn get_download_runtime_storage_info(
    State(state): State<AppState>,
) -> AppResult<Response> {
    let payload = DesktopDownloadRuntimeStorageInfoResponse {
        runtime_kind: "desktop-local",
        root_dir: state.download_runtime_dir().display().to_string(),
        cache_body_dir: state
            .download_runtime_cache_body_dir()
            .display()
            .to_string(),
        cache_meta_dir: state
            .download_runtime_cache_meta_dir()
            .display()
            .to_string(),
        resource_index_dir: state
            .download_runtime_resource_index_dir()
            .display()
            .to_string(),
        sqlite_path: state.sqlite.path().display().to_string(),
    };

    no_store_json_response(&payload)
}

pub(crate) async fn put_download_runtime_resource_index(
    State(state): State<AppState>,
    Json(record): Json<DesktopDownloadResourceIndexRecord>,
) -> AppResult<Response> {
    let normalized_record = normalize_download_runtime_resource_index(record)?;
    let saved = state
        .write_resource_index(&normalized_record)
        .map_err(|error| AppError::internal(error.to_string()))?;
    no_store_json_response(&saved)
}

pub(crate) async fn get_download_runtime_resource_index(
    State(state): State<AppState>,
    Query(params): Query<DesktopDownloadResourceIndexQueryParams>,
) -> AppResult<Response> {
    let id = require_download_runtime_index_id(params.id.as_deref())?;
    let record = state
        .read_resource_index(&id)
        .map_err(|error| AppError::internal(error.to_string()))?;

    no_store_json_response(&record)
}

pub(crate) async fn delete_download_runtime_resource_index(
    State(state): State<AppState>,
    Query(params): Query<DesktopDownloadResourceIndexQueryParams>,
) -> AppResult<Response> {
    let id = require_download_runtime_index_id(params.id.as_deref())?;
    let deleted = state
        .delete_resource_index(&id)
        .map_err(|error| AppError::internal(error.to_string()))?;

    no_store_json_response(&json!({
        "ok": true,
        "deleted": deleted,
    }))
}

pub(crate) async fn clear_download_runtime_resource_indexes(
    State(state): State<AppState>,
) -> AppResult<Response> {
    state
        .clear_resource_indexes()
        .map_err(|error| AppError::internal(error.to_string()))?;
    no_store_json_response(&json!({ "ok": true }))
}

pub(crate) async fn get_download_runtime_store_snapshot(
    State(state): State<AppState>,
) -> AppResult<Response> {
    let snapshot = state
        .read_download_store_snapshot()
        .map_err(|error| AppError::internal(error.to_string()))?;
    no_store_json_response(&snapshot)
}

pub(crate) async fn put_download_runtime_store_snapshot(
    State(state): State<AppState>,
    Json(snapshot): Json<Value>,
) -> AppResult<Response> {
    state
        .write_download_store_snapshot(&snapshot)
        .map_err(|error| AppError::internal(error.to_string()))?;
    no_store_json_response(&json!({ "ok": true }))
}

pub(crate) async fn clear_download_runtime_store_snapshot(
    State(state): State<AppState>,
) -> AppResult<Response> {
    let deleted = state
        .clear_download_store_snapshot()
        .map_err(|error| AppError::internal(error.to_string()))?;
    no_store_json_response(&json!({
        "ok": true,
        "deleted": deleted,
    }))
}

pub(crate) async fn resolve_download_runtime_manifest(
    State(state): State<AppState>,
    Json(request): Json<DesktopDownloadManifestResolveRequest>,
) -> AppResult<Response> {
    let candidate_urls = normalize_download_manifest_candidate_urls(request.entry_manifest_urls)?;
    let mut last_error: Option<DownloadManifestError> = None;

    for candidate_url in candidate_urls {
        for attempt in 1..=MAX_DOWNLOAD_MANIFEST_FETCH_RETRIES + 1 {
            match parse_download_manifest_for_candidate(&state, &candidate_url).await {
                Ok(result) => return no_store_json_response(&result),
                Err(error) => {
                    let should_retry = attempt <= MAX_DOWNLOAD_MANIFEST_FETCH_RETRIES
                        && is_retryable_download_manifest_error(&error);
                    last_error = Some(error);

                    if should_retry {
                        wait_for_download_manifest_retry(attempt).await;
                        continue;
                    }

                    break;
                }
            }
        }
    }

    Err(last_error
        .unwrap_or_else(|| {
            DownloadManifestError::invalid(
                "desktop-download-manifest",
                "missing download manifest candidates",
            )
        })
        .into_app_error())
}

fn normalize_download_manifest_candidate_urls(
    candidate_urls: Vec<String>,
) -> AppResult<Vec<String>> {
    let mut normalized = Vec::new();
    let mut seen = BTreeSet::new();

    for candidate_url in candidate_urls {
        let trimmed = candidate_url.trim();
        if trimmed.is_empty() {
            continue;
        }

        if seen.insert(trimmed.to_string()) {
            normalized.push(trimmed.to_string());
        }
    }

    if normalized.is_empty() {
        return Err(AppError::bad_request(
            "missing desktop download manifest candidates",
        ));
    }

    Ok(normalized)
}

async fn parse_download_manifest_for_candidate(
    state: &AppState,
    candidate_url: &str,
) -> Result<DesktopDownloadManifestResolveResponse, DownloadManifestError> {
    let root_manifest_text = fetch_download_manifest_text(state, candidate_url).await?;
    let is_master_playlist = is_download_manifest_master_playlist(&root_manifest_text);

    if !is_master_playlist {
        let resources = dedupe_download_manifest_resources(
            std::iter::once(build_download_manifest_resource(
                candidate_url,
                DesktopDownloadManifestResourceType::Manifest,
            ))
            .chain(collect_download_media_playlist_resources(
                &root_manifest_text,
                candidate_url,
            )?)
            .collect(),
        );

        return Ok(DesktopDownloadManifestResolveResponse {
            root_manifest_url: candidate_url.to_string(),
            playback_manifest_url: candidate_url.to_string(),
            resource_urls: resources.iter().map(|resource| resource.url.clone()).collect(),
            resources,
            is_master_playlist: false,
        });
    }

    let playback_manifest_url =
        select_download_playback_manifest_url(&root_manifest_text).ok_or_else(|| {
            DownloadManifestError::invalid(
                candidate_url,
                format!("missing playable media playlist: {candidate_url}"),
            )
        })?;
    let playback_manifest_text =
        fetch_download_manifest_text(state, &playback_manifest_url).await?;
    let resources = dedupe_download_manifest_resources(
        std::iter::once(build_download_manifest_resource(
            candidate_url,
            DesktopDownloadManifestResourceType::Manifest,
        ))
        .chain(std::iter::once(build_download_manifest_resource(
            &playback_manifest_url,
            DesktopDownloadManifestResourceType::Manifest,
        )))
        .chain(collect_download_media_playlist_resources(
            &playback_manifest_text,
            &playback_manifest_url,
        )?)
        .collect(),
    );

    Ok(DesktopDownloadManifestResolveResponse {
        root_manifest_url: candidate_url.to_string(),
        playback_manifest_url,
        resource_urls: resources.iter().map(|resource| resource.url.clone()).collect(),
        resources,
        is_master_playlist: true,
    })
}

async fn fetch_download_manifest_text(
    state: &AppState,
    request_url: &str,
) -> Result<String, DownloadManifestError> {
    if let Some(cached_manifest_text) = read_cached_download_manifest_text(state, request_url)? {
        return Ok(cached_manifest_text);
    }

    if let Some(proxy_request) = parse_download_manifest_proxy_request(request_url) {
        return fetch_download_manifest_text_via_proxy(
            state,
            request_url,
            proxy_request.source,
            proxy_request.upstream_url,
            proxy_request.adfilter,
        )
        .await;
    }

    fetch_download_manifest_text_direct(state, request_url).await
}

fn read_cached_download_manifest_text(
    state: &AppState,
    request_url: &str,
) -> Result<Option<String>, DownloadManifestError> {
    let Some(_) = state
        .read_cached_download_entry(request_url)
        .map_err(|error| {
            DownloadManifestError::internal(
                request_url,
                format!("failed to read cached manifest entry: {error}"),
            )
        })?
    else {
        return Ok(None);
    };

    let Some(body) = state.read_cached_download_body(request_url).map_err(|error| {
        DownloadManifestError::internal(
            request_url,
            format!("failed to read cached manifest body: {error}"),
        )
    })? else {
        return Ok(None);
    };

    let Ok(manifest_text) = String::from_utf8(body) else {
        return Ok(None);
    };

    if !manifest_text.contains("#EXTM3U") {
        return Ok(None);
    }

    Ok(Some(manifest_text))
}

#[derive(Debug)]
struct DownloadManifestProxyRequest {
    source: String,
    upstream_url: String,
    adfilter: Option<String>,
}

fn parse_download_manifest_proxy_request(
    request_url: &str,
) -> Option<DownloadManifestProxyRequest> {
    let parsed_url = Url::parse(request_url)
        .ok()
        .or_else(|| Url::parse(&format!("http://moontv.local{request_url}")).ok())?;
    let path = parsed_url.path();

    if !matches!(path, "/api/proxy/vod/m3u8" | "/media/vod/m3u8") {
        return None;
    }

    let mut source = None;
    let mut upstream_url = None;
    let mut adfilter = None;

    for (key, value) in parsed_url.query_pairs() {
        match key.as_ref() {
            "source" => source = Some(value.into_owned()),
            "url" => upstream_url = Some(value.into_owned()),
            "adfilter" => adfilter = Some(value.into_owned()),
            _ => {}
        }
    }

    Some(DownloadManifestProxyRequest {
        source: source?.trim().to_string(),
        upstream_url: upstream_url?.trim().to_string(),
        adfilter: adfilter.map(|value| value.trim().to_string()),
    })
}

async fn fetch_download_manifest_text_via_proxy(
    state: &AppState,
    request_url: &str,
    source: String,
    upstream_url: String,
    adfilter: Option<String>,
) -> Result<String, DownloadManifestError> {
    let config = state.load_config().map_err(|error| {
        DownloadManifestError::internal(
            request_url,
            format!("failed to load local service config: {error}"),
        )
    })?;
    let ad_filter_query_mode = crate::parse_bool_flag(adfilter.as_deref());
    let resolved = crate::resolve_vod_proxy_request(
        &config,
        crate::VodProxyQueryParams {
            source: Some(source),
            url: Some(upstream_url),
            adfilter,
        },
    )
    .map_err(|error| DownloadManifestError::invalid(request_url, error.message))?;
    let upstream_response = crate::fetch_vod_proxy_upstream(
        &state.client,
        &resolved.api_site,
        &resolved.upstream_url,
        &HeaderMap::new(),
    )
    .await
    .map_err(|error| DownloadManifestError::network(request_url, error.message))?;
    let status = upstream_response.status();
    let meta = crate::upstream_response_meta(&upstream_response);
    let manifest_content = upstream_response.text().await.map_err(|error| {
        DownloadManifestError::network(
            request_url,
            format!("Failed to read manifest body: {request_url} ({error})"),
        )
    })?;

    if !status.is_success() {
        let detail = summarize_manifest_error_body(&manifest_content);
        let message = if detail.is_empty() {
            format!("Failed to fetch manifest: {request_url} ({status})")
        } else {
            format!("Failed to fetch manifest: {request_url} ({status}, {detail})")
        };
        return Err(DownloadManifestError::http(request_url, status, message));
    }

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
        ad_filter_result.filtered
    } else {
        rewritten_content
    };

    cache_manifest_text(
        state,
        request_url,
        meta.status,
        meta.content_type.as_deref(),
        response_content.as_bytes(),
    )?;

    ensure_manifest_text(request_url, response_content)
}

async fn fetch_download_manifest_text_direct(
    state: &AppState,
    request_url: &str,
) -> Result<String, DownloadManifestError> {
    let fetch_url = resolve_download_manifest_fetch_url(&state.public_base_url, request_url)?;
    let response = state
        .client
        .get(&fetch_url)
        .header(
            HeaderName::from_static(DOWNLOAD_MANIFEST_REQUEST_INTENT_HEADER),
            HeaderValue::from_static(BACKGROUND_DOWNLOAD_REQUEST_INTENT),
        )
        .timeout(Duration::from_millis(DOWNLOAD_MANIFEST_FETCH_TIMEOUT_MS))
        .send()
        .await
        .map_err(|error| {
            if error.is_timeout() {
                DownloadManifestError::timeout(
                    request_url,
                    format!("Failed to fetch manifest: {request_url} (timeout)"),
                )
            } else {
                DownloadManifestError::network(
                    request_url,
                    format!("Failed to fetch manifest: {request_url} ({error})"),
                )
            }
        })?;
    let status = response.status();
    let content_type = response
        .headers()
        .get(CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .map(str::to_string);
    let body_bytes = response.bytes().await.map_err(|error| {
        DownloadManifestError::network(
            request_url,
            format!("Failed to read manifest body: {request_url} ({error})"),
        )
    })?;

    if !status.is_success() {
        let detail = summarize_manifest_error_body(&String::from_utf8_lossy(&body_bytes));
        let message = if detail.is_empty() {
            format!("Failed to fetch manifest: {request_url} ({status})")
        } else {
            format!("Failed to fetch manifest: {request_url} ({status}, {detail})")
        };
        return Err(DownloadManifestError::http(request_url, status, message));
    }

    cache_manifest_text(
        state,
        request_url,
        status,
        content_type.as_deref(),
        body_bytes.as_ref(),
    )?;

    ensure_manifest_text(
        request_url,
        String::from_utf8(body_bytes.to_vec()).map_err(|_| {
            DownloadManifestError::invalid(
                request_url,
                format!("Upstream content is not valid UTF-8: {request_url}"),
            )
        })?,
    )
}

fn cache_manifest_text(
    state: &AppState,
    request_url: &str,
    status: StatusCode,
    content_type: Option<&str>,
    body: &[u8],
) -> Result<(), DownloadManifestError> {
    state
        .write_cached_download(request_url, status, content_type, body)
        .map_err(|error| {
            DownloadManifestError::internal(
                request_url,
                format!("failed to cache manifest: {request_url} ({error})"),
            )
        })?;
    Ok(())
}

fn ensure_manifest_text(
    request_url: &str,
    manifest_text: String,
) -> Result<String, DownloadManifestError> {
    if !manifest_text.contains("#EXTM3U") {
        return Err(DownloadManifestError::invalid(
            request_url,
            format!("Upstream content is not a valid HLS manifest: {request_url}"),
        ));
    }

    Ok(manifest_text)
}

fn resolve_download_manifest_fetch_url(
    public_base_url: &str,
    request_url: &str,
) -> Result<String, DownloadManifestError> {
    if Url::parse(request_url).is_ok() {
        return Ok(request_url.to_string());
    }

    Url::parse(public_base_url)
        .and_then(|base_url| base_url.join(request_url))
        .map(|url| url.to_string())
        .map_err(|_| {
            DownloadManifestError::invalid(
                request_url,
                format!("Invalid download manifest url: {request_url}"),
            )
        })
}

fn summarize_manifest_error_body(body: &str) -> String {
    let normalized = body.split_whitespace().collect::<Vec<_>>().join(" ");
    if normalized.is_empty() {
        return String::new();
    }

    if normalized.len() > 160 {
        format!("{}...", &normalized[..157])
    } else {
        normalized
    }
}

fn split_manifest_lines(content: &str) -> Vec<String> {
    content
        .split('\n')
        .map(|line| line.trim().to_string())
        .collect()
}

fn manifest_attribute_regex() -> &'static Regex {
    static REGEX: OnceLock<Regex> = OnceLock::new();
    REGEX.get_or_init(|| {
        Regex::new(r#"([A-Z0-9-]+)=("[^"]*"|[^,]*)"#).expect("manifest attribute regex")
    })
}

fn read_manifest_attribute(line: &str, key: &str) -> Option<String> {
    let attribute_line = line.split_once(':').map(|(_, tail)| tail).unwrap_or(line);

    manifest_attribute_regex()
        .captures_iter(attribute_line)
        .find_map(|capture| {
            let capture_key = capture.get(1)?.as_str();
            if capture_key != key {
                return None;
            }

            Some(capture.get(2)?.as_str().trim_matches('"').to_string())
        })
}

fn extract_manifest_uri_attribute(line: &str) -> Option<String> {
    read_manifest_attribute(line, "URI")
}

fn extract_manifest_key_method(line: &str) -> Option<String> {
    read_manifest_attribute(line, "METHOD")
}

fn is_download_manifest_master_playlist(content: &str) -> bool {
    split_manifest_lines(content)
        .iter()
        .any(|line| line.starts_with("#EXT-X-STREAM-INF:"))
}

fn select_download_playback_manifest_url(content: &str) -> Option<String> {
    let lines = split_manifest_lines(content);
    let mut variants = Vec::new();
    let mut index = 0;

    while index < lines.len() {
        let line = lines[index].trim();
        if !line.starts_with("#EXT-X-STREAM-INF:") {
            index += 1;
            continue;
        }

        let bandwidth = read_manifest_attribute(line, "BANDWIDTH")
            .and_then(|value| value.parse::<u64>().ok())
            .unwrap_or(0);
        let next_line = lines.get(index + 1).map(|value| value.trim()).unwrap_or("");

        if !next_line.is_empty() && !next_line.starts_with('#') {
            variants.push((next_line.to_string(), bandwidth));
        }

        index += 2;
    }

    variants.sort_by(|left, right| right.1.cmp(&left.1));
    variants.into_iter().next().map(|item| item.0)
}

fn collect_download_media_playlist_resources(
    content: &str,
    manifest_url: &str,
) -> Result<Vec<DesktopDownloadManifestResource>, DownloadManifestError> {
    let mut resources = Vec::new();

    for line in split_manifest_lines(content) {
        if line.is_empty() {
            continue;
        }

        if line.starts_with("#EXT-X-KEY:") || line.starts_with("#EXT-X-SESSION-KEY:") {
            if let Some(method) = extract_manifest_key_method(&line) {
                let normalized_method = method.trim().to_ascii_uppercase();
                if normalized_method != "AES-128" && normalized_method != "NONE" {
                    return Err(DownloadManifestError::invalid(
                        manifest_url,
                        format!("Unsupported DRM/HLS encryption method: {method}"),
                    ));
                }
            }

            if let Some(url) = extract_manifest_uri_attribute(&line) {
                resources.push(build_download_manifest_resource(
                    &url,
                    DesktopDownloadManifestResourceType::Key,
                ));
            }
            continue;
        }

        if line.starts_with("#EXT-X-MAP:") {
            if let Some(url) = extract_manifest_uri_attribute(&line) {
                resources.push(build_download_manifest_resource(
                    &url,
                    DesktopDownloadManifestResourceType::Map,
                ));
            }
            continue;
        }

        if line.starts_with("#EXT-X-PART:") {
            if let Some(url) = extract_manifest_uri_attribute(&line) {
                resources.push(build_download_manifest_resource(
                    &url,
                    DesktopDownloadManifestResourceType::Segment,
                ));
            }
            continue;
        }

        if line.starts_with("#EXT-X-PRELOAD-HINT:")
            || line.starts_with("#EXT-X-RENDITION-REPORT:")
        {
            continue;
        }

        if !line.starts_with('#') {
            let resource_type = if looks_like_download_manifest_url(&line) {
                DesktopDownloadManifestResourceType::Manifest
            } else {
                DesktopDownloadManifestResourceType::Segment
            };
            resources.push(build_download_manifest_resource(&line, resource_type));
        }
    }

    Ok(resources)
}

fn build_download_manifest_resource(
    url: &str,
    resource_type: DesktopDownloadManifestResourceType,
) -> DesktopDownloadManifestResource {
    DesktopDownloadManifestResource {
        url: url.trim().to_string(),
        resource_type,
    }
}

fn dedupe_download_manifest_resources(
    resources: Vec<DesktopDownloadManifestResource>,
) -> Vec<DesktopDownloadManifestResource> {
    let mut deduped = Vec::new();
    let mut seen = BTreeSet::new();

    for resource in resources {
        if resource.url.is_empty() || !seen.insert(resource.url.clone()) {
            continue;
        }

        deduped.push(resource);
    }

    deduped
}

fn looks_like_download_manifest_url(url: &str) -> bool {
    if manifest_url_regex().is_match(url) {
        return true;
    }

    let path = Url::parse(url)
        .ok()
        .map(|parsed_url| parsed_url.path().to_string())
        .unwrap_or_else(|| url.split('?').next().unwrap_or(url).to_string());

    matches!(path.as_str(), "/api/proxy/vod/m3u8" | "/media/vod/m3u8")
}

fn manifest_url_regex() -> &'static Regex {
    static REGEX: OnceLock<Regex> = OnceLock::new();
    REGEX.get_or_init(|| Regex::new(r"(?i)\.m3u8($|[?#])").expect("manifest url regex"))
}

fn is_retryable_download_manifest_error(error: &DownloadManifestError) -> bool {
    match error.kind {
        DownloadManifestErrorKind::Network | DownloadManifestErrorKind::Timeout => true,
        DownloadManifestErrorKind::Http => matches!(
            error.status,
            Some(StatusCode::REQUEST_TIMEOUT)
                | Some(StatusCode::TOO_EARLY)
                | Some(StatusCode::TOO_MANY_REQUESTS)
                | Some(StatusCode::INTERNAL_SERVER_ERROR)
                | Some(StatusCode::BAD_GATEWAY)
                | Some(StatusCode::SERVICE_UNAVAILABLE)
                | Some(StatusCode::GATEWAY_TIMEOUT)
        ),
        DownloadManifestErrorKind::Invalid | DownloadManifestErrorKind::Internal => false,
    }
}

async fn wait_for_download_manifest_retry(attempt: usize) {
    let clamped_attempt = attempt.max(1) as u64;
    let delay_ms = (250_u64 * clamped_attempt).min(1_500);
    tokio::time::sleep(Duration::from_millis(delay_ms)).await;
}

fn download_runtime_task_not_found() -> AppError {
    AppError::new(StatusCode::NOT_FOUND, "download runtime task not found")
}

async fn write_download_engine_snapshot_response(
    state: &AppState,
    snapshot: DesktopDownloadEngineSnapshot,
) -> AppResult<Response> {
    state
        .write_download_engine_snapshot(&snapshot)
        .map_err(|error| AppError::internal(error.to_string()))?;
    state.publish_download_engine_snapshot(&snapshot);
    no_store_json_response(&snapshot)
}

async fn mutate_download_engine_snapshot<F>(state: &AppState, mutator: F) -> AppResult<Response>
where
    F: FnOnce(&mut DesktopDownloadEngine) -> AppResult<DesktopDownloadEngineSnapshot>,
{
    let snapshot = {
        let mut engine = state.download_engine.write().await;
        mutator(&mut engine)?
    };

    write_download_engine_snapshot_response(state, snapshot).await
}

pub(crate) async fn get_download_runtime_tasks(
    State(state): State<AppState>,
) -> AppResult<Response> {
    let snapshot = state.download_engine.read().await.snapshot();
    no_store_json_response(&snapshot)
}

pub(crate) async fn clear_download_runtime_tasks(
    State(state): State<AppState>,
) -> AppResult<Response> {
    mutate_download_engine_snapshot(&state, |engine| Ok(engine.clear_tasks().clone())).await
}

fn build_download_runtime_snapshot_event(
    snapshot: DesktopDownloadEngineSnapshot,
) -> Result<Event, Infallible> {
    Ok(Event::default()
        .data(serde_json::to_string(&snapshot).expect("download runtime snapshot serializes")))
}

pub(crate) async fn stream_download_runtime_tasks(
    State(state): State<AppState>,
) -> AppResult<Response> {
    let snapshot_stream = stream::unfold(
        (state.subscribe_download_engine_snapshots(), true),
        |(mut receiver, include_current)| async move {
            let next_snapshot = if include_current {
                Some(receiver.borrow().clone())
            } else {
                match receiver.changed().await {
                    Ok(()) => Some(receiver.borrow().clone()),
                    Err(_) => None,
                }
            };

            next_snapshot.map(|snapshot| {
                (
                    build_download_runtime_snapshot_event(snapshot),
                    (receiver, false),
                )
            })
        },
    );

    Ok(Sse::new(snapshot_stream).into_response())
}

pub(crate) async fn post_download_runtime_task(
    State(state): State<AppState>,
    Json(task): Json<DesktopDownloadTask>,
) -> AppResult<Response> {
    mutate_download_engine_snapshot(&state, move |engine| {
        let snapshot = engine
            .upsert_task(task)
            .map_err(AppError::bad_request)?
            .clone();
        Ok(snapshot)
    })
    .await
}

pub(crate) async fn put_download_runtime_task_settings(
    State(state): State<AppState>,
    Json(settings): Json<DesktopDownloadEngineSettingsUpdate>,
) -> AppResult<Response> {
    mutate_download_engine_snapshot(&state, move |engine| {
        Ok(engine.update_settings(settings).clone())
    })
    .await
}

pub(crate) async fn pause_download_runtime_task(
    State(state): State<AppState>,
    AxumPath(task_id): AxumPath<String>,
) -> AppResult<Response> {
    mutate_download_engine_snapshot(&state, move |engine| {
        let snapshot = engine
            .pause_task(&task_id)
            .ok_or_else(download_runtime_task_not_found)?
            .clone();
        Ok(snapshot)
    })
    .await
}

pub(crate) async fn resume_download_runtime_task(
    State(state): State<AppState>,
    AxumPath(task_id): AxumPath<String>,
) -> AppResult<Response> {
    mutate_download_engine_snapshot(&state, move |engine| {
        let snapshot = engine
            .resume_task(&task_id)
            .ok_or_else(download_runtime_task_not_found)?
            .clone();
        Ok(snapshot)
    })
    .await
}

pub(crate) async fn cancel_download_runtime_task(
    State(state): State<AppState>,
    AxumPath(task_id): AxumPath<String>,
) -> AppResult<Response> {
    mutate_download_engine_snapshot(&state, move |engine| {
        engine
            .cancel_task(&task_id)
            .ok_or_else(download_runtime_task_not_found)?;
        Ok(engine.snapshot())
    })
    .await
}

pub(crate) async fn delete_download_runtime_task(
    State(state): State<AppState>,
    AxumPath(task_id): AxumPath<String>,
) -> AppResult<Response> {
    mutate_download_engine_snapshot(&state, move |engine| {
        engine
            .delete_task(&task_id)
            .ok_or_else(download_runtime_task_not_found)?;
        Ok(engine.snapshot())
    })
    .await
}

fn require_download_runtime_url(value: Option<&str>) -> AppResult<String> {
    let url = normalize_optional_text(value)
        .ok_or_else(|| AppError::bad_request("missing download runtime url"))?;
    Url::parse(&url).map_err(|_| AppError::bad_request("invalid download runtime url"))?;
    Ok(url)
}

fn require_download_runtime_index_id(value: Option<&str>) -> AppResult<String> {
    normalize_optional_string(value.map(|item| item.to_string()))
        .ok_or_else(|| AppError::bad_request("missing download runtime index id"))
}

fn parse_download_runtime_status(headers: &HeaderMap) -> AppResult<StatusCode> {
    let raw_status = headers
        .get(HeaderName::from_static("x-moontv-response-status"))
        .and_then(|value| value.to_str().ok())
        .unwrap_or("200")
        .trim();
    let numeric_status = raw_status
        .parse::<u16>()
        .map_err(|_| AppError::bad_request("invalid download runtime status"))?;
    StatusCode::from_u16(numeric_status)
        .map_err(|_| AppError::bad_request("invalid download runtime status"))
}

fn normalize_download_runtime_resource_index(
    record: DesktopDownloadResourceIndexRecord,
) -> AppResult<DesktopDownloadResourceIndexRecord> {
    let id = require_download_runtime_index_id(Some(&record.id))?;
    let owner_username = normalize_optional_string(Some(record.owner_username))
        .ok_or_else(|| AppError::bad_request("missing download runtime ownerUsername"))?;
    let task_id = normalize_optional_string(Some(record.task_id))
        .ok_or_else(|| AppError::bad_request("missing download runtime taskId"))?;
    let content_id = normalize_optional_string(Some(record.content_id))
        .ok_or_else(|| AppError::bad_request("missing download runtime contentId"))?;
    let source = normalize_optional_string(Some(record.source))
        .ok_or_else(|| AppError::bad_request("missing download runtime source"))?;
    let vod_id = normalize_optional_string(Some(record.vod_id))
        .ok_or_else(|| AppError::bad_request("missing download runtime vodId"))?;
    let urls = record
        .urls
        .into_iter()
        .filter_map(|url| normalize_optional_text(Some(&url)))
        .collect::<Vec<_>>();

    Ok(DesktopDownloadResourceIndexRecord {
        id,
        owner_username,
        task_id,
        content_id,
        source,
        vod_id,
        episode_index: record.episode_index,
        urls,
        created_at: record.created_at,
        updated_at: record.updated_at.max(record.created_at),
    })
}

fn parse_byte_range_header(range_header: &str, total_length: usize) -> Option<(usize, usize)> {
    let normalized = range_header.trim();
    let range_value = normalized.strip_prefix("bytes=")?;
    let (start_raw, end_raw) = range_value.split_once('-')?;

    let start = start_raw.parse::<usize>().ok()?;
    if start >= total_length {
        return None;
    }

    let end = if end_raw.trim().is_empty() {
        total_length.checked_sub(1)?
    } else {
        end_raw
            .parse::<usize>()
            .ok()?
            .min(total_length.checked_sub(1)?)
    };

    if end < start {
        return None;
    }

    Some((start, end))
}

pub(crate) fn build_cached_download_response(
    method: &Method,
    request_headers: &HeaderMap,
    entry: &DesktopDownloadCacheEntry,
    body: Vec<u8>,
) -> Response {
    let total_length = body.len();
    let mut status = StatusCode::from_u16(entry.status).unwrap_or(StatusCode::OK);
    let mut headers = HeaderMap::new();
    let content_type = entry
        .content_type
        .as_deref()
        .unwrap_or("application/octet-stream");

    if let Ok(value) = HeaderValue::from_str(content_type) {
        headers.insert(CONTENT_TYPE, value);
    }
    headers.insert(CACHE_CONTROL, HeaderValue::from_static("no-store"));
    headers.insert(ACCEPT_RANGES, HeaderValue::from_static("bytes"));
    apply_cors_headers(&mut headers);

    let response_bytes = if let Some(range_header) = request_headers
        .get(RANGE)
        .and_then(|value| value.to_str().ok())
    {
        if let Some((start, end)) = parse_byte_range_header(range_header, total_length) {
            status = StatusCode::PARTIAL_CONTENT;
            let sliced = body[start..=end].to_vec();
            if let Ok(value) = HeaderValue::from_str(&format!("bytes {start}-{end}/{total_length}"))
            {
                headers.insert(CONTENT_RANGE, value);
            }
            if let Ok(value) = HeaderValue::from_str(&sliced.len().to_string()) {
                headers.insert(CONTENT_LENGTH, value);
            }
            sliced
        } else {
            status = StatusCode::RANGE_NOT_SATISFIABLE;
            if let Ok(value) = HeaderValue::from_str(&format!("bytes */{total_length}")) {
                headers.insert(CONTENT_RANGE, value);
            }
            headers.insert(CONTENT_LENGTH, HeaderValue::from_static("0"));
            Vec::new()
        }
    } else {
        if let Ok(value) = HeaderValue::from_str(&total_length.to_string()) {
            headers.insert(CONTENT_LENGTH, value);
        }
        body
    };

    let mut response = if *method == Method::HEAD {
        Response::new(Body::empty())
    } else {
        Response::new(Body::from(response_bytes))
    };
    *response.status_mut() = status;
    *response.headers_mut() = headers;
    response
}
