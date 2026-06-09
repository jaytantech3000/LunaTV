use std::{
    collections::BTreeMap,
    env, fs,
    path::{Path, PathBuf},
    sync::{Arc, OnceLock},
    time::Duration,
};

use anyhow::{Context, Result};
use axum::{
    Json, Router,
    body::Body,
    extract::{Query, Request, State},
    http::{
        HeaderMap, HeaderValue, Method, StatusCode,
        header::{
            ACCEPT_RANGES, ACCESS_CONTROL_ALLOW_HEADERS, ACCESS_CONTROL_ALLOW_METHODS,
            ACCESS_CONTROL_ALLOW_ORIGIN, ACCESS_CONTROL_EXPOSE_HEADERS, CACHE_CONTROL,
            CONTENT_LENGTH, CONTENT_RANGE, CONTENT_TYPE, ORIGIN, RANGE, REFERER, USER_AGENT,
        },
    },
    middleware::{self, Next},
    response::{IntoResponse, Response},
    routing::get,
};
use clap::Parser;
use futures::future::join_all;
use regex::Regex;
use reqwest::header::HeaderMap as ReqwestHeaderMap;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use tokio::net::TcpListener;
use tokio::sync::RwLock;
use tracing::{info, warn};
use url::{Url, form_urlencoded};

const DEFAULT_HOST: &str = "127.0.0.1";
const DEFAULT_PORT: u16 = 8787;
const DEFAULT_CONFIG_FILE_NAME: &str = "config.example.json";
const DEFAULT_DATA_DIR_NAME: &str = ".lunatv-desktop";
const DEFAULT_SQLITE_FILE_NAME: &str = "moontv-desktop.sqlite3";
const DEFAULT_CACHE_TIME: u64 = 7200;
const DEFAULT_SEARCH_MAX_PAGES: usize = 5;
const DEFAULT_SEARCH_TIMEOUT_MS: u64 = 8_000;
const DEFAULT_DETAIL_TIMEOUT_MS: u64 = 10_000;
const DEFAULT_PROXY_TIMEOUT_MS: u64 = 15_000;
const DEFAULT_WEB_UA: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";
const DEFAULT_LIVE_PROXY_USER_AGENT: &str = "AptvPlayer/1.4.10";
const DEFAULT_BANGUMI_API_BASE_URL: &str = "https://api.bgm.tv";
const DEFAULT_DOUBAN_API_BASE_URL: &str = "https://m.douban.com";
const MAX_DOUBAN_RATING_IDS_PER_REQUEST: usize = 20;

const ADULT_SOURCE_MARKERS: &[&str] = &["🔞", "成人", "情色", "三级片", "三級", "porn", "av"];

const YELLOW_WORDS: &[&str] = &[
    "伦理片",
    "福利",
    "里番动漫",
    "门事件",
    "萝莉少女",
    "制服诱惑",
    "国产传媒",
    "cosplay",
    "黑丝诱惑",
    "无码",
    "日本无码",
    "有码",
    "日本有码",
    "SWAG",
    "网红主播",
    "色情片",
    "同性片",
    "福利视频",
    "福利片",
    "写真热舞",
    "倫理片",
    "理论片",
    "韩国伦理",
    "港台三级",
    "电影解说",
    "伦理",
    "日本伦理",
];

#[derive(Debug, Clone, Parser)]
pub struct Cli {
    #[arg(long, default_value = DEFAULT_HOST)]
    pub host: String,
    #[arg(long, default_value_t = DEFAULT_PORT)]
    pub port: u16,
    #[arg(long)]
    pub config_path: Option<PathBuf>,
    #[arg(long)]
    pub data_dir: Option<PathBuf>,
    #[arg(long)]
    pub sqlite_path: Option<PathBuf>,
}

#[derive(Clone, Debug)]
pub struct AppState {
    host: String,
    port: u16,
    public_base_url: String,
    config_path: PathBuf,
    data_dir: PathBuf,
    sqlite_path: PathBuf,
    client: reqwest::Client,
    bangumi_api_base_url: String,
    live_channels_cache: Arc<RwLock<BTreeMap<String, LiveChannelsCache>>>,
}

impl AppState {
    pub fn from_cli(cli: &Cli) -> Result<Self> {
        let current_dir = env::current_dir().context("failed to resolve current directory")?;
        let config_path = cli
            .config_path
            .clone()
            .unwrap_or_else(|| current_dir.join(DEFAULT_CONFIG_FILE_NAME));
        let data_dir = cli
            .data_dir
            .clone()
            .unwrap_or_else(|| current_dir.join(DEFAULT_DATA_DIR_NAME));
        let sqlite_path = cli
            .sqlite_path
            .clone()
            .unwrap_or_else(|| data_dir.join(DEFAULT_SQLITE_FILE_NAME));

        fs::create_dir_all(&data_dir)
            .with_context(|| format!("failed to create {}", data_dir.display()))?;

        Ok(Self::new(
            cli.host.clone(),
            cli.port,
            config_path,
            data_dir,
            sqlite_path,
        ))
    }

    pub fn new(
        host: String,
        port: u16,
        config_path: PathBuf,
        data_dir: PathBuf,
        sqlite_path: PathBuf,
    ) -> Self {
        let public_base_url = format!("http://{host}:{port}");

        Self {
            host,
            port,
            public_base_url,
            config_path,
            data_dir,
            sqlite_path,
            client: reqwest::Client::new(),
            bangumi_api_base_url: DEFAULT_BANGUMI_API_BASE_URL.to_string(),
            live_channels_cache: Arc::new(RwLock::new(BTreeMap::new())),
        }
    }

    fn bind_addr(&self) -> String {
        format!("{}:{}", self.host, self.port)
    }

    fn load_config(&self) -> Result<ServiceConfig> {
        load_service_config(&self.config_path)
    }
}

#[derive(Debug, Deserialize, Default)]
struct RawServiceConfig {
    cache_time: Option<u64>,
    search_downstream_max_page: Option<usize>,
    disable_yellow_filter: Option<bool>,
    site_name: Option<String>,
    announcement: Option<String>,
    douban_proxy_type: Option<String>,
    douban_proxy: Option<String>,
    douban_image_proxy_type: Option<String>,
    douban_image_proxy: Option<String>,
    enable_web_live: Option<bool>,
    #[serde(default)]
    api_site: BTreeMap<String, RawApiSite>,
    #[serde(default)]
    custom_category: Vec<RawCustomCategory>,
    #[serde(default)]
    lives: BTreeMap<String, RawLiveSource>,
}

#[derive(Debug, Deserialize, Clone)]
struct RawApiSite {
    api: String,
    name: String,
    detail: Option<String>,
    ua: Option<String>,
    referer: Option<String>,
}

#[derive(Debug, Deserialize, Clone)]
struct RawCustomCategory {
    name: Option<String>,
    #[serde(rename = "type")]
    category_type: String,
    query: String,
    disabled: Option<bool>,
}

#[derive(Debug, Deserialize, Clone)]
struct RawLiveSource {
    name: String,
    url: String,
    ua: Option<String>,
    epg: Option<String>,
    disabled: Option<bool>,
}

#[derive(Debug, Clone)]
struct ServiceConfig {
    cache_time: u64,
    max_search_pages: usize,
    adult_content_filter_enabled: bool,
    site_name: Option<String>,
    announcement: Option<String>,
    douban_proxy_type: Option<String>,
    douban_proxy: Option<String>,
    douban_image_proxy_type: Option<String>,
    douban_image_proxy: Option<String>,
    enable_web_live_override: Option<bool>,
    api_sites: Vec<ApiSite>,
    custom_categories: Vec<RuntimeCustomCategory>,
    live_sources: Vec<LiveSourceConfig>,
}

#[derive(Debug, Clone)]
struct ApiSite {
    key: String,
    api: String,
    name: String,
    detail: Option<String>,
    ua: Option<String>,
    referer: Option<String>,
}

#[derive(Debug, Clone)]
struct LiveSourceConfig {
    key: String,
    name: String,
    url: String,
    ua: Option<String>,
    epg: Option<String>,
    disabled: bool,
}

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq, Eq)]
pub struct SearchResult {
    pub id: String,
    pub title: String,
    pub poster: String,
    pub episodes: Vec<String>,
    pub episodes_titles: Vec<String>,
    pub source: String,
    pub source_name: String,
    pub class: Option<String>,
    pub year: String,
    pub desc: Option<String>,
    pub type_name: Option<String>,
    pub douban_id: Option<i64>,
}

#[derive(Debug, Serialize)]
struct SearchResponse {
    results: Vec<SearchResult>,
}

#[derive(Debug, Serialize, Clone, PartialEq)]
struct ContentSuggestion {
    text: String,
    r#type: &'static str,
    score: f64,
}

#[derive(Debug, Serialize)]
struct SuggestionsResponse {
    suggestions: Vec<ContentSuggestion>,
}

#[derive(Debug, Serialize)]
struct DoubanRatingsResponse {
    ratings: BTreeMap<String, String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct RuntimePublicConfigResponse {
    site_name: Option<String>,
    announcement: Option<String>,
    douban_proxy_type: Option<String>,
    douban_proxy: Option<String>,
    douban_image_proxy_type: Option<String>,
    douban_image_proxy: Option<String>,
    enable_web_live: bool,
    custom_categories: Vec<RuntimeCustomCategory>,
}

#[derive(Debug, Serialize, Clone)]
struct RuntimeCustomCategory {
    name: String,
    #[serde(rename = "type")]
    category_type: String,
    query: String,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct LiveSourceResponse {
    key: String,
    name: String,
    url: String,
    ua: Option<String>,
    epg: Option<String>,
    from: &'static str,
    channel_number: usize,
    disabled: bool,
}

#[derive(Debug, Serialize, Clone, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct LiveChannel {
    id: String,
    #[serde(rename = "tvgId")]
    tvg_id: String,
    name: String,
    logo: String,
    group: String,
    url: String,
}

#[derive(Debug, Serialize, Clone, PartialEq, Eq)]
struct LiveProgram {
    start: String,
    end: String,
    title: String,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct LiveEpgData {
    #[serde(rename = "tvgId")]
    tvg_id: String,
    source: String,
    epg_url: String,
    programs: Vec<LiveProgram>,
}

#[derive(Debug, Clone)]
struct LiveChannelsCache {
    channel_number: usize,
    channels: Vec<LiveChannel>,
    epg_url: String,
    epgs: BTreeMap<String, Vec<LiveProgram>>,
}

#[derive(Debug, Serialize)]
struct HealthResponse {
    status: &'static str,
    port: u16,
    base_url: String,
    config_path: String,
    data_dir: String,
    sqlite_path: String,
}

#[derive(Debug, Deserialize)]
struct SearchQueryParams {
    q: Option<String>,
}

#[derive(Debug, Deserialize)]
struct LiveChannelsQueryParams {
    source: Option<String>,
}

#[derive(Debug, Deserialize)]
struct LiveEpgQueryParams {
    source: Option<String>,
    #[serde(rename = "tvgId")]
    tvg_id: Option<String>,
}

#[derive(Debug, Deserialize)]
struct LivePrecheckQueryParams {
    url: Option<String>,
    #[serde(rename = "moontv-source")]
    source_key: Option<String>,
}

#[derive(Debug, Deserialize)]
struct LiveProxyQueryParams {
    url: Option<String>,
    #[serde(rename = "moontv-source")]
    source_key: Option<String>,
    #[serde(rename = "allowCORS")]
    allow_cors: Option<bool>,
}

#[derive(Debug, Deserialize)]
struct DoubanRatingsQueryParams {
    ids: Option<String>,
}

#[derive(Debug, Deserialize)]
struct DetailQueryParams {
    id: Option<String>,
    source: Option<String>,
}

#[derive(Debug, Deserialize)]
struct VodProxyQueryParams {
    source: Option<String>,
    url: Option<String>,
}

#[derive(Debug)]
struct ResolvedVodProxyRequest {
    source: String,
    upstream_url: String,
    api_site: ApiSite,
}

#[derive(Debug, Clone)]
struct UpstreamResponseMeta {
    status: StatusCode,
    final_url: String,
    content_type: Option<String>,
    content_length: Option<String>,
    accept_ranges: Option<String>,
    content_range: Option<String>,
}

#[derive(Debug)]
struct AppError {
    status: StatusCode,
    message: String,
}

impl AppError {
    fn new(status: StatusCode, message: impl Into<String>) -> Self {
        Self {
            status,
            message: message.into(),
        }
    }

    fn bad_request(message: impl Into<String>) -> Self {
        Self::new(StatusCode::BAD_REQUEST, message)
    }

    fn internal(message: impl Into<String>) -> Self {
        Self::new(StatusCode::INTERNAL_SERVER_ERROR, message)
    }
}

impl IntoResponse for AppError {
    fn into_response(self) -> Response {
        (self.status, Json(json!({ "error": self.message }))).into_response()
    }
}

type AppResult<T> = std::result::Result<T, AppError>;

pub async fn run(cli: Cli) -> Result<()> {
    let state = AppState::from_cli(&cli)?;
    let app = build_router(state.clone());
    let listener = TcpListener::bind(state.bind_addr())
        .await
        .context("failed to bind local service listener")?;

    info!(
        "LunaTV local service listening on {} with config {}",
        listener.local_addr()?.to_string(),
        state.config_path.display()
    );

    axum::serve(listener, app)
        .with_graceful_shutdown(shutdown_signal())
        .await
        .context("local service exited unexpectedly")
}

pub fn build_router(state: AppState) -> Router {
    Router::new()
        .route("/health", get(get_health))
        .route("/runtime/public-config", get(get_runtime_public_config))
        .route("/content/search", get(get_content_search))
        .route("/content/suggestions", get(get_content_suggestions))
        .route("/content/detail", get(get_content_detail))
        .route("/live/sources", get(get_live_sources))
        .route("/live/channels", get(get_live_channels))
        .route("/live/epg", get(get_live_epg))
        .route("/live/precheck", get(get_live_precheck))
        .route("/metadata/bangumi/calendar", get(get_bangumi_calendar))
        .route("/metadata/douban/ratings", get(get_douban_ratings))
        .route("/media/live/m3u8", get(get_live_m3u8))
        .route("/media/live/segment", get(get_live_segment))
        .route("/media/live/key", get(get_live_key))
        .route("/media/live/logo", get(get_live_logo))
        .route("/media/vod/m3u8", get(get_vod_m3u8))
        .route("/media/vod/segment", get(get_vod_segment))
        .route("/media/vod/key", get(get_vod_key))
        .route("/api/runtime/public-config", get(get_runtime_public_config))
        .route("/api/search", get(get_content_search))
        .route("/api/search/suggestions", get(get_content_suggestions))
        .route("/api/detail", get(get_content_detail))
        .route("/api/live/sources", get(get_live_sources))
        .route("/api/live/channels", get(get_live_channels))
        .route("/api/live/epg", get(get_live_epg))
        .route("/api/live/precheck", get(get_live_precheck))
        .route("/api/bangumi/calendar", get(get_bangumi_calendar))
        .route("/api/douban/ratings", get(get_douban_ratings))
        .route("/api/proxy/m3u8", get(get_live_m3u8))
        .route("/api/proxy/segment", get(get_live_segment))
        .route("/api/proxy/key", get(get_live_key))
        .route("/api/proxy/logo", get(get_live_logo))
        .route("/api/proxy/vod/m3u8", get(get_vod_m3u8))
        .route("/api/proxy/vod/segment", get(get_vod_segment))
        .route("/api/proxy/vod/key", get(get_vod_key))
        .with_state(state)
        .layer(middleware::from_fn(cors_middleware))
}

async fn shutdown_signal() {
    let _ = tokio::signal::ctrl_c().await;
}

async fn cors_middleware(request: Request, next: Next) -> Response {
    if request.method() == Method::OPTIONS {
        let mut response = StatusCode::NO_CONTENT.into_response();
        apply_cors_headers(response.headers_mut());
        return response;
    }

    let mut response = next.run(request).await;
    apply_cors_headers(response.headers_mut());
    response
}

fn apply_cors_headers(headers: &mut HeaderMap) {
    headers.insert(ACCESS_CONTROL_ALLOW_ORIGIN, HeaderValue::from_static("*"));
    headers.insert(
        ACCESS_CONTROL_ALLOW_METHODS,
        HeaderValue::from_static("GET, HEAD, OPTIONS"),
    );
    headers.insert(
        ACCESS_CONTROL_ALLOW_HEADERS,
        HeaderValue::from_static("Content-Type, Range, Origin, Accept"),
    );
    headers.insert(
        ACCESS_CONTROL_EXPOSE_HEADERS,
        HeaderValue::from_static("Content-Length, Content-Range"),
    );
}

async fn get_health(State(state): State<AppState>) -> Json<HealthResponse> {
    Json(HealthResponse {
        status: "ok",
        port: state.port,
        base_url: state.public_base_url.clone(),
        config_path: state.config_path.display().to_string(),
        data_dir: state.data_dir.display().to_string(),
        sqlite_path: state.sqlite_path.display().to_string(),
    })
}

async fn get_runtime_public_config(State(state): State<AppState>) -> AppResult<Response> {
    let config = state
        .load_config()
        .map_err(|error| AppError::internal(error.to_string()))?;
    let payload = build_runtime_public_config_response(&config);
    let mut response = Json(payload).into_response();
    response
        .headers_mut()
        .insert(CACHE_CONTROL, HeaderValue::from_static("no-store"));
    Ok(response)
}

async fn get_content_search(
    State(state): State<AppState>,
    Query(params): Query<SearchQueryParams>,
) -> AppResult<Response> {
    let query = params.q.unwrap_or_default().trim().to_string();
    let config = state
        .load_config()
        .map_err(|error| AppError::internal(error.to_string()))?;

    let mut results = if query.is_empty() {
        Vec::new()
    } else {
        search_all_sites(&state.client, &config, &query).await
    };

    if config.adult_content_filter_enabled {
        results = filter_adult_content_results(results);
    }

    let mut response = Json(SearchResponse { results }).into_response();
    apply_query_cache_headers(response.headers_mut(), config.cache_time);
    Ok(response)
}

async fn get_content_suggestions(
    State(state): State<AppState>,
    Query(params): Query<SearchQueryParams>,
) -> AppResult<Response> {
    let query = params.q.unwrap_or_default().trim().to_string();
    let config = state
        .load_config()
        .map_err(|error| AppError::internal(error.to_string()))?;

    if query.is_empty() {
        return Ok(Json(SuggestionsResponse {
            suggestions: Vec::new(),
        })
        .into_response());
    }

    let Some(first_site) = config.api_sites.first() else {
        let mut response = Json(SuggestionsResponse {
            suggestions: Vec::new(),
        })
        .into_response();
        apply_query_cache_headers(response.headers_mut(), config.cache_time);
        return Ok(response);
    };

    let mut results = search_site(&state.client, first_site, &query, config.max_search_pages)
        .await
        .map_err(|error| AppError::internal(error.to_string()))?;

    if config.adult_content_filter_enabled {
        results = filter_adult_content_results(results);
    }

    let suggestions = build_content_suggestions(&query, &results);
    let mut response = Json(SuggestionsResponse { suggestions }).into_response();
    apply_query_cache_headers(response.headers_mut(), config.cache_time);
    Ok(response)
}

async fn get_content_detail(
    State(state): State<AppState>,
    Query(params): Query<DetailQueryParams>,
) -> AppResult<Response> {
    let id = params.id.unwrap_or_default().trim().to_string();
    let source = params.source.unwrap_or_default().trim().to_string();

    if id.is_empty() || source.is_empty() {
        return Err(AppError::bad_request("缺少必要参数"));
    }

    if !is_valid_content_id(&id) {
        return Err(AppError::bad_request("无效的视频ID格式"));
    }

    let config = state
        .load_config()
        .map_err(|error| AppError::internal(error.to_string()))?;
    let api_site = config
        .api_sites
        .iter()
        .find(|item| item.key == source)
        .cloned()
        .ok_or_else(|| AppError::bad_request("无效的API来源"))?;

    let result = fetch_content_detail(&state.client, &api_site, &id).await?;
    let mut response = Json(result).into_response();
    apply_query_cache_headers(response.headers_mut(), config.cache_time);
    Ok(response)
}

async fn get_douban_ratings(
    State(state): State<AppState>,
    Query(params): Query<DoubanRatingsQueryParams>,
) -> AppResult<Response> {
    let ids = parse_douban_ids(params.ids.as_deref());
    if ids.is_empty() {
        let mut response = Json(DoubanRatingsResponse {
            ratings: BTreeMap::new(),
        })
        .into_response();
        response.headers_mut().insert(
            CACHE_CONTROL,
            HeaderValue::from_static("private, max-age=300"),
        );
        return Ok(response);
    }

    let ratings = fetch_douban_ratings_by_ids(&state.client, &ids)
        .await
        .map_err(|error| AppError::internal(error.to_string()))?;
    let mut response = Json(DoubanRatingsResponse { ratings }).into_response();
    response.headers_mut().insert(
        CACHE_CONTROL,
        HeaderValue::from_static("private, max-age=300"),
    );
    Ok(response)
}

async fn get_bangumi_calendar(State(state): State<AppState>) -> AppResult<Response> {
    let config = state
        .load_config()
        .map_err(|error| AppError::internal(error.to_string()))?;
    let payload = fetch_bangumi_calendar(&state.client, &state.bangumi_api_base_url)
        .await
        .map_err(|error| AppError::internal(error.to_string()))?;
    let mut response = Json(payload).into_response();
    apply_query_cache_headers(response.headers_mut(), config.cache_time);
    Ok(response)
}

async fn get_live_sources(State(state): State<AppState>) -> AppResult<Response> {
    let config = state
        .load_config()
        .map_err(|error| AppError::internal(error.to_string()))?;
    let cached_channels = state.live_channels_cache.read().await;
    let data = config
        .live_sources
        .iter()
        .filter(|source| !source.disabled)
        .map(|source| LiveSourceResponse {
            key: source.key.clone(),
            name: source.name.clone(),
            url: source.url.clone(),
            ua: source.ua.clone(),
            epg: source.epg.clone(),
            from: "config",
            channel_number: cached_channels
                .get(&source.key)
                .map(|item| item.channel_number)
                .unwrap_or(0),
            disabled: false,
        })
        .collect::<Vec<_>>();

    let mut response = Json(json!({
      "success": true,
      "data": data
    }))
    .into_response();
    apply_query_cache_headers(response.headers_mut(), config.cache_time);
    Ok(response)
}

async fn get_live_channels(
    State(state): State<AppState>,
    Query(params): Query<LiveChannelsQueryParams>,
) -> AppResult<Response> {
    let config = state
        .load_config()
        .map_err(|error| AppError::internal(error.to_string()))?;
    let source_key = params.source.unwrap_or_default().trim().to_string();

    if source_key.is_empty() {
        return Err(AppError::bad_request("缺少直播源参数"));
    }

    let live_source = resolve_live_source(&config, &source_key)?;
    let cache = get_or_refresh_live_channels_cache(&state, &live_source).await?;
    let mut response = Json(json!({
      "success": true,
      "data": cache.channels
    }))
    .into_response();
    apply_query_cache_headers(response.headers_mut(), config.cache_time);
    Ok(response)
}

async fn get_live_epg(
    State(state): State<AppState>,
    Query(params): Query<LiveEpgQueryParams>,
) -> AppResult<Response> {
    let config = state
        .load_config()
        .map_err(|error| AppError::internal(error.to_string()))?;
    let source_key = params.source.unwrap_or_default().trim().to_string();
    let tvg_id = params.tvg_id.unwrap_or_default().trim().to_string();

    if source_key.is_empty() {
        return Err(AppError::bad_request("缺少直播源参数"));
    }

    if tvg_id.is_empty() {
        return Err(AppError::bad_request("缺少频道tvg-id参数"));
    }

    let live_source = resolve_live_source(&config, &source_key)?;
    let cache = get_or_refresh_live_channels_cache(&state, &live_source).await?;
    let programs = cache.epgs.get(&tvg_id).cloned().unwrap_or_default();
    let payload = LiveEpgData {
        tvg_id,
        source: source_key,
        epg_url: cache.epg_url,
        programs,
    };

    let mut response = Json(json!({
      "success": true,
      "data": payload
    }))
    .into_response();
    apply_query_cache_headers(response.headers_mut(), config.cache_time);
    Ok(response)
}

async fn get_live_precheck(
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

    let live_source = resolve_live_source(&config, &source_key)?;
    let upstream_response = fetch_live_proxy_upstream(
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
      "type": detect_live_stream_type(
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

async fn get_live_m3u8(
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
    let live_source = resolve_live_source(&config, &source_key)?;
    let upstream_response = fetch_live_proxy_upstream(
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

    let meta = upstream_response_meta(&upstream_response);

    if should_rewrite_live_manifest(meta.content_type.as_deref(), &meta.final_url, &upstream_url) {
        let manifest_content = upstream_response
            .text()
            .await
            .map_err(|error| AppError::internal(error.to_string()))?;
        let rewritten_content = rewrite_live_manifest_content(
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
        *response.headers_mut() = create_live_proxy_headers(
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
    *response.headers_mut() = create_live_proxy_headers(
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

async fn get_live_segment(
    State(state): State<AppState>,
    Query(params): Query<LiveProxyQueryParams>,
    request_headers: HeaderMap,
) -> AppResult<Response> {
    let config = state
        .load_config()
        .map_err(|error| AppError::internal(error.to_string()))?;
    let upstream_url = params.url.unwrap_or_default().trim().to_string();
    let source_key = params.source_key.unwrap_or_default().trim().to_string();
    let live_source = resolve_live_source(&config, &source_key)?;
    let upstream_response = fetch_live_proxy_upstream(
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

    let meta = upstream_response_meta(&upstream_response);
    let stream = upstream_response.bytes_stream();
    let mut response = Response::new(Body::from_stream(stream));
    *response.status_mut() = meta.status;
    *response.headers_mut() = create_live_proxy_headers(
        &meta,
        meta.content_type.as_deref().unwrap_or("video/mp2t"),
        meta.content_length.clone(),
        true,
        Some("no-cache"),
    );
    Ok(response)
}

async fn get_live_key(
    State(state): State<AppState>,
    Query(params): Query<LiveProxyQueryParams>,
) -> AppResult<Response> {
    let config = state
        .load_config()
        .map_err(|error| AppError::internal(error.to_string()))?;
    let upstream_url = params.url.unwrap_or_default().trim().to_string();
    let source_key = params.source_key.unwrap_or_default().trim().to_string();
    let live_source = resolve_live_source(&config, &source_key)?;
    let upstream_response = fetch_live_proxy_upstream(
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

    let meta = upstream_response_meta(&upstream_response);
    let key_bytes = upstream_response
        .bytes()
        .await
        .map_err(|error| AppError::internal(error.to_string()))?;
    let mut response = Response::new(Body::from(key_bytes));
    *response.status_mut() = meta.status;
    *response.headers_mut() = create_live_proxy_headers(
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

async fn get_live_logo(
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
        Some(resolve_live_source(&config, &source_key)?)
    };
    let upstream_response = fetch_live_proxy_upstream(
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

    let meta = upstream_response_meta(&upstream_response);
    let stream = upstream_response.bytes_stream();
    let mut response = Response::new(Body::from_stream(stream));
    *response.status_mut() = meta.status;
    *response.headers_mut() = create_live_proxy_headers(
        &meta,
        meta.content_type.as_deref().unwrap_or("image/png"),
        meta.content_length.clone(),
        true,
        Some("public, max-age=86400, s-maxage=86400"),
    );
    Ok(response)
}

async fn get_vod_m3u8(
    method: Method,
    State(state): State<AppState>,
    Query(params): Query<VodProxyQueryParams>,
    request_headers: HeaderMap,
) -> AppResult<Response> {
    let config = state
        .load_config()
        .map_err(|error| AppError::internal(error.to_string()))?;
    let resolved = resolve_vod_proxy_request(&config, params)?;
    let upstream_response = fetch_vod_proxy_upstream(
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

    let meta = upstream_response_meta(&upstream_response);
    let manifest_content = upstream_response
        .text()
        .await
        .map_err(|error| AppError::internal(error.to_string()))?;
    let rewritten_content = rewrite_vod_manifest_content(
        &manifest_content,
        &meta.final_url,
        &resolved.source,
        &state.public_base_url,
    );
    let mut response = if method == Method::HEAD {
        Response::new(Body::empty())
    } else {
        Response::new(Body::from(rewritten_content.clone()))
    };
    *response.status_mut() = meta.status;
    *response.headers_mut() = create_vod_proxy_headers(
        &meta,
        meta.content_type
            .as_deref()
            .unwrap_or("application/vnd.apple.mpegurl"),
        Some(rewritten_content.len().to_string()),
        true,
    );

    Ok(response)
}

async fn get_vod_segment(
    State(state): State<AppState>,
    Query(params): Query<VodProxyQueryParams>,
    request_headers: HeaderMap,
) -> AppResult<Response> {
    let config = state
        .load_config()
        .map_err(|error| AppError::internal(error.to_string()))?;
    let resolved = resolve_vod_proxy_request(&config, params)?;
    let upstream_response = fetch_vod_proxy_upstream(
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

    let meta = upstream_response_meta(&upstream_response);
    let stream = upstream_response.bytes_stream();
    let mut response = Response::new(Body::from_stream(stream));
    *response.status_mut() = meta.status;
    *response.headers_mut() = create_vod_proxy_headers(
        &meta,
        meta.content_type
            .as_deref()
            .unwrap_or("application/octet-stream"),
        meta.content_length.clone(),
        true,
    );

    Ok(response)
}

async fn get_vod_key(
    State(state): State<AppState>,
    Query(params): Query<VodProxyQueryParams>,
    request_headers: HeaderMap,
) -> AppResult<Response> {
    let config = state
        .load_config()
        .map_err(|error| AppError::internal(error.to_string()))?;
    let resolved = resolve_vod_proxy_request(&config, params)?;
    let upstream_response = fetch_vod_proxy_upstream(
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

    let meta = upstream_response_meta(&upstream_response);
    let key_bytes = upstream_response
        .bytes()
        .await
        .map_err(|error| AppError::internal(error.to_string()))?;
    let mut response = Response::new(Body::from(key_bytes));
    *response.status_mut() = meta.status;
    *response.headers_mut() = create_vod_proxy_headers(
        &meta,
        meta.content_type
            .as_deref()
            .unwrap_or("application/octet-stream"),
        meta.content_length.clone(),
        true,
    );

    Ok(response)
}

fn load_service_config(path: &Path) -> Result<ServiceConfig> {
    let contents =
        fs::read_to_string(path).with_context(|| format!("failed to read {}", path.display()))?;
    let raw_config = serde_json::from_str::<RawServiceConfig>(&contents)
        .with_context(|| format!("failed to parse {}", path.display()))?;

    let api_sites = raw_config
        .api_site
        .into_iter()
        .map(|(key, site)| ApiSite {
            key,
            api: site.api,
            name: site.name,
            detail: normalize_optional_string(site.detail),
            ua: normalize_optional_string(site.ua),
            referer: normalize_optional_string(site.referer),
        })
        .collect();

    let custom_categories = raw_config
        .custom_category
        .into_iter()
        .filter(|category| !category.disabled.unwrap_or(false))
        .map(|category| RuntimeCustomCategory {
            name: category.name.unwrap_or_default(),
            category_type: category.category_type,
            query: category.query,
        })
        .collect::<Vec<_>>();

    let live_sources = raw_config
        .lives
        .into_iter()
        .map(|(key, live)| LiveSourceConfig {
            key,
            name: live.name,
            url: live.url,
            ua: normalize_optional_string(live.ua),
            epg: normalize_optional_string(live.epg),
            disabled: live.disabled.unwrap_or(false),
        })
        .collect::<Vec<_>>();

    Ok(ServiceConfig {
        cache_time: raw_config.cache_time.unwrap_or(DEFAULT_CACHE_TIME),
        max_search_pages: raw_config
            .search_downstream_max_page
            .unwrap_or(DEFAULT_SEARCH_MAX_PAGES)
            .max(1),
        adult_content_filter_enabled: !raw_config.disable_yellow_filter.unwrap_or(false),
        site_name: normalize_optional_string(raw_config.site_name),
        announcement: normalize_optional_string(raw_config.announcement),
        douban_proxy_type: normalize_optional_string(raw_config.douban_proxy_type),
        douban_proxy: normalize_optional_string(raw_config.douban_proxy),
        douban_image_proxy_type: normalize_optional_string(raw_config.douban_image_proxy_type),
        douban_image_proxy: normalize_optional_string(raw_config.douban_image_proxy),
        enable_web_live_override: raw_config.enable_web_live,
        api_sites,
        custom_categories,
        live_sources,
    })
}

fn normalize_optional_string(value: Option<String>) -> Option<String> {
    value.and_then(|item| {
        let trimmed = item.trim().to_string();
        if trimmed.is_empty() {
            None
        } else {
            Some(trimmed)
        }
    })
}

fn apply_query_cache_headers(headers: &mut HeaderMap, cache_time: u64) {
    if let Ok(value) = HeaderValue::from_str(&format!("public, max-age={cache_time}")) {
        headers.insert(CACHE_CONTROL, value);
    }
}

fn is_valid_content_id(id: &str) -> bool {
    id.chars()
        .all(|character| character.is_ascii_alphanumeric() || character == '_' || character == '-')
}

async fn search_all_sites(
    client: &reqwest::Client,
    config: &ServiceConfig,
    query: &str,
) -> Vec<SearchResult> {
    let tasks = config.api_sites.iter().cloned().map(|api_site| {
        let client = client.clone();
        let query = query.to_string();
        let max_search_pages = config.max_search_pages;

        async move {
            match search_site(&client, &api_site, &query, max_search_pages).await {
                Ok(results) => results,
                Err(error) => {
                    warn!("search failed for {}: {}", api_site.name, error);
                    Vec::new()
                }
            }
        }
    });

    join_all(tasks)
        .await
        .into_iter()
        .flatten()
        .collect::<Vec<_>>()
}

async fn search_site(
    client: &reqwest::Client,
    api_site: &ApiSite,
    query: &str,
    max_search_pages: usize,
) -> Result<Vec<SearchResult>> {
    let first_page_url =
        build_collection_api_url(&api_site.api, &[("ac", "videolist"), ("wd", query)])?;
    let first_response = client
        .get(&first_page_url)
        .headers(build_downstream_headers(api_site, DEFAULT_WEB_UA, None))
        .timeout(Duration::from_millis(DEFAULT_SEARCH_TIMEOUT_MS))
        .send()
        .await?;

    if !first_response.status().is_success() {
        return Ok(Vec::new());
    }

    let first_payload = first_response.json::<Value>().await?;
    let mut results = parse_search_payload(&first_payload, api_site);
    let total_pages = parse_usize(first_payload.get("pagecount")).unwrap_or(1);
    let pages_to_fetch = total_pages
        .saturating_sub(1)
        .min(max_search_pages.saturating_sub(1));

    if pages_to_fetch == 0 {
        return Ok(results);
    }

    let page_tasks = (2..=(pages_to_fetch + 1)).map(|page_number| {
        let client = client.clone();
        let api_site = api_site.clone();
        let query = query.to_string();

        async move {
            let page_url = build_collection_api_url(
                &api_site.api,
                &[
                    ("ac", "videolist"),
                    ("wd", query.as_str()),
                    ("pg", page_number.to_string().as_str()),
                ],
            )?;
            let response = client
                .get(page_url)
                .headers(build_downstream_headers(&api_site, DEFAULT_WEB_UA, None))
                .timeout(Duration::from_millis(DEFAULT_SEARCH_TIMEOUT_MS))
                .send()
                .await?;

            if !response.status().is_success() {
                return Ok::<Vec<SearchResult>, anyhow::Error>(Vec::new());
            }

            let payload = response.json::<Value>().await?;
            Ok(parse_search_payload(&payload, &api_site))
        }
    });

    for page_result in join_all(page_tasks).await {
        match page_result {
            Ok(items) => results.extend(items),
            Err(error) => warn!("search page fetch failed for {}: {}", api_site.name, error),
        }
    }

    Ok(results)
}

async fn fetch_content_detail(
    client: &reqwest::Client,
    api_site: &ApiSite,
    id: &str,
) -> AppResult<SearchResult> {
    if has_custom_detail_url(api_site) {
        fetch_custom_detail(client, api_site, id).await
    } else {
        fetch_json_detail(client, api_site, id).await
    }
}

async fn fetch_json_detail(
    client: &reqwest::Client,
    api_site: &ApiSite,
    id: &str,
) -> AppResult<SearchResult> {
    let detail_url = build_collection_api_url(&api_site.api, &[("ac", "videolist"), ("ids", id)])
        .map_err(|error| AppError::internal(error.to_string()))?;
    let response = client
        .get(detail_url)
        .headers(build_downstream_headers(api_site, DEFAULT_WEB_UA, None))
        .timeout(Duration::from_millis(DEFAULT_DETAIL_TIMEOUT_MS))
        .send()
        .await
        .map_err(|error| AppError::internal(error.to_string()))?;

    if !response.status().is_success() {
        return Err(AppError::internal(format!(
            "详情请求失败: {}",
            response.status()
        )));
    }

    let payload = response
        .json::<Value>()
        .await
        .map_err(|error| AppError::internal(error.to_string()))?;
    parse_detail_payload(&payload, api_site, id)
        .ok_or_else(|| AppError::internal("获取到的详情内容无效"))
}

async fn fetch_custom_detail(
    client: &reqwest::Client,
    api_site: &ApiSite,
    id: &str,
) -> AppResult<SearchResult> {
    let detail_base = api_site
        .detail
        .as_deref()
        .ok_or_else(|| AppError::internal("detail 配置缺失"))?;
    let detail_url = format!(
        "{}/index.php/vod/detail/id/{}.html",
        detail_base.trim_end_matches('/'),
        id
    );
    let response = client
        .get(detail_url)
        .headers(build_downstream_headers(api_site, DEFAULT_WEB_UA, None))
        .timeout(Duration::from_millis(DEFAULT_DETAIL_TIMEOUT_MS))
        .send()
        .await
        .map_err(|error| AppError::internal(error.to_string()))?;

    if !response.status().is_success() {
        return Err(AppError::internal(format!(
            "详情页请求失败: {}",
            response.status()
        )));
    }

    let html = response
        .text()
        .await
        .map_err(|error| AppError::internal(error.to_string()))?;
    Ok(parse_custom_detail_html(&html, api_site, id))
}

fn parse_search_payload(payload: &Value, api_site: &ApiSite) -> Vec<SearchResult> {
    let Some(list) = payload.get("list").and_then(Value::as_array) else {
        return Vec::new();
    };

    list.iter()
        .filter_map(|item| parse_search_item(item, api_site))
        .filter(|result| !result.episodes.is_empty())
        .collect()
}

fn parse_search_item(item: &Value, api_site: &ApiSite) -> Option<SearchResult> {
    let id = value_to_string(item.get("vod_id"))?;
    let title = collapse_whitespace(&value_to_string(item.get("vod_name"))?);
    let poster = value_to_string(item.get("vod_pic")).unwrap_or_default();
    let (episodes, episode_titles) =
        extract_episodes_from_play_url(value_to_string(item.get("vod_play_url")).as_deref());

    Some(SearchResult {
        id,
        title,
        poster,
        episodes,
        episodes_titles: episode_titles,
        source: api_site.key.clone(),
        source_name: api_site.name.clone(),
        class: value_to_string(item.get("vod_class")),
        year: normalize_year(value_to_string(item.get("vod_year")).as_deref()),
        desc: value_to_string(item.get("vod_content")).map(|value| clean_html_tags(&value)),
        type_name: value_to_string(item.get("type_name")),
        douban_id: value_to_i64(item.get("vod_douban_id")),
    })
}

fn parse_detail_payload(payload: &Value, api_site: &ApiSite, id: &str) -> Option<SearchResult> {
    let list = payload.get("list")?.as_array()?;
    let video_detail = list.first()?;
    let (mut episodes, mut episode_titles) = extract_episodes_from_play_url(
        value_to_string(video_detail.get("vod_play_url")).as_deref(),
    );

    if episodes.is_empty() {
        if let Some(content) = value_to_string(video_detail.get("vod_content")) {
            episodes = extract_m3u8_matches(&content);
            episode_titles = (1..=episodes.len())
                .map(|index| index.to_string())
                .collect::<Vec<_>>();
        }
    }

    Some(SearchResult {
        id: id.to_string(),
        title: value_to_string(video_detail.get("vod_name")).unwrap_or_default(),
        poster: value_to_string(video_detail.get("vod_pic")).unwrap_or_default(),
        episodes,
        episodes_titles: episode_titles,
        source: api_site.key.clone(),
        source_name: api_site.name.clone(),
        class: value_to_string(video_detail.get("vod_class")),
        year: normalize_year(value_to_string(video_detail.get("vod_year")).as_deref()),
        desc: value_to_string(video_detail.get("vod_content")).map(|value| clean_html_tags(&value)),
        type_name: value_to_string(video_detail.get("type_name")),
        douban_id: value_to_i64(video_detail.get("vod_douban_id")),
    })
}

fn parse_custom_detail_html(html: &str, api_site: &ApiSite, id: &str) -> SearchResult {
    let mut matches = if matches!(api_site.key.as_str(), "ffzy" | "feifan") {
        html.special_ffzy_m3u8_regex()
            .captures_iter(html)
            .filter_map(|capture| capture.get(1).map(|item| item.as_str().to_string()))
            .collect::<Vec<_>>()
    } else {
        Vec::new()
    };

    if matches.is_empty() {
        matches = html
            .m3u8_regex()
            .captures_iter(html)
            .filter_map(|capture| capture.get(1).map(|item| item.as_str().to_string()))
            .collect::<Vec<_>>();
    }

    let mut deduped_matches = Vec::new();
    for raw_match in matches {
        let cleaned_match = raw_match
            .trim()
            .trim_start_matches('$')
            .split('(')
            .next()
            .unwrap_or_default()
            .trim()
            .to_string();

        if !cleaned_match.is_empty() && !deduped_matches.contains(&cleaned_match) {
            deduped_matches.push(cleaned_match);
        }
    }

    let title = html
        .title_regex()
        .captures(html)
        .and_then(|capture| capture.get(1))
        .map(|item| item.as_str().trim().to_string())
        .unwrap_or_default();
    let desc = html
        .detail_desc_regex()
        .captures(html)
        .and_then(|capture| capture.get(1))
        .map(|item| clean_html_tags(item.as_str()));
    let poster = html
        .cover_regex()
        .captures(html)
        .and_then(|capture| capture.get(1))
        .map(|item| item.as_str().trim().to_string())
        .unwrap_or_default();
    let year = html
        .year_regex()
        .captures(html)
        .and_then(|capture| capture.get(1))
        .map(|item| item.as_str().to_string())
        .unwrap_or_else(|| "unknown".to_string());

    SearchResult {
        id: id.to_string(),
        title,
        poster,
        episodes_titles: (1..=deduped_matches.len())
            .map(|index| index.to_string())
            .collect::<Vec<_>>(),
        episodes: deduped_matches,
        source: api_site.key.clone(),
        source_name: api_site.name.clone(),
        class: Some(String::new()),
        year,
        desc,
        type_name: Some(String::new()),
        douban_id: Some(0),
    }
}

trait RegexExt {
    fn m3u8_regex(&self) -> &Regex;
    fn special_ffzy_m3u8_regex(&self) -> &Regex;
    fn title_regex(&self) -> &Regex;
    fn detail_desc_regex(&self) -> &Regex;
    fn cover_regex(&self) -> &Regex;
    fn year_regex(&self) -> &Regex;
}

impl RegexExt for str {
    fn m3u8_regex(&self) -> &Regex {
        static REGEX: OnceLock<Regex> = OnceLock::new();
        REGEX.get_or_init(|| {
            Regex::new(r#"\$(https?://[^"'\s]+?\.m3u8(?:\?[^"'\s]*)?)"#).expect("valid m3u8 regex")
        })
    }

    fn special_ffzy_m3u8_regex(&self) -> &Regex {
        static REGEX: OnceLock<Regex> = OnceLock::new();
        REGEX.get_or_init(|| {
            Regex::new(r#"\$(https?://[^"'\s]+?/\d{8}/\d+_[a-f0-9]+/index\.m3u8)"#)
                .expect("valid ffzy detail regex")
        })
    }

    fn title_regex(&self) -> &Regex {
        static REGEX: OnceLock<Regex> = OnceLock::new();
        REGEX.get_or_init(|| Regex::new(r#"<h1[^>]*>([^<]+)</h1>"#).expect("valid title regex"))
    }

    fn detail_desc_regex(&self) -> &Regex {
        static REGEX: OnceLock<Regex> = OnceLock::new();
        REGEX.get_or_init(|| {
            Regex::new(r#"<div[^>]*class=["']sketch["'][^>]*>([\s\S]*?)</div>"#)
                .expect("valid desc regex")
        })
    }

    fn cover_regex(&self) -> &Regex {
        static REGEX: OnceLock<Regex> = OnceLock::new();
        REGEX.get_or_init(|| {
            Regex::new(r#"(https?://[^"'\s]+?\.(jpg|jpeg|png|webp))"#).expect("valid cover regex")
        })
    }

    fn year_regex(&self) -> &Regex {
        static REGEX: OnceLock<Regex> = OnceLock::new();
        REGEX.get_or_init(|| Regex::new(r#">(\d{4})<"#).expect("valid year regex"))
    }
}

fn extract_episodes_from_play_url(play_url: Option<&str>) -> (Vec<String>, Vec<String>) {
    let Some(play_url) = play_url else {
        return (Vec::new(), Vec::new());
    };

    let mut episodes = Vec::new();
    let mut titles = Vec::new();

    for candidate_group in play_url.split("$$$") {
        let mut candidate_episodes = Vec::new();
        let mut candidate_titles = Vec::new();

        for title_url in candidate_group.split('#') {
            let mut parts = title_url.splitn(2, '$');
            let Some(title) = parts.next() else {
                continue;
            };
            let Some(url) = parts.next() else {
                continue;
            };

            if looks_like_manifest_url(url.trim()) {
                candidate_titles.push(title.trim().to_string());
                candidate_episodes.push(url.trim().to_string());
            }
        }

        if candidate_episodes.len() > episodes.len() {
            episodes = candidate_episodes;
            titles = candidate_titles;
        }
    }

    (episodes, titles)
}

fn extract_m3u8_matches(content: &str) -> Vec<String> {
    content
        .m3u8_regex()
        .captures_iter(content)
        .filter_map(|capture| capture.get(1).map(|item| item.as_str().to_string()))
        .collect()
}

fn build_downstream_headers(
    api_site: &ApiSite,
    default_user_agent: &str,
    request_headers: Option<&HeaderMap>,
) -> ReqwestHeaderMap {
    let mut headers = ReqwestHeaderMap::new();

    if let Ok(value) = HeaderValue::from_str(api_site.ua.as_deref().unwrap_or(default_user_agent)) {
        headers.insert(USER_AGENT, value);
    }

    if let Some(referer) = api_site.referer.as_deref() {
        if let Ok(value) = HeaderValue::from_str(referer) {
            headers.insert(REFERER, value);
        }
    }

    if let Some(range_value) = request_headers.and_then(|headers| headers.get(RANGE)) {
        headers.insert(RANGE, range_value.clone());
    }

    headers
}

fn build_collection_api_url(api_base_url: &str, params: &[(&str, &str)]) -> Result<String> {
    let mut url =
        Url::parse(api_base_url).with_context(|| format!("invalid api url: {api_base_url}"))?;

    {
        let mut query_pairs = url.query_pairs_mut();
        for (key, value) in params {
            query_pairs.append_pair(key, value);
        }
    }

    Ok(url.to_string())
}

fn value_to_string(value: Option<&Value>) -> Option<String> {
    match value {
        Some(Value::String(inner)) => Some(inner.to_string()),
        Some(Value::Number(inner)) => Some(inner.to_string()),
        Some(Value::Bool(inner)) => Some(inner.to_string()),
        _ => None,
    }
}

fn value_to_i64(value: Option<&Value>) -> Option<i64> {
    match value {
        Some(Value::Number(inner)) => inner.as_i64(),
        Some(Value::String(inner)) => inner.parse::<i64>().ok(),
        _ => None,
    }
}

fn parse_usize(value: Option<&Value>) -> Option<usize> {
    match value {
        Some(Value::Number(inner)) => inner.as_u64().map(|item| item as usize),
        Some(Value::String(inner)) => inner.parse::<usize>().ok(),
        _ => None,
    }
}

fn normalize_year(value: Option<&str>) -> String {
    let Some(value) = value else {
        return "unknown".to_string();
    };

    let Some(capture) = year_value_regex().captures(value) else {
        return "unknown".to_string();
    };

    capture
        .get(1)
        .map(|item| item.as_str().to_string())
        .unwrap_or_else(|| "unknown".to_string())
}

fn year_value_regex() -> &'static Regex {
    static REGEX: OnceLock<Regex> = OnceLock::new();
    REGEX.get_or_init(|| Regex::new(r"(\d{4})").expect("valid year value regex"))
}

fn collapse_whitespace(value: &str) -> String {
    value.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn clean_html_tags(value: &str) -> String {
    if value.trim().is_empty() {
        return String::new();
    }

    let cleaned = html_tag_regex()
        .replace_all(value, "\n")
        .replace('\r', "\n");
    let lines = cleaned
        .split('\n')
        .map(|line| line.split_whitespace().collect::<Vec<_>>().join(" "))
        .filter(|line| !line.is_empty())
        .collect::<Vec<_>>();

    html_escape::decode_html_entities(&lines.join("\n")).to_string()
}

fn html_tag_regex() -> &'static Regex {
    static REGEX: OnceLock<Regex> = OnceLock::new();
    REGEX.get_or_init(|| Regex::new(r"<[^>]+>").expect("valid html tag regex"))
}

fn has_custom_detail_url(api_site: &ApiSite) -> bool {
    api_site
        .detail
        .as_deref()
        .map(|detail| detail.starts_with("http://") || detail.starts_with("https://"))
        .unwrap_or(false)
}

fn filter_adult_content_results(results: Vec<SearchResult>) -> Vec<SearchResult> {
    results
        .into_iter()
        .filter(|result| !is_adult_content_result(result))
        .collect()
}

fn is_adult_content_result(result: &SearchResult) -> bool {
    if ADULT_SOURCE_MARKERS
        .iter()
        .any(|marker| result.source_name.contains(marker))
    {
        return true;
    }

    let searchable_text = [
        Some(result.title.as_str()),
        result.type_name.as_deref(),
        result.class.as_deref(),
        Some(result.source_name.as_str()),
        result.desc.as_deref(),
    ]
    .into_iter()
    .flatten()
    .collect::<Vec<_>>()
    .join(" ");

    contains_adult_marker(&searchable_text)
}

fn contains_adult_marker(text: &str) -> bool {
    let normalized = text.to_lowercase();

    ADULT_SOURCE_MARKERS
        .iter()
        .chain(YELLOW_WORDS.iter())
        .any(|marker| normalized.contains(&marker.to_lowercase()))
}

fn build_content_suggestions(query: &str, results: &[SearchResult]) -> Vec<ContentSuggestion> {
    let query_lower = query.to_lowercase();
    let query_words = query_lower
        .split(|character: char| matches!(character, ' ' | '-' | ':' | '：' | '·' | '、'))
        .filter(|word| !word.is_empty())
        .collect::<Vec<_>>();
    let mut seen = BTreeMap::<String, ContentSuggestion>::new();

    for keyword in results
        .iter()
        .map(|result| result.title.as_str())
        .flat_map(|title| {
            title
                .split(|character: char| matches!(character, ' ' | '-' | ':' | '：' | '·' | '、'))
                .filter(|word| word.chars().count() > 1)
                .map(str::trim)
                .filter(|word| !word.is_empty())
                .map(str::to_string)
                .collect::<Vec<_>>()
        })
    {
        let keyword_lower = keyword.to_lowercase();
        if !keyword_lower.contains(&query_lower) {
            continue;
        }

        let (score, suggestion_type) = if keyword_lower == query_lower {
            (2.0, "exact")
        } else if keyword_lower.starts_with(&query_lower) || keyword_lower.ends_with(&query_lower) {
            (1.8, "related")
        } else if query_words
            .iter()
            .any(|query_word| keyword_lower.contains(query_word))
        {
            (1.5, "related")
        } else {
            (1.0, "suggestion")
        };

        seen.entry(keyword.clone()).or_insert(ContentSuggestion {
            text: keyword,
            r#type: suggestion_type,
            score,
        });

        if seen.len() >= 8 {
            break;
        }
    }

    let mut suggestions = seen.into_values().collect::<Vec<_>>();
    suggestions.sort_by(|left, right| {
        right
            .score
            .partial_cmp(&left.score)
            .unwrap_or(std::cmp::Ordering::Equal)
            .then_with(|| {
                suggestion_type_priority(right.r#type).cmp(&suggestion_type_priority(left.r#type))
            })
            .then_with(|| left.text.cmp(&right.text))
    });
    suggestions.truncate(8);
    suggestions
}

fn suggestion_type_priority(value: &str) -> usize {
    match value {
        "exact" => 3,
        "related" => 2,
        _ => 1,
    }
}

fn parse_douban_ids(ids: Option<&str>) -> Vec<u64> {
    ids.unwrap_or_default()
        .split(',')
        .filter_map(|id| id.trim().parse::<u64>().ok())
        .filter(|id| *id > 0)
        .collect::<std::collections::BTreeSet<_>>()
        .into_iter()
        .take(MAX_DOUBAN_RATING_IDS_PER_REQUEST)
        .collect()
}

async fn fetch_douban_ratings_by_ids(
    client: &reqwest::Client,
    ids: &[u64],
) -> Result<BTreeMap<String, String>> {
    let tasks = ids.iter().copied().map(|id| {
        let client = client.clone();
        async move {
            fetch_single_douban_rating(&client, id)
                .await
                .map(|rating| (id, rating))
        }
    });

    let mut ratings = BTreeMap::new();
    for result in join_all(tasks).await {
        match result {
            Ok((id, rating)) => {
                ratings.insert(id.to_string(), rating);
            }
            Err(error) => warn!("failed to fetch douban rating: {}", error),
        }
    }

    Ok(ratings)
}

async fn fetch_bangumi_calendar(client: &reqwest::Client, api_base_url: &str) -> Result<Value> {
    let response = client
        .get(format!("{}/calendar", api_base_url.trim_end_matches('/')))
        .headers(build_bangumi_headers())
        .timeout(Duration::from_millis(DEFAULT_DETAIL_TIMEOUT_MS))
        .send()
        .await?;

    if !response.status().is_success() {
        anyhow::bail!("bangumi calendar request failed with {}", response.status());
    }

    response.json::<Value>().await.map_err(Into::into)
}

fn build_bangumi_headers() -> ReqwestHeaderMap {
    let mut headers = ReqwestHeaderMap::new();
    headers.insert(USER_AGENT, HeaderValue::from_static(DEFAULT_WEB_UA));
    headers.insert(
        reqwest::header::ACCEPT,
        HeaderValue::from_static("application/json"),
    );
    headers
}

async fn fetch_single_douban_rating(client: &reqwest::Client, id: u64) -> Result<String> {
    let response = client
        .get(format!(
            "{DEFAULT_DOUBAN_API_BASE_URL}/rexxar/api/v2/subject/{id}?for_mobile=1"
        ))
        .headers(build_douban_headers())
        .timeout(Duration::from_millis(DEFAULT_DETAIL_TIMEOUT_MS))
        .send()
        .await?;

    if !response.status().is_success() {
        anyhow::bail!("douban rating request failed with {}", response.status());
    }

    let payload = response.json::<Value>().await?;
    let rating = payload
        .get("rating")
        .and_then(|item| item.get("value"))
        .and_then(|item| item.as_f64())
        .filter(|value| value.is_finite())
        .map(|value| format!("{value:.1}"))
        .unwrap_or_default();

    Ok(rating)
}

fn build_douban_headers() -> ReqwestHeaderMap {
    let mut headers = ReqwestHeaderMap::new();
    headers.insert(USER_AGENT, HeaderValue::from_static(DEFAULT_WEB_UA));
    headers.insert(
        REFERER,
        HeaderValue::from_static("https://movie.douban.com/"),
    );
    headers.insert(
        reqwest::header::ACCEPT,
        HeaderValue::from_static("application/json, text/plain, */*"),
    );
    headers.insert(ORIGIN, HeaderValue::from_static("https://movie.douban.com"));
    headers
}

fn build_runtime_public_config_response(config: &ServiceConfig) -> RuntimePublicConfigResponse {
    RuntimePublicConfigResponse {
        site_name: config.site_name.clone(),
        announcement: config.announcement.clone(),
        douban_proxy_type: config.douban_proxy_type.clone(),
        douban_proxy: config.douban_proxy.clone(),
        douban_image_proxy_type: config.douban_image_proxy_type.clone(),
        douban_image_proxy: config.douban_image_proxy.clone(),
        enable_web_live: config
            .enable_web_live_override
            .unwrap_or_else(|| config.live_sources.iter().any(|source| !source.disabled)),
        custom_categories: config.custom_categories.clone(),
    }
}

fn resolve_live_source(config: &ServiceConfig, source_key: &str) -> AppResult<LiveSourceConfig> {
    let normalized_source_key = source_key.trim();

    if normalized_source_key.is_empty() {
        return Err(AppError::bad_request("Missing source"));
    }

    config
        .live_sources
        .iter()
        .find(|source| source.key == normalized_source_key && !source.disabled)
        .cloned()
        .ok_or_else(|| AppError::new(StatusCode::NOT_FOUND, "Source not found"))
}

async fn get_or_refresh_live_channels_cache(
    state: &AppState,
    live_source: &LiveSourceConfig,
) -> AppResult<LiveChannelsCache> {
    if let Some(cached) = state
        .live_channels_cache
        .read()
        .await
        .get(&live_source.key)
        .cloned()
    {
        return Ok(cached);
    }

    let refreshed = refresh_live_channels_cache(state, live_source).await?;
    if refreshed.channels.is_empty() {
        return Err(AppError::new(StatusCode::NOT_FOUND, "频道信息未找到"));
    }

    let mut cache = state.live_channels_cache.write().await;
    cache.insert(live_source.key.clone(), refreshed.clone());
    Ok(refreshed)
}

async fn refresh_live_channels_cache(
    state: &AppState,
    live_source: &LiveSourceConfig,
) -> AppResult<LiveChannelsCache> {
    let upstream_response = fetch_live_proxy_upstream(
        &state.client,
        Some(live_source),
        &live_source.url,
        None,
        false,
    )
    .await?;

    if !upstream_response.status().is_success() {
        return Err(AppError::internal(format!(
            "Failed to fetch live source: {}",
            upstream_response.status()
        )));
    }

    let playlist_content = upstream_response
        .text()
        .await
        .map_err(|error| AppError::internal(error.to_string()))?;
    let (playlist_epg_url, channels) = parse_live_playlist(&live_source.key, &playlist_content);
    let epg_url = live_source
        .epg
        .clone()
        .or_else(|| normalize_optional_string(Some(playlist_epg_url)))
        .unwrap_or_default();
    let tvg_ids = channels
        .iter()
        .map(|channel| channel.tvg_id.clone())
        .filter(|tvg_id| !tvg_id.is_empty())
        .collect::<Vec<_>>();
    let epgs = fetch_live_epg_programs(
        &state.client,
        &epg_url,
        live_source
            .ua
            .as_deref()
            .unwrap_or(DEFAULT_LIVE_PROXY_USER_AGENT),
        &tvg_ids,
    )
    .await
    .unwrap_or_default();

    Ok(LiveChannelsCache {
        channel_number: channels.len(),
        channels,
        epg_url,
        epgs,
    })
}

async fn fetch_live_epg_programs(
    client: &reqwest::Client,
    epg_url: &str,
    user_agent: &str,
    tvg_ids: &[String],
) -> Result<BTreeMap<String, Vec<LiveProgram>>> {
    let normalized_epg_url = epg_url.trim();
    if normalized_epg_url.is_empty() || tvg_ids.is_empty() {
        return Ok(BTreeMap::new());
    }

    let mut headers = ReqwestHeaderMap::new();
    if let Ok(value) = HeaderValue::from_str(user_agent) {
        headers.insert(USER_AGENT, value);
    }

    let response = client
        .get(normalized_epg_url)
        .headers(headers)
        .timeout(Duration::from_millis(DEFAULT_PROXY_TIMEOUT_MS))
        .send()
        .await?;

    if !response.status().is_success() {
        return Ok(BTreeMap::new());
    }

    let document = response.text().await?;
    Ok(parse_live_epg_document(&document, tvg_ids))
}

fn parse_live_playlist(source_key: &str, content: &str) -> (String, Vec<LiveChannel>) {
    let mut tvg_url = String::new();
    let mut channels = Vec::new();
    let lines = content
        .split('\n')
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .collect::<Vec<_>>();
    let mut channel_index = 0;
    let mut index = 0;

    while index < lines.len() {
        let line = lines[index];
        if line.starts_with("#EXTM3U") {
            if let Some(value) = extract_quoted_attribute(line, "x-tvg-url")
                .or_else(|| extract_quoted_attribute(line, "url-tvg"))
            {
                tvg_url = value
                    .split(',')
                    .next()
                    .map(str::trim)
                    .unwrap_or_default()
                    .to_string();
            }
            index += 1;
            continue;
        }

        if !line.starts_with("#EXTINF:") {
            index += 1;
            continue;
        }

        let next_line = lines.get(index + 1).copied().unwrap_or_default();
        if next_line.is_empty() || next_line.starts_with('#') {
            index += 1;
            continue;
        }

        let tvg_id = extract_quoted_attribute(line, "tvg-id").unwrap_or_default();
        let tvg_name = extract_quoted_attribute(line, "tvg-name").unwrap_or_default();
        let logo = extract_quoted_attribute(line, "tvg-logo").unwrap_or_default();
        let group =
            extract_quoted_attribute(line, "group-title").unwrap_or_else(|| "无分组".to_string());
        let title = line
            .rsplit_once(',')
            .map(|(_, value)| value.trim().to_string())
            .unwrap_or_default();
        let name = if !title.is_empty() { title } else { tvg_name };

        if !name.is_empty() {
            channels.push(LiveChannel {
                id: format!("{source_key}-{channel_index}"),
                tvg_id,
                name,
                logo,
                group,
                url: next_line.to_string(),
            });
            channel_index += 1;
        }

        index += 2;
    }

    (tvg_url, channels)
}

fn parse_live_epg_document(
    document: &str,
    tvg_ids: &[String],
) -> BTreeMap<String, Vec<LiveProgram>> {
    let interested_channels = tvg_ids
        .iter()
        .cloned()
        .collect::<std::collections::BTreeSet<_>>();
    let mut programs = BTreeMap::<String, Vec<LiveProgram>>::new();
    let mut cursor = 0;

    while let Some(start_offset) = document[cursor..].find("<programme") {
        let start_index = cursor + start_offset;
        let Some(end_offset) = document[start_index..].find("</programme>") else {
            break;
        };
        let end_index = start_index + end_offset + "</programme>".len();
        let segment = &document[start_index..end_index];
        cursor = end_index;

        let Some(open_tag_end) = segment.find('>') else {
            continue;
        };
        let open_tag = &segment[..=open_tag_end];
        let Some(tvg_id) = extract_quoted_attribute(open_tag, "channel") else {
            continue;
        };
        if !interested_channels.contains(&tvg_id) {
            continue;
        }

        let Some(start) = extract_quoted_attribute(open_tag, "start") else {
            continue;
        };
        let Some(end) = extract_quoted_attribute(open_tag, "stop") else {
            continue;
        };
        let Some(title) = extract_xml_element_text(segment, "title") else {
            continue;
        };

        let normalized_title = normalize_xml_text(&title);
        if normalized_title.is_empty() {
            continue;
        }

        programs.entry(tvg_id).or_default().push(LiveProgram {
            start,
            end,
            title: normalized_title,
        });
    }

    programs
}

fn extract_quoted_attribute(line: &str, attribute: &str) -> Option<String> {
    let needle = format!(r#"{attribute}=""#);
    let start = line.find(&needle)? + needle.len();
    let tail = &line[start..];
    let end = tail.find('"')?;
    Some(tail[..end].to_string())
}

fn extract_xml_element_text(segment: &str, element_name: &str) -> Option<String> {
    let open_tag_start = segment.find(&format!("<{element_name}"))?;
    let content_start = segment[open_tag_start..].find('>')? + open_tag_start + 1;
    let close_tag = format!("</{element_name}>");
    let content_end = segment[content_start..].find(&close_tag)? + content_start;
    Some(segment[content_start..content_end].to_string())
}

fn normalize_xml_text(value: &str) -> String {
    let trimmed = value.trim();
    let cdata_trimmed = trimmed
        .strip_prefix("<![CDATA[")
        .and_then(|inner| inner.strip_suffix("]]>"))
        .unwrap_or(trimmed);
    html_escape::decode_html_entities(cdata_trimmed.trim()).to_string()
}

fn build_live_proxy_request_headers(
    live_source: Option<&LiveSourceConfig>,
    request_headers: Option<&HeaderMap>,
    include_range: bool,
) -> ReqwestHeaderMap {
    let mut headers = ReqwestHeaderMap::new();
    let user_agent = live_source
        .and_then(|source| source.ua.as_deref())
        .unwrap_or(DEFAULT_LIVE_PROXY_USER_AGENT);

    if let Ok(value) = HeaderValue::from_str(user_agent) {
        headers.insert(USER_AGENT, value);
    }

    if include_range {
        if let Some(range_value) = request_headers.and_then(|headers| headers.get(RANGE)) {
            headers.insert(RANGE, range_value.clone());
        }
    }

    headers
}

async fn fetch_live_proxy_upstream(
    client: &reqwest::Client,
    live_source: Option<&LiveSourceConfig>,
    upstream_url: &str,
    request_headers: Option<&HeaderMap>,
    include_range: bool,
) -> AppResult<reqwest::Response> {
    let normalized_upstream_url = upstream_url.trim();
    if normalized_upstream_url.is_empty() {
        return Err(AppError::bad_request("Missing url"));
    }

    client
        .get(normalized_upstream_url)
        .headers(build_live_proxy_request_headers(
            live_source,
            request_headers,
            include_range,
        ))
        .timeout(Duration::from_millis(DEFAULT_PROXY_TIMEOUT_MS))
        .send()
        .await
        .map_err(|error| AppError::internal(error.to_string()))
}

fn detect_live_stream_type(content_type: Option<&str>) -> &'static str {
    let normalized = content_type.unwrap_or_default().to_ascii_lowercase();
    if normalized.contains("video/mp4") {
        return "mp4";
    }

    if normalized.contains("video/x-flv") {
        return "flv";
    }

    "m3u8"
}

fn should_rewrite_live_manifest(
    content_type: Option<&str>,
    final_url: &str,
    upstream_url: &str,
) -> bool {
    let normalized_content_type = content_type.unwrap_or_default().to_ascii_lowercase();
    let target_url = if !final_url.is_empty() {
        final_url
    } else {
        upstream_url
    };

    normalized_content_type.contains("mpegurl")
        || normalized_content_type.contains("octet-stream")
        || manifest_url_regex().is_match(target_url)
}

fn rewrite_live_manifest_content(
    content: &str,
    final_url: &str,
    source_key: &str,
    public_base_url: &str,
    allow_cors: bool,
) -> String {
    let base_url = get_base_url(final_url);
    let lines = content.split('\n').collect::<Vec<_>>();
    let mut rewritten_lines = Vec::new();
    let mut index = 0;

    while index < lines.len() {
        let trimmed_line = lines[index].trim();
        if trimmed_line.is_empty() {
            rewritten_lines.push(String::new());
            index += 1;
            continue;
        }

        if trimmed_line.starts_with("#EXT-X-STREAM-INF:") {
            rewritten_lines.push(trimmed_line.to_string());
            let next_line = lines
                .get(index + 1)
                .map(|line| line.trim())
                .unwrap_or_default();
            if !next_line.is_empty() && !next_line.starts_with('#') {
                let resolved_url = resolve_url(&base_url, next_line);
                rewritten_lines.push(build_live_proxy_m3u8_url(
                    public_base_url,
                    source_key,
                    &resolved_url,
                    false,
                ));
                index += 2;
                continue;
            }
            index += 1;
            continue;
        }

        if trimmed_line.starts_with("#EXT-X-MEDIA:")
            || trimmed_line.starts_with("#EXT-X-I-FRAME-STREAM-INF:")
            || trimmed_line.starts_with("#EXT-X-RENDITION-REPORT:")
        {
            rewritten_lines.push(rewrite_manifest_uri_attribute(
                trimmed_line,
                &base_url,
                |resolved_url| {
                    build_live_proxy_m3u8_url(public_base_url, source_key, resolved_url, false)
                },
            ));
            index += 1;
            continue;
        }

        if trimmed_line.starts_with("#EXT-X-KEY:")
            || trimmed_line.starts_with("#EXT-X-SESSION-KEY:")
        {
            rewritten_lines.push(rewrite_manifest_uri_attribute(
                trimmed_line,
                &base_url,
                |resolved_url| build_live_proxy_key_url(public_base_url, source_key, resolved_url),
            ));
            index += 1;
            continue;
        }

        if trimmed_line.starts_with("#EXT-X-MAP:")
            || trimmed_line.starts_with("#EXT-X-PART:")
            || trimmed_line.starts_with("#EXT-X-PRELOAD-HINT:")
        {
            rewritten_lines.push(rewrite_manifest_uri_attribute(
                trimmed_line,
                &base_url,
                |resolved_url| {
                    build_live_proxy_segment_url(public_base_url, source_key, resolved_url)
                },
            ));
            index += 1;
            continue;
        }

        if !trimmed_line.starts_with('#') {
            let resolved_url = resolve_url(&base_url, trimmed_line);
            rewritten_lines.push(if allow_cors {
                resolved_url
            } else {
                build_live_proxy_segment_url(public_base_url, source_key, &resolved_url)
            });
            index += 1;
            continue;
        }

        rewritten_lines.push(trimmed_line.to_string());
        index += 1;
    }

    rewritten_lines.join("\n")
}

fn rewrite_manifest_uri_attribute<F>(line: &str, base_url: &str, builder: F) -> String
where
    F: Fn(&str) -> String,
{
    let Some(uri) = extract_quoted_attribute(line, "URI") else {
        return line.to_string();
    };
    let resolved_url = resolve_url(base_url, &uri);
    let target = format!(r#"URI="{uri}""#);
    let replacement = format!(r#"URI="{}""#, builder(&resolved_url));
    line.replacen(&target, &replacement, 1)
}

fn build_live_proxy_m3u8_url(
    base_url: &str,
    source_key: &str,
    url: &str,
    allow_cors: bool,
) -> String {
    build_live_proxy_url(base_url, "/media/live/m3u8", source_key, url, allow_cors)
}

fn build_live_proxy_segment_url(base_url: &str, source_key: &str, url: &str) -> String {
    build_live_proxy_url(base_url, "/media/live/segment", source_key, url, false)
}

fn build_live_proxy_key_url(base_url: &str, source_key: &str, url: &str) -> String {
    build_live_proxy_url(base_url, "/media/live/key", source_key, url, false)
}

fn build_live_proxy_url(
    base_url: &str,
    path: &str,
    source_key: &str,
    url: &str,
    allow_cors: bool,
) -> String {
    let mut serializer = form_urlencoded::Serializer::new(String::new());
    serializer.append_pair("moontv-source", source_key);
    serializer.append_pair("url", url);
    if allow_cors {
        serializer.append_pair("allowCORS", "true");
    }
    let query = serializer.finish();

    format!("{}{}?{}", base_url.trim_end_matches('/'), path, query)
}

fn resolve_vod_proxy_request(
    config: &ServiceConfig,
    params: VodProxyQueryParams,
) -> AppResult<ResolvedVodProxyRequest> {
    let source = params.source.unwrap_or_default().trim().to_string();
    let upstream_url = params.url.unwrap_or_default().trim().to_string();

    if source.is_empty() || upstream_url.is_empty() {
        return Err(AppError::bad_request("Missing source or url"));
    }

    let api_site = config
        .api_sites
        .iter()
        .find(|item| item.key == source)
        .cloned()
        .ok_or_else(|| AppError::bad_request("Invalid source"))?;

    Ok(ResolvedVodProxyRequest {
        source,
        upstream_url,
        api_site,
    })
}

async fn fetch_vod_proxy_upstream(
    client: &reqwest::Client,
    api_site: &ApiSite,
    upstream_url: &str,
    request_headers: &HeaderMap,
) -> AppResult<reqwest::Response> {
    client
        .get(upstream_url)
        .headers(build_downstream_headers(
            api_site,
            DEFAULT_WEB_UA,
            Some(request_headers),
        ))
        .timeout(Duration::from_millis(DEFAULT_PROXY_TIMEOUT_MS))
        .send()
        .await
        .map_err(|error| AppError::internal(error.to_string()))
}

fn upstream_response_meta(response: &reqwest::Response) -> UpstreamResponseMeta {
    UpstreamResponseMeta {
        status: response.status(),
        final_url: response.url().to_string(),
        content_type: response
            .headers()
            .get(CONTENT_TYPE)
            .and_then(|value| value.to_str().ok())
            .map(|value| value.to_string()),
        content_length: response
            .headers()
            .get(CONTENT_LENGTH)
            .and_then(|value| value.to_str().ok())
            .map(|value| value.to_string()),
        accept_ranges: response
            .headers()
            .get(ACCEPT_RANGES)
            .and_then(|value| value.to_str().ok())
            .map(|value| value.to_string()),
        content_range: response
            .headers()
            .get(CONTENT_RANGE)
            .and_then(|value| value.to_str().ok())
            .map(|value| value.to_string()),
    }
}

fn create_vod_proxy_headers(
    meta: &UpstreamResponseMeta,
    content_type: &str,
    content_length: Option<String>,
    include_content_length: bool,
) -> HeaderMap {
    create_proxy_headers(
        meta,
        content_type,
        content_length,
        include_content_length,
        "no-store",
    )
}

fn create_live_proxy_headers(
    meta: &UpstreamResponseMeta,
    content_type: &str,
    content_length: Option<String>,
    include_content_length: bool,
    cache_control: Option<&str>,
) -> HeaderMap {
    create_proxy_headers(
        meta,
        content_type,
        content_length,
        include_content_length,
        cache_control.unwrap_or("no-cache"),
    )
}

fn create_proxy_headers(
    meta: &UpstreamResponseMeta,
    content_type: &str,
    content_length: Option<String>,
    include_content_length: bool,
    cache_control: &str,
) -> HeaderMap {
    let mut headers = HeaderMap::new();
    let content_type_value = HeaderValue::from_str(content_type)
        .unwrap_or_else(|_| HeaderValue::from_static("application/octet-stream"));
    headers.insert(CONTENT_TYPE, content_type_value);

    if let Ok(value) = HeaderValue::from_str(cache_control) {
        headers.insert(CACHE_CONTROL, value);
    }

    apply_cors_headers(&mut headers);

    if include_content_length {
        if let Some(content_length) = content_length {
            if let Ok(value) = HeaderValue::from_str(&content_length) {
                headers.insert(CONTENT_LENGTH, value);
            }
        }
    }

    if let Some(accept_ranges) = meta.accept_ranges.as_deref() {
        if let Ok(value) = HeaderValue::from_str(accept_ranges) {
            headers.insert(ACCEPT_RANGES, value);
        }
    }

    if let Some(content_range) = meta.content_range.as_deref() {
        if let Ok(value) = HeaderValue::from_str(content_range) {
            headers.insert(CONTENT_RANGE, value);
        }
    }

    headers
}

fn rewrite_vod_manifest_content(
    content: &str,
    final_url: &str,
    source: &str,
    public_base_url: &str,
) -> String {
    let base_url = get_base_url(final_url);
    let lines = sanitize_vod_manifest_lines(
        content
            .split('\n')
            .map(|line| line.to_string())
            .collect::<Vec<_>>(),
    );
    let mut rewritten_lines = Vec::new();
    let mut index = 0;

    while index < lines.len() {
        let trimmed_line = lines[index].trim();

        if trimmed_line.is_empty() {
            rewritten_lines.push(String::new());
            index += 1;
            continue;
        }

        if trimmed_line.starts_with("#EXT-X-STREAM-INF:") {
            rewritten_lines.push(trimmed_line.to_string());
            let next_line = lines
                .get(index + 1)
                .map(|line| line.trim().to_string())
                .unwrap_or_default();

            if !next_line.is_empty() && !next_line.starts_with('#') {
                let resolved_url = resolve_url(&base_url, &next_line);
                rewritten_lines.push(build_vod_proxy_m3u8_url(
                    public_base_url,
                    source,
                    &resolved_url,
                ));
                index += 2;
                continue;
            }

            index += 1;
            continue;
        }

        if trimmed_line.starts_with("#EXT-X-MEDIA:")
            || trimmed_line.starts_with("#EXT-X-I-FRAME-STREAM-INF:")
            || trimmed_line.starts_with("#EXT-X-RENDITION-REPORT:")
        {
            rewritten_lines.push(rewrite_attribute_uri(
                trimmed_line,
                &base_url,
                source,
                public_base_url,
                VodAssetKind::M3u8,
            ));
            index += 1;
            continue;
        }

        if trimmed_line.starts_with("#EXT-X-KEY:")
            || trimmed_line.starts_with("#EXT-X-SESSION-KEY:")
        {
            rewritten_lines.push(rewrite_attribute_uri(
                trimmed_line,
                &base_url,
                source,
                public_base_url,
                VodAssetKind::Key,
            ));
            index += 1;
            continue;
        }

        if trimmed_line.starts_with("#EXT-X-MAP:")
            || trimmed_line.starts_with("#EXT-X-PART:")
            || trimmed_line.starts_with("#EXT-X-PRELOAD-HINT:")
        {
            rewritten_lines.push(rewrite_attribute_uri(
                trimmed_line,
                &base_url,
                source,
                public_base_url,
                VodAssetKind::Segment,
            ));
            index += 1;
            continue;
        }

        if !trimmed_line.starts_with('#') {
            let resolved_url = resolve_url(&base_url, trimmed_line);
            if looks_like_manifest_url(&resolved_url) {
                rewritten_lines.push(build_vod_proxy_m3u8_url(
                    public_base_url,
                    source,
                    &resolved_url,
                ));
            } else {
                rewritten_lines.push(build_vod_proxy_segment_url(
                    public_base_url,
                    source,
                    &resolved_url,
                ));
            }

            index += 1;
            continue;
        }

        rewritten_lines.push(trimmed_line.to_string());
        index += 1;
    }

    rewritten_lines.join("\n")
}

#[derive(Clone, Copy)]
enum VodAssetKind {
    M3u8,
    Segment,
    Key,
}

fn rewrite_attribute_uri(
    line: &str,
    base_url: &str,
    source: &str,
    public_base_url: &str,
    asset_kind: VodAssetKind,
) -> String {
    let Some(capture) = uri_attribute_regex().captures(line) else {
        return line.to_string();
    };
    let Some(uri_match) = capture.get(1) else {
        return line.to_string();
    };

    let resolved_url = resolve_url(base_url, uri_match.as_str());
    let proxied_url = match asset_kind {
        VodAssetKind::M3u8 => build_vod_proxy_m3u8_url(public_base_url, source, &resolved_url),
        VodAssetKind::Segment => {
            build_vod_proxy_segment_url(public_base_url, source, &resolved_url)
        }
        VodAssetKind::Key => build_vod_proxy_key_url(public_base_url, source, &resolved_url),
    };

    line.replace(
        &format!("URI=\"{}\"", uri_match.as_str()),
        &format!("URI=\"{proxied_url}\""),
    )
}

fn uri_attribute_regex() -> &'static Regex {
    static REGEX: OnceLock<Regex> = OnceLock::new();
    REGEX.get_or_init(|| Regex::new(r#"URI="([^"]+)""#).expect("valid uri regex"))
}

fn sanitize_vod_manifest_lines(lines: Vec<String>) -> Vec<String> {
    let mut sanitized = Vec::new();
    let mut index = 0;

    while index < lines.len() {
        let trimmed_line = lines[index].trim().to_string();

        if trimmed_line == "#EXT-X-DISCONTINUITY" {
            let mut cursor = index + 1;
            let mut found_unsupported_segment = false;

            while cursor + 1 < lines.len() {
                let duration_line = lines[cursor].trim().to_string();
                let resource_line = lines[cursor + 1].trim().to_string();

                if duration_line.starts_with("#EXTINF:")
                    && is_unsupported_vod_segment_uri(&resource_line)
                {
                    found_unsupported_segment = true;
                    cursor += 2;
                    continue;
                }

                break;
            }

            if found_unsupported_segment {
                if lines
                    .get(cursor)
                    .map(|line| line.trim() == "#EXT-X-DISCONTINUITY")
                    .unwrap_or(false)
                {
                    cursor += 1;
                }

                index = cursor;
                continue;
            }
        }

        if trimmed_line.starts_with("#EXTINF:")
            && lines
                .get(index + 1)
                .map(|line| is_unsupported_vod_segment_uri(line.trim()))
                .unwrap_or(false)
        {
            index += 2;
            continue;
        }

        if (trimmed_line.starts_with("#EXT-X-PART:")
            || trimmed_line.starts_with("#EXT-X-PRELOAD-HINT:")
            || trimmed_line.starts_with("#EXT-X-MAP:"))
            && is_unsupported_vod_segment_uri(&trimmed_line)
        {
            index += 1;
            continue;
        }

        if is_unsupported_vod_segment_uri(&trimmed_line) {
            index += 1;
            continue;
        }

        sanitized.push(trimmed_line);
        index += 1;
    }

    sanitized
}

fn is_unsupported_vod_segment_uri(line: &str) -> bool {
    let target = uri_attribute_regex()
        .captures(line)
        .and_then(|capture| capture.get(1))
        .map(|item| item.as_str())
        .unwrap_or(line.trim());

    unsupported_segment_regex().is_match(target)
}

fn unsupported_segment_regex() -> &'static Regex {
    static REGEX: OnceLock<Regex> = OnceLock::new();
    REGEX
        .get_or_init(|| Regex::new(r"(^|/)video/adjump/").expect("valid unsupported segment regex"))
}

fn get_base_url(manifest_url: &str) -> String {
    if let Ok(mut url) = Url::parse(manifest_url) {
        if url.path().ends_with(".m3u8") {
            let mut path = url.path().to_string();
            if let Some(last_slash_index) = path.rfind('/') {
                path.truncate(last_slash_index + 1);
            }
            url.set_path(&path);
        } else if !url.path().ends_with('/') {
            url.set_path(&format!("{}/", url.path()));
        }
        url.set_query(None);
        url.to_string()
    } else if manifest_url.ends_with('/') {
        manifest_url.to_string()
    } else {
        format!("{manifest_url}/")
    }
}

fn resolve_url(base_url: &str, relative_path: &str) -> String {
    if relative_path.starts_with("http://") || relative_path.starts_with("https://") {
        return relative_path.to_string();
    }

    if relative_path.starts_with("//") {
        if let Ok(base_url) = Url::parse(base_url) {
            return format!("{}{}", base_url.scheme(), relative_path);
        }
    }

    match Url::parse(base_url)
        .and_then(|base| base.join(relative_path))
        .map(|url| url.to_string())
    {
        Ok(url) => url,
        Err(_) => fallback_resolve_url(base_url, relative_path),
    }
}

fn fallback_resolve_url(base_url: &str, relative_path: &str) -> String {
    let mut base = base_url.to_string();
    if !base.ends_with('/') {
        if let Some(last_slash_index) = base.rfind('/') {
            base.truncate(last_slash_index + 1);
        }
    }

    if relative_path.starts_with('/') {
        if let Ok(url) = Url::parse(&base) {
            return format!(
                "{}://{}{}",
                url.scheme(),
                url.host_str().unwrap_or(""),
                relative_path
            );
        }
    }

    if relative_path.starts_with("../") {
        let mut segments = base
            .split('/')
            .filter(|segment| !segment.is_empty())
            .map(|segment| segment.to_string())
            .collect::<Vec<_>>();
        let relative_segments = relative_path
            .split('/')
            .filter(|segment| !segment.is_empty())
            .collect::<Vec<_>>();

        for segment in relative_segments {
            if segment == ".." {
                let _ = segments.pop();
            } else if segment != "." {
                segments.push(segment.to_string());
            }
        }

        if let Ok(url) = Url::parse(&base) {
            return format!(
                "{}://{}/{}",
                url.scheme(),
                url.host_str().unwrap_or(""),
                segments.join("/")
            );
        }
    }

    if let Some(cleaned_relative) = relative_path.strip_prefix("./") {
        return format!("{base}{cleaned_relative}");
    }

    format!("{base}{relative_path}")
}

fn looks_like_manifest_url(url: &str) -> bool {
    manifest_url_regex().is_match(url)
}

fn manifest_url_regex() -> &'static Regex {
    static REGEX: OnceLock<Regex> = OnceLock::new();
    REGEX.get_or_init(|| Regex::new(r"(?i)\.m3u8($|[?#])").expect("valid manifest url regex"))
}

fn build_vod_proxy_m3u8_url(base_url: &str, source: &str, url: &str) -> String {
    build_vod_proxy_url(base_url, "/media/vod/m3u8", source, url)
}

fn build_vod_proxy_segment_url(base_url: &str, source: &str, url: &str) -> String {
    build_vod_proxy_url(base_url, "/media/vod/segment", source, url)
}

fn build_vod_proxy_key_url(base_url: &str, source: &str, url: &str) -> String {
    build_vod_proxy_url(base_url, "/media/vod/key", source, url)
}

fn build_vod_proxy_url(base_url: &str, path: &str, source: &str, url: &str) -> String {
    let mut serializer = form_urlencoded::Serializer::new(String::new());
    serializer.append_pair("source", source);
    serializer.append_pair("url", url);
    let query = serializer.finish();

    format!("{}{}?{}", base_url.trim_end_matches('/'), path, query)
}

#[cfg(test)]
mod tests {
    use super::*;

    use std::sync::atomic::{AtomicU64, Ordering};

    use axum::{body::to_bytes, http::Request, response::IntoResponse};
    use tower::ServiceExt;

    #[tokio::test]
    async fn health_route_returns_ok() {
        let temp_dir = TestDir::new();
        let config_path = write_test_config(
            &temp_dir,
            json!({
              "cache_time": 7200,
              "api_site": {}
            }),
        );
        let app = build_router(AppState::new(
            DEFAULT_HOST.to_string(),
            DEFAULT_PORT,
            config_path,
            temp_dir.path.join("data"),
            temp_dir.path.join("data/moontv.sqlite3"),
        ));

        let response = app
            .oneshot(
                Request::builder()
                    .uri("/health")
                    .body(Body::empty())
                    .expect("health request"),
            )
            .await
            .expect("health response");

        assert_eq!(response.status(), StatusCode::OK);
        let body = to_bytes(response.into_body(), usize::MAX)
            .await
            .expect("health body");
        let payload: Value = serde_json::from_slice(&body).expect("health payload json");

        assert_eq!(payload.get("status"), Some(&Value::String("ok".into())));
        assert_eq!(
            payload.get("port"),
            Some(&Value::Number(DEFAULT_PORT.into()))
        );
    }

    #[test]
    fn manifest_sanitizer_removes_adjumps() {
        let sanitized = sanitize_vod_manifest_lines(vec![
            "#EXTM3U".into(),
            "#EXT-X-DISCONTINUITY".into(),
            "#EXTINF:4.0,".into(),
            "video/adjump/clip.ts".into(),
            "#EXTINF:5.0,".into(),
            "video/real.ts".into(),
        ]);

        assert_eq!(
            sanitized,
            vec![
                "#EXTM3U".to_string(),
                "#EXTINF:5.0,".to_string(),
                "video/real.ts".to_string(),
            ]
        );
    }

    #[test]
    fn rewrite_manifest_rewrites_nested_assets() {
        let manifest = r#"#EXTM3U
#EXT-X-STREAM-INF:BANDWIDTH=1280000
stream/index.m3u8
#EXT-X-KEY:METHOD=AES-128,URI="key.key"
#EXTINF:4.0,
segment0.ts
"#;

        let rewritten = rewrite_vod_manifest_content(
            manifest,
            "https://example.com/path/master.m3u8",
            "wolong",
            "http://127.0.0.1:8787",
        );

        assert!(rewritten.contains("/media/vod/m3u8?source=wolong"));
        assert!(rewritten.contains("/media/vod/key?source=wolong"));
        assert!(rewritten.contains("/media/vod/segment?source=wolong"));
    }

    #[test]
    fn parse_detail_payload_extracts_fallback_m3u8() {
        let api_site = ApiSite {
            key: "wolong".into(),
            api: "https://example.com/api".into(),
            name: "卧龙".into(),
            detail: None,
            ua: None,
            referer: None,
        };
        let payload = json!({
          "list": [{
            "vod_name": "测试影片",
            "vod_pic": "https://img.example.com/cover.jpg",
            "vod_content": "播放地址 $https://cdn.example.com/video/index.m3u8",
            "vod_year": "2025",
            "type_name": "电影"
          }]
        });

        let detail = parse_detail_payload(&payload, &api_site, "123").expect("detail should parse");

        assert_eq!(detail.id, "123");
        assert_eq!(
            detail.episodes,
            vec!["https://cdn.example.com/video/index.m3u8".to_string()]
        );
    }

    #[tokio::test]
    async fn content_search_endpoint_uses_configured_source() {
        let upstream = spawn_mock_server(mock_upstream_router()).await;
        let temp_dir = TestDir::new();
        let config_path = write_test_config(
            &temp_dir,
            json!({
              "cache_time": 7200,
              "api_site": {
                "mock": {
                  "api": format!("{}/api.php/provide/vod", upstream.base_url()),
                  "name": "Mock Resource"
                }
              }
            }),
        );
        let app = build_router(AppState::new(
            DEFAULT_HOST.to_string(),
            DEFAULT_PORT,
            config_path,
            temp_dir.path.join("data"),
            temp_dir.path.join("data/moontv.sqlite3"),
        ));

        let response = app
            .oneshot(
                Request::builder()
                    .uri("/content/search?q=test")
                    .body(Body::empty())
                    .expect("search request"),
            )
            .await
            .expect("search response");

        assert_eq!(response.status(), StatusCode::OK);
        let body = to_bytes(response.into_body(), usize::MAX)
            .await
            .expect("search body");
        let payload: Value = serde_json::from_slice(&body).expect("search payload json");

        assert_eq!(
            payload
                .get("results")
                .and_then(Value::as_array)
                .map(Vec::len),
            Some(1)
        );
        assert_eq!(
            payload
                .get("results")
                .and_then(Value::as_array)
                .and_then(|items| items.first())
                .and_then(|item| item.get("source"))
                .and_then(Value::as_str),
            Some("mock")
        );

        upstream.abort();
    }

    #[tokio::test]
    async fn content_suggestions_endpoint_returns_keywords() {
        let upstream = spawn_mock_server(mock_upstream_router()).await;
        let temp_dir = TestDir::new();
        let config_path = write_test_config(
            &temp_dir,
            json!({
              "cache_time": 7200,
              "api_site": {
                "mock": {
                  "api": format!("{}/api.php/provide/vod", upstream.base_url()),
                  "name": "Mock Resource"
                }
              }
            }),
        );
        let app = build_router(AppState::new(
            DEFAULT_HOST.to_string(),
            DEFAULT_PORT,
            config_path,
            temp_dir.path.join("data"),
            temp_dir.path.join("data/moontv.sqlite3"),
        ));

        let response = app
            .oneshot(
                Request::builder()
                    .uri("/api/search/suggestions?q=Mock")
                    .body(Body::empty())
                    .expect("suggestions request"),
            )
            .await
            .expect("suggestions response");

        assert_eq!(response.status(), StatusCode::OK);
        let body = to_bytes(response.into_body(), usize::MAX)
            .await
            .expect("suggestions body");
        let payload: Value = serde_json::from_slice(&body).expect("suggestions payload json");

        assert_eq!(
            payload
                .get("suggestions")
                .and_then(Value::as_array)
                .and_then(|items| items.first())
                .and_then(|item| item.get("text"))
                .and_then(Value::as_str),
            Some("Mock")
        );

        upstream.abort();
    }

    #[tokio::test]
    async fn bangumi_calendar_endpoint_returns_payload() {
        let upstream = spawn_mock_server(mock_upstream_router()).await;
        let temp_dir = TestDir::new();
        let config_path = write_test_config(
            &temp_dir,
            json!({
              "cache_time": 7200,
              "api_site": {}
            }),
        );
        let mut state = AppState::new(
            DEFAULT_HOST.to_string(),
            DEFAULT_PORT,
            config_path,
            temp_dir.path.join("data"),
            temp_dir.path.join("data/moontv.sqlite3"),
        );
        state.bangumi_api_base_url = upstream.base_url();
        let app = build_router(state);

        let response = app
            .oneshot(
                Request::builder()
                    .uri("/api/bangumi/calendar")
                    .body(Body::empty())
                    .expect("bangumi request"),
            )
            .await
            .expect("bangumi response");

        assert_eq!(response.status(), StatusCode::OK);
        assert_eq!(
            response
                .headers()
                .get(CACHE_CONTROL)
                .and_then(|value| value.to_str().ok()),
            Some("public, max-age=7200")
        );
        let body = to_bytes(response.into_body(), usize::MAX)
            .await
            .expect("bangumi body");
        let payload: Value = serde_json::from_slice(&body).expect("bangumi payload json");

        assert_eq!(
            payload
                .as_array()
                .and_then(|items| items.first())
                .and_then(|item| item.get("weekday"))
                .and_then(|item| item.get("en"))
                .and_then(Value::as_str),
            Some("Mon")
        );

        upstream.abort();
    }

    #[tokio::test]
    async fn runtime_public_config_endpoint_projects_desktop_settings() {
        let temp_dir = TestDir::new();
        let config_path = write_test_config(
            &temp_dir,
            json!({
              "cache_time": 7200,
              "douban_proxy_type": "custom",
              "douban_proxy": "https://proxy.example.com/fetch?url=",
              "douban_image_proxy_type": "custom",
              "douban_image_proxy": "https://img.example.com/fetch?url=",
              "custom_category": [
                {
                  "name": "热门电影",
                  "type": "movie",
                  "query": "热门"
                },
                {
                  "name": "禁用分类",
                  "type": "tv",
                  "query": "禁用",
                  "disabled": true
                }
              ],
              "lives": {
                "news": {
                  "name": "News",
                  "url": "https://example.com/live.m3u"
                }
              },
              "api_site": {}
            }),
        );
        let app = build_router(AppState::new(
            DEFAULT_HOST.to_string(),
            DEFAULT_PORT,
            config_path,
            temp_dir.path.join("data"),
            temp_dir.path.join("data/moontv.sqlite3"),
        ));

        let response = app
            .oneshot(
                Request::builder()
                    .uri("/api/runtime/public-config")
                    .body(Body::empty())
                    .expect("runtime public config request"),
            )
            .await
            .expect("runtime public config response");

        assert_eq!(response.status(), StatusCode::OK);
        assert_eq!(
            response
                .headers()
                .get(CACHE_CONTROL)
                .and_then(|value| value.to_str().ok()),
            Some("no-store")
        );
        let body = to_bytes(response.into_body(), usize::MAX)
            .await
            .expect("runtime public config body");
        let payload: Value =
            serde_json::from_slice(&body).expect("runtime public config payload json");

        assert_eq!(
            payload.get("doubanProxyType").and_then(Value::as_str),
            Some("custom")
        );
        assert_eq!(
            payload.get("enableWebLive").and_then(Value::as_bool),
            Some(true)
        );
        assert_eq!(
            payload
                .get("customCategories")
                .and_then(Value::as_array)
                .map(Vec::len),
            Some(1)
        );
    }

    #[tokio::test]
    async fn live_channels_and_epg_endpoints_return_cached_live_data() {
        let upstream = spawn_mock_server(mock_upstream_router()).await;
        let temp_dir = TestDir::new();
        let config_path = write_test_config(
            &temp_dir,
            json!({
              "cache_time": 7200,
              "api_site": {},
              "lives": {
                "news": {
                  "name": "News",
                  "url": format!("{}/live/source.m3u", upstream.base_url()),
                  "ua": "Custom Live UA",
                  "epg": format!("{}/epg.xml", upstream.base_url())
                }
              }
            }),
        );
        let app = build_router(AppState::new(
            DEFAULT_HOST.to_string(),
            DEFAULT_PORT,
            config_path,
            temp_dir.path.join("data"),
            temp_dir.path.join("data/moontv.sqlite3"),
        ));

        let channels_response = app
            .clone()
            .oneshot(
                Request::builder()
                    .uri("/api/live/channels?source=news")
                    .body(Body::empty())
                    .expect("live channels request"),
            )
            .await
            .expect("live channels response");

        assert_eq!(channels_response.status(), StatusCode::OK);
        let channels_body = to_bytes(channels_response.into_body(), usize::MAX)
            .await
            .expect("live channels body");
        let channels_payload: Value =
            serde_json::from_slice(&channels_body).expect("live channels payload json");
        assert_eq!(
            channels_payload
                .get("data")
                .and_then(Value::as_array)
                .and_then(|items| items.first())
                .and_then(|item| item.get("tvgId"))
                .and_then(Value::as_str),
            Some("cctv1")
        );

        let epg_response = app
            .clone()
            .oneshot(
                Request::builder()
                    .uri("/api/live/epg?source=news&tvgId=cctv1")
                    .body(Body::empty())
                    .expect("live epg request"),
            )
            .await
            .expect("live epg response");

        assert_eq!(epg_response.status(), StatusCode::OK);
        let epg_body = to_bytes(epg_response.into_body(), usize::MAX)
            .await
            .expect("live epg body");
        let epg_payload: Value = serde_json::from_slice(&epg_body).expect("live epg payload json");
        assert_eq!(
            epg_payload
                .get("data")
                .and_then(|data| data.get("programs"))
                .and_then(Value::as_array)
                .and_then(|items| items.first())
                .and_then(|item| item.get("title"))
                .and_then(Value::as_str),
            Some("朝闻天下")
        );

        let sources_response = app
            .oneshot(
                Request::builder()
                    .uri("/api/live/sources")
                    .body(Body::empty())
                    .expect("live sources request"),
            )
            .await
            .expect("live sources response");

        assert_eq!(sources_response.status(), StatusCode::OK);
        let sources_body = to_bytes(sources_response.into_body(), usize::MAX)
            .await
            .expect("live sources body");
        let sources_payload: Value =
            serde_json::from_slice(&sources_body).expect("live sources payload json");
        assert_eq!(
            sources_payload
                .get("data")
                .and_then(Value::as_array)
                .and_then(|items| items.first())
                .and_then(|item| item.get("channelNumber"))
                .and_then(Value::as_u64),
            Some(1)
        );

        upstream.abort();
    }

    #[tokio::test]
    async fn live_proxy_m3u8_endpoint_rewrites_proxy_urls() {
        let upstream = spawn_mock_server(mock_upstream_router()).await;
        let temp_dir = TestDir::new();
        let config_path = write_test_config(
            &temp_dir,
            json!({
              "cache_time": 7200,
              "api_site": {},
              "lives": {
                "news": {
                  "name": "News",
                  "url": format!("{}/live/source.m3u", upstream.base_url()),
                  "ua": "Custom Live UA"
                }
              }
            }),
        );
        let app = build_router(AppState::new(
            DEFAULT_HOST.to_string(),
            DEFAULT_PORT,
            config_path,
            temp_dir.path.join("data"),
            temp_dir.path.join("data/moontv.sqlite3"),
        ));
        let manifest_url = format!("{}/live/index.m3u8", upstream.base_url());
        let service_url = format!(
            "/api/proxy/m3u8?moontv-source=news&url={}",
            form_urlencoded::byte_serialize(manifest_url.as_bytes()).collect::<String>()
        );

        let response = app
            .oneshot(
                Request::builder()
                    .uri(service_url)
                    .body(Body::empty())
                    .expect("live proxy m3u8 request"),
            )
            .await
            .expect("live proxy m3u8 response");

        assert_eq!(response.status(), StatusCode::OK);
        let body = to_bytes(response.into_body(), usize::MAX)
            .await
            .expect("live proxy m3u8 body");
        let manifest = String::from_utf8(body.to_vec()).expect("live manifest utf8");

        assert!(manifest.contains("http://127.0.0.1:8787/media/live/segment"));
        assert!(manifest.contains("http://127.0.0.1:8787/media/live/key"));
        assert!(manifest.contains("moontv-source=news"));

        upstream.abort();
    }

    #[tokio::test]
    async fn live_precheck_endpoint_detects_mp4_streams() {
        let upstream = spawn_mock_server(mock_upstream_router()).await;
        let temp_dir = TestDir::new();
        let config_path = write_test_config(
            &temp_dir,
            json!({
              "cache_time": 7200,
              "api_site": {},
              "lives": {
                "news": {
                  "name": "News",
                  "url": format!("{}/live/source.m3u", upstream.base_url()),
                  "ua": "Custom Live UA"
                }
              }
            }),
        );
        let app = build_router(AppState::new(
            DEFAULT_HOST.to_string(),
            DEFAULT_PORT,
            config_path,
            temp_dir.path.join("data"),
            temp_dir.path.join("data/moontv.sqlite3"),
        ));
        let live_url = format!("{}/live/precheck.mp4", upstream.base_url());
        let service_url = format!(
            "/api/live/precheck?moontv-source=news&url={}",
            form_urlencoded::byte_serialize(live_url.as_bytes()).collect::<String>()
        );

        let response = app
            .oneshot(
                Request::builder()
                    .uri(service_url)
                    .body(Body::empty())
                    .expect("live precheck request"),
            )
            .await
            .expect("live precheck response");

        assert_eq!(response.status(), StatusCode::OK);
        let body = to_bytes(response.into_body(), usize::MAX)
            .await
            .expect("live precheck body");
        let payload: Value = serde_json::from_slice(&body).expect("live precheck payload json");
        assert_eq!(payload.get("type").and_then(Value::as_str), Some("mp4"));

        upstream.abort();
    }

    #[test]
    fn parse_douban_ids_dedupes_and_limits() {
        let ids = parse_douban_ids(Some(
            "1,2,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21",
        ));

        assert_eq!(ids.len(), MAX_DOUBAN_RATING_IDS_PER_REQUEST);
        assert_eq!(ids.first().copied(), Some(1));
        assert_eq!(ids.last().copied(), Some(20));
    }

    #[tokio::test]
    async fn vod_m3u8_endpoint_rewrites_proxy_urls() {
        let upstream = spawn_mock_server(mock_upstream_router()).await;
        let temp_dir = TestDir::new();
        let config_path = write_test_config(
            &temp_dir,
            json!({
              "cache_time": 7200,
              "api_site": {
                "mock": {
                  "api": format!("{}/api.php/provide/vod", upstream.base_url()),
                  "name": "Mock Resource"
                }
              }
            }),
        );
        let app = build_router(AppState::new(
            DEFAULT_HOST.to_string(),
            DEFAULT_PORT,
            config_path,
            temp_dir.path.join("data"),
            temp_dir.path.join("data/moontv.sqlite3"),
        ));
        let manifest_url = format!("{}/upstream/master.m3u8", upstream.base_url());
        let service_url = format!(
            "/media/vod/m3u8?source=mock&url={}",
            form_urlencoded::byte_serialize(manifest_url.as_bytes()).collect::<String>()
        );

        let response = app
            .oneshot(
                Request::builder()
                    .uri(service_url)
                    .body(Body::empty())
                    .expect("vod request"),
            )
            .await
            .expect("vod response");

        assert_eq!(response.status(), StatusCode::OK);
        let body = to_bytes(response.into_body(), usize::MAX)
            .await
            .expect("manifest body");
        let manifest = String::from_utf8(body.to_vec()).expect("manifest utf8");

        assert!(manifest.contains("http://127.0.0.1:8787/media/vod/segment"));
        assert!(manifest.contains("http://127.0.0.1:8787/media/vod/key"));

        upstream.abort();
    }

    #[tokio::test]
    async fn vod_segment_endpoint_preserves_range_headers() {
        let upstream = spawn_mock_server(mock_upstream_router()).await;
        let temp_dir = TestDir::new();
        let config_path = write_test_config(
            &temp_dir,
            json!({
              "cache_time": 7200,
              "api_site": {
                "mock": {
                  "api": format!("{}/api.php/provide/vod", upstream.base_url()),
                  "name": "Mock Resource"
                }
              }
            }),
        );
        let app = build_router(AppState::new(
            DEFAULT_HOST.to_string(),
            DEFAULT_PORT,
            config_path,
            temp_dir.path.join("data"),
            temp_dir.path.join("data/moontv.sqlite3"),
        ));
        let segment_url = format!("{}/upstream/segment.ts", upstream.base_url());
        let service_url = format!(
            "/media/vod/segment?source=mock&url={}",
            form_urlencoded::byte_serialize(segment_url.as_bytes()).collect::<String>()
        );

        let response = app
            .oneshot(
                Request::builder()
                    .uri(service_url)
                    .header(RANGE, "bytes=0-3")
                    .body(Body::empty())
                    .expect("segment request"),
            )
            .await
            .expect("segment response");

        assert_eq!(response.status(), StatusCode::PARTIAL_CONTENT);
        assert_eq!(
            response
                .headers()
                .get(CONTENT_RANGE)
                .and_then(|value| value.to_str().ok()),
            Some("bytes 0-3/8")
        );
        assert_eq!(
            response
                .headers()
                .get(ACCEPT_RANGES)
                .and_then(|value| value.to_str().ok()),
            Some("bytes")
        );

        upstream.abort();
    }

    fn mock_upstream_router() -> Router {
        Router::new()
      .route(
        "/api.php/provide/vod",
        get(|Query(params): Query<BTreeMap<String, String>>| async move {
          let ids = params.get("ids").cloned().unwrap_or_default();
          if !ids.is_empty() {
            Json(json!({
              "list": [{
                "vod_name": "Mock Detail",
                "vod_pic": "https://img.example.com/detail.jpg",
                "vod_play_url": "第1集$https://cdn.example.com/mock/index.m3u8",
                "vod_year": "2026",
                "type_name": "电影"
              }]
            }))
            .into_response()
          } else {
            Json(json!({
              "pagecount": 1,
              "list": [{
                "vod_id": "1",
                "vod_name": "Mock Search Result",
                "vod_pic": "https://img.example.com/search.jpg",
                "vod_play_url": "第1集$https://cdn.example.com/mock/index.m3u8",
                "vod_year": "2026",
                "vod_content": "正常结果",
                "type_name": "电影"
              }]
            }))
            .into_response()
          }
        }),
      )
      .route(
        "/upstream/master.m3u8",
        get(|| async move {
          (
            [(CONTENT_TYPE, "application/vnd.apple.mpegurl")],
            "#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI=\"enc.key\"\n#EXTINF:4.0,\nsegment.ts\n",
          )
        }),
      )
      .route(
        "/upstream/segment.ts",
        get(|headers: HeaderMap| async move {
          if headers
            .get(RANGE)
            .and_then(|value| value.to_str().ok())
            == Some("bytes=0-3")
          {
            (
              StatusCode::PARTIAL_CONTENT,
              [
                (CONTENT_TYPE, "video/mp2t"),
                (CONTENT_LENGTH, "4"),
                (ACCEPT_RANGES, "bytes"),
                (CONTENT_RANGE, "bytes 0-3/8"),
              ],
              "mock",
            )
              .into_response()
          } else {
            (
              StatusCode::OK,
              [
                (CONTENT_TYPE, "video/mp2t"),
                (CONTENT_LENGTH, "8"),
                (ACCEPT_RANGES, "bytes"),
              ],
              "mockdata",
            )
              .into_response()
          }
        }),
      )
      .route(
        "/upstream/enc.key",
        get(|| async move {
          (
            [(CONTENT_TYPE, "application/octet-stream")],
            vec![0_u8, 1, 2, 3],
          )
        }),
      )
      .route(
        "/live/source.m3u",
        get(|| async move {
          (
            [(CONTENT_TYPE, "application/vnd.apple.mpegurl")],
            "#EXTM3U\n#EXTINF:-1 tvg-id=\"cctv1\" tvg-name=\"CCTV-1\" tvg-logo=\"/live/logo.png\" group-title=\"央视频道\",CCTV-1\nhttps://stream.example.com/cctv1/index.m3u8\n",
          )
        }),
      )
      .route(
        "/live/index.m3u8",
        get(|| async move {
          (
            [(CONTENT_TYPE, "application/vnd.apple.mpegurl")],
            "#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI=\"enc.key\"\n#EXTINF:4.0,\nsegment0.ts\n",
          )
        }),
      )
      .route(
        "/live/segment0.ts",
        get(|headers: HeaderMap| async move {
          if headers
            .get(RANGE)
            .and_then(|value| value.to_str().ok())
            == Some("bytes=0-3")
          {
            (
              StatusCode::PARTIAL_CONTENT,
              [
                (CONTENT_TYPE, "video/mp2t"),
                (CONTENT_LENGTH, "4"),
                (ACCEPT_RANGES, "bytes"),
                (CONTENT_RANGE, "bytes 0-3/8"),
              ],
              "live",
            )
              .into_response()
          } else {
            (
              StatusCode::OK,
              [
                (CONTENT_TYPE, "video/mp2t"),
                (CONTENT_LENGTH, "8"),
                (ACCEPT_RANGES, "bytes"),
              ],
              "livedata",
            )
              .into_response()
          }
        }),
      )
      .route(
        "/live/enc.key",
        get(|| async move {
          (
            [(CONTENT_TYPE, "application/octet-stream")],
            vec![4_u8, 5, 6, 7],
          )
        }),
      )
      .route(
        "/live/logo.png",
        get(|| async move {
          (
            [(CONTENT_TYPE, "image/png")],
            vec![137_u8, 80, 78, 71],
          )
        }),
      )
      .route(
        "/live/precheck.mp4",
        get(|| async move {
          (
            [(CONTENT_TYPE, "video/mp4")],
            vec![0_u8, 1, 2, 3],
          )
        }),
      )
      .route(
        "/epg.xml",
        get(|| async move {
          (
            [(CONTENT_TYPE, "application/xml")],
            r#"<?xml version="1.0" encoding="UTF-8"?><tv><programme start="20260608080000 +0800" stop="20260608090000 +0800" channel="cctv1"><title lang="zh">朝闻天下</title></programme></tv>"#,
          )
        }),
      )
      .route(
        "/calendar",
        get(|| async move {
          Json(json!([
            {
              "weekday": {
                "en": "Mon"
              },
              "items": [{
                "id": 1,
                "name": "Mock Bangumi",
                "name_cn": "模拟番剧",
                "rating": {
                  "score": 8.1
                },
                "air_date": "2026-06-09",
                "images": {
                  "large": "https://img.example.com/bangumi-large.jpg",
                  "common": "https://img.example.com/bangumi-common.jpg",
                  "medium": "https://img.example.com/bangumi-medium.jpg",
                  "small": "https://img.example.com/bangumi-small.jpg",
                  "grid": "https://img.example.com/bangumi-grid.jpg"
                }
              }]
            }
          ]))
        }),
      )
    }

    async fn spawn_mock_server(router: Router) -> MockServerHandle {
        let listener = TcpListener::bind("127.0.0.1:0")
            .await
            .expect("bind mock server");
        let address = listener.local_addr().expect("mock server address");
        let task = tokio::spawn(async move {
            axum::serve(listener, router)
                .await
                .expect("mock server exited");
        });

        MockServerHandle { address, task }
    }

    struct MockServerHandle {
        address: std::net::SocketAddr,
        task: tokio::task::JoinHandle<()>,
    }

    impl MockServerHandle {
        fn base_url(&self) -> String {
            format!("http://{}", self.address)
        }

        fn abort(self) {
            self.task.abort();
        }
    }

    struct TestDir {
        path: PathBuf,
    }

    impl TestDir {
        fn new() -> Self {
            static COUNTER: AtomicU64 = AtomicU64::new(0);

            let path = env::temp_dir().join(format!(
                "lunatv-local-service-tests-{}-{}",
                std::process::id(),
                COUNTER.fetch_add(1, Ordering::Relaxed)
            ));
            fs::create_dir_all(&path).expect("create test dir");
            Self { path }
        }
    }

    impl Drop for TestDir {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.path);
        }
    }

    fn write_test_config(dir: &TestDir, payload: Value) -> PathBuf {
        let path = dir.path.join("desktop.config.json");
        fs::write(
            &path,
            serde_json::to_string_pretty(&payload).expect("serialize config"),
        )
        .expect("write config");
        path
    }
}
