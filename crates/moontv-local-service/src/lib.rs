mod config;
mod proxy;
mod storage;

pub use config::{
    ApiSiteConfig, CustomCategory, LiveSourceConfig, PublicConfigResponse, ServiceConfig,
};
pub use storage::{CacheMetaRecord, ResourceIndexRecord};

use axum::{
    Json, Router,
    body::{Body, Bytes},
    extract::{Query, State},
    http::{
        HeaderMap, Method, Response, StatusCode,
        header::{self, HeaderValue},
    },
    routing::{delete, get, put},
};
use proxy::{ProxyFetchError, ProxySupport, looks_like_manifest};
use serde::{Deserialize, Serialize};
use std::{
    error::Error,
    path::PathBuf,
    sync::Arc,
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use storage::Storage;
use tokio::{net::TcpListener, signal};
use tracing::{error, info};

type BoxError = Box<dyn Error + Send + Sync>;

#[derive(Clone, Debug)]
pub struct LocalServiceOptions {
    pub allow_private_hosts: bool,
    pub config_path: PathBuf,
    pub data_dir: PathBuf,
    pub host: String,
    pub port: u16,
    pub sqlite_path: PathBuf,
}

#[derive(Clone, Debug)]
pub struct ServiceInfo {
    pub base_url: String,
    pub config_path: PathBuf,
    pub data_dir: PathBuf,
    pub host: String,
    pub port: u16,
    pub sqlite_path: PathBuf,
}

#[derive(Clone)]
pub struct AppState {
    config: ServiceConfig,
    proxy: ProxySupport,
    service: ServiceInfo,
    storage: Storage,
}

#[derive(Debug, Deserialize)]
struct UrlQuery {
    url: Option<String>,
}

#[derive(Debug, Deserialize)]
struct ResourceIndexQuery {
    id: Option<String>,
}

#[derive(Debug, Deserialize)]
struct VodProxyQuery {
    source: Option<String>,
    url: Option<String>,
}

#[derive(Debug, Deserialize)]
struct LiveProxyQuery {
    #[serde(rename = "moontv-source")]
    moontv_source: Option<String>,
    url: Option<String>,
}

#[derive(Debug, Deserialize)]
struct LiveManifestQuery {
    #[serde(rename = "allowCORS")]
    allow_cors: Option<bool>,
    #[serde(rename = "moontv-source")]
    moontv_source: Option<String>,
    url: Option<String>,
}

#[derive(Debug, Serialize)]
struct DeleteResponse {
    deleted: bool,
    ok: bool,
}

#[derive(Debug, Serialize)]
struct HealthResponse {
    base_url: String,
    config_path: String,
    data_dir: String,
    port: u16,
    sqlite_path: String,
    status: &'static str,
}

#[derive(Debug, Serialize)]
struct CacheMetaResponse {
    exists: bool,
    #[serde(rename = "contentType")]
    content_type: Option<String>,
    #[serde(rename = "sizeBytes")]
    size_bytes: Option<u64>,
    status: Option<u16>,
    url: String,
}

#[derive(Debug, Serialize)]
struct OkResponse {
    ok: bool,
}

pub async fn create_app_state(options: LocalServiceOptions) -> Result<Arc<AppState>, BoxError> {
    let config = config::load_service_config(&options.config_path);
    let storage = Storage::new(&options.data_dir);
    storage.ensure_dirs().await?;

    let proxy = ProxySupport::new(options.allow_private_hosts)?;
    let service = ServiceInfo {
        base_url: build_base_url(&options.host, options.port),
        config_path: options.config_path,
        data_dir: options.data_dir,
        host: options.host,
        port: options.port,
        sqlite_path: options.sqlite_path,
    };

    Ok(Arc::new(AppState {
        config,
        proxy,
        service,
        storage,
    }))
}

pub fn build_router(state: Arc<AppState>) -> Router {
    Router::new()
        .route("/health", get(health).options(options_handler))
        .route(
            "/api/runtime/public-config",
            get(public_config).options(options_handler),
        )
        .route(
            "/api/download-runtime/cache",
            put(put_cached_download).options(options_handler),
        )
        .route(
            "/api/download-runtime/cache/meta",
            get(get_cached_download_meta).options(options_handler),
        )
        .route(
            "/api/download-runtime/cache/response",
            get(get_cached_download_response).options(options_handler),
        )
        .route(
            "/api/download-runtime/cache/delete",
            delete(delete_cached_download).options(options_handler),
        )
        .route(
            "/api/download-runtime/cache/all",
            delete(clear_cached_downloads).options(options_handler),
        )
        .route(
            "/api/download-runtime/resource-index",
            get(get_resource_index)
                .put(put_resource_index)
                .delete(delete_resource_index)
                .options(options_handler),
        )
        .route(
            "/api/download-runtime/resource-index/all",
            delete(clear_resource_indexes).options(options_handler),
        )
        .route(
            "/api/proxy/vod/m3u8",
            get(vod_manifest)
                .head(vod_manifest_head)
                .options(options_handler),
        )
        .route(
            "/api/proxy/vod/segment",
            get(vod_segment)
                .head(vod_segment_head)
                .options(options_handler),
        )
        .route(
            "/api/proxy/vod/key",
            get(vod_key).head(vod_key_head).options(options_handler),
        )
        .route(
            "/api/proxy/m3u8",
            get(live_manifest)
                .head(live_manifest_head)
                .options(options_handler),
        )
        .route(
            "/api/proxy/segment",
            get(live_segment)
                .head(live_segment_head)
                .options(options_handler),
        )
        .route(
            "/api/proxy/key",
            get(live_key).head(live_key_head).options(options_handler),
        )
        .route(
            "/api/proxy/logo",
            get(live_logo).head(live_logo_head).options(options_handler),
        )
        .fallback(fallback_handler)
        .with_state(state)
}

pub async fn run_local_service(options: LocalServiceOptions) -> Result<(), BoxError> {
    let state = create_app_state(options.clone()).await?;
    let bind_target = format!("{}:{}", options.host, options.port);
    let listener = TcpListener::bind(&bind_target).await?;
    let local_addr = listener.local_addr()?;

    info!("LunaTV local service listening on {}", local_addr);

    axum::serve(listener, build_router(state))
        .with_graceful_shutdown(shutdown_signal())
        .await?;

    info!("local service exited");
    Ok(())
}

fn build_base_url(host: &str, port: u16) -> String {
    if host.contains(':') && !host.starts_with('[') {
        format!("http://[{host}]:{port}")
    } else {
        format!("http://{host}:{port}")
    }
}

async fn shutdown_signal() {
    if signal::ctrl_c().await.is_ok() {
        info!("signal received, not accepting new connections");
    }
}

async fn health(State(state): State<Arc<AppState>>) -> Response<Body> {
    json_response(
        StatusCode::OK,
        &HealthResponse {
            base_url: state.service.base_url.clone(),
            config_path: state.service.config_path.display().to_string(),
            data_dir: state.service.data_dir.display().to_string(),
            port: state.service.port,
            sqlite_path: state.service.sqlite_path.display().to_string(),
            status: "ok",
        },
    )
}

async fn public_config(State(state): State<Arc<AppState>>) -> Response<Body> {
    json_response(StatusCode::OK, &state.config.to_public_config())
}

async fn put_cached_download(
    State(state): State<Arc<AppState>>,
    Query(query): Query<UrlQuery>,
    headers: HeaderMap,
    body: Bytes,
) -> Response<Body> {
    let Some(url) = normalize_query_value(query.url) else {
        return json_error(StatusCode::BAD_REQUEST, "missing url");
    };

    let status = headers
        .get("x-moontv-response-status")
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.parse::<u16>().ok())
        .filter(|value| (200..=599).contains(value))
        .unwrap_or(200);
    let content_type = headers
        .get(header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .filter(|value| !value.trim().is_empty())
        .unwrap_or("application/octet-stream");

    match state
        .storage
        .put_cached_download(&url, status, content_type, &body, now_ms())
        .await
    {
        Ok(record) => json_response(StatusCode::OK, &record),
        Err(error) => {
            error!("failed to store cached download: {}", error);
            json_error(
                StatusCode::INTERNAL_SERVER_ERROR,
                "failed to store cached download",
            )
        }
    }
}

async fn get_cached_download_meta(
    State(state): State<Arc<AppState>>,
    Query(query): Query<UrlQuery>,
) -> Response<Body> {
    let Some(url) = normalize_query_value(query.url) else {
        return json_error(StatusCode::BAD_REQUEST, "missing url");
    };

    match state.storage.get_cached_download_meta(&url).await {
        Ok(Some(record)) => json_response(
            StatusCode::OK,
            &CacheMetaResponse {
                exists: true,
                content_type: Some(record.content_type),
                size_bytes: Some(record.size_bytes),
                status: Some(record.status),
                url,
            },
        ),
        Ok(None) => json_response(
            StatusCode::OK,
            &CacheMetaResponse {
                exists: false,
                content_type: None,
                size_bytes: None,
                status: None,
                url,
            },
        ),
        Err(error) => {
            error!("failed to read cached download metadata: {}", error);
            json_error(
                StatusCode::INTERNAL_SERVER_ERROR,
                "failed to read cached download metadata",
            )
        }
    }
}

async fn get_cached_download_response(
    State(state): State<Arc<AppState>>,
    Query(query): Query<UrlQuery>,
) -> Response<Body> {
    let Some(url) = normalize_query_value(query.url) else {
        return json_error(StatusCode::BAD_REQUEST, "missing url");
    };

    match state.storage.get_cached_download(&url).await {
        Ok(Some((record, body))) => {
            let mut headers = default_cors_headers();
            headers.insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
            headers.insert(header::ACCEPT_RANGES, HeaderValue::from_static("bytes"));
            set_header_value(&mut headers, header::CONTENT_TYPE, &record.content_type);
            set_header_value(
                &mut headers,
                header::CONTENT_LENGTH,
                &body.len().to_string(),
            );
            build_response(
                status_code_from_u16(record.status),
                headers,
                Body::from(body),
            )
        }
        Ok(None) => json_error(StatusCode::NOT_FOUND, "cached download not found"),
        Err(error) => {
            error!("failed to read cached download body: {}", error);
            json_error(
                StatusCode::INTERNAL_SERVER_ERROR,
                "failed to read cached download body",
            )
        }
    }
}

async fn delete_cached_download(
    State(state): State<Arc<AppState>>,
    Query(query): Query<UrlQuery>,
) -> Response<Body> {
    let Some(url) = normalize_query_value(query.url) else {
        return json_error(StatusCode::BAD_REQUEST, "missing url");
    };

    match state.storage.delete_cached_download(&url).await {
        Ok(deleted) => json_response(StatusCode::OK, &DeleteResponse { deleted, ok: true }),
        Err(error) => {
            error!("failed to delete cached download: {}", error);
            json_error(
                StatusCode::INTERNAL_SERVER_ERROR,
                "failed to delete cached download",
            )
        }
    }
}

async fn clear_cached_downloads(State(state): State<Arc<AppState>>) -> Response<Body> {
    match state.storage.clear_cached_downloads().await {
        Ok(()) => json_response(StatusCode::OK, &OkResponse { ok: true }),
        Err(error) => {
            error!("failed to clear cached downloads: {}", error);
            json_error(
                StatusCode::INTERNAL_SERVER_ERROR,
                "failed to clear cached downloads",
            )
        }
    }
}

async fn put_resource_index(
    State(state): State<Arc<AppState>>,
    Json(record): Json<ResourceIndexRecord>,
) -> Response<Body> {
    match state.storage.put_resource_index(&record).await {
        Ok(saved) => json_response(StatusCode::OK, &saved),
        Err(error) => {
            error!("failed to store resource index: {}", error);
            json_error(
                StatusCode::INTERNAL_SERVER_ERROR,
                "failed to store resource index",
            )
        }
    }
}

async fn get_resource_index(
    State(state): State<Arc<AppState>>,
    Query(query): Query<ResourceIndexQuery>,
) -> Response<Body> {
    let Some(id) = normalize_query_value(query.id) else {
        return json_error(StatusCode::BAD_REQUEST, "missing id");
    };

    match state.storage.get_resource_index(&id).await {
        Ok(record) => json_response(StatusCode::OK, &record),
        Err(error) => {
            error!("failed to read resource index: {}", error);
            json_error(
                StatusCode::INTERNAL_SERVER_ERROR,
                "failed to read resource index",
            )
        }
    }
}

async fn delete_resource_index(
    State(state): State<Arc<AppState>>,
    Query(query): Query<ResourceIndexQuery>,
) -> Response<Body> {
    let Some(id) = normalize_query_value(query.id) else {
        return json_error(StatusCode::BAD_REQUEST, "missing id");
    };

    match state.storage.delete_resource_index(&id).await {
        Ok(deleted) => json_response(StatusCode::OK, &DeleteResponse { deleted, ok: true }),
        Err(error) => {
            error!("failed to delete resource index: {}", error);
            json_error(
                StatusCode::INTERNAL_SERVER_ERROR,
                "failed to delete resource index",
            )
        }
    }
}

async fn clear_resource_indexes(State(state): State<Arc<AppState>>) -> Response<Body> {
    match state.storage.clear_resource_indexes().await {
        Ok(()) => json_response(StatusCode::OK, &OkResponse { ok: true }),
        Err(error) => {
            error!("failed to clear resource indexes: {}", error);
            json_error(
                StatusCode::INTERNAL_SERVER_ERROR,
                "failed to clear resource indexes",
            )
        }
    }
}

async fn vod_manifest(
    State(state): State<Arc<AppState>>,
    Query(query): Query<VodProxyQuery>,
) -> Response<Body> {
    handle_vod_manifest(state, query, false).await
}

async fn vod_manifest_head(
    State(state): State<Arc<AppState>>,
    Query(query): Query<VodProxyQuery>,
) -> Response<Body> {
    handle_vod_manifest(state, query, true).await
}

async fn handle_vod_manifest(
    state: Arc<AppState>,
    query: VodProxyQuery,
    head_only: bool,
) -> Response<Body> {
    let Some(source) = normalize_query_value(query.source) else {
        return json_error(StatusCode::BAD_REQUEST, "missing source or url");
    };
    let Some(url) = normalize_query_value(query.url) else {
        return json_error(StatusCode::BAD_REQUEST, "missing source or url");
    };

    let Some(api_site) = state.config.api_site(&source) else {
        return json_error(StatusCode::BAD_REQUEST, "invalid source");
    };

    let upstream = match state
        .proxy
        .fetch(
            &url,
            reqwest::Method::GET,
            proxy::build_vod_headers(api_site, None),
        )
        .await
    {
        Ok(response) => response,
        Err(error) => return proxy_fetch_error_response(error),
    };

    if !upstream.status().is_success() {
        return json_error(
            StatusCode::BAD_GATEWAY,
            &format!("failed to fetch manifest: {}", upstream.status()),
        );
    }

    let final_url = upstream.url().to_string();
    let status = upstream.status();
    let content_type = upstream
        .headers()
        .get(header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .unwrap_or("application/vnd.apple.mpegurl")
        .to_string();
    let manifest = match upstream.text().await {
        Ok(body) => body,
        Err(error) => {
            error!("failed to read manifest body: {}", error);
            return json_error(StatusCode::BAD_GATEWAY, "failed to read manifest body");
        }
    };
    let rewritten = proxy::rewrite_vod_manifest_content(&manifest, &final_url, &source);
    let mut headers = default_cors_headers();
    headers.insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
    set_header_value(&mut headers, header::CONTENT_TYPE, &content_type);
    set_header_value(
        &mut headers,
        header::CONTENT_LENGTH,
        &rewritten.as_bytes().len().to_string(),
    );

    if head_only {
        return build_response(status, headers, Body::empty());
    }

    build_response(status, headers, Body::from(rewritten))
}

async fn vod_segment(
    State(state): State<Arc<AppState>>,
    Query(query): Query<VodProxyQuery>,
    headers: HeaderMap,
) -> Response<Body> {
    handle_vod_asset(state, query, headers, false, false).await
}

async fn vod_segment_head(
    State(state): State<Arc<AppState>>,
    Query(query): Query<VodProxyQuery>,
    headers: HeaderMap,
) -> Response<Body> {
    handle_vod_asset(state, query, headers, false, true).await
}

async fn vod_key(
    State(state): State<Arc<AppState>>,
    Query(query): Query<VodProxyQuery>,
    headers: HeaderMap,
) -> Response<Body> {
    handle_vod_asset(state, query, headers, true, false).await
}

async fn vod_key_head(
    State(state): State<Arc<AppState>>,
    Query(query): Query<VodProxyQuery>,
    headers: HeaderMap,
) -> Response<Body> {
    handle_vod_asset(state, query, headers, true, true).await
}

async fn handle_vod_asset(
    state: Arc<AppState>,
    query: VodProxyQuery,
    headers: HeaderMap,
    is_key: bool,
    head_only: bool,
) -> Response<Body> {
    let Some(source) = normalize_query_value(query.source) else {
        return json_error(StatusCode::BAD_REQUEST, "missing source or url");
    };
    let Some(url) = normalize_query_value(query.url) else {
        return json_error(StatusCode::BAD_REQUEST, "missing source or url");
    };

    let Some(api_site) = state.config.api_site(&source) else {
        return json_error(StatusCode::BAD_REQUEST, "invalid source");
    };

    let upstream = match state
        .proxy
        .fetch(
            &url,
            reqwest::Method::GET,
            proxy::build_vod_headers(api_site, headers.get(header::RANGE)),
        )
        .await
    {
        Ok(response) => response,
        Err(error) => return proxy_fetch_error_response(error),
    };

    if !upstream.status().is_success() && upstream.status() != StatusCode::PARTIAL_CONTENT {
        let message = if is_key {
            format!("failed to fetch key: {}", upstream.status())
        } else {
            format!("failed to fetch segment: {}", upstream.status())
        };
        return json_error(StatusCode::BAD_GATEWAY, &message);
    }

    stream_upstream_response(
        upstream,
        &proxy::infer_vod_asset_content_type(&url, is_key),
        "no-store",
        head_only,
    )
}

async fn live_manifest(
    State(state): State<Arc<AppState>>,
    Query(query): Query<LiveManifestQuery>,
) -> Response<Body> {
    handle_live_manifest(state, query, false).await
}

async fn live_manifest_head(
    State(state): State<Arc<AppState>>,
    Query(query): Query<LiveManifestQuery>,
) -> Response<Body> {
    handle_live_manifest(state, query, true).await
}

async fn handle_live_manifest(
    state: Arc<AppState>,
    query: LiveManifestQuery,
    head_only: bool,
) -> Response<Body> {
    let Some(source) = normalize_query_value(query.moontv_source) else {
        return json_error(StatusCode::BAD_REQUEST, "missing url");
    };
    let Some(url) = normalize_query_value(query.url) else {
        return json_error(StatusCode::BAD_REQUEST, "missing url");
    };

    let Some(live_source) = state.config.live_source(&source) else {
        return json_error(StatusCode::NOT_FOUND, "source not found");
    };

    let upstream = match state
        .proxy
        .fetch(
            &url,
            reqwest::Method::GET,
            proxy::build_live_headers(live_source, None),
        )
        .await
    {
        Ok(response) => response,
        Err(error) => return proxy_fetch_error_response(error),
    };

    if !upstream.status().is_success() {
        return json_error(StatusCode::BAD_GATEWAY, "failed to fetch m3u8");
    }

    let final_url = upstream.url().to_string();
    let status = upstream.status();
    let content_type = upstream
        .headers()
        .get(header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .unwrap_or("application/vnd.apple.mpegurl")
        .to_string();

    if looks_like_manifest(&final_url, Some(&content_type)) {
        let manifest = match upstream.text().await {
            Ok(body) => body,
            Err(error) => {
                error!("failed to read live manifest body: {}", error);
                return json_error(StatusCode::BAD_GATEWAY, "failed to read live manifest body");
            }
        };
        let rewritten = proxy::rewrite_live_m3u8_content(
            &manifest,
            &final_url,
            &source,
            query.allow_cors.unwrap_or(false),
        );
        let mut headers = default_cors_headers();
        headers.insert(header::CACHE_CONTROL, HeaderValue::from_static("no-cache"));
        set_header_value(&mut headers, header::CONTENT_TYPE, &content_type);
        set_header_value(
            &mut headers,
            header::CONTENT_LENGTH,
            &rewritten.as_bytes().len().to_string(),
        );

        if head_only {
            return build_response(status, headers, Body::empty());
        }

        return build_response(status, headers, Body::from(rewritten));
    }

    stream_upstream_response(upstream, &content_type, "no-cache", head_only)
}

async fn live_segment(
    State(state): State<Arc<AppState>>,
    Query(query): Query<LiveProxyQuery>,
    headers: HeaderMap,
) -> Response<Body> {
    handle_live_asset(
        state,
        query,
        headers,
        "video/mp2t",
        "failed to fetch segment",
        false,
    )
    .await
}

async fn live_segment_head(
    State(state): State<Arc<AppState>>,
    Query(query): Query<LiveProxyQuery>,
    headers: HeaderMap,
) -> Response<Body> {
    handle_live_asset(
        state,
        query,
        headers,
        "video/mp2t",
        "failed to fetch segment",
        true,
    )
    .await
}

async fn live_key(
    State(state): State<Arc<AppState>>,
    Query(query): Query<LiveProxyQuery>,
    headers: HeaderMap,
) -> Response<Body> {
    handle_live_asset(
        state,
        query,
        headers,
        "application/octet-stream",
        "failed to fetch key",
        false,
    )
    .await
}

async fn live_key_head(
    State(state): State<Arc<AppState>>,
    Query(query): Query<LiveProxyQuery>,
    headers: HeaderMap,
) -> Response<Body> {
    handle_live_asset(
        state,
        query,
        headers,
        "application/octet-stream",
        "failed to fetch key",
        true,
    )
    .await
}

async fn handle_live_asset(
    state: Arc<AppState>,
    query: LiveProxyQuery,
    headers: HeaderMap,
    fallback_content_type: &str,
    failure_message: &str,
    head_only: bool,
) -> Response<Body> {
    let Some(source) = normalize_query_value(query.moontv_source) else {
        return json_error(StatusCode::BAD_REQUEST, "missing url");
    };
    let Some(url) = normalize_query_value(query.url) else {
        return json_error(StatusCode::BAD_REQUEST, "missing url");
    };

    let Some(live_source) = state.config.live_source(&source) else {
        return json_error(StatusCode::NOT_FOUND, "source not found");
    };

    let upstream = match state
        .proxy
        .fetch(
            &url,
            reqwest::Method::GET,
            proxy::build_live_headers(live_source, headers.get(header::RANGE)),
        )
        .await
    {
        Ok(response) => response,
        Err(error) => return proxy_fetch_error_response(error),
    };

    if !upstream.status().is_success() && upstream.status() != StatusCode::PARTIAL_CONTENT {
        return json_error(StatusCode::BAD_GATEWAY, failure_message);
    }

    stream_upstream_response(upstream, fallback_content_type, "no-cache", head_only)
}

async fn live_logo(
    State(state): State<Arc<AppState>>,
    Query(query): Query<LiveProxyQuery>,
    headers: HeaderMap,
) -> Response<Body> {
    handle_logo(state, query, headers, false).await
}

async fn live_logo_head(
    State(state): State<Arc<AppState>>,
    Query(query): Query<LiveProxyQuery>,
    headers: HeaderMap,
) -> Response<Body> {
    handle_logo(state, query, headers, true).await
}

async fn handle_logo(
    state: Arc<AppState>,
    query: LiveProxyQuery,
    headers: HeaderMap,
    head_only: bool,
) -> Response<Body> {
    let Some(url) = normalize_query_value(query.url) else {
        return json_error(StatusCode::BAD_REQUEST, "missing image url");
    };

    let source = query
        .moontv_source
        .as_deref()
        .and_then(|value| state.config.live_source(value.trim()));

    let upstream = match state
        .proxy
        .fetch(
            &url,
            reqwest::Method::GET,
            proxy::build_logo_headers(source, headers.get(header::RANGE)),
        )
        .await
    {
        Ok(response) => response,
        Err(error) => return proxy_fetch_error_response(error),
    };

    if !upstream.status().is_success() && upstream.status() != StatusCode::PARTIAL_CONTENT {
        return json_error(StatusCode::BAD_GATEWAY, "error fetching image");
    }

    stream_upstream_response(
        upstream,
        "application/octet-stream",
        "public, max-age=86400, s-maxage=86400",
        head_only,
    )
}

async fn options_handler() -> Response<Body> {
    build_response(
        StatusCode::NO_CONTENT,
        default_cors_headers(),
        Body::empty(),
    )
}

async fn fallback_handler(method: Method) -> Response<Body> {
    if method == Method::OPTIONS {
        return options_handler().await;
    }

    json_error(StatusCode::NOT_FOUND, "not found")
}

fn proxy_fetch_error_response(error: ProxyFetchError) -> Response<Body> {
    match error {
        ProxyFetchError::InvalidTarget(message) => json_error(StatusCode::BAD_REQUEST, &message),
        ProxyFetchError::Upstream(message) => json_error(StatusCode::BAD_GATEWAY, &message),
    }
}

fn stream_upstream_response(
    upstream: reqwest::Response,
    fallback_content_type: &str,
    cache_control: &str,
    head_only: bool,
) -> Response<Body> {
    let status = upstream.status();
    let mut headers = default_cors_headers();
    set_header_value(
        &mut headers,
        header::CONTENT_TYPE,
        upstream
            .headers()
            .get(header::CONTENT_TYPE)
            .and_then(|value| value.to_str().ok())
            .unwrap_or(fallback_content_type),
    );
    set_header_value(&mut headers, header::CACHE_CONTROL, cache_control);

    if !upstream.headers().contains_key(header::CONTENT_ENCODING) {
        if let Some(content_length) = upstream.headers().get(header::CONTENT_LENGTH) {
            headers.insert(header::CONTENT_LENGTH, content_length.clone());
        }
    }
    if let Some(accept_ranges) = upstream.headers().get(header::ACCEPT_RANGES) {
        headers.insert(header::ACCEPT_RANGES, accept_ranges.clone());
    } else {
        headers.insert(header::ACCEPT_RANGES, HeaderValue::from_static("bytes"));
    }
    if let Some(content_range) = upstream.headers().get(header::CONTENT_RANGE) {
        headers.insert(header::CONTENT_RANGE, content_range.clone());
    }

    if head_only {
        return build_response(status, headers, Body::empty());
    }

    build_response(status, headers, Body::from_stream(upstream.bytes_stream()))
}

fn json_response<T>(status: StatusCode, value: &T) -> Response<Body>
where
    T: Serialize,
{
    let body = match serde_json::to_vec(value) {
        Ok(value) => value,
        Err(error) => {
            error!("failed to serialize response body: {}", error);
            return json_error(
                StatusCode::INTERNAL_SERVER_ERROR,
                "internal serialization error",
            );
        }
    };

    let mut headers = default_cors_headers();
    headers.insert(
        header::CONTENT_TYPE,
        HeaderValue::from_static("application/json"),
    );
    headers.insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
    build_response(status, headers, Body::from(body))
}

fn json_error(status: StatusCode, message: &str) -> Response<Body> {
    #[derive(Serialize)]
    struct ErrorResponse<'a> {
        error: &'a str,
    }

    json_response(status, &ErrorResponse { error: message })
}

fn default_cors_headers() -> HeaderMap {
    let mut headers = HeaderMap::new();
    headers.insert("access-control-allow-origin", HeaderValue::from_static("*"));
    headers.insert(
        "access-control-allow-methods",
        HeaderValue::from_static("GET, POST, PUT, PATCH, DELETE, HEAD, OPTIONS"),
    );
    headers.insert(
    "access-control-allow-headers",
    HeaderValue::from_static(
      "Content-Type, Range, Origin, Accept, Authorization, X-MoonTV-Response-Status, X-MoonTV-Download-Intent",
    ),
  );
    headers.insert(
        "access-control-expose-headers",
        HeaderValue::from_static("Content-Length, Content-Range"),
    );
    headers
}

fn build_response(status: StatusCode, headers: HeaderMap, body: Body) -> Response<Body> {
    let mut response = Response::new(body);
    *response.status_mut() = status;
    *response.headers_mut() = headers;
    response
}

fn set_header_value(headers: &mut HeaderMap, name: header::HeaderName, value: &str) {
    if let Ok(parsed) = HeaderValue::from_str(value) {
        headers.insert(name, parsed);
    }
}

fn normalize_query_value(value: Option<String>) -> Option<String> {
    value.and_then(|candidate| {
        let trimmed = candidate.trim();
        if trimmed.is_empty() {
            None
        } else {
            Some(trimmed.to_string())
        }
    })
}

fn status_code_from_u16(value: u16) -> StatusCode {
    StatusCode::from_u16(value).unwrap_or(StatusCode::OK)
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or(Duration::from_secs(0))
        .as_millis() as u64
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::http::Request;
    use axum::{Router, routing::get};
    use http_body_util::BodyExt;
    use std::{fs, net::SocketAddr};
    use tempfile::tempdir;
    use tower::ServiceExt;

    async fn test_app() -> (Router, tempfile::TempDir) {
        let temp_dir = tempdir().unwrap();
        let config_path = temp_dir.path().join("config.json");
        fs::write(
            &config_path,
            serde_json::json!({
              "site_name": "LunaTV",
              "api_site": {
                "demo": {
                  "ua": "DemoVod/1.0",
                  "referer": "https://vod.example.com/"
                }
              },
              "lives": {
                "live": {
                  "name": "Demo Live",
                  "url": "https://live.example.com/playlist.m3u8",
                  "ua": "DemoLive/1.0"
                }
              },
              "custom_category": [
                {
                  "name": "热门",
                  "type": "movie",
                  "query": "热门"
                }
              ]
            })
            .to_string(),
        )
        .unwrap();

        let options = LocalServiceOptions {
            allow_private_hosts: true,
            config_path,
            data_dir: temp_dir.path().join("data"),
            host: "127.0.0.1".to_string(),
            port: 8787,
            sqlite_path: temp_dir.path().join("data").join("moontv.sqlite3"),
        };

        let state = create_app_state(options).await.unwrap();
        (build_router(state), temp_dir)
    }

    async fn spawn_upstream() -> SocketAddr {
        let upstream = Router::new()
            .route(
                "/playlist.m3u8",
                get(|| async {
                    (
                        [(header::CONTENT_TYPE, "application/vnd.apple.mpegurl")],
                        [
                            "#EXTM3U",
                            "#EXT-X-KEY:METHOD=AES-128,URI=\"key.bin\"",
                            "#EXT-X-MAP:URI=\"init.mp4\"",
                            "#EXTINF:6.0,",
                            "segment-001.ts",
                            "#EXTINF:6.0,",
                            "/video/adjump/ad.ts",
                            "#EXT-X-ENDLIST",
                        ]
                        .join("\n"),
                    )
                }),
            )
            .route("/key.bin", get(|| async { "demo-key" }))
            .route("/init.mp4", get(|| async { "init" }))
            .route("/segment-001.ts", get(|| async { "segment" }))
            .route(
                "/live.m3u8",
                get(|| async {
                    (
                        [(header::CONTENT_TYPE, "application/vnd.apple.mpegurl")],
                        [
                            "#EXTM3U",
                            "#EXT-X-KEY:METHOD=AES-128,URI=\"key.bin\"",
                            "#EXTINF:6.0,",
                            "segment.ts",
                            "#EXT-X-ENDLIST",
                        ]
                        .join("\n"),
                    )
                }),
            )
            .route("/segment.ts", get(|| async { "live-segment" }));

        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        tokio::spawn(async move {
            axum::serve(listener, upstream).await.unwrap();
        });
        addr
    }

    async fn response_text(response: Response<Body>) -> String {
        let bytes = response.into_body().collect().await.unwrap().to_bytes();
        String::from_utf8(bytes.to_vec()).unwrap()
    }

    #[tokio::test]
    async fn stores_and_reads_download_runtime_cache_entries() {
        let (app, _temp_dir) = test_app().await;

        let put_response = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("PUT")
                    .uri("/api/download-runtime/cache?url=https%3A%2F%2Fexample.com%2Fdemo.bin")
                    .header("content-type", "application/octet-stream")
                    .header("x-moontv-response-status", "206")
                    .body(Body::from("cache-body"))
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(put_response.status(), StatusCode::OK);

        let meta_response = app
            .clone()
            .oneshot(
                Request::builder()
                    .uri(
                        "/api/download-runtime/cache/meta?url=https%3A%2F%2Fexample.com%2Fdemo.bin",
                    )
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        let meta_json: serde_json::Value =
            serde_json::from_str(&response_text(meta_response).await).unwrap();
        assert_eq!(meta_json["exists"], true);
        assert_eq!(meta_json["status"], 206);

        let body_response = app
            .clone()
            .oneshot(
                Request::builder()
                    .uri(
                        "/api/download-runtime/cache/response?url=https%3A%2F%2Fexample.com%2Fdemo.bin",
                    )
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(body_response.status(), StatusCode::PARTIAL_CONTENT);
        assert_eq!(response_text(body_response).await, "cache-body");

        let delete_response = app
            .oneshot(
                Request::builder()
                    .method("DELETE")
                    .uri(
                        "/api/download-runtime/cache/delete?url=https%3A%2F%2Fexample.com%2Fdemo.bin",
                    )
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        let delete_json: serde_json::Value =
            serde_json::from_str(&response_text(delete_response).await).unwrap();
        assert_eq!(delete_json["deleted"], true);
        assert_eq!(delete_json["ok"], true);
    }

    #[tokio::test]
    async fn stores_and_reads_resource_indexes() {
        let (app, _temp_dir) = test_app().await;

        let payload = serde_json::json!({
          "id": "demo",
          "ownerUsername": "u",
          "taskId": "t",
          "contentId": "c",
          "source": "s",
          "vodId": "v",
          "episodeIndex": 1,
          "urls": ["https://example.com/a"],
          "createdAt": 1,
          "updatedAt": 2
        });

        let put_response = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("PUT")
                    .uri("/api/download-runtime/resource-index")
                    .header("content-type", "application/json")
                    .body(Body::from(payload.to_string()))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(put_response.status(), StatusCode::OK);

        let get_response = app
            .clone()
            .oneshot(
                Request::builder()
                    .uri("/api/download-runtime/resource-index?id=demo")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        let get_json: serde_json::Value =
            serde_json::from_str(&response_text(get_response).await).unwrap();
        assert_eq!(get_json["id"], "demo");

        let clear_response = app
            .oneshot(
                Request::builder()
                    .method("DELETE")
                    .uri("/api/download-runtime/resource-index/all")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        let clear_json: serde_json::Value =
            serde_json::from_str(&response_text(clear_response).await).unwrap();
        assert_eq!(clear_json["ok"], true);
    }

    #[tokio::test]
    async fn rewrites_vod_manifest_to_local_proxy_urls() {
        let (app, _temp_dir) = test_app().await;
        let upstream_addr = spawn_upstream().await;
        let encoded = url::form_urlencoded::Serializer::new(String::new())
            .append_pair("url", &format!("http://{}/playlist.m3u8", upstream_addr))
            .append_pair("source", "demo")
            .finish();

        let response = app
            .oneshot(
                Request::builder()
                    .uri(format!("/api/proxy/vod/m3u8?{encoded}"))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::OK);
        let body = response_text(response).await;
        assert!(body.contains("/api/proxy/vod/key?source=demo&url=http%3A%2F%2F127.0.0.1"));
        assert!(body.contains("/api/proxy/vod/segment?source=demo&url=http%3A%2F%2F127.0.0.1"));
        assert!(!body.contains("adjump"));
    }

    #[tokio::test]
    async fn returns_public_config_payload() {
        let (app, _temp_dir) = test_app().await;

        let response = app
            .oneshot(
                Request::builder()
                    .uri("/api/runtime/public-config")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::OK);
        let payload: serde_json::Value =
            serde_json::from_str(&response_text(response).await).unwrap();
        assert_eq!(payload["siteName"], "LunaTV");
        assert_eq!(payload["customCategories"][0]["query"], "热门");
    }
}
