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
    DesktopDownloadTask, DesktopDownloadTaskStatus,
};
use regex::Regex;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use tracing::warn;
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

#[derive(Debug, Clone, Copy, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
enum DesktopDownloadTaskBulkCommand {
    Pause,
    Resume,
    Retry,
    Cancel,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DesktopDownloadTaskBulkCommandRequest {
    command: DesktopDownloadTaskBulkCommand,
    #[serde(default)]
    task_ids: Vec<String>,
}

impl DesktopDownloadTaskBulkCommandRequest {
    fn into_parts(self) -> (DesktopDownloadTaskBulkCommand, Vec<String>) {
        let task_ids = self
            .task_ids
            .into_iter()
            .filter_map(|task_id| normalize_optional_string(Some(task_id)))
            .collect::<BTreeSet<_>>()
            .into_iter()
            .collect();

        (self.command, task_ids)
    }
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
const DOWNLOAD_RESOURCE_FETCH_TIMEOUT_MS: u64 = 45_000;
const MAX_DOWNLOAD_MANIFEST_FETCH_RETRIES: usize = 2;
const DOWNLOAD_MANIFEST_REQUEST_INTENT_HEADER: &str = "x-moontv-download-intent";
const BACKGROUND_DOWNLOAD_REQUEST_INTENT: &str = "background";
const DOWNLOAD_RUNTIME_ERROR_STORAGE: &str = "download_runtime_storage_error";
const DOWNLOAD_RUNTIME_ERROR_RESOURCE_FETCH_FAILED: &str =
    "download_runtime_resource_fetch_failed";
const DOWNLOAD_RUNTIME_ERROR_RESOURCE_RESPONSE_READ_FAILED: &str =
    "download_runtime_resource_response_read_failed";
const DOWNLOAD_RUNTIME_ERROR_CACHE_NOT_FOUND: &str = "download_runtime_cache_not_found";
const DOWNLOAD_RUNTIME_ERROR_CACHE_BODY_NOT_FOUND: &str =
    "download_runtime_cache_body_not_found";
const DOWNLOAD_RUNTIME_ERROR_MANIFEST_INVALID: &str = "download_runtime_manifest_invalid";
const DOWNLOAD_RUNTIME_ERROR_MANIFEST_UPSTREAM: &str = "download_runtime_manifest_upstream";
const DOWNLOAD_RUNTIME_ERROR_MANIFEST_TIMEOUT: &str = "download_runtime_manifest_timeout";
const DOWNLOAD_RUNTIME_ERROR_MANIFEST_INTERNAL: &str = "download_runtime_manifest_internal";
const DOWNLOAD_RUNTIME_ERROR_TASK_NOT_FOUND: &str = "download_runtime_task_not_found";
const DOWNLOAD_RUNTIME_ERROR_TASK_INVALID: &str = "download_runtime_task_invalid";
const DOWNLOAD_RUNTIME_ERROR_MISSING_URL: &str = "download_runtime_missing_url";
const DOWNLOAD_RUNTIME_ERROR_INVALID_URL: &str = "download_runtime_invalid_url";
const DOWNLOAD_RUNTIME_ERROR_MISSING_INDEX_ID: &str = "download_runtime_missing_index_id";
const DOWNLOAD_RUNTIME_ERROR_INVALID_STATUS: &str = "download_runtime_invalid_status";
const DOWNLOAD_RUNTIME_ERROR_INVALID_RESOURCE_INDEX: &str =
    "download_runtime_invalid_resource_index";

fn download_runtime_storage_error(message: impl Into<String>) -> AppError {
    AppError::internal_with_code(DOWNLOAD_RUNTIME_ERROR_STORAGE, message)
}

fn download_runtime_validation_error(
    code: &'static str,
    message: impl Into<String>,
) -> AppError {
    AppError::bad_request_with_code(code, message)
}

fn download_runtime_task_invalid(message: impl Into<String>) -> AppError {
    AppError::bad_request_with_code(DOWNLOAD_RUNTIME_ERROR_TASK_INVALID, message)
}

fn download_runtime_upstream_error(
    code: &'static str,
    message: impl Into<String>,
) -> AppError {
    AppError::with_code(StatusCode::BAD_GATEWAY, code, message)
}

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

#[derive(Debug)]
struct RuntimeFetchedDownloadResponse {
    status: StatusCode,
    content_type: Option<String>,
    body: Vec<u8>,
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
        match self.kind {
            DownloadManifestErrorKind::Invalid => AppError::bad_request_with_code(
                DOWNLOAD_RUNTIME_ERROR_MANIFEST_INVALID,
                self.message,
            ),
            DownloadManifestErrorKind::Http | DownloadManifestErrorKind::Network => {
                download_runtime_upstream_error(
                    DOWNLOAD_RUNTIME_ERROR_MANIFEST_UPSTREAM,
                    self.message,
                )
            }
            DownloadManifestErrorKind::Timeout => download_runtime_upstream_error(
                DOWNLOAD_RUNTIME_ERROR_MANIFEST_TIMEOUT,
                self.message,
            ),
            DownloadManifestErrorKind::Internal => AppError::internal_with_code(
                DOWNLOAD_RUNTIME_ERROR_MANIFEST_INTERNAL,
                self.message,
            ),
        }
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
        .map_err(|error| download_runtime_storage_error(error.to_string()))?;
    let entry = state
        .write_cached_download(&url, status, content_type, body_bytes.as_ref())
        .map_err(|error| download_runtime_storage_error(error.to_string()))?;

    no_store_json_response(&entry)
}

pub(crate) async fn get_download_runtime_cache_meta(
    State(state): State<AppState>,
    Query(params): Query<DesktopDownloadCacheQueryParams>,
) -> AppResult<Response> {
    let url = require_download_runtime_url(params.url.as_deref())?;
    let entry = state
        .read_cached_download_entry(&url)
        .map_err(|error| download_runtime_storage_error(error.to_string()))?;
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
        .map_err(|error| download_runtime_storage_error(error.to_string()))?
        .ok_or_else(|| {
            AppError::with_code(
                StatusCode::NOT_FOUND,
                DOWNLOAD_RUNTIME_ERROR_CACHE_NOT_FOUND,
                "cached download not found",
            )
        })?;
    let body = state
        .read_cached_download_body(&url)
        .map_err(|error| download_runtime_storage_error(error.to_string()))?
        .ok_or_else(|| {
            AppError::with_code(
                StatusCode::NOT_FOUND,
                DOWNLOAD_RUNTIME_ERROR_CACHE_BODY_NOT_FOUND,
                "cached download body not found",
            )
        })?;

    Ok(build_cached_download_response(
        &method,
        &request_headers,
        &entry,
        body,
    ))
}

pub(crate) async fn fetch_download_runtime_cache_response(
    State(state): State<AppState>,
    Query(params): Query<DesktopDownloadCacheQueryParams>,
    request_headers: HeaderMap,
) -> AppResult<Response> {
    let url = require_download_runtime_url(params.url.as_deref())?;

    if let Some(response) =
        try_build_cached_download_response(&state, &Method::GET, &request_headers, &url)?
    {
        return Ok(response);
    }

    let fetched_response = fetch_runtime_download_response(&state, &url, &request_headers).await?;

    if fetched_response.status.is_success() {
        let entry = state
            .write_cached_download(
                &url,
                fetched_response.status,
                fetched_response.content_type.as_deref(),
                fetched_response.body.as_ref(),
            )
            .map_err(|error| download_runtime_storage_error(error.to_string()))?;

        return Ok(build_cached_download_response(
            &Method::GET,
            &request_headers,
            &entry,
            fetched_response.body,
        ));
    }

    Ok(build_download_runtime_fetched_response(
        fetched_response.status,
        fetched_response.content_type.as_deref(),
        fetched_response.body,
    ))
}

pub(crate) async fn delete_download_runtime_cache(
    State(state): State<AppState>,
    Query(params): Query<DesktopDownloadCacheQueryParams>,
) -> AppResult<Response> {
    let url = require_download_runtime_url(params.url.as_deref())?;
    let deleted = state
        .delete_cached_download(&url)
        .map_err(|error| download_runtime_storage_error(error.to_string()))?;

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
        .map_err(|error| download_runtime_storage_error(error.to_string()))?;
    no_store_json_response(&json!({ "ok": true }))
}

fn try_build_cached_download_response(
    state: &AppState,
    method: &Method,
    request_headers: &HeaderMap,
    url: &str,
) -> AppResult<Option<Response>> {
    let Some(entry) = state
        .read_cached_download_entry(url)
        .map_err(|error| download_runtime_storage_error(error.to_string()))?
    else {
        return Ok(None);
    };
    let Some(body) = state
        .read_cached_download_body(url)
        .map_err(|error| download_runtime_storage_error(error.to_string()))?
    else {
        return Ok(None);
    };

    Ok(Some(build_cached_download_response(
        method,
        request_headers,
        &entry,
        body,
    )))
}

async fn fetch_runtime_download_response(
    state: &AppState,
    url: &str,
    request_headers: &HeaderMap,
) -> AppResult<RuntimeFetchedDownloadResponse> {
    if let Some((path, proxy_params)) = crate::vod_proxy::parse_vod_proxy_url(url) {
        let fetched_asset = crate::vod_proxy::fetch_vod_proxy_asset_bytes(
            state,
            &path,
            proxy_params,
            request_headers,
        )
        .await?;

        return Ok(RuntimeFetchedDownloadResponse {
            status: fetched_asset.status,
            content_type: fetched_asset.content_type,
            body: fetched_asset.body,
        });
    }

    let response = state
        .client
        .get(url)
        .header(
            HeaderName::from_static(DOWNLOAD_MANIFEST_REQUEST_INTENT_HEADER),
            HeaderValue::from_static(BACKGROUND_DOWNLOAD_REQUEST_INTENT),
        )
        .timeout(Duration::from_millis(DOWNLOAD_RESOURCE_FETCH_TIMEOUT_MS))
        .send()
        .await
        .map_err(|error| {
            AppError::with_code(
                StatusCode::BAD_GATEWAY,
                DOWNLOAD_RUNTIME_ERROR_RESOURCE_FETCH_FAILED,
                format!("failed to fetch download resource: {url} ({error})"),
            )
        })?;
    let status = response.status();
    let content_type = response
        .headers()
        .get(CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .map(str::to_string);
    let body = response
        .bytes()
        .await
        .map_err(|error| {
            AppError::with_code(
                StatusCode::BAD_GATEWAY,
                DOWNLOAD_RUNTIME_ERROR_RESOURCE_RESPONSE_READ_FAILED,
                format!("failed to read download resource response: {url} ({error})"),
            )
        })?
        .to_vec();

    Ok(RuntimeFetchedDownloadResponse {
        status,
        content_type,
        body,
    })
}

fn build_download_runtime_fetched_response(
    status: StatusCode,
    content_type: Option<&str>,
    body: Vec<u8>,
) -> Response {
    let mut headers = HeaderMap::new();

    if let Ok(value) = HeaderValue::from_str(content_type.unwrap_or("application/octet-stream")) {
        headers.insert(CONTENT_TYPE, value);
    }
    if let Ok(value) = HeaderValue::from_str(&body.len().to_string()) {
        headers.insert(CONTENT_LENGTH, value);
    }
    headers.insert(CACHE_CONTROL, HeaderValue::from_static("no-store"));
    apply_cors_headers(&mut headers);

    let mut response = Response::new(Body::from(body));
    *response.status_mut() = status;
    *response.headers_mut() = headers;
    response
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
        .map_err(|error| download_runtime_storage_error(error.to_string()))?;
    no_store_json_response(&saved)
}

pub(crate) async fn get_download_runtime_resource_index(
    State(state): State<AppState>,
    Query(params): Query<DesktopDownloadResourceIndexQueryParams>,
) -> AppResult<Response> {
    let id = require_download_runtime_index_id(params.id.as_deref())?;
    let record = state
        .read_resource_index(&id)
        .map_err(|error| download_runtime_storage_error(error.to_string()))?;

    no_store_json_response(&record)
}

pub(crate) async fn delete_download_runtime_resource_index(
    State(state): State<AppState>,
    Query(params): Query<DesktopDownloadResourceIndexQueryParams>,
) -> AppResult<Response> {
    let id = require_download_runtime_index_id(params.id.as_deref())?;
    let deleted = state
        .delete_resource_index(&id)
        .map_err(|error| download_runtime_storage_error(error.to_string()))?;

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
        .map_err(|error| download_runtime_storage_error(error.to_string()))?;
    no_store_json_response(&json!({ "ok": true }))
}

pub(crate) async fn get_download_runtime_store_snapshot(
    State(state): State<AppState>,
) -> AppResult<Response> {
    let snapshot = state
        .read_download_store_snapshot()
        .map_err(|error| download_runtime_storage_error(error.to_string()))?;
    no_store_json_response(&snapshot)
}

pub(crate) async fn put_download_runtime_store_snapshot(
    State(state): State<AppState>,
    Json(snapshot): Json<Value>,
) -> AppResult<Response> {
    state
        .write_download_store_snapshot(&snapshot)
        .map_err(|error| download_runtime_storage_error(error.to_string()))?;
    no_store_json_response(&json!({ "ok": true }))
}

pub(crate) async fn clear_download_runtime_store_snapshot(
    State(state): State<AppState>,
) -> AppResult<Response> {
    let deleted = state
        .clear_download_store_snapshot()
        .map_err(|error| download_runtime_storage_error(error.to_string()))?;
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
    let resolved_manifest = resolve_download_manifest_candidates(&state, candidate_urls).await?;
    no_store_json_response(&resolved_manifest)
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
        return Err(AppError::bad_request_with_code(
            DOWNLOAD_RUNTIME_ERROR_MANIFEST_INVALID,
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
            resource_urls: resources
                .iter()
                .map(|resource| resource.url.clone())
                .collect(),
            resources,
            is_master_playlist: false,
        });
    }

    let playback_manifest_url = select_download_playback_manifest_url(&root_manifest_text)
        .ok_or_else(|| {
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
        resource_urls: resources
            .iter()
            .map(|resource| resource.url.clone())
            .collect(),
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

    let Some(body) = state
        .read_cached_download_body(request_url)
        .map_err(|error| {
            DownloadManifestError::internal(
                request_url,
                format!("failed to read cached manifest body: {error}"),
            )
        })?
    else {
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

        if line.starts_with("#EXT-X-PRELOAD-HINT:") || line.starts_with("#EXT-X-RENDITION-REPORT:")
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

async fn resolve_download_manifest_candidates(
    state: &AppState,
    candidate_urls: Vec<String>,
) -> Result<DesktopDownloadManifestResolveResponse, AppError> {
    let mut last_error: Option<DownloadManifestError> = None;

    for candidate_url in candidate_urls {
        for attempt in 1..=MAX_DOWNLOAD_MANIFEST_FETCH_RETRIES + 1 {
            match parse_download_manifest_for_candidate(state, &candidate_url).await {
                Ok(result) => return Ok(result),
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

fn download_runtime_task_not_found() -> AppError {
    AppError::with_code(
        StatusCode::NOT_FOUND,
        DOWNLOAD_RUNTIME_ERROR_TASK_NOT_FOUND,
        "download runtime task not found",
    )
}

async fn persist_download_engine_snapshot(
    state: &AppState,
    snapshot: DesktopDownloadEngineSnapshot,
) -> AppResult<DesktopDownloadEngineSnapshot> {
    state
        .write_download_engine_snapshot(&snapshot)
        .map_err(|error| download_runtime_storage_error(error.to_string()))?;
    state.publish_download_engine_snapshot(&snapshot);
    Ok(snapshot)
}

async fn write_download_engine_snapshot_response(
    state: &AppState,
    snapshot: DesktopDownloadEngineSnapshot,
) -> AppResult<Response> {
    let snapshot = persist_download_engine_snapshot(state, snapshot).await?;
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

async fn update_download_runtime_task<F>(
    state: &AppState,
    task_id: &str,
    updater: F,
) -> AppResult<Option<DesktopDownloadTask>>
where
    F: FnOnce(DesktopDownloadTask) -> DesktopDownloadTask,
{
    let (snapshot, next_task) = {
        let mut engine = state.download_engine.write().await;
        let Some(current_task) = engine.snapshot().tasks.get(task_id).cloned() else {
            return Ok(None);
        };
        let next_task = updater(current_task);
        let snapshot = engine
            .upsert_task(next_task.clone())
            .map_err(download_runtime_task_invalid)?
            .clone();
        (snapshot, next_task)
    };

    persist_download_engine_snapshot(state, snapshot).await?;
    Ok(Some(next_task))
}

async fn read_download_runtime_task(
    state: &AppState,
    task_id: &str,
) -> Option<DesktopDownloadTask> {
    state
        .download_engine
        .read()
        .await
        .snapshot()
        .tasks
        .get(task_id)
        .cloned()
}

fn calculate_download_task_progress(downloaded_resources: u32, total_resources: u32) -> u8 {
    if total_resources == 0 {
        return 0;
    }

    ((downloaded_resources as f64 / total_resources as f64) * 100.0)
        .round()
        .clamp(0.0, 100.0) as u8
}

fn estimate_download_task_total_size_bytes(
    completed_size_bytes: u64,
    downloaded_resources: u32,
    total_resources: u32,
) -> u64 {
    if downloaded_resources == 0 || total_resources == 0 {
        return completed_size_bytes;
    }

    let average_size = completed_size_bytes as f64 / downloaded_resources as f64;
    completed_size_bytes.max((average_size * total_resources as f64).round() as u64)
}

fn resolve_download_runtime_owner_username(state: &AppState) -> String {
    state
        .read_download_store_snapshot()
        .ok()
        .flatten()
        .and_then(|snapshot| {
            snapshot
                .get("ownerUsername")
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(str::to_string)
        })
        .unwrap_or_else(|| "desktop-runtime".to_string())
}

fn normalize_download_runtime_task_candidate_url(
    state: &AppState,
    source: &str,
    value: &str,
) -> Option<String> {
    let normalized_value = normalize_optional_text(Some(value))?;
    if crate::vod_proxy::parse_vod_proxy_url(&normalized_value).is_some() {
        return Some(normalized_value);
    }

    if matches!(
        Url::parse(&normalized_value)
            .ok()
            .map(|parsed_url| parsed_url.scheme().to_ascii_lowercase()),
        Some(scheme) if scheme == "http" || scheme == "https"
    ) {
        return Some(crate::build_vod_proxy_m3u8_url(
            &state.public_base_url,
            source,
            &normalized_value,
        ));
    }

    Some(normalized_value)
}

async fn resolve_download_runtime_task_manifest_candidates(
    state: &AppState,
    task: &DesktopDownloadTask,
) -> Vec<String> {
    let mut current_candidates = task.manifest_candidate_urls.clone();
    current_candidates.push(task.entry_manifest_url.clone());
    let mut candidate_urls = normalize_download_manifest_candidate_urls(current_candidates)
        .unwrap_or_else(|_| Vec::new());

    if candidate_urls.len() > 1 || task.title.trim().is_empty() {
        return candidate_urls;
    }

    let config = match state.load_config() {
        Ok(config) => config,
        Err(_) => return candidate_urls,
    };

    let fallback_sources = crate::playback_prefetch::search_playback_sources_with_prefetch(
        &state.client,
        &config,
        &crate::playback_prefetch::PlaybackSourcePrefetchRequest {
            title: task.title.clone(),
            year: Some(task.year.clone()),
            search_type: task.search_type.clone(),
            query: task.search_title.clone(),
            douban_id: task.douban_id,
            allow_adult_candidates: None,
        },
    )
    .await;

    for fallback_source in fallback_sources {
        let Some(episode_url) = fallback_source.episodes.get(task.episode_index as usize) else {
            continue;
        };
        let Some(candidate_url) = normalize_download_runtime_task_candidate_url(
            state,
            &fallback_source.source,
            episode_url,
        ) else {
            continue;
        };
        candidate_urls.push(candidate_url);
    }

    normalize_download_manifest_candidate_urls(candidate_urls).unwrap_or_else(|_| Vec::new())
}

fn build_download_runtime_resource_index_record(
    state: &AppState,
    task: &DesktopDownloadTask,
    manifest_result: &DesktopDownloadManifestResolveResponse,
) -> DesktopDownloadResourceIndexRecord {
    let timestamp = crate::current_timestamp_ms();
    DesktopDownloadResourceIndexRecord {
        id: task.cache_index_id.clone(),
        owner_username: resolve_download_runtime_owner_username(state),
        task_id: task.id.clone(),
        content_id: task.content_id.clone(),
        source: task.source.clone(),
        vod_id: task.vod_id.clone(),
        episode_index: i64::from(task.episode_index),
        urls: manifest_result.resource_urls.clone(),
        created_at: timestamp,
        updated_at: timestamp,
    }
}

fn is_download_runtime_task_running(task: &DesktopDownloadTask) -> bool {
    task.status == DesktopDownloadTaskStatus::Downloading
}

fn should_flush_download_runtime_progress(downloaded_resources: u32, total_resources: u32) -> bool {
    downloaded_resources == total_resources
        || downloaded_resources == 1
        || downloaded_resources % 5 == 0
}

async fn fetch_and_cache_download_runtime_resource(
    state: &AppState,
    url: &str,
) -> Result<DesktopDownloadCacheEntry, String> {
    if let Some(entry) = state
        .read_cached_download_entry(url)
        .map_err(|error| error.to_string())?
    {
        return Ok(entry);
    }

    let fetched_response = fetch_runtime_download_response(state, url, &HeaderMap::new())
        .await
        .map_err(|error| error.message)?;
    if !fetched_response.status.is_success() {
        let detail =
            summarize_manifest_error_body(&String::from_utf8_lossy(&fetched_response.body));
        return Err(format!(
            "failed to fetch download resource: {url} ({}{})",
            fetched_response.status.as_u16(),
            if detail.is_empty() {
                String::new()
            } else {
                format!(", {detail}")
            }
        ));
    }

    state
        .write_cached_download(
            url,
            fetched_response.status,
            fetched_response.content_type.as_deref(),
            fetched_response.body.as_ref(),
        )
        .map_err(|error| error.to_string())
}

fn cleanup_download_runtime_cache_index(
    state: &AppState,
    cache_index_id: &str,
) -> Result<(), String> {
    let Some(resource_index) = state
        .read_resource_index(cache_index_id)
        .map_err(|error| error.to_string())?
    else {
        return Ok(());
    };

    for url in resource_index.urls {
        state
            .delete_cached_download(&url)
            .map_err(|error| error.to_string())?;
    }

    state
        .delete_resource_index(cache_index_id)
        .map_err(|error| error.to_string())?;
    Ok(())
}

async fn activate_queued_download_runtime_task(state: &AppState, task_id: &str) -> AppResult<bool> {
    let snapshot = {
        let mut active_tasks = state.download_runtime_active_tasks.lock().await;
        if active_tasks.contains(task_id) {
            return Ok(false);
        }

        let mut engine = state.download_engine.write().await;
        let Some(mut task) = engine.snapshot().tasks.get(task_id).cloned() else {
            return Ok(false);
        };
        if task.status != DesktopDownloadTaskStatus::Queued {
            return Ok(false);
        }

        task.status = DesktopDownloadTaskStatus::Downloading;
        task.error_message = None;
        task.download_speed_bytes_per_second = 0;
        task.updated_at = crate::current_timestamp_ms();
        let snapshot = engine
            .upsert_task(task)
            .map_err(download_runtime_task_invalid)?
            .clone();
        active_tasks.insert(task_id.to_string());
        snapshot
    };

    if let Err(error) = persist_download_engine_snapshot(state, snapshot).await {
        state
            .download_runtime_active_tasks
            .lock()
            .await
            .remove(task_id);
        return Err(error);
    }

    Ok(true)
}

async fn process_download_runtime_queue(state: AppState) -> AppResult<()> {
    let _guard = state.download_runtime_schedule_lock.lock().await;

    loop {
        let active_task_ids = state.download_runtime_active_tasks.lock().await.clone();
        let snapshot = state.download_engine.read().await.snapshot();
        let available_slots = snapshot
            .max_concurrent_tasks
            .saturating_sub(active_task_ids.len() as u8) as usize;
        if available_slots == 0 {
            return Ok(());
        }

        let mut queued_tasks = snapshot
            .tasks
            .into_values()
            .filter(|task| {
                task.status == DesktopDownloadTaskStatus::Queued
                    && !active_task_ids.contains(&task.id)
            })
            .collect::<Vec<_>>();
        if queued_tasks.is_empty() {
            return Ok(());
        }

        queued_tasks.sort_by(|left, right| {
            left.created_at
                .cmp(&right.created_at)
                .then_with(|| left.title.cmp(&right.title))
                .then_with(|| left.episode_index.cmp(&right.episode_index))
                .then_with(|| left.id.cmp(&right.id))
        });

        let next_task_ids = queued_tasks
            .into_iter()
            .take(available_slots)
            .map(|task| task.id)
            .collect::<Vec<_>>();
        let mut spawned_worker = false;

        for task_id in next_task_ids {
            if !activate_queued_download_runtime_task(&state, &task_id).await? {
                continue;
            }

            spawned_worker = true;
            let worker_state = state.clone();
            tokio::spawn(async move {
                run_download_runtime_task_worker(worker_state, task_id).await;
            });
        }

        if !spawned_worker {
            return Ok(());
        }
    }
}

pub(crate) fn schedule_download_runtime_processing(state: AppState) {
    tokio::spawn(async move {
        if let Err(error) = process_download_runtime_queue(state).await {
            warn!(
                "desktop download runtime scheduler failed: {}",
                error.message
            );
        }
    });
}

async fn fail_download_runtime_task(
    state: &AppState,
    task_id: &str,
    error_message: &str,
) -> AppResult<()> {
    let _ = update_download_runtime_task(state, task_id, |mut task| {
        if !is_download_runtime_task_running(&task) {
            return task;
        }

        task.status = DesktopDownloadTaskStatus::Error;
        task.error_message = Some(error_message.to_string());
        task.current_size_bytes = task.size_bytes;
        task.estimated_total_size_bytes = task.estimated_total_size_bytes.max(task.size_bytes);
        task.download_speed_bytes_per_second = 0;
        task.updated_at = crate::current_timestamp_ms();
        task
    })
    .await?;
    Ok(())
}

async fn execute_download_runtime_task(state: &AppState, task_id: &str) -> Result<(), String> {
    let Some(initial_task) = read_download_runtime_task(state, task_id).await else {
        return Ok(());
    };
    if !is_download_runtime_task_running(&initial_task) {
        return Ok(());
    }

    let manifest_candidate_urls =
        resolve_download_runtime_task_manifest_candidates(state, &initial_task).await;
    let manifest_candidate_urls =
        normalize_download_manifest_candidate_urls(manifest_candidate_urls)
            .map_err(|error| error.message)?;
    let manifest_result =
        resolve_download_manifest_candidates(state, manifest_candidate_urls.clone())
            .await
            .map_err(|error| error.message)?;

    let Some(task_after_manifest) = read_download_runtime_task(state, task_id).await else {
        return Ok(());
    };
    if !is_download_runtime_task_running(&task_after_manifest) {
        return Ok(());
    }

    let Some(task_after_manifest) = update_download_runtime_task(state, task_id, |mut task| {
        task.entry_manifest_url = manifest_result.root_manifest_url.clone();
        task.manifest_candidate_urls = manifest_candidate_urls.clone();
        task.playback_manifest_url = Some(manifest_result.playback_manifest_url.clone());
        task.total_resources = manifest_result.resources.len() as u32;
        task.downloaded_resources = 0;
        task.progress = 0;
        task.size_bytes = 0;
        task.current_size_bytes = 0;
        task.estimated_total_size_bytes = 0;
        task.download_speed_bytes_per_second = 0;
        task.error_message = None;
        task.updated_at = crate::current_timestamp_ms();
        task
    })
    .await
    .map_err(|error| error.message)?
    else {
        return Ok(());
    };
    if !is_download_runtime_task_running(&task_after_manifest) {
        return Ok(());
    }

    let resource_index_record =
        build_download_runtime_resource_index_record(state, &task_after_manifest, &manifest_result);
    state
        .write_resource_index(&resource_index_record)
        .map_err(|error| error.to_string())?;

    let total_resources = manifest_result.resources.len() as u32;
    let mut downloaded_resources = 0_u32;
    let mut completed_size_bytes = 0_u64;

    for resource in &manifest_result.resources {
        let Some(current_task) = read_download_runtime_task(state, task_id).await else {
            cleanup_download_runtime_cache_index(state, &task_after_manifest.cache_index_id)?;
            return Ok(());
        };
        if !is_download_runtime_task_running(&current_task) {
            return Ok(());
        }

        let cache_entry = if let Some(cache_entry) = state
            .read_cached_download_entry(&resource.url)
            .map_err(|error| error.to_string())?
        {
            cache_entry
        } else {
            fetch_and_cache_download_runtime_resource(state, &resource.url).await?
        };

        completed_size_bytes = completed_size_bytes.saturating_add(cache_entry.size_bytes);
        downloaded_resources = downloaded_resources.saturating_add(1);

        if !should_flush_download_runtime_progress(downloaded_resources, total_resources) {
            continue;
        }

        let Some(current_task) = read_download_runtime_task(state, task_id).await else {
            cleanup_download_runtime_cache_index(state, &task_after_manifest.cache_index_id)?;
            return Ok(());
        };
        if !is_download_runtime_task_running(&current_task) {
            return Ok(());
        }

        let estimated_total_size_bytes = estimate_download_task_total_size_bytes(
            completed_size_bytes,
            downloaded_resources,
            total_resources,
        );
        let _ = update_download_runtime_task(state, task_id, |mut task| {
            task.playback_manifest_url = Some(manifest_result.playback_manifest_url.clone());
            task.total_resources = total_resources;
            task.downloaded_resources = downloaded_resources;
            task.size_bytes = completed_size_bytes;
            task.current_size_bytes = completed_size_bytes;
            task.estimated_total_size_bytes = estimated_total_size_bytes;
            task.download_speed_bytes_per_second = 0;
            task.progress = calculate_download_task_progress(downloaded_resources, total_resources);
            task.error_message = None;
            task.updated_at = crate::current_timestamp_ms();
            task
        })
        .await
        .map_err(|error| error.message)?;
    }

    let _ = update_download_runtime_task(state, task_id, |mut task| {
        task.status = DesktopDownloadTaskStatus::Done;
        task.playback_manifest_url = Some(manifest_result.playback_manifest_url.clone());
        task.total_resources = total_resources;
        task.downloaded_resources = total_resources;
        task.progress = 100;
        task.size_bytes = completed_size_bytes;
        task.current_size_bytes = completed_size_bytes;
        task.estimated_total_size_bytes = completed_size_bytes;
        task.download_speed_bytes_per_second = 0;
        task.error_message = None;
        task.updated_at = crate::current_timestamp_ms();
        task
    })
    .await
    .map_err(|error| error.message)?;

    Ok(())
}

async fn run_download_runtime_task_worker(state: AppState, task_id: String) {
    let execution_result = execute_download_runtime_task(&state, &task_id).await;
    if let Err(error_message) = execution_result {
        if let Err(error) = fail_download_runtime_task(&state, &task_id, &error_message).await {
            warn!(
                "desktop download runtime task {} failed to record error state: {}",
                task_id, error.message
            );
        }
    }

    state
        .download_runtime_active_tasks
        .lock()
        .await
        .remove(&task_id);
    schedule_download_runtime_processing(state);
}

pub(crate) async fn get_download_runtime_tasks(
    State(state): State<AppState>,
) -> AppResult<Response> {
    let snapshot = state.download_engine.read().await.snapshot();
    no_store_json_response(&snapshot)
}

pub(crate) async fn get_download_runtime_task(
    State(state): State<AppState>,
    AxumPath(task_id): AxumPath<String>,
) -> AppResult<Response> {
    let task = state
        .download_engine
        .read()
        .await
        .snapshot()
        .tasks
        .get(&task_id)
        .cloned()
        .ok_or_else(download_runtime_task_not_found)?;

    no_store_json_response(&task)
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
    let response = mutate_download_engine_snapshot(&state, move |engine| {
        let snapshot = engine
            .upsert_task(task)
            .map_err(download_runtime_task_invalid)?
            .clone();
        Ok(snapshot)
    })
    .await?;
    schedule_download_runtime_processing(state);
    Ok(response)
}

pub(crate) async fn put_download_runtime_task_settings(
    State(state): State<AppState>,
    Json(settings): Json<DesktopDownloadEngineSettingsUpdate>,
) -> AppResult<Response> {
    let response = mutate_download_engine_snapshot(&state, move |engine| {
        Ok(engine.update_settings(settings).clone())
    })
    .await?;
    schedule_download_runtime_processing(state);
    Ok(response)
}

fn apply_download_runtime_task_bulk_command(
    engine: &mut DesktopDownloadEngine,
    task_id: &str,
    command: DesktopDownloadTaskBulkCommand,
) {
    match command {
        DesktopDownloadTaskBulkCommand::Pause => {
            engine.pause_task(task_id);
        }
        DesktopDownloadTaskBulkCommand::Resume => {
            engine.resume_task(task_id);
        }
        DesktopDownloadTaskBulkCommand::Retry => {
            engine.retry_task(task_id);
        }
        DesktopDownloadTaskBulkCommand::Cancel => {
            engine.cancel_task(task_id);
        }
    }
}

pub(crate) async fn post_download_runtime_task_bulk_command(
    State(state): State<AppState>,
    Json(request): Json<DesktopDownloadTaskBulkCommandRequest>,
) -> AppResult<Response> {
    let (command, task_ids) = request.into_parts();
    let response = mutate_download_engine_snapshot(&state, move |engine| {
        for task_id in &task_ids {
            apply_download_runtime_task_bulk_command(engine, task_id, command);
        }
        Ok(engine.snapshot())
    })
    .await?;
    schedule_download_runtime_processing(state);
    Ok(response)
}

pub(crate) async fn pause_download_runtime_task(
    State(state): State<AppState>,
    AxumPath(task_id): AxumPath<String>,
) -> AppResult<Response> {
    let response = mutate_download_engine_snapshot(&state, move |engine| {
        let snapshot = engine
            .pause_task(&task_id)
            .ok_or_else(download_runtime_task_not_found)?
            .clone();
        Ok(snapshot)
    })
    .await?;
    schedule_download_runtime_processing(state);
    Ok(response)
}

pub(crate) async fn resume_download_runtime_task(
    State(state): State<AppState>,
    AxumPath(task_id): AxumPath<String>,
) -> AppResult<Response> {
    let response = mutate_download_engine_snapshot(&state, move |engine| {
        let snapshot = engine
            .resume_task(&task_id)
            .ok_or_else(download_runtime_task_not_found)?
            .clone();
        Ok(snapshot)
    })
    .await?;
    schedule_download_runtime_processing(state);
    Ok(response)
}

pub(crate) async fn retry_download_runtime_task(
    State(state): State<AppState>,
    AxumPath(task_id): AxumPath<String>,
) -> AppResult<Response> {
    let response = mutate_download_engine_snapshot(&state, move |engine| {
        let snapshot = engine
            .retry_task(&task_id)
            .ok_or_else(download_runtime_task_not_found)?
            .clone();
        Ok(snapshot)
    })
    .await?;
    schedule_download_runtime_processing(state);
    Ok(response)
}

pub(crate) async fn cancel_download_runtime_task(
    State(state): State<AppState>,
    AxumPath(task_id): AxumPath<String>,
) -> AppResult<Response> {
    let response = mutate_download_engine_snapshot(&state, move |engine| {
        engine
            .cancel_task(&task_id)
            .ok_or_else(download_runtime_task_not_found)?;
        Ok(engine.snapshot())
    })
    .await?;
    schedule_download_runtime_processing(state);
    Ok(response)
}

pub(crate) async fn delete_download_runtime_task(
    State(state): State<AppState>,
    AxumPath(task_id): AxumPath<String>,
) -> AppResult<Response> {
    let response = mutate_download_engine_snapshot(&state, move |engine| {
        engine
            .delete_task(&task_id)
            .ok_or_else(download_runtime_task_not_found)?;
        Ok(engine.snapshot())
    })
    .await?;
    schedule_download_runtime_processing(state);
    Ok(response)
}

fn require_download_runtime_url(value: Option<&str>) -> AppResult<String> {
    let url = normalize_optional_text(value)
        .ok_or_else(|| {
            download_runtime_validation_error(
                DOWNLOAD_RUNTIME_ERROR_MISSING_URL,
                "missing download runtime url",
            )
        })?;
    Url::parse(&url).map_err(|_| {
        download_runtime_validation_error(
            DOWNLOAD_RUNTIME_ERROR_INVALID_URL,
            "invalid download runtime url",
        )
    })?;
    Ok(url)
}

fn require_download_runtime_index_id(value: Option<&str>) -> AppResult<String> {
    normalize_optional_string(value.map(|item| item.to_string()))
        .ok_or_else(|| {
            download_runtime_validation_error(
                DOWNLOAD_RUNTIME_ERROR_MISSING_INDEX_ID,
                "missing download runtime index id",
            )
        })
}

fn parse_download_runtime_status(headers: &HeaderMap) -> AppResult<StatusCode> {
    let raw_status = headers
        .get(HeaderName::from_static("x-moontv-response-status"))
        .and_then(|value| value.to_str().ok())
        .unwrap_or("200")
        .trim();
    let numeric_status = raw_status
        .parse::<u16>()
        .map_err(|_| {
            download_runtime_validation_error(
                DOWNLOAD_RUNTIME_ERROR_INVALID_STATUS,
                "invalid download runtime status",
            )
        })?;
    StatusCode::from_u16(numeric_status)
        .map_err(|_| {
            download_runtime_validation_error(
                DOWNLOAD_RUNTIME_ERROR_INVALID_STATUS,
                "invalid download runtime status",
            )
        })
}

fn normalize_download_runtime_resource_index(
    record: DesktopDownloadResourceIndexRecord,
) -> AppResult<DesktopDownloadResourceIndexRecord> {
    let id = require_download_runtime_index_id(Some(&record.id))?;
    let owner_username = normalize_optional_string(Some(record.owner_username))
        .ok_or_else(|| {
            download_runtime_validation_error(
                DOWNLOAD_RUNTIME_ERROR_INVALID_RESOURCE_INDEX,
                "missing download runtime ownerUsername",
            )
        })?;
    let task_id = normalize_optional_string(Some(record.task_id))
        .ok_or_else(|| {
            download_runtime_validation_error(
                DOWNLOAD_RUNTIME_ERROR_INVALID_RESOURCE_INDEX,
                "missing download runtime taskId",
            )
        })?;
    let content_id = normalize_optional_string(Some(record.content_id))
        .ok_or_else(|| {
            download_runtime_validation_error(
                DOWNLOAD_RUNTIME_ERROR_INVALID_RESOURCE_INDEX,
                "missing download runtime contentId",
            )
        })?;
    let source = normalize_optional_string(Some(record.source))
        .ok_or_else(|| {
            download_runtime_validation_error(
                DOWNLOAD_RUNTIME_ERROR_INVALID_RESOURCE_INDEX,
                "missing download runtime source",
            )
        })?;
    let vod_id = normalize_optional_string(Some(record.vod_id))
        .ok_or_else(|| {
            download_runtime_validation_error(
                DOWNLOAD_RUNTIME_ERROR_INVALID_RESOURCE_INDEX,
                "missing download runtime vodId",
            )
        })?;
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
