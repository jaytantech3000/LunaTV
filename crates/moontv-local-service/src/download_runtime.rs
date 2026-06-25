use std::convert::Infallible;

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
