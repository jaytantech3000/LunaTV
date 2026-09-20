use std::{
    collections::{BTreeMap, BTreeSet, HashMap},
    convert::Infallible,
    env, fs,
    io::{Read, Write},
    path::{Path, PathBuf},
    sync::{Arc, Mutex as StdMutex, OnceLock, Weak},
    time::{Duration, SystemTime, UNIX_EPOCH},
};

use aes::{
    Aes256,
    cipher::{BlockDecryptMut, BlockEncryptMut, KeyIvInit, block_padding::Pkcs7},
};
use anyhow::{Context, Result};
use argon2::{
    Argon2,
    password_hash::{PasswordHasher, SaltString},
};
use axum::{
    Json, Router,
    body::{Body, to_bytes},
    extract::{FromRequest, Multipart, OriginalUri, Query, Request, State},
    http::{
        HeaderMap, HeaderName, HeaderValue, Method, StatusCode,
        header::{
            ACCEPT_ENCODING, ACCEPT_RANGES, ACCESS_CONTROL_ALLOW_HEADERS,
            ACCESS_CONTROL_ALLOW_METHODS, ACCESS_CONTROL_ALLOW_ORIGIN,
            ACCESS_CONTROL_EXPOSE_HEADERS, CACHE_CONTROL, CONTENT_DISPOSITION, CONTENT_ENCODING,
            CONTENT_LENGTH, CONTENT_RANGE, CONTENT_TYPE, ORIGIN, RANGE, REFERER, USER_AGENT,
        },
    },
    middleware::{self, Next},
    response::{
        IntoResponse, Response,
        sse::{Event, Sse},
    },
    routing::{any, delete, get, post, put},
};
use base64::{Engine as _, engine::general_purpose::STANDARD as BASE64_STANDARD};
use cbc::{Decryptor, Encryptor};
use clap::Parser;
use flate2::{Compression, read::GzDecoder, write::GzEncoder};
use futures::{future::join_all, stream};
#[cfg(target_os = "windows")]
use hyper::body::Incoming;
#[cfg(target_os = "windows")]
use hyper::server::conn::http1;
#[cfg(target_os = "windows")]
use hyper_util::{rt::TokioIo, service::TowerToHyperService};
use md5::Md5;
use moontv_download::{DesktopDownloadEngine, DesktopDownloadEngineSnapshot};
use moontv_profile::{LocalDesktopProfileStore, ProfileDomain};
use moontv_storage::sqlite::{DesktopSqlite, SqliteDatabaseInfo};
use moontv_sync::{
    PROFILE_SYNC_ADMIN_SETTINGS_DOMAIN, PROFILE_SYNC_USER_DATA_DOMAINS, ProfileSyncClient,
    ProfileSyncSession, ProfileSyncStatusResponse, default_profile_sync_selected_domains,
};
use rand::Rng;
use regex::Regex;
use reqwest::header::HeaderMap as ReqwestHeaderMap;
use serde::{Deserialize, Serialize, de::DeserializeOwned};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use time::{Duration as TimeDuration, OffsetDateTime, format_description::well_known::Rfc3339};
use tokio::net::TcpListener;
use tokio::sync::{Mutex, RwLock, watch};
#[cfg(target_os = "windows")]
use tower::ServiceExt;
use tracing::{info, warn};
use url::{Url, form_urlencoded};

mod content_detail;
mod content_search;
mod download_runtime;
mod image_cache;
mod image_proxy;
mod live_proxy;
mod online_vod_cache;
mod playback_prefetch;
mod profile_local;
mod profile_sync;
mod profile_sync_onboarding;
mod profile_sync_worker;
mod vod_prefetch;
mod vod_proxy;

pub(crate) use content_search::{search_all_sites, search_site};

use download_runtime::{
    DesktopDownloadCacheEntry, DesktopDownloadResourceIndexRecord, build_cached_download_response,
    cancel_download_runtime_task, clear_download_runtime_cache,
    clear_download_runtime_resource_indexes, clear_download_runtime_store_snapshot,
    clear_download_runtime_tasks, delete_download_runtime_cache,
    delete_download_runtime_resource_index, delete_download_runtime_task,
    fetch_download_runtime_cache_response, get_download_runtime_cache_meta,
    get_download_runtime_cache_response, get_download_runtime_resource_index,
    get_download_runtime_storage_info, get_download_runtime_store_snapshot,
    get_download_runtime_task, get_download_runtime_tasks, pause_download_runtime_task,
    post_download_runtime_task, post_download_runtime_task_bulk_command,
    put_download_runtime_cache, put_download_runtime_resource_index,
    put_download_runtime_store_snapshot, put_download_runtime_task_settings,
    resolve_download_runtime_manifest, resume_download_runtime_task, retry_download_runtime_task,
    schedule_download_runtime_processing, stream_download_runtime_tasks,
};
use image_cache::{CachedImage, ImageCache};
use image_proxy::get_image_proxy;
use live_proxy::{get_live_key, get_live_logo, get_live_m3u8, get_live_precheck, get_live_segment};
use online_vod_cache::{
    CachedOnlineVodAsset, OnlineVodCache, OnlineVodCachePolicy, OnlineVodCacheWriter,
};
use profile_sync::{
    build_profile_sync_status_payload, get_profile_bootstrap, get_profile_sync_server_config,
    get_profile_sync_status, proxy_profile_sync_change_password, proxy_profile_sync_favorites,
    proxy_profile_sync_follows, proxy_profile_sync_login, proxy_profile_sync_logout,
    proxy_profile_sync_passthrough, proxy_profile_sync_playrecords,
    proxy_profile_sync_search_history, proxy_profile_sync_skip_configs,
};
use profile_sync_onboarding::{
    execute_profile_sync_onboarding, post_profile_sync_sync_now, preview_profile_sync_onboarding,
};
use vod_prefetch::{
    VodPrefetchManager, get_vod_prefetch_session, post_vod_prefetch_advance,
    post_vod_prefetch_retry, post_vod_prefetch_session, stop_vod_prefetch_session,
};
use vod_proxy::{get_vod_key, get_vod_m3u8, get_vod_segment};

const DEFAULT_HOST: &str = "127.0.0.1";
const DEFAULT_PORT: u16 = 8787;
const LOCAL_SERVICE_ACCESS_TOKEN_HEADER: &str = "x-moontv-local-token";
const LOCAL_SERVICE_ADMIN_CAPABILITY_HEADER: &str = "x-moontv-admin-capability";
const DEFAULT_CONFIG_FILE_NAME: &str = "config.example.json";
const DEFAULT_DATA_DIR_NAME: &str = ".lunatv-desktop";
const DEFAULT_SQLITE_FILE_NAME: &str = "moontv-desktop.sqlite3";
const ADMIN_PERSISTENCE_FILE_NAME: &str = "desktop-admin-state.json";
const ADMIN_PERSISTENCE_METADATA_KEY: &str = "desktop:admin-persistence";
const DEFAULT_DESKTOP_OWNER_USERNAME: &str = "admin";
const DOWNLOAD_RUNTIME_DIR_NAME: &str = "download-runtime";
const DOWNLOAD_RUNTIME_CACHE_BODY_DIR_NAME: &str = "cache-body";
const DOWNLOAD_RUNTIME_CACHE_META_DIR_NAME: &str = "cache-meta";
const DOWNLOAD_RUNTIME_RESOURCE_INDEX_DIR_NAME: &str = "resource-index";
const DOWNLOAD_RUNTIME_STORE_FILE_NAME: &str = "download-store.json";
const DOWNLOAD_ENGINE_SNAPSHOT_METADATA_KEY: &str = "desktop:download-engine-snapshot";
const DEFAULT_CACHE_TIME: u64 = 7200;
const DEFAULT_SEARCH_MAX_PAGES: usize = 5;
const DEFAULT_SEARCH_TIMEOUT_MS: u64 = 8_000;
const DEFAULT_DETAIL_TIMEOUT_MS: u64 = 10_000;
const DEFAULT_PROXY_TIMEOUT_MS: u64 = 15_000;
const DEFAULT_WEB_UA: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";
pub(crate) const DOWNLOAD_RUNTIME_ERROR_RESOURCE_RESPONSE_READ_FAILED: &str =
    "download_runtime_resource_response_read_failed";
const DESKTOP_CONFIG_SUBSCRIPTION_REFRESH_CHECK_INTERVAL: Duration = Duration::from_secs(5 * 60);
const DESKTOP_CONFIG_SUBSCRIPTION_REFRESH_MIN_INTERVAL: TimeDuration = TimeDuration::hours(1);
const DESKTOP_LOCAL_DATA_MIGRATION_NOTE: &str = "桌面本地模式仅迁移管理员配置和本地账号密码；播放记录、收藏、搜索历史与跳过片头片尾等浏览器本地数据不会导入或导出。";
const OPENSSL_SALTED_PREFIX: &[u8; 8] = b"Salted__";
const DEFAULT_LIVE_PROXY_USER_AGENT: &str = "AptvPlayer/1.4.10";
const DEFAULT_BANGUMI_API_BASE_URL: &str = "https://api.bgm.tv";
const DEFAULT_DOUBAN_API_BASE_URL: &str = "https://m.douban.com";
const DEFAULT_DOUBAN_MOVIE_API_BASE_URL: &str = "https://movie.douban.com";
const DEFAULT_DOUBAN_SEARCH_API_BASE_URL: &str = "https://search.douban.com";
const DEFAULT_SITE_NAME: &str = "MoonTV";
const DEFAULT_SITE_ANNOUNCEMENT: &str = "本网站仅提供影视信息搜索服务，所有内容均来自第三方网站。本站不存储任何视频资源，不对任何内容的准确性、合法性、完整性负责。";
const DEFAULT_DOUBAN_PROXY_TYPE: &str = "cmliussss-cdn-tencent";
const DEFAULT_DOUBAN_IMAGE_PROXY_TYPE: &str = "cmliussss-cdn-tencent";
const MAX_DOUBAN_RATING_IDS_PER_REQUEST: usize = 20;
const DOUBAN_SEARCH_PAGE_SIZE: usize = 15;
const MAX_DOUBAN_SEARCH_LIMIT: usize = 60;
#[cfg(target_os = "windows")]
const WINDOWS_SELF_PROBE_DELAY: Duration = Duration::from_millis(250);
#[cfg(target_os = "windows")]
const WINDOWS_SELF_PROBE_TIMEOUT: Duration = Duration::from_millis(750);

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

const DEFAULT_VOD_AD_FILTER_MIN_DURATION: f64 = 3.0;
const DEFAULT_VOD_AD_FILTER_MAX_DURATION: f64 = 120.0;
const DEFAULT_VOD_AD_FILTER_MAX_SEGMENTS: usize = 15;

const VOD_AD_FILTER_DOMAIN_PATTERNS: &[&str] = &[
    "doubleclick",
    "googlesyndication",
    "googleadservices",
    "adsystem",
    "adservice",
    "baidu.com/adm",
    "pos.baidu.com",
    "cpro.baidu",
    "eclick.baidu",
    "baidustatic.com/adm",
    "gdt.qq.com",
    "l.qq.com",
    "e.qq.com",
    "adsmind.gdtimg",
    "tanx.com",
    "alimama.com",
    "mmstat.com",
    "atanx.alicdn",
    "ykad.",
    "ykimg.com/material",
    "iusmob.",
    "pangle.",
    "pangolin.",
    "bytedance.com/ad",
    "oceanengine.",
    "csjad.",
    "iqiyiad.",
    "iqiyi.com/cupid",
    "cupid.iqiyi",
    "iqiyi.hbuioo.com",
    "mgtvad.",
    "admaster.",
    "miaozhen.",
    "adcdn.",
    "ad-cdn.",
    "/ad/",
    "/ads/",
    "advert",
    "adsrv",
    "adpush",
    "adx.",
    "dsp.",
    "rtb.",
    "ssp.",
    "tracking",
    "analytics",
    "commercial",
    "insert.",
    "preroll",
    "midroll",
    "postroll",
    "ffzyad",
    "vip.ffzyad.com",
    "bytegoofy.com",
    "mimg.0c1q0l.cn",
    "mc.usihnbcq.cn",
    "wan.51img1.com",
    "casino",
    "macau",
    "aomen",
    "gambling",
    "bet365",
    "1xbet",
    "188bet",
    "22bet",
    "bookmaker",
    "sportsbook",
];

const VOD_AD_FILTER_SAFE_DOMAINS: &[&str] = &[
    "hhuus.com",
    "bvvvvvvvvv1f.com",
    "play-cdn",
    "modujx",
    "ffzy",
    "sdzy",
    "wujin",
    "heimuer",
    "lzizy",
    "alicdn.com",
    "aliyuncs.com",
    "aliyun",
    "qcloud",
    "myqcloud.com",
    "ksyun",
    "ks-cdn",
    "huaweicloud",
    "hwcdn",
    "baidubce",
    "bcebos.com",
    "cdn.bcebos",
    "cdn.jsdelivr",
    "bootcdn",
    "staticfile",
    "unpkg",
    "cdnjs",
];

const FORCE_VOD_AD_DOMAIN_PATTERNS: &[&str] = &[
    "ffzyad",
    "vip.ffzyad.com",
    "bytegoofy.com",
    "mimg.0c1q0l.cn",
    "mc.usihnbcq.cn",
    "wan.51img1.com",
    "iqiyi.hbuioo.com",
    "casino",
    "macau",
    "aomen",
    "gambling",
    "bet365",
    "1xbet",
    "188bet",
    "22bet",
    "bookmaker",
    "sportsbook",
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
    #[arg(long)]
    pub access_token: Option<String>,
    #[arg(long)]
    pub admin_capability: Option<String>,
}

#[derive(Clone, Debug)]
pub struct AppState {
    host: String,
    port: u16,
    public_base_url: String,
    config_path: PathBuf,
    data_dir: PathBuf,
    sqlite_path: PathBuf,
    sqlite: DesktopSqlite,
    client: reqwest::Client,
    download_client: reqwest::Client,
    image_client: reqwest::Client,
    image_cache: ImageCache,
    online_vod_cache: OnlineVodCache,
    vod_prefetch: VodPrefetchManager,
    image_flights: Arc<Mutex<HashMap<String, Arc<ImageFlight>>>>,
    download_engine: Arc<RwLock<DesktopDownloadEngine>>,
    download_engine_snapshot_tx: watch::Sender<DesktopDownloadEngineSnapshot>,
    download_runtime_active_tasks: Arc<Mutex<BTreeSet<String>>>,
    download_runtime_schedule_lock: Arc<Mutex<()>>,
    profile_sync: ProfileSyncClient,
    profile_sync_session: Arc<RwLock<ProfileSyncSessionState>>,
    profile_sync_last_username: Arc<RwLock<Option<String>>>,
    profile_sync_worker_lock: Arc<Mutex<()>>,
    profile_mutation_locks: Arc<StdMutex<HashMap<String, Weak<Mutex<()>>>>>,
    access_token: Option<String>,
    admin_capability: Option<String>,
    bangumi_api_base_url: String,
    douban_api_base_url: String,
    douban_movie_api_base_url: String,
    douban_search_api_base_url: String,
    live_channels_cache: Arc<RwLock<BTreeMap<String, LiveChannelsCache>>>,
}

#[derive(Debug, Default)]
pub(crate) struct ProfileSyncSessionState {
    pub(crate) session: Option<ProfileSyncSession>,
    /// Reserved when a session-affecting request starts. Only the response for
    /// the current epoch may commit, so the latest initiated intent wins.
    pub(crate) generation: u64,
}

#[derive(Debug)]
struct ImageFlight {
    completion_tx: watch::Sender<Option<AppResult<CachedImage>>>,
    deadline: tokio::time::Instant,
}

struct ProfileMutationLock {
    key: String,
    lock: Arc<Mutex<()>>,
    locks: Arc<StdMutex<HashMap<String, Weak<Mutex<()>>>>>,
}

impl ProfileMutationLock {
    async fn lock(&self) -> tokio::sync::MutexGuard<'_, ()> {
        self.lock.lock().await
    }
}

impl Drop for ProfileMutationLock {
    fn drop(&mut self) {
        let Ok(mut locks) = self.locks.lock() else {
            return;
        };
        if Arc::strong_count(&self.lock) == 1
            && locks
                .get(&self.key)
                .and_then(Weak::upgrade)
                .is_some_and(|current| Arc::ptr_eq(&current, &self.lock))
        {
            locks.remove(&self.key);
        }
    }
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

        let state = Self::try_new(
            cli.host.clone(),
            cli.port,
            config_path,
            data_dir,
            sqlite_path,
        )?;
        let state = match cli.access_token.clone() {
            Some(access_token) => state.with_access_token(access_token),
            None => state,
        };
        Ok(match cli.admin_capability.clone() {
            Some(admin_capability) => state.with_admin_capability(admin_capability),
            None => state,
        })
    }

    pub fn new(
        host: String,
        port: u16,
        config_path: PathBuf,
        data_dir: PathBuf,
        sqlite_path: PathBuf,
    ) -> Self {
        Self::try_new(host, port, config_path, data_dir, sqlite_path)
            .expect("failed to initialize local service app state")
    }

    pub fn try_new(
        host: String,
        port: u16,
        config_path: PathBuf,
        data_dir: PathBuf,
        sqlite_path: PathBuf,
    ) -> Result<Self> {
        let public_base_url = format!("http://{host}:{port}");
        let sqlite = DesktopSqlite::initialize(&sqlite_path).with_context(|| {
            format!(
                "failed to initialize desktop sqlite foundation at {}",
                sqlite_path.display()
            )
        })?;
        let download_engine = DesktopDownloadEngine::from_snapshot(
            sqlite
                .read_app_metadata::<DesktopDownloadEngineSnapshot>(
                    DOWNLOAD_ENGINE_SNAPSHOT_METADATA_KEY,
                )?
                .unwrap_or_default(),
        );
        let (download_engine_snapshot_tx, _) = watch::channel(download_engine.snapshot());
        let image_cache = ImageCache::new(&data_dir).with_context(|| {
            format!(
                "failed to initialize image cache under {}",
                data_dir.display()
            )
        })?;
        let online_vod_cache = OnlineVodCache::new(&data_dir).with_context(|| {
            format!(
                "failed to initialize online VOD cache under {}",
                data_dir.display()
            )
        })?;
        let vod_prefetch = VodPrefetchManager::new(&data_dir, online_vod_cache.clone())
            .with_context(|| {
                format!(
                    "failed to initialize VOD prefetch state under {}",
                    data_dir.display()
                )
            })?;
        vod_prefetch
            .recover_stale_full_episode_session()
            .with_context(|| {
                format!(
                    "failed to recover stale VOD prefetch state under {}",
                    data_dir.display()
                )
            })?;
        let download_client = reqwest::Client::builder()
            .no_gzip()
            .no_brotli()
            .no_deflate()
            .no_zstd()
            .redirect(vod_upstream_redirect_policy())
            .build()
            .context("failed to build download http client")?;

        let state = Self {
            host,
            port,
            public_base_url,
            config_path,
            data_dir,
            sqlite_path,
            sqlite,
            client: reqwest::Client::builder()
                .redirect(vod_upstream_redirect_policy())
                .build()
                .context("failed to build default http client")?,
            download_client,
            image_client: reqwest::Client::builder()
                .redirect(reqwest::redirect::Policy::none())
                .build()
                .expect("failed to build image proxy http client"),
            image_cache,
            online_vod_cache,
            vod_prefetch,
            image_flights: Arc::new(Mutex::new(HashMap::new())),
            download_engine: Arc::new(RwLock::new(download_engine)),
            download_engine_snapshot_tx,
            download_runtime_active_tasks: Arc::new(Mutex::new(BTreeSet::new())),
            download_runtime_schedule_lock: Arc::new(Mutex::new(())),
            profile_sync: ProfileSyncClient::new(reqwest::Client::new()),
            profile_sync_session: Arc::new(RwLock::new(ProfileSyncSessionState::default())),
            profile_sync_last_username: Arc::new(RwLock::new(None)),
            profile_sync_worker_lock: Arc::new(Mutex::new(())),
            profile_mutation_locks: Arc::new(StdMutex::new(HashMap::new())),
            access_token: None,
            admin_capability: None,
            bangumi_api_base_url: DEFAULT_BANGUMI_API_BASE_URL.to_string(),
            douban_api_base_url: DEFAULT_DOUBAN_API_BASE_URL.to_string(),
            douban_movie_api_base_url: DEFAULT_DOUBAN_MOVIE_API_BASE_URL.to_string(),
            douban_search_api_base_url: DEFAULT_DOUBAN_SEARCH_API_BASE_URL.to_string(),
            live_channels_cache: Arc::new(RwLock::new(BTreeMap::new())),
        };
        if state.config_path.is_file() {
            state.load_admin_persistence()?;
        }
        Ok(state)
    }

    fn bind_addr(&self) -> String {
        format!("{}:{}", effective_bind_host(&self.host), self.port)
    }

    pub(crate) fn public_base_url(&self) -> &str {
        &self.public_base_url
    }

    fn read_cached_image(&self, url: &str) -> AppResult<Option<CachedImage>> {
        self.image_cache.get(url).map_err(|error| {
            AppError::new(
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("failed to read image cache: {error}"),
            )
        })
    }

    fn write_cached_image(&self, url: &str, image: &CachedImage) -> AppResult<()> {
        self.image_cache.store(url, image).map_err(|error| {
            AppError::new(
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("failed to write image cache: {error}"),
            )
        })
    }

    pub(crate) fn read_cached_online_vod_asset(
        &self,
        request_url: &str,
    ) -> Option<CachedOnlineVodAsset> {
        match self
            .online_vod_cache
            .get(request_url, current_timestamp_ms())
        {
            Ok(asset) => asset,
            Err(error) => {
                warn!("online VOD cache read failed; falling back to upstream: {error}");
                None
            }
        }
    }

    fn begin_online_vod_cache_write(
        &self,
        request_url: &str,
        status: StatusCode,
        content_type: Option<&str>,
        expected_body_len: Option<u64>,
        policy: OnlineVodCachePolicy,
    ) -> Option<OnlineVodCacheWriter> {
        match self.online_vod_cache.begin_write(
            request_url,
            status.as_u16(),
            content_type,
            expected_body_len,
            policy,
            current_timestamp_ms(),
            None,
        ) {
            Ok(writer) => writer,
            Err(error) => {
                warn!("online VOD cache initialization failed; continuing without cache: {error}");
                None
            }
        }
    }

    fn cache_online_vod_asset(
        &self,
        request_url: &str,
        status: StatusCode,
        content_type: Option<&str>,
        body: &[u8],
        policy: OnlineVodCachePolicy,
    ) {
        if let Err(error) = self.online_vod_cache.store(
            request_url,
            status.as_u16(),
            content_type,
            body,
            policy,
            current_timestamp_ms(),
        ) {
            warn!("online VOD cache write failed; playback response was preserved: {error}");
        }
    }

    pub(crate) fn cache_online_vod_prefetch_asset(
        &self,
        request_url: &str,
        status: StatusCode,
        content_type: Option<&str>,
        body: &[u8],
        policy: OnlineVodCachePolicy,
        prefetch_session_id: Option<&str>,
    ) -> AppResult<()> {
        self.online_vod_cache
            .store_for_prefetch_session(
                request_url,
                status.as_u16(),
                content_type,
                body,
                policy,
                current_timestamp_ms(),
                prefetch_session_id,
            )
            .map_err(|error| {
                AppError::new(
                    StatusCode::INTERNAL_SERVER_ERROR,
                    format!("failed to write online VOD cache: {error}"),
                )
            })
    }

    async fn acquire_image_flight(
        &self,
        url: &str,
    ) -> (
        Arc<ImageFlight>,
        Option<watch::Receiver<Option<AppResult<CachedImage>>>>,
        bool,
    ) {
        let mut flights = self.image_flights.lock().await;
        if let Some(flight) = flights.get(url) {
            return (
                flight.clone(),
                Some(flight.completion_tx.subscribe()),
                false,
            );
        }
        let (completion_tx, _) = watch::channel(None);
        let flight = Arc::new(ImageFlight {
            completion_tx,
            deadline: tokio::time::Instant::now() + image_proxy::IMAGE_PROXY_TIMEOUT,
        });
        flights.insert(url.to_string(), flight.clone());
        (flight, None, true)
    }

    async fn complete_image_flight(
        &self,
        url: &str,
        flight: &Arc<ImageFlight>,
        result: AppResult<CachedImage>,
    ) {
        let mut flights = self.image_flights.lock().await;
        if flights
            .get(url)
            .is_some_and(|active_flight| Arc::ptr_eq(active_flight, flight))
        {
            flight.completion_tx.send_replace(Some(result));
            flights.remove(url);
        }
    }

    pub fn with_access_token(mut self, access_token: String) -> Self {
        self.access_token = normalize_optional_string(Some(access_token));
        self
    }

    pub fn with_admin_capability(mut self, admin_capability: String) -> Self {
        self.admin_capability = normalize_optional_string(Some(admin_capability));
        self
    }

    fn load_config(&self) -> Result<ServiceConfig> {
        let persistence = self.load_admin_persistence()?;
        Ok(build_service_config_from_admin(
            &persistence.config,
            &persistence.profile_sync_api_base_url,
            &persistence.profile_sync_sync_domains,
        ))
    }

    fn admin_persistence_path(&self) -> PathBuf {
        self.data_dir.join(ADMIN_PERSISTENCE_FILE_NAME)
    }

    fn sqlite_info(&self) -> &SqliteDatabaseInfo {
        self.sqlite.info()
    }

    fn profile_store(&self) -> LocalDesktopProfileStore {
        LocalDesktopProfileStore::new(self.sqlite.clone())
    }

    fn acquire_profile_mutation_lock(
        &self,
        username: &str,
        domain: ProfileDomain,
    ) -> ProfileMutationLock {
        let key = format!("{username}:{}", domain.as_str());
        let mut locks = self
            .profile_mutation_locks
            .lock()
            .expect("profile mutation lock registry poisoned");
        locks.retain(|_, lock| lock.strong_count() > 0);

        let lock = locks.get(&key).and_then(Weak::upgrade).unwrap_or_else(|| {
            let lock = Arc::new(Mutex::new(()));
            locks.insert(key.clone(), Arc::downgrade(&lock));
            lock
        });

        ProfileMutationLock {
            key,
            lock,
            locks: self.profile_mutation_locks.clone(),
        }
    }

    fn write_download_engine_snapshot(
        &self,
        snapshot: &DesktopDownloadEngineSnapshot,
    ) -> Result<()> {
        self.sqlite
            .write_app_metadata(DOWNLOAD_ENGINE_SNAPSHOT_METADATA_KEY, snapshot)
    }

    fn publish_download_engine_snapshot(&self, snapshot: &DesktopDownloadEngineSnapshot) {
        self.download_engine_snapshot_tx
            .send_replace(snapshot.clone());
    }

    fn subscribe_download_engine_snapshots(
        &self,
    ) -> watch::Receiver<DesktopDownloadEngineSnapshot> {
        self.download_engine_snapshot_tx.subscribe()
    }

    fn download_runtime_dir(&self) -> PathBuf {
        self.data_dir.join(DOWNLOAD_RUNTIME_DIR_NAME)
    }

    fn download_runtime_cache_body_dir(&self) -> PathBuf {
        self.download_runtime_dir()
            .join(DOWNLOAD_RUNTIME_CACHE_BODY_DIR_NAME)
    }

    fn download_runtime_cache_meta_dir(&self) -> PathBuf {
        self.download_runtime_dir()
            .join(DOWNLOAD_RUNTIME_CACHE_META_DIR_NAME)
    }

    fn download_runtime_resource_index_dir(&self) -> PathBuf {
        self.download_runtime_dir()
            .join(DOWNLOAD_RUNTIME_RESOURCE_INDEX_DIR_NAME)
    }

    fn download_runtime_store_path(&self) -> PathBuf {
        self.download_runtime_dir()
            .join(DOWNLOAD_RUNTIME_STORE_FILE_NAME)
    }

    fn ensure_download_runtime_dirs(&self) -> Result<()> {
        fs::create_dir_all(self.download_runtime_cache_body_dir()).with_context(|| {
            format!(
                "failed to create {}",
                self.download_runtime_cache_body_dir().display()
            )
        })?;
        fs::create_dir_all(self.download_runtime_cache_meta_dir()).with_context(|| {
            format!(
                "failed to create {}",
                self.download_runtime_cache_meta_dir().display()
            )
        })?;
        fs::create_dir_all(self.download_runtime_resource_index_dir()).with_context(|| {
            format!(
                "failed to create {}",
                self.download_runtime_resource_index_dir().display()
            )
        })?;
        Ok(())
    }

    fn cached_download_body_path(&self, url: &str) -> PathBuf {
        self.download_runtime_cache_body_dir()
            .join(format!("{}.bin", stable_hash_key(url)))
    }

    fn cached_download_meta_path(&self, url: &str) -> PathBuf {
        self.download_runtime_cache_meta_dir()
            .join(format!("{}.json", stable_hash_key(url)))
    }

    fn resource_index_path(&self, id: &str) -> PathBuf {
        self.download_runtime_resource_index_dir()
            .join(format!("{}.json", stable_hash_key(id)))
    }

    fn write_cached_download(
        &self,
        url: &str,
        status: StatusCode,
        content_type: Option<&str>,
        body: &[u8],
    ) -> Result<DesktopDownloadCacheEntry> {
        if body.len() > MAX_DOWNLOAD_CACHE_ENTRY_BYTES {
            anyhow::bail!(
                "download cache entry exceeds {} bytes",
                MAX_DOWNLOAD_CACHE_ENTRY_BYTES
            );
        }

        self.ensure_download_runtime_dirs()?;
        let current_size = dir_files_size_bytes(&self.download_runtime_cache_body_dir());
        if current_size.saturating_add(body.len() as u64) > DOWNLOAD_RUNTIME_CACHE_MAX_BYTES {
            anyhow::bail!(
                "download cache quota exceeded ({} + {} > {})",
                current_size,
                body.len(),
                DOWNLOAD_RUNTIME_CACHE_MAX_BYTES
            );
        }

        let body_path = self.cached_download_body_path(url);
        let meta_path = self.cached_download_meta_path(url);
        let timestamp = current_timestamp_ms();
        let entry = DesktopDownloadCacheEntry {
            url: url.to_string(),
            status: status.as_u16(),
            content_type: normalize_optional_text(content_type),
            size_bytes: body.len() as u64,
            created_at: timestamp,
            updated_at: timestamp,
        };

        // 先写 body，再写 meta；meta 是提交点。读侧先读 meta 再校验 body 长度，
        // 校验不过按未完成处理，避免读到 torn/半截数据。
        write_file_atomic(&body_path, body)?;
        let meta_contents =
            serde_json::to_vec(&entry).context("failed to encode download cache meta")?;
        write_file_atomic(&meta_path, &meta_contents)?;
        Ok(entry)
    }

    fn read_cached_download_entry(&self, url: &str) -> Result<Option<DesktopDownloadCacheEntry>> {
        let meta_path = self.cached_download_meta_path(url);
        if !meta_path.exists() {
            return Ok(None);
        }

        let entry: DesktopDownloadCacheEntry = read_json_file(&meta_path)?;
        if entry.url != url {
            return Ok(None);
        }

        let body_path = self.cached_download_body_path(url);
        match fs::metadata(&body_path) {
            // 校验已写入长度与 meta 一致，屏蔽非原子写留下的半截数据。
            Ok(metadata) if metadata.len() == entry.size_bytes => {}
            _ => return Ok(None),
        }

        Ok(Some(entry))
    }

    fn read_cached_download_body(&self, url: &str) -> Result<Option<Vec<u8>>> {
        let body_path = self.cached_download_body_path(url);
        if !body_path.exists() {
            return Ok(None);
        }

        let bytes = fs::read(&body_path)
            .with_context(|| format!("failed to read {}", body_path.display()))?;
        Ok(Some(bytes))
    }

    fn delete_cached_download(&self, url: &str) -> Result<bool> {
        let body_path = self.cached_download_body_path(url);
        let meta_path = self.cached_download_meta_path(url);
        let body_deleted = delete_if_exists(&body_path)?;
        let meta_deleted = delete_if_exists(&meta_path)?;
        Ok(body_deleted || meta_deleted)
    }

    fn clear_cached_downloads(&self) -> Result<()> {
        remove_dir_contents_if_exists(&self.download_runtime_cache_body_dir())?;
        remove_dir_contents_if_exists(&self.download_runtime_cache_meta_dir())?;
        Ok(())
    }

    fn write_resource_index(
        &self,
        record: &DesktopDownloadResourceIndexRecord,
    ) -> Result<DesktopDownloadResourceIndexRecord> {
        self.ensure_download_runtime_dirs()?;
        let path = self.resource_index_path(&record.id);
        write_json_file(&path, record)?;
        Ok(record.clone())
    }

    fn read_resource_index(&self, id: &str) -> Result<Option<DesktopDownloadResourceIndexRecord>> {
        let path = self.resource_index_path(id);
        if !path.exists() {
            return Ok(None);
        }

        let record: DesktopDownloadResourceIndexRecord = read_json_file(&path)?;
        if record.id != id {
            return Ok(None);
        }

        Ok(Some(record))
    }

    fn delete_resource_index(&self, id: &str) -> Result<bool> {
        delete_if_exists(&self.resource_index_path(id))
    }

    fn clear_resource_indexes(&self) -> Result<()> {
        remove_dir_contents_if_exists(&self.download_runtime_resource_index_dir())?;
        Ok(())
    }

    fn write_download_store_snapshot(&self, snapshot: &Value) -> Result<()> {
        self.sqlite.write_download_store_snapshot(snapshot)?;
        let legacy_path = self.download_runtime_store_path();
        if delete_if_exists(&legacy_path)? {
            info!(
                "removed legacy desktop download store snapshot file after sqlite write: {}",
                legacy_path.display()
            );
        }
        Ok(())
    }

    fn read_download_store_snapshot(&self) -> Result<Option<Value>> {
        if let Some(snapshot) = self.sqlite.read_download_store_snapshot()? {
            return Ok(Some(snapshot));
        }

        self.migrate_legacy_download_store_snapshot()
    }

    fn clear_download_store_snapshot(&self) -> Result<bool> {
        let sqlite_deleted = self.sqlite.clear_download_store_snapshot()?;
        let legacy_deleted = delete_if_exists(&self.download_runtime_store_path())?;
        Ok(sqlite_deleted || legacy_deleted)
    }

    fn migrate_legacy_download_store_snapshot(&self) -> Result<Option<Value>> {
        let legacy_path = self.download_runtime_store_path();
        if !legacy_path.exists() {
            return Ok(None);
        }

        let snapshot: Value = read_json_file(&legacy_path)?;
        self.sqlite.write_download_store_snapshot(&snapshot)?;
        delete_if_exists(&legacy_path)?;
        info!(
            "migrated legacy desktop download store snapshot from {} into {}",
            legacy_path.display(),
            self.sqlite.path().display()
        );
        Ok(Some(snapshot))
    }

    fn load_admin_persistence(&self) -> Result<DesktopAdminPersistence> {
        let (raw_contents, raw_config) = read_raw_service_config(&self.config_path)?;
        if let Some(persistence) = self
            .sqlite
            .read_app_metadata::<DesktopAdminPersistence>(ADMIN_PERSISTENCE_METADATA_KEY)?
        {
            delete_if_exists(&self.admin_persistence_path())?;
            return Ok(normalize_sqlite_admin_persistence(
                persistence,
                raw_contents,
                &raw_config,
            ));
        }

        let persistence =
            load_admin_persistence(&self.config_path, &self.admin_persistence_path())?;
        self.sqlite
            .write_app_metadata(ADMIN_PERSISTENCE_METADATA_KEY, &persistence)?;
        let legacy_path = self.admin_persistence_path();
        if delete_if_exists(&legacy_path)? {
            info!(
                "migrated legacy desktop admin persistence from {} into {}",
                legacy_path.display(),
                self.sqlite.path().display()
            );
        }
        Ok(persistence)
    }

    fn save_admin_persistence(&self, persistence: &DesktopAdminPersistence) -> Result<()> {
        self.sqlite
            .write_app_metadata(ADMIN_PERSISTENCE_METADATA_KEY, persistence)?;
        delete_if_exists(&self.admin_persistence_path())?;
        Ok(())
    }

    fn write_raw_config(&self, contents: &str) -> Result<()> {
        fs::write(&self.config_path, contents)
            .with_context(|| format!("failed to write {}", self.config_path.display()))
    }
}

#[derive(Debug, Deserialize, Default)]
struct RawServiceConfig {
    cache_time: Option<u64>,
    #[serde(default)]
    auth: RawAuthConfig,
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
    player_enhancements: RawPlayerEnhancementConfig,
    #[serde(default)]
    profile_sync: RawProfileSyncConfig,
    #[serde(default)]
    api_site: BTreeMap<String, RawApiSite>,
    #[serde(default)]
    custom_category: Vec<RawCustomCategory>,
    #[serde(default)]
    lives: BTreeMap<String, RawLiveSource>,
}

#[derive(Debug, Deserialize, Clone, Default)]
struct RawAuthConfig {
    username: Option<String>,
    #[allow(dead_code)]
    password: Option<String>,
}

#[derive(Debug, Deserialize, Clone)]
struct RawApiSite {
    api: String,
    name: String,
    detail: Option<String>,
    ua: Option<String>,
    referer: Option<String>,
    disabled: Option<bool>,
    disable_ad_filter: Option<bool>,
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

#[derive(Debug, Deserialize, Clone, Default)]
struct RawProfileSyncConfig {
    api_base_url: Option<String>,
    sync_domains: Option<Vec<String>>,
}

#[derive(Debug, Serialize, Deserialize, Clone, Copy, PartialEq, Eq, Default)]
#[serde(rename_all = "lowercase")]
enum PlayerEnhancementLevel {
    #[default]
    Off,
    Light,
    Standard,
    Strong,
}

impl PlayerEnhancementLevel {
    fn is_enabled(self) -> bool {
        self != Self::Off
    }

    fn resolve(level: Option<Self>, enabled: Option<bool>, fallback: Self) -> Self {
        if let Some(level) = level {
            return level;
        }

        match enabled {
            Some(true) => {
                if fallback == Self::Off {
                    Self::Standard
                } else {
                    fallback
                }
            }
            Some(false) => Self::Off,
            None => fallback,
        }
    }
}

#[derive(Debug, Deserialize, Clone, Default)]
struct RawPlayerEnhancementConfig {
    audio_spike_protection: Option<bool>,
    audio_spike_protection_level: Option<PlayerEnhancementLevel>,
    audio_dynamic_protection: Option<bool>,
    audio_fixed_ceiling: Option<bool>,
    visual_enhancement: Option<bool>,
    visual_enhancement_level: Option<PlayerEnhancementLevel>,
}

#[derive(Debug, Clone)]
struct ServiceConfig {
    cache_time: u64,
    max_search_pages: usize,
    adult_content_filter_enabled: bool,
    vod_ad_filter_enabled: bool,
    fluid_search: bool,
    player_audio_spike_protection: bool,
    player_audio_spike_protection_level: PlayerEnhancementLevel,
    player_audio_dynamic_protection: bool,
    player_audio_fixed_ceiling: bool,
    player_visual_enhancement: bool,
    player_visual_enhancement_level: PlayerEnhancementLevel,
    site_name: Option<String>,
    announcement: Option<String>,
    douban_proxy_type: Option<String>,
    douban_proxy: Option<String>,
    douban_image_proxy_type: Option<String>,
    douban_image_proxy: Option<String>,
    enable_web_live_override: Option<bool>,
    profile_sync_api_base_url: Option<String>,
    profile_sync_domains: Vec<String>,
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
    disabled: bool,
    disable_ad_filter: bool,
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

#[derive(Debug, Serialize, Clone, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct DoubanItem {
    id: String,
    title: String,
    poster: String,
    rate: String,
    year: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    play_type: Option<&'static str>,
}

#[derive(Debug, Serialize)]
struct DoubanResult {
    code: u16,
    message: &'static str,
    list: Vec<DoubanItem>,
}

#[derive(Debug, Deserialize)]
struct DoubanCategoryApiResponse {
    #[serde(default)]
    items: Vec<DoubanCategoryApiItem>,
}

#[derive(Debug, Deserialize)]
struct DoubanCategoryApiItem {
    id: String,
    title: String,
    #[serde(default)]
    card_subtitle: Option<String>,
    #[serde(default)]
    pic: Option<DoubanRemotePicture>,
    #[serde(default)]
    rating: Option<DoubanRemoteRating>,
}

#[derive(Debug, Deserialize)]
struct DoubanListApiResponse {
    #[serde(default)]
    subjects: Vec<DoubanListApiItem>,
}

#[derive(Debug, Deserialize)]
struct DoubanListApiItem {
    id: String,
    title: String,
    #[serde(default)]
    card_subtitle: Option<String>,
    #[serde(default)]
    cover: Option<String>,
    #[serde(default)]
    rate: Option<String>,
}

#[derive(Debug, Deserialize)]
struct DoubanRecommendApiResponse {
    #[serde(default)]
    items: Vec<DoubanRecommendApiItem>,
}

#[derive(Debug, Deserialize)]
struct DoubanRecommendApiItem {
    #[serde(default)]
    id: Option<String>,
    #[serde(default)]
    title: Option<String>,
    #[serde(default)]
    year: Option<String>,
    #[serde(rename = "type", default)]
    item_type: Option<String>,
    #[serde(default)]
    pic: Option<DoubanRemotePicture>,
    #[serde(default)]
    rating: Option<DoubanRemoteRating>,
}

#[derive(Debug, Deserialize)]
struct DoubanRemotePicture {
    #[serde(default)]
    large: Option<String>,
    #[serde(default)]
    normal: Option<String>,
}

#[derive(Debug, Deserialize)]
struct DoubanRemoteRating {
    #[serde(default)]
    value: Option<f64>,
    #[serde(default)]
    count: Option<u64>,
}

#[derive(Debug, Deserialize)]
struct DoubanSearchPageLabel {
    #[serde(default)]
    text: Option<String>,
}

#[derive(Debug, Deserialize)]
struct DoubanSearchPageItem {
    #[serde(default)]
    tpl_name: Option<String>,
    #[serde(default)]
    id: Option<i64>,
    #[serde(default)]
    title: Option<String>,
    #[serde(default)]
    cover_url: Option<String>,
    #[serde(default)]
    labels: Vec<DoubanSearchPageLabel>,
    #[serde(default)]
    rating: Option<DoubanRemoteRating>,
}

#[derive(Debug, Deserialize)]
struct DoubanSearchPageData {
    #[serde(default)]
    total: usize,
    #[serde(default)]
    items: Vec<DoubanSearchPageItem>,
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
    disable_yellow_filter: bool,
    fluid_search: bool,
    enable_web_live: bool,
    player_audio_spike_protection: bool,
    player_audio_spike_protection_level: PlayerEnhancementLevel,
    player_audio_dynamic_protection: bool,
    player_audio_fixed_ceiling: bool,
    player_visual_enhancement: bool,
    player_visual_enhancement_level: PlayerEnhancementLevel,
    profile_sync_enabled: bool,
    custom_categories: Vec<RuntimeCustomCategory>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct LocalAuthStatusResponse {
    username: String,
    password_required: bool,
    multi_user: bool,
    owner_password_configured: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ProfileBootstrapResponse {
    app_target: &'static str,
    runtime: RuntimePublicConfigResponse,
    profile_sync: ProfileSyncStatusResponse,
    local_auth: LocalAuthStatusResponse,
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

#[derive(Debug, Serialize, Deserialize, Clone)]
struct DesktopAdminPersistence {
    #[serde(default)]
    config: DesktopAdminConfig,
    #[serde(rename = "userPasswords", default)]
    user_passwords: BTreeMap<String, String>,
    #[serde(default)]
    profile_sync_api_base_url: Option<String>,
    #[serde(
        rename = "profileSyncSyncDomains",
        default = "default_profile_sync_selected_domains"
    )]
    profile_sync_sync_domains: Vec<String>,
}

impl Default for DesktopAdminPersistence {
    fn default() -> Self {
        Self {
            config: DesktopAdminConfig::default(),
            user_passwords: BTreeMap::new(),
            profile_sync_api_base_url: None,
            profile_sync_sync_domains: default_profile_sync_selected_domains(),
        }
    }
}

#[derive(Debug, Serialize, Deserialize, Clone)]
struct DesktopAdminConfig {
    #[serde(rename = "ConfigSubscribtion", default)]
    config_subscribtion: DesktopConfigSubscribtion,
    #[serde(rename = "ConfigFile", default)]
    config_file: String,
    #[serde(rename = "SiteConfig", default)]
    site_config: DesktopSiteConfig,
    #[serde(rename = "UserConfig", default)]
    user_config: DesktopUserConfig,
    #[serde(rename = "SourceConfig", default)]
    source_config: Vec<DesktopSourceConfigItem>,
    #[serde(rename = "CustomCategories", default)]
    custom_categories: Vec<DesktopCategoryConfigItem>,
    #[serde(rename = "LiveConfig", default)]
    live_config: Vec<DesktopLiveConfigItem>,
    #[serde(rename = "AdFilterConfig", default)]
    ad_filter_config: DesktopAdFilterConfig,
    #[serde(rename = "PlayerEnhancementConfig", default)]
    player_enhancement_config: DesktopPlayerEnhancementConfig,
}

impl Default for DesktopAdminConfig {
    fn default() -> Self {
        Self {
            config_subscribtion: DesktopConfigSubscribtion::default(),
            config_file: String::new(),
            site_config: DesktopSiteConfig::default(),
            user_config: DesktopUserConfig::default(),
            source_config: Vec::new(),
            custom_categories: Vec::new(),
            live_config: Vec::new(),
            ad_filter_config: DesktopAdFilterConfig::default(),
            player_enhancement_config: DesktopPlayerEnhancementConfig::default(),
        }
    }
}

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
struct DesktopConfigSubscribtion {
    #[serde(rename = "URL", default)]
    url: String,
    #[serde(rename = "AutoUpdate", default)]
    auto_update: bool,
    #[serde(rename = "LastCheck", default)]
    last_check: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
struct DesktopSiteConfig {
    #[serde(rename = "SiteName", default = "default_site_name")]
    site_name: String,
    #[serde(rename = "Announcement", default = "default_site_announcement")]
    announcement: String,
    #[serde(
        rename = "SearchDownstreamMaxPage",
        default = "default_search_max_pages"
    )]
    search_downstream_max_page: usize,
    #[serde(rename = "SiteInterfaceCacheTime", default = "default_cache_time")]
    site_interface_cache_time: u64,
    #[serde(rename = "DoubanProxyType", default = "default_douban_proxy_type")]
    douban_proxy_type: String,
    #[serde(rename = "DoubanProxy", default)]
    douban_proxy: String,
    #[serde(
        rename = "DoubanImageProxyType",
        default = "default_douban_image_proxy_type"
    )]
    douban_image_proxy_type: String,
    #[serde(rename = "DoubanImageProxy", default)]
    douban_image_proxy: String,
    #[serde(rename = "DisableYellowFilter", default)]
    disable_yellow_filter: bool,
    #[serde(rename = "FluidSearch", default = "default_fluid_search")]
    fluid_search: bool,
    #[serde(rename = "EnableWebLive", default)]
    enable_web_live: bool,
}

impl Default for DesktopSiteConfig {
    fn default() -> Self {
        Self {
            site_name: default_site_name(),
            announcement: default_site_announcement(),
            search_downstream_max_page: default_search_max_pages(),
            site_interface_cache_time: default_cache_time(),
            douban_proxy_type: default_douban_proxy_type(),
            douban_proxy: String::new(),
            douban_image_proxy_type: default_douban_image_proxy_type(),
            douban_image_proxy: String::new(),
            disable_yellow_filter: false,
            fluid_search: default_fluid_search(),
            enable_web_live: false,
        }
    }
}

#[derive(Debug, Serialize, Deserialize, Clone)]
struct DesktopAdFilterConfig {
    enabled: bool,
}

impl Default for DesktopAdFilterConfig {
    fn default() -> Self {
        Self { enabled: true }
    }
}

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
struct DesktopPlayerEnhancementConfig {
    #[serde(rename = "AudioSpikeProtection", default)]
    audio_spike_protection: bool,
    #[serde(
        rename = "AudioSpikeProtectionLevel",
        default,
        skip_serializing_if = "Option::is_none"
    )]
    audio_spike_protection_level: Option<PlayerEnhancementLevel>,
    #[serde(
        rename = "AudioDynamicProtection",
        default,
        skip_serializing_if = "Option::is_none"
    )]
    audio_dynamic_protection: Option<bool>,
    #[serde(
        rename = "AudioFixedCeiling",
        default,
        skip_serializing_if = "Option::is_none"
    )]
    audio_fixed_ceiling: Option<bool>,
    #[serde(rename = "VisualEnhancement", default)]
    visual_enhancement: bool,
    #[serde(
        rename = "VisualEnhancementLevel",
        default,
        skip_serializing_if = "Option::is_none"
    )]
    visual_enhancement_level: Option<PlayerEnhancementLevel>,
}

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
struct DesktopUserConfig {
    #[serde(rename = "Users", default)]
    users: Vec<DesktopUserConfigItem>,
    #[serde(rename = "Tags", default)]
    tags: Vec<DesktopUserTagConfigItem>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
struct DesktopUserConfigItem {
    username: String,
    role: String,
    #[serde(default)]
    banned: bool,
    #[serde(rename = "enabledApis", default)]
    enabled_apis: Vec<String>,
    #[serde(default)]
    tags: Vec<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
struct DesktopUserTagConfigItem {
    name: String,
    #[serde(rename = "enabledApis", default)]
    enabled_apis: Vec<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
struct DesktopSourceConfigItem {
    key: String,
    name: String,
    api: String,
    detail: Option<String>,
    ua: Option<String>,
    referer: Option<String>,
    from: String,
    #[serde(default)]
    disabled: bool,
    #[serde(default)]
    disable_ad_filter: bool,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
struct DesktopCategoryConfigItem {
    name: Option<String>,
    #[serde(rename = "type")]
    category_type: String,
    query: String,
    from: String,
    #[serde(default)]
    disabled: bool,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
struct DesktopLiveConfigItem {
    key: String,
    name: String,
    url: String,
    ua: Option<String>,
    epg: Option<String>,
    from: String,
    #[serde(rename = "channelNumber", default)]
    channel_number: usize,
    #[serde(default)]
    disabled: bool,
}

#[derive(Debug, Serialize)]
struct DesktopAdminConfigResult {
    #[serde(rename = "Role")]
    role: String,
    #[serde(rename = "Config")]
    config: DesktopAdminConfig,
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
    version: String,
    port: u16,
    base_url: String,
    config_path: String,
    data_dir: String,
    sqlite_path: String,
    sqlite_schema_version: i64,
    sqlite_migration_count: usize,
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
struct DoubanCategoriesQueryParams {
    kind: Option<String>,
    category: Option<String>,
    #[serde(rename = "type")]
    item_type: Option<String>,
    limit: Option<String>,
    start: Option<String>,
}

#[derive(Debug, Deserialize)]
struct DoubanListQueryParams {
    tag: Option<String>,
    #[serde(rename = "type")]
    item_type: Option<String>,
    #[serde(rename = "pageSize")]
    page_size: Option<String>,
    #[serde(rename = "pageStart")]
    page_start: Option<String>,
}

#[derive(Debug, Deserialize)]
struct DoubanRecommendsQueryParams {
    kind: Option<String>,
    limit: Option<String>,
    start: Option<String>,
    category: Option<String>,
    format: Option<String>,
    label: Option<String>,
    region: Option<String>,
    year: Option<String>,
    platform: Option<String>,
    sort: Option<String>,
}

#[derive(Debug, Deserialize)]
struct DoubanSearchQueryParams {
    q: Option<String>,
    limit: Option<String>,
    start: Option<String>,
}

#[derive(Debug, Deserialize)]
struct DetailQueryParams {
    id: Option<String>,
    source: Option<String>,
}

#[derive(Debug, Deserialize)]
pub(crate) struct VodProxyQueryParams {
    pub(crate) source: Option<String>,
    pub(crate) url: Option<String>,
    pub(crate) adfilter: Option<String>,
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

#[derive(Clone, Debug)]
struct AppError {
    status: StatusCode,
    code: Option<&'static str>,
    message: String,
}

impl AppError {
    fn new(status: StatusCode, message: impl Into<String>) -> Self {
        Self {
            status,
            code: None,
            message: message.into(),
        }
    }

    fn with_code(status: StatusCode, code: &'static str, message: impl Into<String>) -> Self {
        Self {
            status,
            code: Some(code),
            message: message.into(),
        }
    }

    fn bad_request(message: impl Into<String>) -> Self {
        Self::new(StatusCode::BAD_REQUEST, message)
    }

    fn bad_request_with_code(code: &'static str, message: impl Into<String>) -> Self {
        Self::with_code(StatusCode::BAD_REQUEST, code, message)
    }

    fn internal(message: impl Into<String>) -> Self {
        Self::new(StatusCode::INTERNAL_SERVER_ERROR, message)
    }

    fn internal_with_code(code: &'static str, message: impl Into<String>) -> Self {
        Self::with_code(StatusCode::INTERNAL_SERVER_ERROR, code, message)
    }
}

impl IntoResponse for AppError {
    fn into_response(self) -> Response {
        let mut payload = serde_json::Map::new();
        payload.insert("error".into(), Value::String(self.message));
        if let Some(code) = self.code {
            payload.insert("code".into(), Value::String(code.to_string()));
        }

        (self.status, Json(Value::Object(payload))).into_response()
    }
}

type AppResult<T> = std::result::Result<T, AppError>;

pub async fn run(cli: Cli) -> Result<()> {
    let state = AppState::from_cli(&cli)?;
    spawn_background_tasks(state.clone());
    let app = build_router(state.clone());
    let listener = TcpListener::bind(state.bind_addr())
        .await
        .context("failed to bind local service listener")?;
    let listener_addr = listener.local_addr()?.to_string();

    if effective_bind_host(&state.host) != state.host {
        info!(
            "LunaTV local service listening on {} with public base URL {} and config {}",
            listener_addr,
            state.public_base_url,
            state.config_path.display()
        );
    } else {
        info!(
            "LunaTV local service listening on {} with config {}",
            listener_addr,
            state.config_path.display()
        );
    }

    serve_local_service(listener, app, state.public_base_url.clone())
        .await
        .context("local service exited unexpectedly")
}

#[cfg(target_os = "windows")]
async fn serve_local_service(
    listener: TcpListener,
    app: Router,
    base_url: String,
) -> std::io::Result<()> {
    info!("using Windows HTTP/1 local service serve loop");
    spawn_windows_local_service_self_probe(base_url);

    loop {
        let (stream, remote_addr) = listener.accept().await?;
        if !remote_addr.ip().is_loopback() {
            warn!("rejected non-loopback local service connection from {remote_addr}");
            continue;
        }

        info!("accepted local service connection from {remote_addr}");

        let service = app
            .clone()
            .map_request(|request: axum::http::Request<Incoming>| request.map(Body::new));
        tokio::spawn(async move {
            let io = TokioIo::new(stream);
            let hyper_service = TowerToHyperService::new(service);

            if let Err(error) = http1::Builder::new()
                .serve_connection(io, hyper_service)
                .await
            {
                warn!("failed to serve local service connection from {remote_addr}: {error}");
            }
        });
    }
}

#[cfg(not(target_os = "windows"))]
async fn serve_local_service(
    listener: TcpListener,
    app: Router,
    _base_url: String,
) -> std::io::Result<()> {
    axum::serve(listener, app)
        .with_graceful_shutdown(shutdown_signal())
        .await
}

#[cfg(target_os = "windows")]
fn spawn_windows_local_service_self_probe(base_url: String) {
    tokio::spawn(async move {
        tokio::time::sleep(WINDOWS_SELF_PROBE_DELAY).await;

        match tokio::task::spawn_blocking(move || blocking_local_service_health_probe(&base_url))
            .await
        {
            Ok(Ok(status_code)) => {
                info!("local service self-probe succeeded with HTTP {status_code}");
            }
            Ok(Err(error)) => {
                warn!("local service self-probe failed: {error}");
            }
            Err(error) => {
                warn!("local service self-probe join failed: {error}");
            }
        }
    });
}

#[cfg(target_os = "windows")]
fn blocking_local_service_health_probe(base_url: &str) -> std::result::Result<u16, String> {
    let authority = local_service_authority(base_url)?;
    let request = build_local_service_health_request(&authority);
    let address = authority
        .parse::<std::net::SocketAddr>()
        .map_err(|error| format!("invalid local service address {authority}: {error}"))?;

    let mut stream = std::net::TcpStream::connect_timeout(&address, WINDOWS_SELF_PROBE_TIMEOUT)
        .map_err(|error| format!("tcp connect failed: {error}"))?;
    stream
        .set_write_timeout(Some(WINDOWS_SELF_PROBE_TIMEOUT))
        .map_err(|error| format!("failed to set probe write timeout: {error}"))?;
    stream
        .set_read_timeout(Some(WINDOWS_SELF_PROBE_TIMEOUT))
        .map_err(|error| format!("failed to set probe read timeout: {error}"))?;
    stream
        .write_all(request.as_bytes())
        .map_err(|error| format!("failed to write probe request: {error}"))?;

    let mut buffer = [0_u8; 1024];
    let bytes_read = stream
        .read(&mut buffer)
        .map_err(|error| format!("failed to read probe response: {error}"))?;
    if bytes_read == 0 {
        return Err("probe response closed before sending data".to_string());
    }

    let response_head = String::from_utf8_lossy(&buffer[..bytes_read]);
    let status_line = response_head
        .lines()
        .next()
        .map(str::trim)
        .unwrap_or_default();

    status_line
        .split_whitespace()
        .nth(1)
        .ok_or_else(|| format!("invalid probe response status line: {status_line}"))?
        .parse::<u16>()
        .map_err(|error| format!("invalid probe response status line: {status_line}; {error}"))
}

fn effective_bind_host(configured_host: &str) -> &str {
    configured_host
}

pub fn build_router(state: AppState) -> Router {
    schedule_download_runtime_processing(state.clone());

    Router::new()
        .route("/health", get(get_health))
        .route("/runtime/public-config", get(get_runtime_public_config))
        .route("/content/search", get(content_search::get_content_search))
        .route(
            "/content/search/ws",
            get(content_search::stream_content_search),
        )
        .route(
            "/content/suggestions",
            get(content_search::get_content_suggestions),
        )
        .route("/content/detail", get(content_detail::get_content_detail))
        .route("/live/sources", get(get_live_sources))
        .route("/live/channels", get(get_live_channels))
        .route("/live/epg", get(get_live_epg))
        .route("/live/precheck", get(get_live_precheck))
        .route("/metadata/bangumi/calendar", get(get_bangumi_calendar))
        .route("/metadata/douban/ratings", get(get_douban_ratings))
        .route("/douban/search", get(get_douban_title_search))
        .route("/douban/categories", get(get_douban_categories))
        .route("/douban", get(get_douban_list))
        .route("/douban/recommends", get(get_douban_recommends))
        .route("/media/live/m3u8", get(get_live_m3u8))
        .route("/media/live/segment", get(get_live_segment))
        .route("/media/live/key", get(get_live_key))
        .route("/media/live/logo", get(get_live_logo))
        .route("/media/vod/m3u8", get(get_vod_m3u8))
        .route("/media/vod/segment", get(get_vod_segment))
        .route("/media/vod/key", get(get_vod_key))
        .route("/image-proxy", get(get_image_proxy))
        .route("/api/runtime/public-config", get(get_runtime_public_config))
        .route("/api/image-proxy", get(get_image_proxy))
        .route("/api/profile/bootstrap", get(get_profile_bootstrap))
        .route("/api/profile-sync/status", get(get_profile_sync_status))
        .route(
            "/api/profile-sync/sync-now",
            post(post_profile_sync_sync_now),
        )
        .route("/api/server-config", get(get_profile_sync_server_config))
        .route("/api/login", any(proxy_profile_sync_login))
        .route("/api/logout", any(proxy_profile_sync_logout))
        .route(
            "/api/change-password",
            any(proxy_profile_sync_change_password),
        )
        .route(
            "/api/download-runtime/cache",
            put(put_download_runtime_cache),
        )
        .route(
            "/api/download-runtime/cache/meta",
            get(get_download_runtime_cache_meta),
        )
        .route(
            "/api/download-runtime/cache/response",
            get(get_download_runtime_cache_response),
        )
        .route(
            "/api/download-runtime/cache/fetch",
            get(fetch_download_runtime_cache_response),
        )
        .route(
            "/api/download-runtime/cache/delete",
            delete(delete_download_runtime_cache),
        )
        .route(
            "/api/download-runtime/cache/all",
            delete(clear_download_runtime_cache),
        )
        .route(
            "/api/download-runtime/storage-info",
            get(get_download_runtime_storage_info),
        )
        .route(
            "/api/download-runtime/manifest/resolve",
            post(resolve_download_runtime_manifest),
        )
        .route(
            "/api/download-runtime/resource-index",
            put(put_download_runtime_resource_index)
                .get(get_download_runtime_resource_index)
                .delete(delete_download_runtime_resource_index),
        )
        .route(
            "/api/download-runtime/resource-index/all",
            delete(clear_download_runtime_resource_indexes),
        )
        .route(
            "/api/download-runtime/store",
            get(get_download_runtime_store_snapshot)
                .put(put_download_runtime_store_snapshot)
                .delete(clear_download_runtime_store_snapshot),
        )
        .route(
            "/api/download-runtime/tasks",
            get(get_download_runtime_tasks)
                .post(post_download_runtime_task)
                .delete(clear_download_runtime_tasks),
        )
        .route(
            "/api/download-runtime/tasks/stream",
            get(stream_download_runtime_tasks),
        )
        .route(
            "/api/download-runtime/tasks/settings",
            put(put_download_runtime_task_settings),
        )
        .route(
            "/api/download-runtime/tasks/bulk",
            post(post_download_runtime_task_bulk_command),
        )
        .route(
            "/api/download-runtime/tasks/{task_id}/pause",
            post(pause_download_runtime_task),
        )
        .route(
            "/api/download-runtime/tasks/{task_id}/resume",
            post(resume_download_runtime_task),
        )
        .route(
            "/api/download-runtime/tasks/{task_id}/retry",
            post(retry_download_runtime_task),
        )
        .route(
            "/api/download-runtime/tasks/{task_id}/cancel",
            post(cancel_download_runtime_task),
        )
        .route(
            "/api/download-runtime/tasks/{task_id}",
            get(get_download_runtime_task).delete(delete_download_runtime_task),
        )
        .route("/api/playrecords", any(proxy_profile_sync_playrecords))
        .route("/api/favorites", any(proxy_profile_sync_favorites))
        .route("/api/follows", any(proxy_profile_sync_follows))
        .route("/api/searchhistory", any(proxy_profile_sync_search_history))
        .route("/api/skipconfigs", any(proxy_profile_sync_skip_configs))
        .route("/api/admin/config", get(get_admin_config))
        .route("/api/admin/reset", get(reset_admin_config))
        .route("/api/admin/config_file", post(update_admin_config_file))
        .route(
            "/api/admin/profile-sync/onboarding/preview",
            post(preview_profile_sync_onboarding),
        )
        .route(
            "/api/admin/profile-sync/onboarding/execute",
            post(execute_profile_sync_onboarding),
        )
        .route(
            "/api/admin/data_migration/export",
            post(export_admin_data_migration),
        )
        .route(
            "/api/admin/data_migration/import",
            post(import_admin_data_migration),
        )
        .route(
            "/api/admin/config_subscription/fetch",
            post(fetch_admin_config_subscription),
        )
        .route("/api/admin/site", post(update_admin_site_config))
        .route("/api/admin/adfilter", post(update_admin_ad_filter_config))
        .route("/api/admin/source", post(update_admin_source_config))
        .route("/api/admin/source/validate", get(validate_admin_sources))
        .route("/api/admin/category", post(update_admin_category_config))
        .route("/api/admin/live", post(update_admin_live_config))
        .route("/api/admin/live/refresh", post(refresh_admin_live_sources))
        .route("/api/admin/user", post(update_admin_user_config))
        .route("/api/search", get(content_search::get_content_search))
        .route("/api/search/ws", get(content_search::stream_content_search))
        .route(
            "/api/search/suggestions",
            get(content_search::get_content_suggestions),
        )
        .route(
            "/api/playback/search-sources",
            post(playback_prefetch::search_playback_sources),
        )
        .route("/api/detail", get(content_detail::get_content_detail))
        .route("/api/live/sources", get(get_live_sources))
        .route("/api/live/channels", get(get_live_channels))
        .route("/api/live/epg", get(get_live_epg))
        .route("/api/live/precheck", get(get_live_precheck))
        .route("/api/bangumi/calendar", get(get_bangumi_calendar))
        .route("/api/douban/search", get(get_douban_title_search))
        .route("/api/douban/categories", get(get_douban_categories))
        .route("/api/douban", get(get_douban_list))
        .route("/api/douban/recommends", get(get_douban_recommends))
        .route("/api/douban/ratings", get(get_douban_ratings))
        .route("/api/proxy/m3u8", get(get_live_m3u8))
        .route("/api/proxy/segment", get(get_live_segment))
        .route("/api/proxy/key", get(get_live_key))
        .route("/api/proxy/logo", get(get_live_logo))
        .route("/api/proxy/vod/m3u8", get(get_vod_m3u8))
        .route("/api/proxy/vod/segment", get(get_vod_segment))
        .route("/api/proxy/vod/key", get(get_vod_key))
        .route(
            "/api/vod-prefetch/session",
            get(get_vod_prefetch_session)
                .post(post_vod_prefetch_session)
                .delete(stop_vod_prefetch_session),
        )
        .route(
            "/api/vod-prefetch/session/advance",
            post(post_vod_prefetch_advance),
        )
        .route(
            "/api/vod-prefetch/session/retry",
            post(post_vod_prefetch_retry),
        )
        .with_state(state.clone())
        .layer(middleware::from_fn_with_state(
            state,
            local_service_access_middleware,
        ))
        .layer(middleware::from_fn(cors_middleware))
}

fn spawn_background_tasks(state: AppState) {
    profile_sync_worker::spawn_profile_outbox_worker(state.clone());

    tokio::spawn(async move {
        if let Err(error) = refresh_admin_config_subscription_if_due(&state).await {
            warn!("desktop subscription refresh task failed during startup: {error}");
        }

        let mut interval =
            tokio::time::interval(DESKTOP_CONFIG_SUBSCRIPTION_REFRESH_CHECK_INTERVAL);
        interval.tick().await;

        loop {
            interval.tick().await;
            if let Err(error) = refresh_admin_config_subscription_if_due(&state).await {
                warn!("desktop subscription refresh task failed: {error}");
            }
        }
    });
}

#[cfg(not(windows))]
async fn shutdown_signal() {
    let _ = tokio::signal::ctrl_c().await;
}

async fn cors_middleware(request: Request, next: Next) -> Response {
    let request_origin = request
        .headers()
        .get(ORIGIN)
        .and_then(|value| value.to_str().ok())
        .map(str::to_owned);
    if request.method() == Method::OPTIONS {
        let mut response = StatusCode::NO_CONTENT.into_response();
        apply_cors_headers_for_origin(response.headers_mut(), request_origin.as_deref());
        return response;
    }

    let mut response = next.run(request).await;
    apply_cors_headers_for_origin(response.headers_mut(), request_origin.as_deref());
    response
}

fn apply_cors_headers(headers: &mut HeaderMap) {
    apply_cors_headers_for_origin(headers, None);
}

fn apply_cors_headers_for_origin(headers: &mut HeaderMap, request_origin: Option<&str>) {
    let allowed_origin = match request_origin {
        Some("tauri://localhost") => "tauri://localhost",
        Some("https://tauri.localhost") => "https://tauri.localhost",
        Some("http://tauri.localhost") => "http://tauri.localhost",
        Some("http://127.0.0.1:3000") => "http://127.0.0.1:3000",
        _ => "tauri://localhost",
    };
    headers.insert(
        ACCESS_CONTROL_ALLOW_ORIGIN,
        HeaderValue::from_static(allowed_origin),
    );
    headers.insert(
        ACCESS_CONTROL_ALLOW_METHODS,
        HeaderValue::from_static("GET, POST, PUT, PATCH, DELETE, HEAD, OPTIONS"),
    );
    headers.insert(
        ACCESS_CONTROL_ALLOW_HEADERS,
        HeaderValue::from_static(
            "Content-Type, Range, Origin, Accept, Authorization, X-MoonTV-Response-Status, X-MoonTV-Download-Intent, X-MoonTV-Local-Token, X-MoonTV-Admin-Capability",
        ),
    );
    headers.insert(
        ACCESS_CONTROL_EXPOSE_HEADERS,
        HeaderValue::from_static("Content-Length, Content-Range"),
    );
}

async fn local_service_access_middleware(
    State(state): State<AppState>,
    request: Request,
    next: Next,
) -> Response {
    let path = request.uri().path();
    if request.method() == Method::OPTIONS || !requires_local_service_access_token(path) {
        return next.run(request).await;
    }

    let is_authorized = match state.access_token.as_deref() {
        None => true,
        Some(expected) => request
            .headers()
            .get(LOCAL_SERVICE_ACCESS_TOKEN_HEADER)
            .and_then(|value| value.to_str().ok())
            .is_some_and(|actual| actual == expected),
    };
    if is_authorized
        && (!state
            .admin_capability
            .as_ref()
            .is_some_and(|_| requires_admin_capability(path))
            || has_valid_admin_capability(&state, request.headers()))
    {
        return next.run(request).await;
    }

    AppError::new(StatusCode::UNAUTHORIZED, "Unauthorized").into_response()
}

fn has_valid_admin_capability(state: &AppState, headers: &HeaderMap) -> bool {
    match state.admin_capability.as_deref() {
        None => false,
        Some(expected) => headers
            .get(LOCAL_SERVICE_ADMIN_CAPABILITY_HEADER)
            .and_then(|value| value.to_str().ok())
            .is_some_and(|actual| actual == expected),
    }
}

fn requires_admin_capability(path: &str) -> bool {
    path.starts_with("/api/admin/")
}

fn requires_local_service_access_token(path: &str) -> bool {
    matches!(
        path,
        "/api/login"
            | "/api/logout"
            | "/api/change-password"
            | "/api/profile-sync/status"
            | "/api/profile-sync/sync-now"
            | "/api/vod-prefetch/session"
            | "/api/vod-prefetch/session/advance"
            | "/api/vod-prefetch/session/retry"
    ) || path.starts_with("/api/admin/")
        || path.starts_with("/api/download-runtime/")
        || matches!(
            path,
            "/api/playrecords"
                | "/api/favorites"
                | "/api/follows"
                | "/api/searchhistory"
                | "/api/skipconfigs"
        )
}

async fn get_health(State(state): State<AppState>) -> Json<HealthResponse> {
    let sqlite_info = state.sqlite_info();
    Json(HealthResponse {
        status: "ok",
        version: env!("CARGO_PKG_VERSION").to_string(),
        port: state.port,
        base_url: state.public_base_url.clone(),
        config_path: state.config_path.display().to_string(),
        data_dir: state.data_dir.display().to_string(),
        sqlite_path: state.sqlite_path.display().to_string(),
        sqlite_schema_version: sqlite_info.schema_version,
        sqlite_migration_count: sqlite_info.applied_migration_count,
    })
}

async fn get_runtime_public_config(State(state): State<AppState>) -> AppResult<Response> {
    let config = state
        .load_config()
        .map_err(|error| AppError::internal(error.to_string()))?;
    let payload = build_runtime_public_config_response(&config);
    no_store_json_response(&payload)
}

fn build_local_auth_status_payload(state: &AppState) -> Result<LocalAuthStatusResponse> {
    let persistence = state.load_admin_persistence()?;
    let owner_username = resolve_owner_username_for_import(&persistence.config)
        .unwrap_or_else(|| DEFAULT_DESKTOP_OWNER_USERNAME.to_string());
    let owner_password_configured =
        extract_owner_password_from_config_file(&persistence.config.config_file).is_some();
    let multi_user = persistence
        .config
        .user_config
        .users
        .iter()
        .any(|user| user.username != owner_username);

    Ok(LocalAuthStatusResponse {
        username: owner_username,
        password_required: owner_password_configured || multi_user,
        multi_user,
        owner_password_configured,
    })
}

pub(crate) async fn build_profile_bootstrap_response(
    state: &AppState,
    config: &ServiceConfig,
) -> AppResult<ProfileBootstrapResponse> {
    Ok(ProfileBootstrapResponse {
        app_target: "desktop",
        runtime: build_runtime_public_config_response(config),
        profile_sync: build_profile_sync_status_payload(state, config).await,
        local_auth: build_local_auth_status_payload(state)
            .map_err(|error| AppError::internal(error.to_string()))?,
    })
}

#[cfg(target_os = "windows")]
fn local_service_authority(base_url: &str) -> std::result::Result<String, String> {
    base_url
        .trim()
        .trim_end_matches('/')
        .strip_prefix("http://")
        .map(str::to_string)
        .filter(|authority| !authority.is_empty())
        .ok_or_else(|| format!("unsupported local service base URL: {base_url}"))
}

#[cfg(target_os = "windows")]
fn build_local_service_health_request(authority: &str) -> String {
    format!(
        "GET /health HTTP/1.1\r\nHost: {authority}\r\nConnection: close\r\nAccept: application/json\r\n\r\n"
    )
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AdminConfigFileRequest {
    config_file: String,
    subscription_url: Option<String>,
    auto_update: Option<bool>,
    last_check_time: Option<String>,
}

#[derive(Debug, Deserialize)]
struct AdminConfigSubscriptionFetchRequest {
    url: String,
}

#[derive(Debug, Deserialize)]
struct AdminDataMigrationExportRequest {
    password: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
struct AdminDataMigrationArchive {
    timestamp: String,
    #[serde(rename = "serverVersion")]
    server_version: String,
    data: AdminDataMigrationArchiveData,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
struct AdminDataMigrationArchiveData {
    #[serde(rename = "adminConfig")]
    admin_config: DesktopAdminConfig,
    #[serde(rename = "userData", default)]
    user_data: BTreeMap<String, AdminDataMigrationUserData>,
    #[serde(
        rename = "desktopMetadata",
        default,
        skip_serializing_if = "Option::is_none"
    )]
    desktop_metadata: Option<AdminDataMigrationDesktopMetadata>,
}

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
struct AdminDataMigrationUserData {
    #[serde(rename = "playRecords", default)]
    play_records: BTreeMap<String, Value>,
    #[serde(default)]
    favorites: BTreeMap<String, Value>,
    #[serde(rename = "searchHistory", default)]
    search_history: Vec<String>,
    #[serde(rename = "skipConfigs", default)]
    skip_configs: BTreeMap<String, Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    password: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct AdminDataMigrationDesktopMetadata {
    scope: String,
    note: String,
    includes_browser_local_data: bool,
    includes_remote_profile_data: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AdminSourceMutationRequest {
    action: String,
    key: Option<String>,
    name: Option<String>,
    api: Option<String>,
    detail: Option<String>,
    ua: Option<String>,
    referer: Option<String>,
    #[serde(alias = "disable_ad_filter")]
    disable_ad_filter: Option<bool>,
    order: Option<Vec<String>>,
    keys: Option<Vec<String>>,
}

#[derive(Debug, Deserialize)]
struct AdminAdFilterMutationRequest {
    enabled: Option<bool>,
}

#[derive(Debug, Deserialize)]
struct AdminSourceValidateQuery {
    q: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AdminCategoryMutationRequest {
    action: String,
    name: Option<String>,
    #[serde(rename = "type")]
    category_type: Option<String>,
    query: Option<String>,
    order: Option<Vec<String>>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AdminLiveMutationRequest {
    action: String,
    key: Option<String>,
    name: Option<String>,
    url: Option<String>,
    ua: Option<String>,
    epg: Option<String>,
    order: Option<Vec<String>>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AdminUserMutationRequest {
    action: String,
    target_username: Option<String>,
    target_password: Option<String>,
    user_group: Option<String>,
    group_action: Option<String>,
    group_name: Option<String>,
    enabled_apis: Option<Vec<String>>,
    user_groups: Option<Vec<String>>,
    usernames: Option<Vec<String>>,
}

async fn get_admin_config(State(state): State<AppState>) -> AppResult<Response> {
    let persistence = state
        .load_admin_persistence()
        .map_err(|error| AppError::internal(error.to_string()))?;

    no_store_json_response(&DesktopAdminConfigResult {
        role: "owner".to_string(),
        config: persistence.config,
    })
}

async fn reset_admin_config(State(state): State<AppState>) -> AppResult<Response> {
    let current = state
        .load_admin_persistence()
        .map_err(|error| AppError::internal(error.to_string()))?;
    let mut reset_persistence = build_default_admin_persistence_from_raw(
        &state.config_path,
        current.profile_sync_api_base_url,
        Some(current.profile_sync_sync_domains),
    )
    .map_err(|error| AppError::internal(error.to_string()))?;
    reset_persistence.config.config_subscribtion = current.config.config_subscribtion;
    state
        .save_admin_persistence(&reset_persistence)
        .map_err(|error| AppError::internal(error.to_string()))?;

    no_store_json_response(&json!({ "ok": true }))
}

async fn export_admin_data_migration(
    State(state): State<AppState>,
    request: Request,
) -> AppResult<Response> {
    if should_proxy_admin_data_migration(&state)
        .map_err(|error| AppError::internal(error.to_string()))?
    {
        return proxy_profile_sync_passthrough(&state, request).await;
    }

    let body_bytes = to_bytes(request.into_body(), usize::MAX)
        .await
        .map_err(|error| AppError::bad_request(error.to_string()))?;
    let payload = serde_json::from_slice::<AdminDataMigrationExportRequest>(&body_bytes)
        .map_err(|error| AppError::bad_request(format!("请求体格式错误: {error}")))?;
    let password = normalize_owned_string(Some(payload.password))
        .ok_or_else(|| AppError::bad_request("请提供加密密码"))?;

    let archive = build_local_admin_data_migration_archive(&state)
        .map_err(|error| AppError::internal(error.to_string()))?;
    let archive_json =
        serde_json::to_vec(&archive).map_err(|error| AppError::internal(error.to_string()))?;
    let compressed =
        gzip_bytes(&archive_json).map_err(|error| AppError::internal(error.to_string()))?;
    let encrypted = cryptojs_aes_encrypt_text(&BASE64_STANDARD.encode(&compressed), &password)
        .map_err(|error| AppError::internal(error.to_string()))?;

    build_binary_file_response(
        encrypted,
        &format!("moontv-backup-{}.dat", current_timestamp_ms()),
    )
}

async fn import_admin_data_migration(
    State(state): State<AppState>,
    request: Request,
) -> AppResult<Response> {
    if should_proxy_admin_data_migration(&state)
        .map_err(|error| AppError::internal(error.to_string()))?
    {
        return proxy_profile_sync_passthrough(&state, request).await;
    }

    let mut multipart = Multipart::from_request(request, &())
        .await
        .map_err(|error| AppError::bad_request(error.to_string()))?;
    let mut encrypted_data = None::<String>;
    let mut password = None::<String>;

    while let Some(field) = multipart
        .next_field()
        .await
        .map_err(|error| AppError::bad_request(error.to_string()))?
    {
        match field.name() {
            Some("file") => {
                encrypted_data = Some(
                    field
                        .text()
                        .await
                        .map_err(|error| AppError::bad_request(error.to_string()))?,
                );
            }
            Some("password") => {
                password = Some(
                    field
                        .text()
                        .await
                        .map_err(|error| AppError::bad_request(error.to_string()))?,
                );
            }
            _ => {}
        }
    }

    let encrypted_data = encrypted_data.ok_or_else(|| AppError::bad_request("请选择备份文件"))?;
    let password =
        normalize_owned_string(password).ok_or_else(|| AppError::bad_request("请提供解密密码"))?;

    let archive = parse_local_admin_data_migration_archive(&encrypted_data, &password)
        .map_err(|error| AppError::bad_request(error.to_string()))?;
    import_local_admin_data_migration_archive(&state, &archive)
        .map_err(|error| AppError::internal(error.to_string()))?;

    no_store_json_response(&json!({
        "message": "数据导入成功",
        "importedUsers": archive.data.user_data.len(),
        "timestamp": archive.timestamp,
        "serverVersion": archive.server_version,
        "note": DESKTOP_LOCAL_DATA_MIGRATION_NOTE,
    }))
}

#[allow(unreachable_code)]
async fn update_admin_config_file(
    State(state): State<AppState>,
    Json(payload): Json<AdminConfigFileRequest>,
) -> AppResult<Response> {
    persist_admin_config_file_with_subscription(
        &state,
        payload.config_file.trim(),
        normalize_owned_string(payload.subscription_url).unwrap_or_default(),
        payload.auto_update.unwrap_or(false),
        normalize_owned_string(payload.last_check_time).unwrap_or_default(),
    )
    .map_err(|error| AppError::internal(error.to_string()))?;

    return no_store_json_response(&json!({
        "success": true,
        "message": "閰嶇疆鏂囦欢鏇存柊鎴愬姛"
    }));

    let config_file = payload.config_file.trim();
    if config_file.is_empty() {
        return Err(AppError::bad_request("配置文件内容不能为空"));
    }

    serde_json::from_str::<Value>(config_file)
        .map_err(|error| AppError::bad_request(format!("配置文件格式错误: {error}")))?;

    state
        .write_raw_config(config_file)
        .map_err(|error| AppError::internal(error.to_string()))?;

    let mut persistence = state
        .load_admin_persistence()
        .map_err(|error| AppError::internal(error.to_string()))?;
    persistence.config.config_subscribtion.url =
        normalize_owned_string(payload.subscription_url).unwrap_or_default();
    persistence.config.config_subscribtion.auto_update = payload.auto_update.unwrap_or(false);
    persistence.config.config_subscribtion.last_check =
        normalize_owned_string(payload.last_check_time).unwrap_or_default();

    state
        .save_admin_persistence(&persistence)
        .map_err(|error| AppError::internal(error.to_string()))?;

    no_store_json_response(&json!({
        "success": true,
        "message": "配置文件更新成功"
    }))
}

#[allow(unreachable_code)]
async fn fetch_admin_config_subscription(
    State(state): State<AppState>,
    Json(payload): Json<AdminConfigSubscriptionFetchRequest>,
) -> AppResult<Response> {
    let config_content =
        fetch_admin_config_subscription_content(&state, payload.url.trim()).await?;

    return no_store_json_response(&json!({
        "success": true,
        "configContent": config_content,
        "message": "閰嶇疆鎷夊彇鎴愬姛"
    }));

    let url = payload.url.trim().to_string();
    if url.is_empty() {
        return Err(AppError::bad_request("缺少URL参数"));
    }

    let upstream_response = state
        .client
        .get(&url)
        .timeout(Duration::from_millis(DEFAULT_PROXY_TIMEOUT_MS))
        .send()
        .await
        .map_err(|error| AppError::new(StatusCode::BAD_GATEWAY, error.to_string()))?;

    if !upstream_response.status().is_success() {
        return Err(AppError::new(
            StatusCode::BAD_GATEWAY,
            format!(
                "请求失败: {} {}",
                upstream_response.status(),
                upstream_response
                    .status()
                    .canonical_reason()
                    .unwrap_or("upstream error")
            ),
        ));
    }

    let encoded_content = upstream_response
        .text()
        .await
        .map_err(|error| AppError::new(StatusCode::BAD_GATEWAY, error.to_string()))?;
    let decoded_content = bs58::decode(encoded_content.trim())
        .into_vec()
        .map_err(|error| AppError::bad_request(format!("配置订阅解码失败: {error}")))?;
    let config_content = String::from_utf8(decoded_content)
        .map_err(|error| AppError::bad_request(format!("配置订阅内容不是有效UTF-8: {error}")))?;

    no_store_json_response(&json!({
        "success": true,
        "configContent": config_content,
        "message": "配置拉取成功"
    }))
}

async fn fetch_admin_config_subscription_content(state: &AppState, url: &str) -> AppResult<String> {
    let normalized_url = url.trim();
    if normalized_url.is_empty() {
        return Err(AppError::bad_request("missing subscription url"));
    }

    let upstream_response = state
        .client
        .get(normalized_url)
        .timeout(Duration::from_millis(DEFAULT_PROXY_TIMEOUT_MS))
        .send()
        .await
        .map_err(|error| AppError::new(StatusCode::BAD_GATEWAY, error.to_string()))?;

    if !upstream_response.status().is_success() {
        return Err(AppError::new(
            StatusCode::BAD_GATEWAY,
            format!(
                "subscription request failed: {} {}",
                upstream_response.status(),
                upstream_response
                    .status()
                    .canonical_reason()
                    .unwrap_or("upstream error")
            ),
        ));
    }

    let encoded_content = upstream_response
        .text()
        .await
        .map_err(|error| AppError::new(StatusCode::BAD_GATEWAY, error.to_string()))?;
    let decoded_content = bs58::decode(encoded_content.trim())
        .into_vec()
        .map_err(|error| {
            AppError::bad_request(format!("subscription base58 decode failed: {error}"))
        })?;
    let config_content = String::from_utf8(decoded_content).map_err(|error| {
        AppError::bad_request(format!("subscription content is not utf-8: {error}"))
    })?;

    validate_admin_config_file_contents(&config_content)
        .map_err(|error| AppError::bad_request(error.to_string()))?;

    Ok(config_content)
}

async fn refresh_admin_config_subscription_if_due(state: &AppState) -> Result<()> {
    let persistence = state.load_admin_persistence()?;
    let subscription = persistence.config.config_subscribtion;
    if !should_auto_refresh_admin_config_subscription(&subscription) {
        return Ok(());
    }

    let config_content = fetch_admin_config_subscription_content(state, &subscription.url)
        .await
        .map_err(|error| anyhow::anyhow!(error.message))?;
    let current_owner_username =
        extract_owner_username_from_config_file(&persistence.config.config_file);
    let current_owner_password =
        extract_owner_password_from_config_file(&persistence.config.config_file);
    let config_content = apply_desktop_runtime_overrides_to_config_file(
        &config_content,
        current_owner_username.as_deref(),
        current_owner_password.as_deref(),
        persistence.profile_sync_api_base_url.as_deref(),
        persistence
            .profile_sync_api_base_url
            .as_ref()
            .map(|_| persistence.profile_sync_sync_domains.as_slice()),
    )?;
    persist_admin_config_file_with_subscription(
        state,
        &config_content,
        subscription.url,
        subscription.auto_update,
        current_iso_timestamp(),
    )?;
    Ok(())
}

fn should_auto_refresh_admin_config_subscription(subscription: &DesktopConfigSubscribtion) -> bool {
    if !subscription.auto_update || subscription.url.trim().is_empty() {
        return false;
    }

    let last_check = subscription.last_check.trim();
    if last_check.is_empty() {
        return true;
    }

    OffsetDateTime::parse(last_check, &Rfc3339)
        .map(|timestamp| {
            OffsetDateTime::now_utc()
                >= timestamp + DESKTOP_CONFIG_SUBSCRIPTION_REFRESH_MIN_INTERVAL
        })
        .unwrap_or(true)
}

fn validate_admin_config_file_contents(config_file: &str) -> Result<()> {
    let trimmed = config_file.trim();
    if trimmed.is_empty() {
        anyhow::bail!("config file content cannot be empty");
    }

    serde_json::from_str::<Value>(trimmed).context("config file json is invalid")?;
    Ok(())
}

fn apply_desktop_runtime_overrides_to_config_file(
    config_file: &str,
    owner_username: Option<&str>,
    owner_password: Option<&str>,
    profile_sync_api_base_url: Option<&str>,
    profile_sync_sync_domains: Option<&[String]>,
) -> Result<String> {
    let mut config_value = serde_json::from_str::<Value>(config_file.trim())
        .context("failed to parse config file json")?;
    let root = config_value
        .as_object_mut()
        .context("config file root must be an object")?;

    let auth_entry = root.entry("auth".to_string()).or_insert_with(|| json!({}));
    if !auth_entry.is_object() {
        *auth_entry = json!({});
    }
    let auth = auth_entry
        .as_object_mut()
        .context("auth must be an object after normalization")?;
    match owner_username
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        Some(owner_username) => {
            auth.insert(
                "username".to_string(),
                Value::String(owner_username.to_string()),
            );
        }
        None => {
            auth.remove("username");
        }
    }
    match owner_password
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        Some(owner_password) => {
            auth.insert(
                "password".to_string(),
                Value::String(owner_password.to_string()),
            );
        }
        None => {
            auth.remove("password");
        }
    }

    let profile_sync_entry = root
        .entry("profile_sync".to_string())
        .or_insert_with(|| json!({}));
    if !profile_sync_entry.is_object() {
        *profile_sync_entry = json!({});
    }
    let profile_sync = profile_sync_entry
        .as_object_mut()
        .context("profile_sync must be an object after normalization")?;
    match profile_sync_api_base_url
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        Some(profile_sync_api_base_url) => {
            profile_sync.insert(
                "api_base_url".to_string(),
                Value::String(profile_sync_api_base_url.to_string()),
            );
            if let Some(sync_domains) = profile_sync_sync_domains {
                profile_sync.insert(
                    "sync_domains".to_string(),
                    Value::Array(
                        sync_domains
                            .iter()
                            .map(|domain| Value::String(domain.clone()))
                            .collect(),
                    ),
                );
            }
        }
        None => {
            profile_sync.remove("api_base_url");
            profile_sync.remove("sync_domains");
        }
    }

    serde_json::to_string_pretty(&config_value).context("failed to encode config file json")
}

fn persist_admin_config_file_with_subscription(
    state: &AppState,
    config_file: &str,
    subscription_url: String,
    auto_update: bool,
    last_check: String,
) -> Result<()> {
    validate_admin_config_file_contents(config_file)?;
    state.write_raw_config(config_file)?;

    let persistence = state.load_admin_persistence()?;
    let (_, raw_config) = read_raw_service_config(&state.config_path)?;
    let mut persistence =
        merge_admin_persistence_with_raw(persistence, config_file.to_string(), &raw_config);
    persistence.config.config_subscribtion.url = subscription_url;
    persistence.config.config_subscribtion.auto_update = auto_update;
    persistence.config.config_subscribtion.last_check = last_check;
    state.save_admin_persistence(&persistence)?;
    Ok(())
}

fn current_iso_timestamp() -> String {
    OffsetDateTime::now_utc()
        .format(&Rfc3339)
        .unwrap_or_else(|_| current_timestamp_ms().to_string())
}

async fn update_admin_site_config(
    State(state): State<AppState>,
    Json(payload): Json<DesktopSiteConfig>,
) -> AppResult<Response> {
    let mut persistence = state
        .load_admin_persistence()
        .map_err(|error| AppError::internal(error.to_string()))?;
    persistence.config.site_config = normalize_desktop_site_config(payload);
    state
        .save_admin_persistence(&persistence)
        .map_err(|error| AppError::internal(error.to_string()))?;

    no_store_json_response(&json!({ "ok": true }))
}

async fn update_admin_ad_filter_config(
    State(state): State<AppState>,
    Json(payload): Json<AdminAdFilterMutationRequest>,
) -> AppResult<Response> {
    let mut persistence = state
        .load_admin_persistence()
        .map_err(|error| AppError::internal(error.to_string()))?;
    persistence.config.ad_filter_config.enabled = payload.enabled.unwrap_or(true);
    state
        .save_admin_persistence(&persistence)
        .map_err(|error| AppError::internal(error.to_string()))?;

    no_store_json_response(&json!({ "ok": true }))
}

async fn update_admin_source_config(
    State(state): State<AppState>,
    Json(payload): Json<AdminSourceMutationRequest>,
) -> AppResult<Response> {
    let mut persistence = state
        .load_admin_persistence()
        .map_err(|error| AppError::internal(error.to_string()))?;

    match payload.action.as_str() {
        "add" => {
            let key = require_owned_string(payload.key, "缺少 key 参数")?;
            let name = require_owned_string(payload.name, "缺少 name 参数")?;
            let api = require_owned_string(payload.api, "缺少 api 参数")?;

            if persistence
                .config
                .source_config
                .iter()
                .any(|source| source.key == key)
            {
                return Err(AppError::bad_request("该源已存在"));
            }

            persistence
                .config
                .source_config
                .push(DesktopSourceConfigItem {
                    key,
                    name,
                    api,
                    detail: normalize_owned_string(payload.detail),
                    ua: normalize_owned_string(payload.ua),
                    referer: normalize_owned_string(payload.referer),
                    from: "custom".to_string(),
                    disabled: false,
                    disable_ad_filter: false,
                });
        }
        "edit" => {
            let key = require_owned_string(payload.key, "缺少 key 参数")?;
            let name = require_owned_string(payload.name, "缺少 name 参数")?;
            let api = require_owned_string(payload.api, "缺少 api 参数")?;
            let entry = persistence
                .config
                .source_config
                .iter_mut()
                .find(|source| source.key == key)
                .ok_or_else(|| AppError::new(StatusCode::NOT_FOUND, "源不存在"))?;

            if entry.from == "config" {
                return Err(AppError::bad_request("配置文件来源的视频源不可编辑"));
            }

            entry.name = name;
            entry.api = api;
            entry.detail = normalize_owned_string(payload.detail);
            entry.ua = normalize_owned_string(payload.ua);
            entry.referer = normalize_owned_string(payload.referer);
        }
        "update_ad_filter" => {
            let key = require_owned_string(payload.key, "缺少 key 参数")?;
            let disable_ad_filter = payload
                .disable_ad_filter
                .ok_or_else(|| AppError::bad_request("参数格式错误"))?;
            let entry = persistence
                .config
                .source_config
                .iter_mut()
                .find(|source| source.key == key)
                .ok_or_else(|| AppError::new(StatusCode::NOT_FOUND, "源不存在"))?;
            entry.disable_ad_filter = disable_ad_filter;
        }
        "disable" | "enable" => {
            let key = require_owned_string(payload.key, "缺少 key 参数")?;
            let entry = persistence
                .config
                .source_config
                .iter_mut()
                .find(|source| source.key == key)
                .ok_or_else(|| AppError::new(StatusCode::NOT_FOUND, "源不存在"))?;
            entry.disabled = payload.action == "disable";
        }
        "delete" => {
            let key = require_owned_string(payload.key, "缺少 key 参数")?;
            let index = persistence
                .config
                .source_config
                .iter()
                .position(|source| source.key == key)
                .ok_or_else(|| AppError::new(StatusCode::NOT_FOUND, "源不存在"))?;
            if persistence.config.source_config[index].from == "config" {
                return Err(AppError::bad_request("该源不可删除"));
            }
            persistence.config.source_config.remove(index);
            remove_api_keys_from_user_config(&mut persistence.config.user_config, &[key]);
        }
        "batch_disable" | "batch_enable" => {
            let keys = require_non_empty_string_list(payload.keys, "缺少 keys 参数或为空")?;
            let should_disable = payload.action == "batch_disable";
            persistence
                .config
                .source_config
                .iter_mut()
                .filter(|source| keys.iter().any(|key| key == &source.key))
                .for_each(|source| source.disabled = should_disable);
        }
        "batch_delete" => {
            let keys = require_non_empty_string_list(payload.keys, "缺少 keys 参数或为空")?;
            let removable_keys = persistence
                .config
                .source_config
                .iter()
                .filter(|source| {
                    keys.iter().any(|key| key == &source.key) && source.from != "config"
                })
                .map(|source| source.key.clone())
                .collect::<Vec<_>>();
            persistence
                .config
                .source_config
                .retain(|source| !removable_keys.iter().any(|key| key == &source.key));
            remove_api_keys_from_user_config(&mut persistence.config.user_config, &removable_keys);
        }
        "sort" => {
            let order = payload
                .order
                .ok_or_else(|| AppError::bad_request("排序列表格式错误"))?;
            reorder_by_key(&mut persistence.config.source_config, &order, |source| {
                source.key.clone()
            });
        }
        _ => return Err(AppError::bad_request("未知操作")),
    }

    state
        .save_admin_persistence(&persistence)
        .map_err(|error| AppError::internal(error.to_string()))?;

    no_store_json_response(&json!({ "ok": true }))
}

async fn validate_admin_sources(
    State(state): State<AppState>,
    Query(params): Query<AdminSourceValidateQuery>,
) -> AppResult<Response> {
    let query = params.q.unwrap_or_default().trim().to_string();
    if query.is_empty() {
        return Err(AppError::bad_request("搜索关键词不能为空"));
    }

    let config = state
        .load_config()
        .map_err(|error| AppError::internal(error.to_string()))?;
    let lower_query = query.to_lowercase();
    let mut completed_sources = 0_usize;
    let mut events = vec![Ok::<Event, Infallible>(
        Event::default().data(
            json!({
                "type": "start",
                "totalSources": config.api_sites.len(),
            })
            .to_string(),
        ),
    )];

    for source in &config.api_sites {
        let (event_type, status) = if source.disabled {
            ("source_error", "invalid")
        } else {
            match search_site(&state.client, source, &query, 1).await {
                Ok(results) => {
                    let matched = results
                        .iter()
                        .any(|result| result.title.to_lowercase().contains(lower_query.as_str()));
                    if matched {
                        ("source_result", "valid")
                    } else {
                        ("source_result", "no_results")
                    }
                }
                Err(_) => ("source_error", "invalid"),
            }
        };

        completed_sources += 1;
        events.push(Ok(Event::default().data(
            json!({
                "type": event_type,
                "source": source.key,
                "status": status,
            })
            .to_string(),
        )));
    }

    events.push(Ok(Event::default().data(
        json!({
            "type": "complete",
            "completedSources": completed_sources,
        })
        .to_string(),
    )));

    let mut response = Sse::new(stream::iter(events)).into_response();
    response
        .headers_mut()
        .insert(CACHE_CONTROL, HeaderValue::from_static("no-cache"));
    Ok(response)
}

async fn update_admin_category_config(
    State(state): State<AppState>,
    Json(payload): Json<AdminCategoryMutationRequest>,
) -> AppResult<Response> {
    let mut persistence = state
        .load_admin_persistence()
        .map_err(|error| AppError::internal(error.to_string()))?;

    match payload.action.as_str() {
        "add" => {
            let name = require_owned_string(payload.name, "缺少必要参数")?;
            let category_type = require_owned_string(payload.category_type, "缺少必要参数")?;
            let query = require_owned_string(payload.query, "缺少必要参数")?;
            if persistence
                .config
                .custom_categories
                .iter()
                .any(|category| category.query == query && category.category_type == category_type)
            {
                return Err(AppError::bad_request("该分类已存在"));
            }
            persistence
                .config
                .custom_categories
                .push(DesktopCategoryConfigItem {
                    name: Some(name),
                    category_type,
                    query,
                    from: "custom".to_string(),
                    disabled: false,
                });
        }
        "disable" | "enable" => {
            let query = require_owned_string(payload.query, "缺少 query 或 type 参数")?;
            let category_type =
                require_owned_string(payload.category_type, "缺少 query 或 type 参数")?;
            let entry = persistence
                .config
                .custom_categories
                .iter_mut()
                .find(|category| category.query == query && category.category_type == category_type)
                .ok_or_else(|| AppError::new(StatusCode::NOT_FOUND, "分类不存在"))?;
            entry.disabled = payload.action == "disable";
        }
        "delete" => {
            let query = require_owned_string(payload.query, "缺少 query 或 type 参数")?;
            let category_type =
                require_owned_string(payload.category_type, "缺少 query 或 type 参数")?;
            let index = persistence
                .config
                .custom_categories
                .iter()
                .position(|category| {
                    category.query == query && category.category_type == category_type
                })
                .ok_or_else(|| AppError::new(StatusCode::NOT_FOUND, "分类不存在"))?;
            if persistence.config.custom_categories[index].from == "config" {
                return Err(AppError::bad_request("该分类不可删除"));
            }
            persistence.config.custom_categories.remove(index);
        }
        "sort" => {
            let order = payload
                .order
                .ok_or_else(|| AppError::bad_request("排序列表格式错误"))?;
            reorder_by_key(
                &mut persistence.config.custom_categories,
                &order,
                |category| format!("{}:{}", category.query, category.category_type),
            );
        }
        _ => return Err(AppError::bad_request("未知操作")),
    }

    state
        .save_admin_persistence(&persistence)
        .map_err(|error| AppError::internal(error.to_string()))?;

    no_store_json_response(&json!({ "ok": true }))
}

async fn update_admin_live_config(
    State(state): State<AppState>,
    Json(payload): Json<AdminLiveMutationRequest>,
) -> AppResult<Response> {
    let mut persistence = state
        .load_admin_persistence()
        .map_err(|error| AppError::internal(error.to_string()))?;

    match payload.action.as_str() {
        "add" => {
            let key = require_owned_string(payload.key, "缺少 key 参数")?;
            let name = require_owned_string(payload.name, "缺少 name 参数")?;
            let url = require_owned_string(payload.url, "缺少 url 参数")?;
            if persistence
                .config
                .live_config
                .iter()
                .any(|live| live.key == key)
            {
                return Err(AppError::bad_request("直播源 key 已存在"));
            }

            let mut live_item = DesktopLiveConfigItem {
                key: key.clone(),
                name,
                url,
                ua: normalize_owned_string(payload.ua),
                epg: normalize_owned_string(payload.epg),
                from: "custom".to_string(),
                channel_number: 0,
                disabled: false,
            };
            live_item.channel_number = refresh_admin_live_channel_count(&state, &live_item).await;
            persistence.config.live_config.push(live_item);
        }
        "edit" => {
            let key = require_owned_string(payload.key, "缺少 key 参数")?;
            let name = require_owned_string(payload.name, "缺少 name 参数")?;
            let url = require_owned_string(payload.url, "缺少 url 参数")?;
            let index = persistence
                .config
                .live_config
                .iter()
                .position(|live| live.key == key)
                .ok_or_else(|| AppError::new(StatusCode::NOT_FOUND, "直播源不存在"))?;

            if persistence.config.live_config[index].from == "config" {
                return Err(AppError::bad_request("不能编辑配置文件中的直播源"));
            }

            persistence.config.live_config[index].name = name;
            persistence.config.live_config[index].url = url;
            persistence.config.live_config[index].ua = normalize_owned_string(payload.ua);
            persistence.config.live_config[index].epg = normalize_owned_string(payload.epg);
            let live_snapshot = persistence.config.live_config[index].clone();
            persistence.config.live_config[index].channel_number =
                refresh_admin_live_channel_count(&state, &live_snapshot).await;
        }
        "delete" => {
            let key = require_owned_string(payload.key, "缺少 key 参数")?;
            let index = persistence
                .config
                .live_config
                .iter()
                .position(|live| live.key == key)
                .ok_or_else(|| AppError::new(StatusCode::NOT_FOUND, "直播源不存在"))?;
            if persistence.config.live_config[index].from == "config" {
                return Err(AppError::bad_request("不能删除配置文件中的直播源"));
            }
            persistence.config.live_config.remove(index);
            state.live_channels_cache.write().await.remove(&key);
        }
        "enable" | "disable" => {
            let key = require_owned_string(payload.key, "缺少 key 参数")?;
            let entry = persistence
                .config
                .live_config
                .iter_mut()
                .find(|live| live.key == key)
                .ok_or_else(|| AppError::new(StatusCode::NOT_FOUND, "直播源不存在"))?;
            entry.disabled = payload.action == "disable";
            if entry.disabled {
                state.live_channels_cache.write().await.remove(&key);
            }
        }
        "sort" => {
            let order = payload
                .order
                .ok_or_else(|| AppError::bad_request("排序数据格式错误"))?;
            reorder_by_key(&mut persistence.config.live_config, &order, |live| {
                live.key.clone()
            });
        }
        _ => return Err(AppError::bad_request("未知操作")),
    }

    state
        .save_admin_persistence(&persistence)
        .map_err(|error| AppError::internal(error.to_string()))?;

    no_store_json_response(&json!({ "success": true }))
}

async fn refresh_admin_live_sources(State(state): State<AppState>) -> AppResult<Response> {
    let mut persistence = state
        .load_admin_persistence()
        .map_err(|error| AppError::internal(error.to_string()))?;

    for index in 0..persistence.config.live_config.len() {
        if persistence.config.live_config[index].disabled {
            continue;
        }

        let live_snapshot = persistence.config.live_config[index].clone();
        persistence.config.live_config[index].channel_number =
            refresh_admin_live_channel_count(&state, &live_snapshot).await;
    }

    state
        .save_admin_persistence(&persistence)
        .map_err(|error| AppError::internal(error.to_string()))?;

    no_store_json_response(&json!({
        "success": true,
        "message": "直播源刷新成功"
    }))
}

async fn update_admin_user_config(
    State(state): State<AppState>,
    Json(payload): Json<AdminUserMutationRequest>,
) -> AppResult<Response> {
    let mut persistence = state
        .load_admin_persistence()
        .map_err(|error| AppError::internal(error.to_string()))?;

    match payload.action.as_str() {
        "add" => {
            let target_username = require_owned_string(payload.target_username, "缺少目标用户名")?;
            let target_password =
                require_owned_string(payload.target_password, "缺少目标用户密码")?;
            if persistence
                .config
                .user_config
                .users
                .iter()
                .any(|user| user.username == target_username)
            {
                return Err(AppError::bad_request("用户已存在"));
            }

            let mut user = DesktopUserConfigItem {
                username: target_username.clone(),
                role: "user".to_string(),
                banned: false,
                enabled_apis: Vec::new(),
                tags: Vec::new(),
            };
            if let Some(group_name) = normalize_owned_string(payload.user_group) {
                if persistence
                    .config
                    .user_config
                    .tags
                    .iter()
                    .any(|tag| tag.name == group_name)
                {
                    user.tags.push(group_name);
                }
            }
            persistence.config.user_config.users.push(user);
            persistence
                .user_passwords
                .insert(target_username, hash_desktop_password(&target_password));
        }
        "ban" | "unban" => {
            let target_username = require_owned_string(payload.target_username, "缺少目标用户名")?;
            let user =
                find_admin_user_mut(&mut persistence.config.user_config.users, &target_username)
                    .ok_or_else(|| AppError::new(StatusCode::NOT_FOUND, "目标用户不存在"))?;
            if user.role == "owner" {
                return Err(AppError::bad_request("无法操作站长"));
            }
            user.banned = payload.action == "ban";
        }
        "setAdmin" => {
            let target_username = require_owned_string(payload.target_username, "缺少目标用户名")?;
            let user =
                find_admin_user_mut(&mut persistence.config.user_config.users, &target_username)
                    .ok_or_else(|| AppError::new(StatusCode::NOT_FOUND, "目标用户不存在"))?;
            if user.role == "owner" {
                return Err(AppError::bad_request("无法操作站长"));
            }
            user.role = "admin".to_string();
        }
        "cancelAdmin" => {
            let target_username = require_owned_string(payload.target_username, "缺少目标用户名")?;
            let user =
                find_admin_user_mut(&mut persistence.config.user_config.users, &target_username)
                    .ok_or_else(|| AppError::new(StatusCode::NOT_FOUND, "目标用户不存在"))?;
            if user.role == "owner" {
                return Err(AppError::bad_request("无法操作站长"));
            }
            user.role = "user".to_string();
        }
        "changePassword" => {
            let target_username = require_owned_string(payload.target_username, "缺少目标用户名")?;
            let target_password = require_owned_string(payload.target_password, "缺少新密码")?;
            let user =
                find_admin_user_mut(&mut persistence.config.user_config.users, &target_username)
                    .ok_or_else(|| AppError::new(StatusCode::NOT_FOUND, "目标用户不存在"))?;
            if user.role == "owner" {
                return Err(AppError::new(StatusCode::UNAUTHORIZED, "无法修改站长密码"));
            }
            persistence
                .user_passwords
                .insert(target_username, hash_desktop_password(&target_password));
        }
        "deleteUser" => {
            let target_username = require_owned_string(payload.target_username, "缺少目标用户名")?;
            let index = persistence
                .config
                .user_config
                .users
                .iter()
                .position(|user| user.username == target_username)
                .ok_or_else(|| AppError::new(StatusCode::NOT_FOUND, "目标用户不存在"))?;
            if persistence.config.user_config.users[index].role == "owner" {
                return Err(AppError::bad_request("不能删除站长"));
            }
            persistence.config.user_config.users.remove(index);
            persistence.user_passwords.remove(&target_username);
        }
        "updateUserApis" => {
            let target_username = require_owned_string(payload.target_username, "缺少目标用户名")?;
            let user =
                find_admin_user_mut(&mut persistence.config.user_config.users, &target_username)
                    .ok_or_else(|| AppError::new(StatusCode::NOT_FOUND, "目标用户不存在"))?;
            user.enabled_apis = normalize_string_list(payload.enabled_apis.unwrap_or_default());
        }
        "userGroup" => {
            let group_action = require_owned_string(payload.group_action, "缺少用户组操作")?;
            let group_name = require_owned_string(payload.group_name, "缺少用户组名称")?;
            match group_action.as_str() {
                "add" => {
                    if persistence
                        .config
                        .user_config
                        .tags
                        .iter()
                        .any(|tag| tag.name == group_name)
                    {
                        return Err(AppError::bad_request("用户组已存在"));
                    }
                    persistence
                        .config
                        .user_config
                        .tags
                        .push(DesktopUserTagConfigItem {
                            name: group_name,
                            enabled_apis: normalize_string_list(
                                payload.enabled_apis.unwrap_or_default(),
                            ),
                        });
                }
                "edit" => {
                    let tag = persistence
                        .config
                        .user_config
                        .tags
                        .iter_mut()
                        .find(|tag| tag.name == group_name)
                        .ok_or_else(|| AppError::new(StatusCode::NOT_FOUND, "用户组不存在"))?;
                    tag.enabled_apis =
                        normalize_string_list(payload.enabled_apis.unwrap_or_default());
                }
                "delete" => {
                    let index = persistence
                        .config
                        .user_config
                        .tags
                        .iter()
                        .position(|tag| tag.name == group_name)
                        .ok_or_else(|| AppError::new(StatusCode::NOT_FOUND, "用户组不存在"))?;
                    persistence.config.user_config.tags.remove(index);
                    persistence
                        .config
                        .user_config
                        .users
                        .iter_mut()
                        .for_each(|user| {
                            user.tags.retain(|tag| tag != &group_name);
                        });
                }
                _ => return Err(AppError::bad_request("未知的用户组操作")),
            }
        }
        "updateUserGroups" => {
            let target_username = require_owned_string(payload.target_username, "缺少目标用户名")?;
            let user =
                find_admin_user_mut(&mut persistence.config.user_config.users, &target_username)
                    .ok_or_else(|| AppError::new(StatusCode::NOT_FOUND, "目标用户不存在"))?;
            user.tags = filter_known_user_groups(
                payload.user_groups.unwrap_or_default(),
                &persistence.config.user_config.tags,
            );
        }
        "batchUpdateUserGroups" => {
            let usernames = require_non_empty_string_list(payload.usernames, "缺少用户名列表")?;
            let user_groups = filter_known_user_groups(
                payload.user_groups.unwrap_or_default(),
                &persistence.config.user_config.tags,
            );
            persistence
                .config
                .user_config
                .users
                .iter_mut()
                .for_each(|user| {
                    if usernames.iter().any(|username| username == &user.username) {
                        user.tags = user_groups.clone();
                    }
                });
        }
        _ => return Err(AppError::bad_request("未知操作")),
    }

    let owner_username = persistence
        .config
        .user_config
        .users
        .iter()
        .find(|user| user.role == "owner")
        .map(|user| user.username.clone())
        .unwrap_or_else(|| DEFAULT_DESKTOP_OWNER_USERNAME.to_string());
    persistence.config.user_config =
        normalize_user_config(persistence.config.user_config, &owner_username);

    state
        .save_admin_persistence(&persistence)
        .map_err(|error| AppError::internal(error.to_string()))?;

    no_store_json_response(&json!({ "ok": true }))
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

async fn get_douban_categories(
    State(state): State<AppState>,
    Query(params): Query<DoubanCategoriesQueryParams>,
) -> AppResult<Response> {
    let kind = normalize_owned_string(params.kind).unwrap_or_else(|| "movie".to_string());
    let category = normalize_owned_string(params.category).unwrap_or_default();
    let item_type = normalize_owned_string(params.item_type).unwrap_or_default();
    let page_limit = parse_i64_query_param(params.limit.as_deref(), 20);
    let page_start = parse_i64_query_param(params.start.as_deref(), 0);

    if category.is_empty() || item_type.is_empty() {
        return Err(AppError::bad_request(
            "缺少必要参数: kind 或 category 或 type",
        ));
    }

    if kind != "tv" && kind != "movie" {
        return Err(AppError::bad_request("kind 参数必须是 tv 或 movie"));
    }

    if !(1..=100).contains(&page_limit) {
        return Err(AppError::bad_request("pageSize 必须在 1-100 之间"));
    }

    if page_start < 0 {
        return Err(AppError::bad_request("pageStart 不能小于 0"));
    }

    let config = state
        .load_config()
        .map_err(|error| AppError::internal(error.to_string()))?;
    let target = build_url_with_query(
        &state.douban_api_base_url,
        &format!("/rexxar/api/v2/subject/recent_hot/{kind}"),
        &[
            ("start", page_start.to_string()),
            ("limit", page_limit.to_string()),
            ("category", category),
            ("type", item_type),
        ],
    )
    .map_err(|error| AppError::internal(error.to_string()))?;
    let douban_data =
        fetch_douban_json::<DoubanCategoryApiResponse>(&state.client, &config, &target)
            .await
            .map_err(|error| AppError::internal(error.to_string()))?;
    let list = douban_data
        .items
        .into_iter()
        .map(|item| DoubanItem {
            id: item.id,
            title: item.title,
            poster: item
                .pic
                .as_ref()
                .and_then(|picture| picture.normal.clone().or_else(|| picture.large.clone()))
                .unwrap_or_default(),
            rate: format_douban_rating(item.rating.as_ref(), false),
            year: extract_any_year(item.card_subtitle.as_deref()),
            play_type: None,
        })
        .collect::<Vec<_>>();

    let mut response = Json(DoubanResult {
        code: 200,
        message: "获取成功",
        list,
    })
    .into_response();
    apply_query_cache_headers(response.headers_mut(), config.cache_time);
    Ok(response)
}

async fn get_douban_list(
    State(state): State<AppState>,
    Query(params): Query<DoubanListQueryParams>,
) -> AppResult<Response> {
    let item_type = normalize_owned_string(params.item_type).unwrap_or_default();
    let tag = normalize_owned_string(params.tag).unwrap_or_default();
    let page_size = parse_i64_query_param(params.page_size.as_deref(), 16);
    let page_start = parse_i64_query_param(params.page_start.as_deref(), 0);

    if item_type.is_empty() || tag.is_empty() {
        return Err(AppError::bad_request("缺少必要参数: type 或 tag"));
    }

    if item_type != "tv" && item_type != "movie" {
        return Err(AppError::bad_request("type 参数必须是 tv 或 movie"));
    }

    if !(1..=100).contains(&page_size) {
        return Err(AppError::bad_request("pageSize 必须在 1-100 之间"));
    }

    if page_start < 0 {
        return Err(AppError::bad_request("pageStart 不能小于 0"));
    }

    let config = state
        .load_config()
        .map_err(|error| AppError::internal(error.to_string()))?;
    let list = if tag == "top250" {
        fetch_douban_top250(
            &state.client,
            &config,
            &state.douban_movie_api_base_url,
            page_start as usize,
        )
        .await
        .map_err(|error| AppError::internal(error.to_string()))?
    } else {
        let target = build_url_with_query(
            &state.douban_movie_api_base_url,
            "/j/search_subjects",
            &[
                ("type", item_type),
                ("tag", tag),
                ("sort", "recommend".to_string()),
                ("page_limit", page_size.to_string()),
                ("page_start", page_start.to_string()),
            ],
        )
        .map_err(|error| AppError::internal(error.to_string()))?;
        let douban_data =
            fetch_douban_json::<DoubanListApiResponse>(&state.client, &config, &target)
                .await
                .map_err(|error| AppError::internal(error.to_string()))?;

        douban_data
            .subjects
            .into_iter()
            .map(|item| DoubanItem {
                id: item.id,
                title: item.title,
                poster: item.cover.unwrap_or_default(),
                rate: item.rate.unwrap_or_default(),
                year: extract_any_year(item.card_subtitle.as_deref()),
                play_type: None,
            })
            .collect::<Vec<_>>()
    };

    let mut response = Json(DoubanResult {
        code: 200,
        message: "获取成功",
        list,
    })
    .into_response();
    apply_query_cache_headers(response.headers_mut(), config.cache_time);
    Ok(response)
}

async fn get_douban_recommends(
    State(state): State<AppState>,
    Query(params): Query<DoubanRecommendsQueryParams>,
) -> AppResult<Response> {
    let kind = normalize_owned_string(params.kind).unwrap_or_default();
    let page_limit = parse_i64_query_param(params.limit.as_deref(), 20);
    let page_start = parse_i64_query_param(params.start.as_deref(), 0);
    let category = normalize_douban_filter_value(params.category);
    let format = normalize_douban_filter_value(params.format);
    let label = normalize_douban_filter_value(params.label);
    let region = normalize_douban_filter_value(params.region);
    let year = normalize_douban_filter_value(params.year);
    let platform = normalize_douban_filter_value(params.platform);
    let sort = normalize_douban_sort_value(params.sort);

    if kind.is_empty() {
        return Err(AppError::bad_request("缺少必要参数: kind"));
    }

    if kind != "tv" && kind != "movie" {
        return Err(AppError::bad_request("kind 参数必须是 tv 或 movie"));
    }

    if !(1..=100).contains(&page_limit) {
        return Err(AppError::bad_request("pageSize 必须在 1-100 之间"));
    }

    if page_start < 0 {
        return Err(AppError::bad_request("pageStart 不能小于 0"));
    }

    let config = state
        .load_config()
        .map_err(|error| AppError::internal(error.to_string()))?;
    let target = build_douban_recommend_target(
        &state.douban_api_base_url,
        &kind,
        page_start as usize,
        page_limit as usize,
        category.as_deref(),
        format.as_deref(),
        label.as_deref(),
        region.as_deref(),
        year.as_deref(),
        platform.as_deref(),
        sort.as_deref(),
    )
    .map_err(|error| AppError::internal(error.to_string()))?;
    let douban_data =
        fetch_douban_json::<DoubanRecommendApiResponse>(&state.client, &config, &target)
            .await
            .map_err(|error| AppError::internal(error.to_string()))?;
    let list = douban_data
        .items
        .into_iter()
        .filter_map(|item| {
            if !matches!(item.item_type.as_deref(), Some("movie" | "tv")) {
                return None;
            }

            Some(DoubanItem {
                id: item.id.unwrap_or_default(),
                title: item.title.unwrap_or_default(),
                poster: item
                    .pic
                    .as_ref()
                    .and_then(|picture| picture.normal.clone().or_else(|| picture.large.clone()))
                    .unwrap_or_default(),
                rate: format_douban_rating(item.rating.as_ref(), false),
                year: item.year.unwrap_or_default(),
                play_type: None,
            })
        })
        .collect::<Vec<_>>();

    let mut response = Json(DoubanResult {
        code: 200,
        message: "获取成功",
        list,
    })
    .into_response();
    apply_query_cache_headers(response.headers_mut(), config.cache_time);
    Ok(response)
}

async fn get_douban_title_search(
    State(state): State<AppState>,
    Query(params): Query<DoubanSearchQueryParams>,
) -> AppResult<Response> {
    let query = normalize_owned_string(params.q).unwrap_or_default();
    let limit = normalize_douban_search_limit(params.limit.as_deref());
    let start = normalize_douban_search_start(params.start.as_deref());

    if query.is_empty() {
        return Err(AppError::bad_request("缺少必要参数: q"));
    }

    let config = state
        .load_config()
        .map_err(|error| AppError::internal(error.to_string()))?;
    let first_page = fetch_douban_search_page(
        &state.client,
        &config,
        &state.douban_search_api_base_url,
        &query,
        start,
    )
    .await
    .map_err(|error| AppError::internal(error.to_string()))?;
    let mut collected_items = first_page.items;
    let total = first_page
        .total
        .max(start + count_douban_search_subject_items(&collected_items));
    let desired_count = limit.min(total.saturating_sub(start));

    if desired_count > DOUBAN_SEARCH_PAGE_SIZE {
        let page_starts = ((start + DOUBAN_SEARCH_PAGE_SIZE)..(start + desired_count))
            .step_by(DOUBAN_SEARCH_PAGE_SIZE)
            .take_while(|page_start| *page_start < total)
            .collect::<Vec<_>>();
        let tasks = page_starts.iter().map(|page_start| {
            fetch_douban_search_page(
                &state.client,
                &config,
                &state.douban_search_api_base_url,
                &query,
                *page_start,
            )
        });

        for result in join_all(tasks).await {
            if let Ok(page) = result {
                collected_items.extend(page.items);
            }
        }
    }

    let mut seen_ids = BTreeSet::new();
    let mut list = Vec::new();
    let target_count = if desired_count == 0 {
        limit
    } else {
        desired_count
    };
    for item in collected_items
        .into_iter()
        .filter(is_douban_search_subject_item)
    {
        let id = item.id.expect("search subject item id should exist");
        if !seen_ids.insert(id) {
            continue;
        }
        list.push(map_douban_search_item(&item));
        if list.len() >= target_count {
            break;
        }
    }

    let mut response = Json(DoubanResult {
        code: 200,
        message: "获取成功",
        list,
    })
    .into_response();
    apply_query_cache_headers(response.headers_mut(), config.cache_time);
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

fn build_local_request_url(base_url: &str, original_uri: &OriginalUri) -> String {
    let path_and_query = original_uri
        .0
        .path_and_query()
        .map(|value| value.as_str())
        .unwrap_or_else(|| original_uri.0.path());

    format!("{}{}", base_url.trim_end_matches('/'), path_and_query)
}

fn try_build_cached_vod_proxy_response(
    state: &AppState,
    method: &Method,
    original_uri: &OriginalUri,
    request_headers: &HeaderMap,
) -> AppResult<Option<Response>> {
    let request_url = build_local_request_url(&state.public_base_url, original_uri);
    let Some(entry) = state
        .read_cached_download_entry(&request_url)
        .map_err(|error| AppError::internal(error.to_string()))?
    else {
        return Ok(None);
    };
    let Some(body) = state
        .read_cached_download_body(&request_url)
        .map_err(|error| AppError::internal(error.to_string()))?
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

fn try_build_cached_online_vod_proxy_response(
    state: &AppState,
    method: &Method,
    original_uri: &OriginalUri,
    request_headers: &HeaderMap,
) -> Option<Response> {
    let request_url = build_local_request_url(&state.public_base_url, original_uri);
    let asset = state.read_cached_online_vod_asset(&request_url)?;
    let entry = DesktopDownloadCacheEntry {
        url: request_url,
        status: asset.status,
        content_type: asset.content_type,
        size_bytes: asset.body.len() as u64,
        created_at: 0,
        updated_at: 0,
    };

    Some(build_cached_download_response(
        method,
        request_headers,
        &entry,
        asset.body,
    ))
}

fn default_cache_time() -> u64 {
    DEFAULT_CACHE_TIME
}

fn default_search_max_pages() -> usize {
    DEFAULT_SEARCH_MAX_PAGES
}

fn default_site_name() -> String {
    DEFAULT_SITE_NAME.to_string()
}

fn default_site_announcement() -> String {
    DEFAULT_SITE_ANNOUNCEMENT.to_string()
}

fn default_douban_proxy_type() -> String {
    DEFAULT_DOUBAN_PROXY_TYPE.to_string()
}

fn default_douban_image_proxy_type() -> String {
    DEFAULT_DOUBAN_IMAGE_PROXY_TYPE.to_string()
}

fn default_fluid_search() -> bool {
    true
}

fn normalize_profile_sync_domain(domain: &str) -> Option<String> {
    let trimmed = domain.trim();
    PROFILE_SYNC_USER_DATA_DOMAINS
        .contains(&trimmed)
        .then(|| trimmed.to_string())
}

pub(crate) fn normalize_profile_sync_selected_domains(domains: Option<Vec<String>>) -> Vec<String> {
    let mut normalized = Vec::new();
    let mut seen = BTreeSet::new();

    if let Some(domains) = domains {
        for domain in domains {
            let Some(normalized_domain) = normalize_profile_sync_domain(&domain) else {
                continue;
            };
            if seen.insert(normalized_domain.clone()) {
                normalized.push(normalized_domain);
            }
        }
    }

    if normalized.is_empty() {
        default_profile_sync_selected_domains()
    } else {
        normalized
    }
}

pub(crate) fn validate_profile_sync_selected_domains(
    domains: Option<Vec<String>>,
) -> AppResult<Vec<String>> {
    let Some(domains) = domains else {
        return Ok(default_profile_sync_selected_domains());
    };

    let mut normalized = Vec::new();
    let mut seen = BTreeSet::new();

    for domain in domains {
        let trimmed = domain.trim();
        if trimmed.is_empty() {
            continue;
        }
        if !PROFILE_SYNC_USER_DATA_DOMAINS.contains(&trimmed) {
            return Err(AppError::bad_request(format!(
                "不支持的同步范围: {trimmed}"
            )));
        }

        let candidate = trimmed.to_string();
        if seen.insert(candidate.clone()) {
            normalized.push(candidate);
        }
    }

    if normalized.is_empty() {
        Ok(default_profile_sync_selected_domains())
    } else {
        Ok(normalized)
    }
}

pub(crate) fn sync_domains_include_adminsettings(sync_domains: &[String]) -> bool {
    sync_domains
        .iter()
        .any(|domain| domain == PROFILE_SYNC_ADMIN_SETTINGS_DOMAIN)
}

fn read_raw_service_config(path: &Path) -> Result<(String, RawServiceConfig)> {
    let contents =
        fs::read_to_string(path).with_context(|| format!("failed to read {}", path.display()))?;
    let raw_config = serde_json::from_str::<RawServiceConfig>(&contents)
        .with_context(|| format!("failed to parse {}", path.display()))?;
    Ok((contents, raw_config))
}

fn build_default_admin_persistence_from_raw(
    config_path: &Path,
    profile_sync_api_base_url: Option<String>,
    profile_sync_sync_domains: Option<Vec<String>>,
) -> Result<DesktopAdminPersistence> {
    let (raw_contents, raw_config) = read_raw_service_config(config_path)?;
    Ok(DesktopAdminPersistence {
        config: build_default_admin_config(&raw_contents, &raw_config),
        user_passwords: BTreeMap::new(),
        profile_sync_api_base_url: profile_sync_api_base_url
            .or_else(|| normalize_optional_string(raw_config.profile_sync.api_base_url)),
        profile_sync_sync_domains: normalize_profile_sync_selected_domains(
            profile_sync_sync_domains.or(raw_config.profile_sync.sync_domains),
        ),
    })
}

fn load_admin_persistence(
    config_path: &Path,
    persistence_path: &Path,
) -> Result<DesktopAdminPersistence> {
    let (raw_contents, raw_config) = read_raw_service_config(config_path)?;

    let base = if persistence_path.exists() {
        let contents = fs::read_to_string(persistence_path)
            .with_context(|| format!("failed to read {}", persistence_path.display()))?;
        serde_json::from_str::<DesktopAdminPersistence>(&contents)
            .with_context(|| format!("failed to parse {}", persistence_path.display()))?
    } else {
        DesktopAdminPersistence {
            config: build_default_admin_config(&raw_contents, &raw_config),
            user_passwords: BTreeMap::new(),
            profile_sync_api_base_url: None,
            profile_sync_sync_domains: default_profile_sync_selected_domains(),
        }
    };

    Ok(merge_admin_persistence_with_raw(
        base,
        raw_contents,
        &raw_config,
    ))
}

fn normalize_sqlite_admin_persistence(
    mut persistence: DesktopAdminPersistence,
    raw_contents: String,
    raw_config: &RawServiceConfig,
) -> DesktopAdminPersistence {
    persistence.config.config_file = raw_contents;
    persistence.config.site_config = normalize_desktop_site_config(persistence.config.site_config);
    let owner_username = persistence
        .config
        .user_config
        .users
        .iter()
        .find(|user| user.role == "owner")
        .map(|user| user.username.clone())
        .or_else(|| normalize_optional_string(raw_config.auth.username.clone()))
        .unwrap_or_else(|| DEFAULT_DESKTOP_OWNER_USERNAME.to_string());
    persistence.config.user_config =
        normalize_user_config(persistence.config.user_config, &owner_username);
    persistence.profile_sync_api_base_url =
        normalize_optional_string(persistence.profile_sync_api_base_url);
    persistence.profile_sync_sync_domains =
        normalize_profile_sync_selected_domains(Some(persistence.profile_sync_sync_domains));
    persistence
}

fn build_default_admin_config(
    raw_contents: &str,
    raw_config: &RawServiceConfig,
) -> DesktopAdminConfig {
    let owner_username = normalize_optional_string(raw_config.auth.username.clone())
        .unwrap_or_else(|| DEFAULT_DESKTOP_OWNER_USERNAME.to_string());
    let site_config = build_default_site_config_from_raw(raw_config);
    let player_enhancement_config = build_default_player_enhancement_config_from_raw(raw_config);

    DesktopAdminConfig {
        config_subscribtion: DesktopConfigSubscribtion::default(),
        config_file: raw_contents.to_string(),
        site_config,
        user_config: DesktopUserConfig {
            users: vec![DesktopUserConfigItem {
                username: owner_username,
                role: "owner".to_string(),
                banned: false,
                enabled_apis: Vec::new(),
                tags: Vec::new(),
            }],
            tags: Vec::new(),
        },
        source_config: raw_config
            .api_site
            .iter()
            .map(|(key, site)| DesktopSourceConfigItem {
                key: key.clone(),
                name: site.name.clone(),
                api: site.api.clone(),
                detail: normalize_optional_string(site.detail.clone()),
                ua: normalize_optional_string(site.ua.clone()),
                referer: normalize_optional_string(site.referer.clone()),
                from: "config".to_string(),
                disabled: site.disabled.unwrap_or(false),
                disable_ad_filter: site.disable_ad_filter.unwrap_or(false),
            })
            .collect(),
        custom_categories: raw_config
            .custom_category
            .iter()
            .map(|category| DesktopCategoryConfigItem {
                name: Some(
                    category
                        .name
                        .clone()
                        .unwrap_or_else(|| category.query.clone()),
                ),
                category_type: category.category_type.clone(),
                query: category.query.clone(),
                from: "config".to_string(),
                disabled: category.disabled.unwrap_or(false),
            })
            .collect(),
        live_config: raw_config
            .lives
            .iter()
            .map(|(key, live)| DesktopLiveConfigItem {
                key: key.clone(),
                name: live.name.clone(),
                url: live.url.clone(),
                ua: normalize_optional_string(live.ua.clone()),
                epg: normalize_optional_string(live.epg.clone()),
                from: "config".to_string(),
                channel_number: 0,
                disabled: live.disabled.unwrap_or(false),
            })
            .collect(),
        ad_filter_config: DesktopAdFilterConfig::default(),
        player_enhancement_config,
    }
}

fn build_default_site_config_from_raw(raw_config: &RawServiceConfig) -> DesktopSiteConfig {
    DesktopSiteConfig {
        site_name: normalize_optional_string(raw_config.site_name.clone())
            .unwrap_or_else(default_site_name),
        announcement: normalize_optional_string(raw_config.announcement.clone())
            .unwrap_or_else(default_site_announcement),
        search_downstream_max_page: raw_config
            .search_downstream_max_page
            .unwrap_or(DEFAULT_SEARCH_MAX_PAGES)
            .max(1),
        site_interface_cache_time: raw_config.cache_time.unwrap_or(DEFAULT_CACHE_TIME).max(1),
        douban_proxy_type: normalize_optional_string(raw_config.douban_proxy_type.clone())
            .unwrap_or_else(default_douban_proxy_type),
        douban_proxy: normalize_optional_string(raw_config.douban_proxy.clone())
            .unwrap_or_default(),
        douban_image_proxy_type: normalize_optional_string(
            raw_config.douban_image_proxy_type.clone(),
        )
        .unwrap_or_else(default_douban_image_proxy_type),
        douban_image_proxy: normalize_optional_string(raw_config.douban_image_proxy.clone())
            .unwrap_or_default(),
        disable_yellow_filter: raw_config.disable_yellow_filter.unwrap_or(false),
        fluid_search: true,
        enable_web_live: raw_config.enable_web_live.unwrap_or_else(|| {
            raw_config
                .lives
                .values()
                .any(|live| !live.disabled.unwrap_or(false))
        }),
    }
}

fn build_player_enhancement_config(
    audio_level: PlayerEnhancementLevel,
    audio_dynamic_protection: bool,
    audio_fixed_ceiling: bool,
    visual_level: PlayerEnhancementLevel,
) -> DesktopPlayerEnhancementConfig {
    DesktopPlayerEnhancementConfig {
        audio_spike_protection: audio_level.is_enabled(),
        audio_spike_protection_level: Some(audio_level),
        audio_dynamic_protection: Some(audio_dynamic_protection),
        audio_fixed_ceiling: Some(audio_fixed_ceiling),
        visual_enhancement: visual_level.is_enabled(),
        visual_enhancement_level: Some(visual_level),
    }
}

fn build_default_player_enhancement_config_from_raw(
    raw_config: &RawServiceConfig,
) -> DesktopPlayerEnhancementConfig {
    let audio_level = PlayerEnhancementLevel::resolve(
        raw_config.player_enhancements.audio_spike_protection_level,
        raw_config.player_enhancements.audio_spike_protection,
        PlayerEnhancementLevel::Off,
    );
    let visual_level = PlayerEnhancementLevel::resolve(
        raw_config.player_enhancements.visual_enhancement_level,
        raw_config.player_enhancements.visual_enhancement,
        PlayerEnhancementLevel::Off,
    );
    let audio_dynamic_protection = raw_config
        .player_enhancements
        .audio_dynamic_protection
        .unwrap_or(audio_level.is_enabled());
    let audio_fixed_ceiling = raw_config
        .player_enhancements
        .audio_fixed_ceiling
        .unwrap_or(audio_level.is_enabled());

    build_player_enhancement_config(
        audio_level,
        audio_dynamic_protection,
        audio_fixed_ceiling,
        visual_level,
    )
}

fn merge_admin_persistence_with_raw(
    mut persistence: DesktopAdminPersistence,
    raw_contents: String,
    raw_config: &RawServiceConfig,
) -> DesktopAdminPersistence {
    let owner_username = normalize_optional_string(raw_config.auth.username.clone())
        .unwrap_or_else(|| DEFAULT_DESKTOP_OWNER_USERNAME.to_string());

    persistence.config.config_file = raw_contents.clone();
    persistence.config.site_config = normalize_desktop_site_config(persistence.config.site_config);
    persistence.config.source_config = merge_source_config(
        std::mem::take(&mut persistence.config.source_config),
        &raw_config.api_site,
    );
    persistence.config.custom_categories = merge_category_config(
        std::mem::take(&mut persistence.config.custom_categories),
        &raw_config.custom_category,
    );
    persistence.config.live_config = merge_live_config(
        std::mem::take(&mut persistence.config.live_config),
        &raw_config.lives,
    );
    persistence.config.player_enhancement_config = merge_player_enhancement_config(
        std::mem::take(&mut persistence.config.player_enhancement_config),
        &raw_config.player_enhancements,
    );
    persistence.config.user_config = normalize_user_config(
        std::mem::take(&mut persistence.config.user_config),
        &owner_username,
    );

    persistence.profile_sync_api_base_url =
        normalize_optional_string(raw_config.profile_sync.api_base_url.clone());
    persistence.profile_sync_sync_domains = match raw_config.profile_sync.sync_domains.clone() {
        Some(sync_domains) => normalize_profile_sync_selected_domains(Some(sync_domains)),
        None => normalize_profile_sync_selected_domains(Some(
            persistence.profile_sync_sync_domains.clone(),
        )),
    };

    persistence
}

fn merge_source_config(
    existing: Vec<DesktopSourceConfigItem>,
    raw_sources: &BTreeMap<String, RawApiSite>,
) -> Vec<DesktopSourceConfigItem> {
    let mut merged = existing
        .into_iter()
        .map(|mut item| {
            if let Some(raw_source) = raw_sources.get(&item.key) {
                item.name = raw_source.name.clone();
                item.api = raw_source.api.clone();
                item.detail = normalize_optional_string(raw_source.detail.clone());
                item.ua = normalize_optional_string(raw_source.ua.clone());
                item.referer = normalize_optional_string(raw_source.referer.clone());
                item.from = "config".to_string();
                item.disable_ad_filter = raw_source
                    .disable_ad_filter
                    .unwrap_or(item.disable_ad_filter);
            } else if item.from == "config" {
                item.from = "custom".to_string();
            }
            item
        })
        .collect::<Vec<_>>();

    for (key, raw_source) in raw_sources {
        if merged.iter().any(|item| item.key == *key) {
            continue;
        }

        merged.push(DesktopSourceConfigItem {
            key: key.clone(),
            name: raw_source.name.clone(),
            api: raw_source.api.clone(),
            detail: normalize_optional_string(raw_source.detail.clone()),
            ua: normalize_optional_string(raw_source.ua.clone()),
            referer: normalize_optional_string(raw_source.referer.clone()),
            from: "config".to_string(),
            disabled: raw_source.disabled.unwrap_or(false),
            disable_ad_filter: raw_source.disable_ad_filter.unwrap_or(false),
        });
    }

    merged
}

fn merge_category_config(
    existing: Vec<DesktopCategoryConfigItem>,
    raw_categories: &[RawCustomCategory],
) -> Vec<DesktopCategoryConfigItem> {
    let mut merged = existing
        .into_iter()
        .map(|mut item| {
            if let Some(raw_category) = raw_categories.iter().find(|raw_category| {
                raw_category.query == item.query && raw_category.category_type == item.category_type
            }) {
                item.name = Some(
                    raw_category
                        .name
                        .clone()
                        .unwrap_or_else(|| raw_category.query.clone()),
                );
                item.from = "config".to_string();
            } else if item.from == "config" {
                item.from = "custom".to_string();
            }
            item
        })
        .collect::<Vec<_>>();

    for raw_category in raw_categories {
        if merged.iter().any(|item| {
            item.query == raw_category.query && item.category_type == raw_category.category_type
        }) {
            continue;
        }

        merged.push(DesktopCategoryConfigItem {
            name: Some(
                raw_category
                    .name
                    .clone()
                    .unwrap_or_else(|| raw_category.query.clone()),
            ),
            category_type: raw_category.category_type.clone(),
            query: raw_category.query.clone(),
            from: "config".to_string(),
            disabled: raw_category.disabled.unwrap_or(false),
        });
    }

    merged
}

fn merge_player_enhancement_config(
    existing: DesktopPlayerEnhancementConfig,
    raw_config: &RawPlayerEnhancementConfig,
) -> DesktopPlayerEnhancementConfig {
    let existing_audio_level = PlayerEnhancementLevel::resolve(
        existing.audio_spike_protection_level,
        Some(existing.audio_spike_protection),
        PlayerEnhancementLevel::Off,
    );
    let existing_visual_level = PlayerEnhancementLevel::resolve(
        existing.visual_enhancement_level,
        Some(existing.visual_enhancement),
        PlayerEnhancementLevel::Off,
    );
    let audio_level = PlayerEnhancementLevel::resolve(
        raw_config.audio_spike_protection_level,
        raw_config.audio_spike_protection,
        existing_audio_level,
    );
    let visual_level = PlayerEnhancementLevel::resolve(
        raw_config.visual_enhancement_level,
        raw_config.visual_enhancement,
        existing_visual_level,
    );
    let has_explicit_audio_level = raw_config.audio_spike_protection_level.is_some()
        || raw_config.audio_spike_protection.is_some();
    let audio_dynamic_protection = raw_config.audio_dynamic_protection.unwrap_or_else(|| {
        if has_explicit_audio_level {
            audio_level.is_enabled()
        } else {
            existing
                .audio_dynamic_protection
                .unwrap_or(existing_audio_level.is_enabled())
        }
    });
    let audio_fixed_ceiling = raw_config.audio_fixed_ceiling.unwrap_or_else(|| {
        if has_explicit_audio_level {
            audio_level.is_enabled()
        } else {
            existing
                .audio_fixed_ceiling
                .unwrap_or(existing_audio_level.is_enabled())
        }
    });

    build_player_enhancement_config(
        audio_level,
        audio_dynamic_protection,
        audio_fixed_ceiling,
        visual_level,
    )
}

fn merge_live_config(
    existing: Vec<DesktopLiveConfigItem>,
    raw_lives: &BTreeMap<String, RawLiveSource>,
) -> Vec<DesktopLiveConfigItem> {
    let mut merged = existing
        .into_iter()
        .map(|mut item| {
            if let Some(raw_live) = raw_lives.get(&item.key) {
                item.name = raw_live.name.clone();
                item.url = raw_live.url.clone();
                item.ua = normalize_optional_string(raw_live.ua.clone());
                item.epg = normalize_optional_string(raw_live.epg.clone());
                item.from = "config".to_string();
            } else if item.from == "config" {
                item.from = "custom".to_string();
            }
            item
        })
        .collect::<Vec<_>>();

    for (key, raw_live) in raw_lives {
        if merged.iter().any(|item| item.key == *key) {
            continue;
        }

        merged.push(DesktopLiveConfigItem {
            key: key.clone(),
            name: raw_live.name.clone(),
            url: raw_live.url.clone(),
            ua: normalize_optional_string(raw_live.ua.clone()),
            epg: normalize_optional_string(raw_live.epg.clone()),
            from: "config".to_string(),
            channel_number: 0,
            disabled: raw_live.disabled.unwrap_or(false),
        });
    }

    merged
}

fn build_admin_settings_sync_snapshot(config: &DesktopAdminConfig) -> DesktopAdminConfig {
    DesktopAdminConfig {
        site_config: normalize_desktop_site_config(config.site_config.clone()),
        source_config: config.source_config.clone(),
        custom_categories: config.custom_categories.clone(),
        live_config: config.live_config.clone(),
        ad_filter_config: config.ad_filter_config.clone(),
        player_enhancement_config: config.player_enhancement_config.clone(),
        ..DesktopAdminConfig::default()
    }
}

fn apply_admin_settings_to_config_file(
    base_config_file: &str,
    admin_config: &DesktopAdminConfig,
) -> Result<String> {
    let admin_settings = build_admin_settings_sync_snapshot(admin_config);
    let mut config_value = serde_json::from_str::<Value>(base_config_file.trim())
        .context("failed to parse base config file json")?;
    let root = config_value
        .as_object_mut()
        .context("config file root must be an object")?;

    root.insert(
        "cache_time".to_string(),
        Value::Number(admin_settings.site_config.site_interface_cache_time.into()),
    );
    root.insert(
        "search_downstream_max_page".to_string(),
        Value::Number((admin_settings.site_config.search_downstream_max_page as u64).into()),
    );
    root.insert(
        "disable_yellow_filter".to_string(),
        Value::Bool(admin_settings.site_config.disable_yellow_filter),
    );
    root.insert(
        "site_name".to_string(),
        Value::String(admin_settings.site_config.site_name),
    );
    root.insert(
        "announcement".to_string(),
        Value::String(admin_settings.site_config.announcement),
    );
    root.insert(
        "douban_proxy_type".to_string(),
        Value::String(admin_settings.site_config.douban_proxy_type),
    );
    root.insert(
        "douban_proxy".to_string(),
        Value::String(admin_settings.site_config.douban_proxy),
    );
    root.insert(
        "douban_image_proxy_type".to_string(),
        Value::String(admin_settings.site_config.douban_image_proxy_type),
    );
    root.insert(
        "douban_image_proxy".to_string(),
        Value::String(admin_settings.site_config.douban_image_proxy),
    );
    root.insert(
        "enable_web_live".to_string(),
        Value::Bool(admin_settings.site_config.enable_web_live),
    );

    let player_enhancements_entry = root
        .entry("player_enhancements".to_string())
        .or_insert_with(|| json!({}));
    if !player_enhancements_entry.is_object() {
        *player_enhancements_entry = json!({});
    }
    let player_enhancements = player_enhancements_entry
        .as_object_mut()
        .context("player_enhancements must be an object after normalization")?;
    player_enhancements.insert(
        "audio_spike_protection".to_string(),
        Value::Bool(
            admin_settings
                .player_enhancement_config
                .audio_spike_protection,
        ),
    );
    match admin_settings
        .player_enhancement_config
        .audio_spike_protection_level
    {
        Some(level) => {
            player_enhancements.insert(
                "audio_spike_protection_level".to_string(),
                serde_json::to_value(level)
                    .context("failed to serialize audio spike protection level")?,
            );
        }
        None => {
            player_enhancements.remove("audio_spike_protection_level");
        }
    }
    match admin_settings
        .player_enhancement_config
        .audio_dynamic_protection
    {
        Some(value) => {
            player_enhancements.insert("audio_dynamic_protection".to_string(), Value::Bool(value));
        }
        None => {
            player_enhancements.remove("audio_dynamic_protection");
        }
    }
    match admin_settings.player_enhancement_config.audio_fixed_ceiling {
        Some(value) => {
            player_enhancements.insert("audio_fixed_ceiling".to_string(), Value::Bool(value));
        }
        None => {
            player_enhancements.remove("audio_fixed_ceiling");
        }
    }
    player_enhancements.insert(
        "visual_enhancement".to_string(),
        Value::Bool(admin_settings.player_enhancement_config.visual_enhancement),
    );
    match admin_settings
        .player_enhancement_config
        .visual_enhancement_level
    {
        Some(level) => {
            player_enhancements.insert(
                "visual_enhancement_level".to_string(),
                serde_json::to_value(level)
                    .context("failed to serialize visual enhancement level")?,
            );
        }
        None => {
            player_enhancements.remove("visual_enhancement_level");
        }
    }

    root.insert(
        "api_site".to_string(),
        Value::Object(
            admin_settings
                .source_config
                .into_iter()
                .map(|source| {
                    (
                        source.key,
                        json!({
                            "api": source.api,
                            "name": source.name,
                            "detail": source.detail,
                            "ua": source.ua,
                            "referer": source.referer,
                            "disabled": source.disabled,
                            "disable_ad_filter": source.disable_ad_filter
                        }),
                    )
                })
                .collect(),
        ),
    );
    root.insert(
        "custom_category".to_string(),
        Value::Array(
            admin_settings
                .custom_categories
                .into_iter()
                .map(|category| {
                    json!({
                        "name": category.name,
                        "type": category.category_type,
                        "query": category.query,
                        "disabled": category.disabled
                    })
                })
                .collect(),
        ),
    );
    root.insert(
        "lives".to_string(),
        Value::Object(
            admin_settings
                .live_config
                .into_iter()
                .map(|live| {
                    (
                        live.key,
                        json!({
                            "name": live.name,
                            "url": live.url,
                            "ua": live.ua,
                            "epg": live.epg,
                            "disabled": live.disabled
                        }),
                    )
                })
                .collect(),
        ),
    );

    serde_json::to_string_pretty(&config_value)
        .context("failed to encode config file with admin settings")
}

fn build_service_config_from_admin(
    admin_config: &DesktopAdminConfig,
    profile_sync_api_base_url: &Option<String>,
    profile_sync_domains: &[String],
) -> ServiceConfig {
    let audio_level = PlayerEnhancementLevel::resolve(
        admin_config
            .player_enhancement_config
            .audio_spike_protection_level,
        Some(
            admin_config
                .player_enhancement_config
                .audio_spike_protection,
        ),
        PlayerEnhancementLevel::Off,
    );
    let visual_level = PlayerEnhancementLevel::resolve(
        admin_config
            .player_enhancement_config
            .visual_enhancement_level,
        Some(admin_config.player_enhancement_config.visual_enhancement),
        PlayerEnhancementLevel::Off,
    );
    let audio_dynamic_protection = admin_config
        .player_enhancement_config
        .audio_dynamic_protection
        .unwrap_or(audio_level.is_enabled());
    let audio_fixed_ceiling = admin_config
        .player_enhancement_config
        .audio_fixed_ceiling
        .unwrap_or(audio_level.is_enabled());

    ServiceConfig {
        cache_time: admin_config.site_config.site_interface_cache_time.max(1),
        max_search_pages: admin_config.site_config.search_downstream_max_page.max(1),
        adult_content_filter_enabled: !admin_config.site_config.disable_yellow_filter,
        vod_ad_filter_enabled: admin_config.ad_filter_config.enabled,
        fluid_search: admin_config.site_config.fluid_search,
        player_audio_spike_protection: audio_level.is_enabled(),
        player_audio_spike_protection_level: audio_level,
        player_audio_dynamic_protection: audio_dynamic_protection,
        player_audio_fixed_ceiling: audio_fixed_ceiling,
        player_visual_enhancement: visual_level.is_enabled(),
        player_visual_enhancement_level: visual_level,
        site_name: normalize_owned_string(Some(admin_config.site_config.site_name.clone())),
        announcement: normalize_owned_string(Some(admin_config.site_config.announcement.clone())),
        douban_proxy_type: normalize_owned_string(Some(
            admin_config.site_config.douban_proxy_type.clone(),
        )),
        douban_proxy: normalize_owned_string(Some(admin_config.site_config.douban_proxy.clone())),
        douban_image_proxy_type: normalize_owned_string(Some(
            admin_config.site_config.douban_image_proxy_type.clone(),
        )),
        douban_image_proxy: normalize_owned_string(Some(
            admin_config.site_config.douban_image_proxy.clone(),
        )),
        enable_web_live_override: Some(admin_config.site_config.enable_web_live),
        profile_sync_api_base_url: profile_sync_api_base_url.clone(),
        profile_sync_domains: normalize_profile_sync_selected_domains(Some(
            profile_sync_domains.to_vec(),
        )),
        api_sites: admin_config
            .source_config
            .iter()
            .map(|source| ApiSite {
                key: source.key.clone(),
                api: source.api.clone(),
                name: source.name.clone(),
                detail: source.detail.clone(),
                ua: source.ua.clone(),
                referer: source.referer.clone(),
                disabled: source.disabled,
                disable_ad_filter: source.disable_ad_filter,
            })
            .collect(),
        custom_categories: admin_config
            .custom_categories
            .iter()
            .filter(|category| !category.disabled)
            .map(|category| RuntimeCustomCategory {
                name: category.name.clone().unwrap_or_default(),
                category_type: category.category_type.clone(),
                query: category.query.clone(),
            })
            .collect(),
        live_sources: admin_config
            .live_config
            .iter()
            .map(|live| LiveSourceConfig {
                key: live.key.clone(),
                name: live.name.clone(),
                url: live.url.clone(),
                ua: live.ua.clone(),
                epg: live.epg.clone(),
                disabled: live.disabled,
            })
            .collect(),
    }
}

fn hash_desktop_password(password: &str) -> String {
    let mut salt_bytes = [0_u8; 16];
    rand::rng().fill(&mut salt_bytes);
    let salt = SaltString::encode_b64(&salt_bytes).expect("failed to encode desktop password salt");
    Argon2::default()
        .hash_password(password.as_bytes(), &salt)
        .expect("failed to hash desktop password")
        .to_string()
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

fn normalize_owned_string(value: Option<String>) -> Option<String> {
    normalize_optional_string(value)
}

fn normalize_desktop_site_config(site_config: DesktopSiteConfig) -> DesktopSiteConfig {
    DesktopSiteConfig {
        site_name: normalize_owned_string(Some(site_config.site_name))
            .unwrap_or_else(default_site_name),
        announcement: normalize_owned_string(Some(site_config.announcement))
            .unwrap_or_else(default_site_announcement),
        search_downstream_max_page: site_config.search_downstream_max_page.max(1),
        site_interface_cache_time: site_config.site_interface_cache_time.max(1),
        douban_proxy_type: normalize_owned_string(Some(site_config.douban_proxy_type))
            .unwrap_or_else(default_douban_proxy_type),
        douban_proxy: normalize_owned_string(Some(site_config.douban_proxy)).unwrap_or_default(),
        douban_image_proxy_type: normalize_owned_string(Some(site_config.douban_image_proxy_type))
            .unwrap_or_else(default_douban_image_proxy_type),
        douban_image_proxy: normalize_owned_string(Some(site_config.douban_image_proxy))
            .unwrap_or_default(),
        disable_yellow_filter: site_config.disable_yellow_filter,
        fluid_search: site_config.fluid_search,
        enable_web_live: site_config.enable_web_live,
    }
}

fn normalize_string_list(values: Vec<String>) -> Vec<String> {
    let mut normalized = Vec::new();
    for value in values {
        if let Some(next_value) = normalize_optional_string(Some(value)) {
            if !normalized.iter().any(|existing| existing == &next_value) {
                normalized.push(next_value);
            }
        }
    }
    normalized
}

fn require_owned_string(value: Option<String>, message: &str) -> AppResult<String> {
    normalize_owned_string(value).ok_or_else(|| AppError::bad_request(message))
}

fn require_non_empty_string_list(
    value: Option<Vec<String>>,
    message: &str,
) -> AppResult<Vec<String>> {
    let normalized = normalize_string_list(value.unwrap_or_default());
    if normalized.is_empty() {
        return Err(AppError::bad_request(message));
    }
    Ok(normalized)
}

fn remove_api_keys_from_user_config(user_config: &mut DesktopUserConfig, api_keys: &[String]) {
    if api_keys.is_empty() {
        return;
    }

    user_config.tags.iter_mut().for_each(|tag| {
        tag.enabled_apis
            .retain(|api| !api_keys.iter().any(|key| key == api));
    });
    user_config.users.iter_mut().for_each(|user| {
        user.enabled_apis
            .retain(|api| !api_keys.iter().any(|key| key == api));
    });
}

fn reorder_by_key<T, F>(items: &mut Vec<T>, order: &[String], key_fn: F)
where
    F: Fn(&T) -> String,
{
    let mut remaining = std::mem::take(items);
    let mut reordered = Vec::with_capacity(remaining.len());

    for expected_key in order {
        if let Some(index) = remaining
            .iter()
            .position(|item| key_fn(item) == *expected_key)
        {
            reordered.push(remaining.remove(index));
        }
    }

    reordered.extend(remaining);
    *items = reordered;
}

fn find_admin_user_mut<'a>(
    users: &'a mut [DesktopUserConfigItem],
    username: &str,
) -> Option<&'a mut DesktopUserConfigItem> {
    users.iter_mut().find(|user| user.username == username)
}

fn filter_known_user_groups(
    requested_groups: Vec<String>,
    available_groups: &[DesktopUserTagConfigItem],
) -> Vec<String> {
    let available_group_names = available_groups
        .iter()
        .map(|tag| tag.name.clone())
        .collect::<Vec<_>>();

    normalize_string_list(requested_groups)
        .into_iter()
        .filter(|group_name| available_group_names.iter().any(|name| name == group_name))
        .collect()
}

fn normalize_user_config(
    mut user_config: DesktopUserConfig,
    owner_username: &str,
) -> DesktopUserConfig {
    user_config.tags = user_config
        .tags
        .into_iter()
        .filter_map(|tag| {
            let name = normalize_owned_string(Some(tag.name))?;
            Some(DesktopUserTagConfigItem {
                name,
                enabled_apis: normalize_string_list(tag.enabled_apis),
            })
        })
        .collect::<Vec<_>>();

    let mut seen_users = BTreeMap::new();
    for user in std::mem::take(&mut user_config.users) {
        if let Some(username) = normalize_owned_string(Some(user.username)) {
            if seen_users.contains_key(&username) {
                continue;
            }
            seen_users.insert(
                username.clone(),
                DesktopUserConfigItem {
                    username,
                    role: if user.role == "admin" || user.role == "owner" {
                        user.role
                    } else {
                        "user".to_string()
                    },
                    banned: user.banned,
                    enabled_apis: normalize_string_list(user.enabled_apis),
                    tags: filter_known_user_groups(user.tags, &user_config.tags),
                },
            );
        }
    }

    let owner_entry = seen_users
        .remove(owner_username)
        .unwrap_or(DesktopUserConfigItem {
            username: owner_username.to_string(),
            role: "owner".to_string(),
            banned: false,
            enabled_apis: Vec::new(),
            tags: Vec::new(),
        });

    let mut users = vec![DesktopUserConfigItem {
        username: owner_username.to_string(),
        role: "owner".to_string(),
        banned: false,
        enabled_apis: owner_entry.enabled_apis,
        tags: owner_entry.tags,
    }];

    users.extend(seen_users.into_values().map(|mut user| {
        if user.role == "owner" {
            user.role = "user".to_string();
        }
        user
    }));

    DesktopUserConfig {
        users,
        tags: user_config.tags,
    }
}

fn should_proxy_admin_data_migration(state: &AppState) -> Result<bool> {
    Ok(state.load_config()?.profile_sync_api_base_url.is_some())
}

fn build_local_admin_data_migration_archive(state: &AppState) -> Result<AdminDataMigrationArchive> {
    let persistence = state.load_admin_persistence()?;
    let admin_config = build_admin_settings_sync_snapshot(&persistence.config);

    Ok(AdminDataMigrationArchive {
        timestamp: current_iso_timestamp(),
        server_version: env!("CARGO_PKG_VERSION").to_string(),
        data: AdminDataMigrationArchiveData {
            admin_config,
            user_data: BTreeMap::new(),
            desktop_metadata: Some(AdminDataMigrationDesktopMetadata {
                scope: "desktop-local".to_string(),
                note: DESKTOP_LOCAL_DATA_MIGRATION_NOTE.to_string(),
                includes_browser_local_data: false,
                includes_remote_profile_data: false,
            }),
        },
    })
}

fn import_local_admin_data_migration_archive(
    state: &AppState,
    archive: &AdminDataMigrationArchive,
) -> Result<()> {
    let current_persistence = state.load_admin_persistence()?;
    let imported_admin_settings = build_admin_settings_sync_snapshot(&archive.data.admin_config);
    let current_owner_username =
        extract_owner_username_from_config_file(&current_persistence.config.config_file);
    let current_owner_password =
        extract_owner_password_from_config_file(&current_persistence.config.config_file);
    let prepared_config_file = apply_admin_settings_to_config_file(
        &current_persistence.config.config_file,
        &imported_admin_settings,
    )
    .and_then(|config_file| {
        apply_desktop_runtime_overrides_to_config_file(
            &config_file,
            current_owner_username.as_deref(),
            current_owner_password.as_deref(),
            current_persistence.profile_sync_api_base_url.as_deref(),
            current_persistence
                .profile_sync_api_base_url
                .as_ref()
                .map(|_| current_persistence.profile_sync_sync_domains.as_slice()),
        )
    })?;

    let imported_persistence = DesktopAdminPersistence {
        config: DesktopAdminConfig {
            config_subscribtion: current_persistence.config.config_subscribtion,
            config_file: prepared_config_file.clone(),
            user_config: current_persistence.config.user_config,
            site_config: imported_admin_settings.site_config,
            source_config: imported_admin_settings.source_config,
            custom_categories: imported_admin_settings.custom_categories,
            live_config: imported_admin_settings.live_config,
            ad_filter_config: imported_admin_settings.ad_filter_config,
            player_enhancement_config: imported_admin_settings.player_enhancement_config,
        },
        user_passwords: current_persistence.user_passwords,
        profile_sync_api_base_url: current_persistence.profile_sync_api_base_url,
        profile_sync_sync_domains: current_persistence.profile_sync_sync_domains,
    };

    state.write_raw_config(&prepared_config_file)?;
    state.save_admin_persistence(&imported_persistence)?;

    // Re-load once so the persisted desktop state is normalized against the raw config.
    let merged_persistence = state.load_admin_persistence()?;
    state.save_admin_persistence(&merged_persistence)?;

    Ok(())
}
pub(crate) fn resolve_owner_username_for_import(
    admin_config: &DesktopAdminConfig,
) -> Option<String> {
    admin_config
        .user_config
        .users
        .iter()
        .find(|user| user.role == "owner")
        .map(|user| user.username.clone())
        .or_else(|| extract_owner_username_from_config_file(&admin_config.config_file))
        .or_else(|| {
            admin_config
                .user_config
                .users
                .first()
                .map(|user| user.username.clone())
        })
}

fn extract_owner_username_from_config_file(config_file: &str) -> Option<String> {
    serde_json::from_str::<RawServiceConfig>(config_file.trim())
        .ok()
        .and_then(|config| normalize_optional_string(config.auth.username))
}

fn extract_owner_password_from_config_file(config_file: &str) -> Option<String> {
    serde_json::from_str::<RawServiceConfig>(config_file.trim())
        .ok()
        .and_then(|config| normalize_optional_string(config.auth.password))
}

fn parse_local_admin_data_migration_archive(
    encrypted_data: &str,
    password: &str,
) -> Result<AdminDataMigrationArchive> {
    let compressed_base64 = cryptojs_aes_decrypt_text(encrypted_data, password)?;
    let compressed = BASE64_STANDARD
        .decode(compressed_base64.trim())
        .context("failed to decode encrypted backup payload")?;
    let archive_json = gunzip_bytes(&compressed)?;
    serde_json::from_slice::<AdminDataMigrationArchive>(&archive_json)
        .context("backup file json is invalid")
}

fn build_binary_file_response(body: String, filename: &str) -> AppResult<Response> {
    let mut response = Response::builder()
        .status(StatusCode::OK)
        .body(Body::from(body.clone()))
        .map_err(|error| AppError::internal(error.to_string()))?;

    response.headers_mut().insert(
        CONTENT_TYPE,
        HeaderValue::from_static("application/octet-stream"),
    );
    response.headers_mut().insert(
        CONTENT_DISPOSITION,
        HeaderValue::from_str(&format!("attachment; filename=\"{filename}\""))
            .map_err(|error| AppError::internal(error.to_string()))?,
    );
    response.headers_mut().insert(
        CONTENT_LENGTH,
        HeaderValue::from_str(&body.len().to_string())
            .map_err(|error| AppError::internal(error.to_string()))?,
    );
    response
        .headers_mut()
        .insert(CACHE_CONTROL, HeaderValue::from_static("no-store"));

    Ok(response)
}

fn gzip_bytes(payload: &[u8]) -> Result<Vec<u8>> {
    let mut encoder = GzEncoder::new(Vec::new(), Compression::default());
    encoder.write_all(payload)?;
    encoder.finish().context("failed to finish gzip encoding")
}

fn gunzip_bytes(payload: &[u8]) -> Result<Vec<u8>> {
    let mut decoder = GzDecoder::new(payload);
    let mut decoded = Vec::new();
    decoder
        .read_to_end(&mut decoded)
        .context("failed to gunzip backup payload")?;
    Ok(decoded)
}

fn cryptojs_aes_encrypt_text(plaintext: &str, password: &str) -> Result<String> {
    let mut salt = [0_u8; 8];
    rand::rng().fill(&mut salt);
    let (key, iv) = derive_openssl_key_iv(password.as_bytes(), &salt, 32, 16);
    let encryptor = Encryptor::<Aes256>::new_from_slices(&key, &iv)
        .context("failed to initialize backup encryptor")?;
    let mut buffer = plaintext.as_bytes().to_vec();
    let original_len = buffer.len();
    let padded_len = ((original_len / 16) + 1) * 16;
    buffer.resize(padded_len, 0);
    let ciphertext = encryptor
        .encrypt_padded_mut::<Pkcs7>(&mut buffer, original_len)
        .map_err(|error| anyhow::anyhow!("failed to encrypt backup payload: {error}"))?;

    let mut openssl_payload =
        Vec::with_capacity(OPENSSL_SALTED_PREFIX.len() + salt.len() + ciphertext.len());
    openssl_payload.extend_from_slice(OPENSSL_SALTED_PREFIX);
    openssl_payload.extend_from_slice(&salt);
    openssl_payload.extend_from_slice(ciphertext);
    Ok(BASE64_STANDARD.encode(openssl_payload))
}

fn cryptojs_aes_decrypt_text(encrypted_data: &str, password: &str) -> Result<String> {
    let payload = BASE64_STANDARD
        .decode(encrypted_data.trim())
        .context("failed to decode encrypted backup payload")?;
    if payload.len() < OPENSSL_SALTED_PREFIX.len() + 8
        || &payload[..OPENSSL_SALTED_PREFIX.len()] != OPENSSL_SALTED_PREFIX
    {
        anyhow::bail!("invalid encrypted backup payload");
    }

    let salt_start = OPENSSL_SALTED_PREFIX.len();
    let salt_end = salt_start + 8;
    let salt = &payload[salt_start..salt_end];
    let ciphertext = &payload[salt_end..];
    let (key, iv) = derive_openssl_key_iv(password.as_bytes(), salt, 32, 16);
    let decryptor = Decryptor::<Aes256>::new_from_slices(&key, &iv)
        .context("failed to initialize backup decryptor")?;
    let mut buffer = ciphertext.to_vec();
    let plaintext = decryptor
        .decrypt_padded_mut::<Pkcs7>(&mut buffer)
        .map_err(|_| anyhow::anyhow!("decrypt failed"))?;

    String::from_utf8(plaintext.to_vec()).context("decrypted backup payload is not utf-8")
}

fn derive_openssl_key_iv(
    password: &[u8],
    salt: &[u8],
    key_len: usize,
    iv_len: usize,
) -> (Vec<u8>, Vec<u8>) {
    let mut derived = Vec::with_capacity(key_len + iv_len);
    let mut previous = Vec::new();

    while derived.len() < key_len + iv_len {
        let mut digest = Md5::new();
        if !previous.is_empty() {
            digest.update(&previous);
        }
        digest.update(password);
        digest.update(salt);
        previous = digest.finalize().to_vec();
        derived.extend_from_slice(&previous);
    }

    let key = derived[..key_len].to_vec();
    let iv = derived[key_len..key_len + iv_len].to_vec();
    (key, iv)
}

fn no_store_json_response<T: Serialize>(payload: &T) -> AppResult<Response> {
    let mut response = Json(payload).into_response();
    response
        .headers_mut()
        .insert(CACHE_CONTROL, HeaderValue::from_static("no-store"));
    Ok(response)
}

fn current_timestamp_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_else(|_| Duration::from_secs(0))
        .as_millis() as u64
}

fn stable_hash_key(value: &str) -> String {
    let mut digest = Sha256::new();
    digest.update(value.as_bytes());
    digest
        .finalize()
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

fn normalize_optional_text(value: Option<&str>) -> Option<String> {
    value.and_then(|item| {
        let normalized = item.trim();
        if normalized.is_empty() {
            None
        } else {
            Some(normalized.to_string())
        }
    })
}

static ATOMIC_WRITE_SEQUENCE: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);

pub(crate) const DOWNLOAD_RUNTIME_CACHE_MAX_BYTES: u64 = 8 * 1024 * 1024 * 1024;
pub(crate) const MAX_DOWNLOAD_CACHE_ENTRY_BYTES: usize = 256 * 1024 * 1024;

// 原子写：先写同目录临时文件再 rename。rename 在同一文件系统上是原子的，
// 读侧永远只会看到完整的旧文件或完整的新文件，也不会顺着预置符号链接去覆盖目标。
fn write_file_atomic(path: &Path, contents: &[u8]) -> Result<()> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .with_context(|| format!("failed to create {}", parent.display()))?;
    }

    let file_name = path
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("tmp");
    let temp_path = path.with_file_name(format!(
        ".{file_name}.tmp.{}.{}",
        std::process::id(),
        ATOMIC_WRITE_SEQUENCE.fetch_add(1, std::sync::atomic::Ordering::Relaxed)
    ));

    let write_result = fs::write(&temp_path, contents);
    if write_result.is_ok() {
        if let Err(error) = fs::rename(&temp_path, path) {
            let _ = fs::remove_file(&temp_path);
            return Err(error).with_context(|| format!("failed to rename {}", temp_path.display()));
        }
        return Ok(());
    }

    write_result.with_context(|| format!("failed to write {}", temp_path.display()))
}

fn dir_files_size_bytes(dir: &Path) -> u64 {
    fs::read_dir(dir)
        .map(|entries| {
            entries
                .filter_map(Result::ok)
                .filter_map(|entry| entry.metadata().ok())
                .filter(|metadata| metadata.is_file())
                .fold(0_u64, |sum, metadata| sum.saturating_add(metadata.len()))
        })
        .unwrap_or(0)
}

fn write_json_file<T: Serialize>(path: &Path, payload: &T) -> Result<()> {
    let contents = serde_json::to_string_pretty(payload).context("failed to encode json")?;
    write_file_atomic(path, contents.as_bytes())
}

fn read_json_file<T: DeserializeOwned>(path: &Path) -> Result<T> {
    let contents =
        fs::read_to_string(path).with_context(|| format!("failed to read {}", path.display()))?;
    serde_json::from_str(&contents).with_context(|| format!("failed to decode {}", path.display()))
}

fn delete_if_exists(path: &Path) -> Result<bool> {
    if !path.exists() {
        return Ok(false);
    }

    fs::remove_file(path).with_context(|| format!("failed to remove {}", path.display()))?;
    Ok(true)
}

fn remove_dir_contents_if_exists(path: &Path) -> Result<()> {
    if path.exists() {
        fs::remove_dir_all(path).with_context(|| format!("failed to remove {}", path.display()))?;
    }
    fs::create_dir_all(path).with_context(|| format!("failed to create {}", path.display()))?;
    Ok(())
}

fn apply_query_cache_headers(headers: &mut HeaderMap, cache_time: u64) {
    if let Ok(value) = HeaderValue::from_str(&format!("public, max-age={cache_time}")) {
        headers.insert(CACHE_CONTROL, value);
    }
}

fn normalize_positive_douban_id(value: Option<i64>) -> Option<i64> {
    value.filter(|value| *value > 0)
}

fn is_valid_content_id(id: &str) -> bool {
    id.chars()
        .all(|character| character.is_ascii_alphanumeric() || character == '_' || character == '-')
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
    let api_base_url = api_base_url.trim();
    Url::parse(api_base_url).with_context(|| format!("invalid api url: {api_base_url}"))?;

    if params.is_empty() {
        return Ok(api_base_url.to_string());
    }

    let separator = if api_base_url.ends_with('?') || api_base_url.ends_with('&') {
        ""
    } else if collection_api_url_uses_wrapped_target(api_base_url) {
        "?"
    } else if api_base_url.contains('?') {
        "&"
    } else {
        "?"
    };

    Ok(format!(
        "{api_base_url}{separator}{}",
        build_collection_api_query(params)
    ))
}

fn collection_api_url_uses_wrapped_target(api_base_url: &str) -> bool {
    match Url::parse(api_base_url) {
        Ok(url) => url.query_pairs().any(|(key, _)| key == "url"),
        Err(_) => false,
    }
}

fn build_collection_api_query(params: &[(&str, &str)]) -> String {
    params
        .iter()
        .map(|(key, value)| {
            format!(
                "{}={}",
                encode_collection_api_query_component(key),
                encode_collection_api_query_component(value)
            )
        })
        .collect::<Vec<_>>()
        .join("&")
}

fn encode_collection_api_query_component(value: &str) -> String {
    form_urlencoded::byte_serialize(value.as_bytes())
        .collect::<String>()
        .replace('+', "%20")
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

fn build_douban_html_headers() -> ReqwestHeaderMap {
    let mut headers = ReqwestHeaderMap::new();
    headers.insert(USER_AGENT, HeaderValue::from_static(DEFAULT_WEB_UA));
    headers.insert(
        REFERER,
        HeaderValue::from_static("https://movie.douban.com/"),
    );
    headers.insert(
        reqwest::header::ACCEPT,
        HeaderValue::from_static(
            "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
        ),
    );
    headers
}

fn parse_i64_query_param(raw_value: Option<&str>, default_value: i64) -> i64 {
    raw_value
        .and_then(|value| value.trim().parse::<i64>().ok())
        .unwrap_or(default_value)
}

fn normalize_douban_filter_value(raw_value: Option<String>) -> Option<String> {
    match normalize_owned_string(raw_value) {
        Some(value) if value == "all" => None,
        value => value,
    }
}

fn normalize_douban_sort_value(raw_value: Option<String>) -> Option<String> {
    match normalize_owned_string(raw_value) {
        Some(value) if value == "T" => None,
        value => value,
    }
}

fn normalize_douban_search_limit(raw_limit: Option<&str>) -> usize {
    let parsed_limit = raw_limit
        .and_then(|value| value.trim().parse::<usize>().ok())
        .unwrap_or(DOUBAN_SEARCH_PAGE_SIZE);
    parsed_limit.clamp(1, MAX_DOUBAN_SEARCH_LIMIT)
}

fn normalize_douban_search_start(raw_start: Option<&str>) -> usize {
    raw_start
        .and_then(|value| value.trim().parse::<i64>().ok())
        .filter(|value| *value >= 0)
        .map(|value| value as usize)
        .unwrap_or(0)
}

fn build_url_with_query(base_url: &str, path: &str, params: &[(&str, String)]) -> Result<String> {
    let normalized_path = if path.starts_with('/') {
        path.to_string()
    } else {
        format!("/{path}")
    };
    let mut target = Url::parse(&format!(
        "{}{}",
        base_url.trim_end_matches('/'),
        normalized_path
    ))?;
    {
        let mut query_pairs = target.query_pairs_mut();
        for (key, value) in params {
            query_pairs.append_pair(key, value);
        }
    }
    Ok(target.into())
}

fn resolve_douban_request_url(config: &ServiceConfig, target: &str) -> String {
    match config
        .douban_proxy_type
        .as_deref()
        .unwrap_or(DEFAULT_DOUBAN_PROXY_TYPE)
    {
        "cmliussss-cdn-tencent" => target
            .replace(
                DEFAULT_DOUBAN_API_BASE_URL,
                "https://m.douban.cmliussss.net",
            )
            .replace(
                DEFAULT_DOUBAN_MOVIE_API_BASE_URL,
                "https://movie.douban.cmliussss.net",
            ),
        "cmliussss-cdn-ali" => target
            .replace(
                DEFAULT_DOUBAN_API_BASE_URL,
                "https://m.douban.cmliussss.com",
            )
            .replace(
                DEFAULT_DOUBAN_MOVIE_API_BASE_URL,
                "https://movie.douban.cmliussss.com",
            ),
        "cors-proxy-zwei" => build_douban_encoded_proxy_url("https://ciao-cors.is-an.org/", target),
        "cors-anywhere" => build_douban_direct_proxy_url("https://cors-anywhere.com/", target),
        "custom" => build_douban_encoded_proxy_url(
            config.douban_proxy.as_deref().unwrap_or_default(),
            target,
        ),
        _ => target.to_string(),
    }
}

fn build_douban_direct_proxy_url(proxy_url: &str, target: &str) -> String {
    if proxy_url.trim().is_empty() {
        return target.to_string();
    }

    format!("{proxy_url}{target}")
}

fn build_douban_encoded_proxy_url(proxy_url: &str, target: &str) -> String {
    if proxy_url.trim().is_empty() {
        return target.to_string();
    }

    format!(
        "{proxy_url}{}",
        form_urlencoded::byte_serialize(target.as_bytes()).collect::<String>()
    )
}

async fn fetch_douban_json<T: for<'de> Deserialize<'de>>(
    client: &reqwest::Client,
    config: &ServiceConfig,
    target: &str,
) -> Result<T> {
    let response = client
        .get(resolve_douban_request_url(config, target))
        .headers(build_douban_headers())
        .timeout(Duration::from_millis(DEFAULT_DETAIL_TIMEOUT_MS))
        .send()
        .await?;

    if !response.status().is_success() {
        anyhow::bail!("douban request failed with {}", response.status());
    }

    response.json::<T>().await.map_err(Into::into)
}

fn build_douban_recommend_target(
    base_url: &str,
    kind: &str,
    page_start: usize,
    page_limit: usize,
    category: Option<&str>,
    format: Option<&str>,
    label: Option<&str>,
    region: Option<&str>,
    year: Option<&str>,
    platform: Option<&str>,
    sort: Option<&str>,
) -> Result<String> {
    let mut selected_categories = serde_json::Map::new();
    selected_categories.insert(
        "类型".to_string(),
        Value::String(category.unwrap_or_default().to_string()),
    );
    if let Some(format) = format.filter(|value| !value.is_empty()) {
        selected_categories.insert("形式".to_string(), Value::String(format.to_string()));
    }
    if let Some(region) = region.filter(|value| !value.is_empty()) {
        selected_categories.insert("地区".to_string(), Value::String(region.to_string()));
    }

    let mut tags = Vec::new();
    if let Some(category) = category.filter(|value| !value.is_empty()) {
        tags.push(category.to_string());
    }
    if category.unwrap_or_default().is_empty() {
        if let Some(format) = format.filter(|value| !value.is_empty()) {
            tags.push(format.to_string());
        }
    }
    if let Some(label) = label.filter(|value| !value.is_empty()) {
        tags.push(label.to_string());
    }
    if let Some(region) = region.filter(|value| !value.is_empty()) {
        tags.push(region.to_string());
    }
    if let Some(year) = year.filter(|value| !value.is_empty()) {
        tags.push(year.to_string());
    }
    if let Some(platform) = platform.filter(|value| !value.is_empty()) {
        tags.push(platform.to_string());
    }

    let mut params = vec![
        ("refresh", "0".to_string()),
        ("start", page_start.to_string()),
        ("count", page_limit.to_string()),
        (
            "selected_categories",
            Value::Object(selected_categories).to_string(),
        ),
        ("uncollect", "false".to_string()),
        ("score_range", "0,10".to_string()),
        ("tags", tags.join(",")),
    ];
    if let Some(sort) = sort.filter(|value| !value.is_empty()) {
        params.push(("sort", sort.to_string()));
    }

    build_url_with_query(
        base_url,
        &format!("/rexxar/api/v2/{kind}/recommend"),
        &params,
    )
}

async fn fetch_douban_top250(
    client: &reqwest::Client,
    config: &ServiceConfig,
    movie_base_url: &str,
    page_start: usize,
) -> Result<Vec<DoubanItem>> {
    let target = build_url_with_query(
        movie_base_url,
        "/top250",
        &[("start", page_start.to_string()), ("filter", String::new())],
    )?;
    let response = client
        .get(resolve_douban_request_url(config, &target))
        .headers(build_douban_html_headers())
        .timeout(Duration::from_millis(DEFAULT_DETAIL_TIMEOUT_MS))
        .send()
        .await?;

    if !response.status().is_success() {
        anyhow::bail!("douban top250 request failed with {}", response.status());
    }

    let html = response.text().await?;
    Ok(parse_douban_top250_items(&html))
}

fn douban_top250_item_regex() -> &'static Regex {
    static REGEX: OnceLock<Regex> = OnceLock::new();
    REGEX.get_or_init(|| {
        Regex::new(
            r#"<div class="item">[\s\S]*?<a[^>]+href="https?://movie\.douban\.com/subject/(\d+)/"[\s\S]*?<img[^>]+alt="([^"]+)"[^>]*src="([^"]+)"[\s\S]*?<span class="rating_num"[^>]*>([^<]*)</span>[\s\S]*?</div>"#,
        )
        .expect("valid douban top250 regex")
    })
}

fn parse_douban_top250_items(html: &str) -> Vec<DoubanItem> {
    douban_top250_item_regex()
        .captures_iter(html)
        .map(|capture| DoubanItem {
            id: capture
                .get(1)
                .map(|value| value.as_str().to_string())
                .unwrap_or_default(),
            title: capture
                .get(2)
                .map(|value| value.as_str().to_string())
                .unwrap_or_default(),
            poster: capture
                .get(3)
                .map(|value| value.as_str().replace("http://", "https://"))
                .unwrap_or_default(),
            rate: capture
                .get(4)
                .map(|value| value.as_str().trim().to_string())
                .unwrap_or_default(),
            year: String::new(),
            play_type: None,
        })
        .collect()
}

async fn fetch_douban_search_page(
    client: &reqwest::Client,
    config: &ServiceConfig,
    search_base_url: &str,
    query: &str,
    start: usize,
) -> Result<DoubanSearchPageData> {
    let mut params = vec![
        ("search_text", query.to_string()),
        ("cat", "1002".to_string()),
    ];
    if start > 0 {
        params.push(("start", start.to_string()));
    }

    let target = build_url_with_query(search_base_url, "/movie/subject_search", &params)?;
    let response = client
        .get(resolve_douban_request_url(config, &target))
        .headers(build_douban_html_headers())
        .timeout(Duration::from_millis(DEFAULT_DETAIL_TIMEOUT_MS))
        .send()
        .await?;

    if !response.status().is_success() {
        anyhow::bail!("douban search request failed with {}", response.status());
    }

    let html = response.text().await?;
    extract_douban_search_data(&html)
}

fn douban_search_data_regex() -> &'static Regex {
    static REGEX: OnceLock<Regex> = OnceLock::new();
    REGEX.get_or_init(|| {
        Regex::new(r#"(?s)window\.__DATA__\s*=\s*(\{.*?\})\s*;"#)
            .expect("valid douban search data regex")
    })
}

fn extract_douban_search_data(html: &str) -> Result<DoubanSearchPageData> {
    let payload = douban_search_data_regex()
        .captures(html)
        .and_then(|captures| captures.get(1))
        .map(|value| value.as_str())
        .ok_or_else(|| anyhow::anyhow!("未找到豆瓣搜索结果数据"))?;

    serde_json::from_str::<DoubanSearchPageData>(payload).map_err(Into::into)
}

fn douban_search_year_suffix_regex() -> &'static Regex {
    static REGEX: OnceLock<Regex> = OnceLock::new();
    REGEX.get_or_init(|| {
        Regex::new(r#"\s*[（(]\d{4}[)）]\s*$"#).expect("valid douban search year suffix regex")
    })
}

fn douban_search_year_regex() -> &'static Regex {
    static REGEX: OnceLock<Regex> = OnceLock::new();
    REGEX.get_or_init(|| {
        Regex::new(r#"[（(](\d{4})[)）]\s*$"#).expect("valid douban search year regex")
    })
}

fn douban_any_year_regex() -> &'static Regex {
    static REGEX: OnceLock<Regex> = OnceLock::new();
    REGEX.get_or_init(|| Regex::new(r#"(\d{4})"#).expect("valid douban any year regex"))
}

fn sanitize_douban_title(raw_title: &str) -> String {
    let without_mark = raw_title.replace('\u{200e}', "");
    douban_search_year_suffix_regex()
        .replace_all(without_mark.trim(), "")
        .trim()
        .to_string()
}

fn extract_search_title_year(raw_title: &str) -> String {
    douban_search_year_regex()
        .captures(raw_title)
        .and_then(|captures| captures.get(1))
        .map(|value| value.as_str().to_string())
        .unwrap_or_default()
}

fn extract_any_year(raw_text: Option<&str>) -> String {
    raw_text
        .and_then(|value| douban_any_year_regex().captures(value))
        .and_then(|captures| captures.get(1))
        .map(|value| value.as_str().to_string())
        .unwrap_or_default()
}

fn format_douban_rating(rating: Option<&DoubanRemoteRating>, require_rating_count: bool) -> String {
    let Some(rating) = rating else {
        return String::new();
    };
    let Some(value) = rating
        .value
        .filter(|value| value.is_finite() && *value > 0.0)
    else {
        return String::new();
    };
    if require_rating_count && rating.count.unwrap_or_default() == 0 {
        return String::new();
    }

    format!("{value:.1}")
}

fn is_douban_search_subject_item(item: &DoubanSearchPageItem) -> bool {
    item.tpl_name.as_deref() == Some("search_subject")
        && item.id.is_some_and(|value| value > 0)
        && item
            .title
            .as_deref()
            .map(|value| !value.trim().is_empty())
            .unwrap_or(false)
}

fn count_douban_search_subject_items(items: &[DoubanSearchPageItem]) -> usize {
    items
        .iter()
        .filter(|item| is_douban_search_subject_item(item))
        .count()
}

fn infer_douban_search_play_type(item: &DoubanSearchPageItem) -> &'static str {
    if item
        .labels
        .iter()
        .any(|label| label.text.as_deref() == Some("剧集"))
    {
        "tv"
    } else {
        "movie"
    }
}

fn map_douban_search_item(item: &DoubanSearchPageItem) -> DoubanItem {
    DoubanItem {
        id: item.id.unwrap_or_default().to_string(),
        title: sanitize_douban_title(item.title.as_deref().unwrap_or_default()),
        poster: item.cover_url.clone().unwrap_or_default(),
        rate: format_douban_rating(item.rating.as_ref(), true),
        year: extract_search_title_year(item.title.as_deref().unwrap_or_default()),
        play_type: Some(infer_douban_search_play_type(item)),
    }
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
        disable_yellow_filter: !config.adult_content_filter_enabled,
        fluid_search: config.fluid_search,
        enable_web_live: config
            .enable_web_live_override
            .unwrap_or_else(|| config.live_sources.iter().any(|source| !source.disabled)),
        player_audio_spike_protection: config.player_audio_spike_protection,
        player_audio_spike_protection_level: config.player_audio_spike_protection_level,
        player_audio_dynamic_protection: config.player_audio_dynamic_protection,
        player_audio_fixed_ceiling: config.player_audio_fixed_ceiling,
        player_visual_enhancement: config.player_visual_enhancement,
        player_visual_enhancement_level: config.player_visual_enhancement_level,
        profile_sync_enabled: config.profile_sync_api_base_url.is_some(),
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

async fn refresh_admin_live_channel_count(
    state: &AppState,
    live_source: &DesktopLiveConfigItem,
) -> usize {
    let runtime_live_source = LiveSourceConfig {
        key: live_source.key.clone(),
        name: live_source.name.clone(),
        url: live_source.url.clone(),
        ua: live_source.ua.clone(),
        epg: live_source.epg.clone(),
        disabled: live_source.disabled,
    };

    refresh_live_channels_cache(state, &runtime_live_source)
        .await
        .map(|cache| cache.channel_number)
        .unwrap_or(0)
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

const MAX_VOD_UPSTREAM_URL_LENGTH: usize = 8192;

// 上游 URL 安全校验：只放行 http/https，并拒绝云元数据/链路本地等内网直连目标。
// 注意：回环与 RFC1918 私网被有意保留为允许——自建 LAN 内容源是受支持场景，
// 且本地测试/开发的 mock 上游就绑定在 127.0.0.1 上。发现更高危目标请在此收紧。
fn is_blocked_vod_proxy_host(host: url::Host<&str>) -> bool {
    match host {
        url::Host::Domain(_) => false,
        url::Host::Ipv4(address) => address.is_link_local() || address.is_unspecified(),
        url::Host::Ipv6(address) => {
            address.is_unspecified()
                || address.is_unicast_link_local()
                || address.is_unique_local()
                || address
                    .to_ipv4_mapped()
                    .is_some_and(|mapped| mapped.is_link_local() || mapped.is_unspecified())
        }
    }
}

fn is_unsafe_vod_upstream_url(url: &Url) -> bool {
    if !matches!(url.scheme(), "http" | "https") {
        return true;
    }
    match url.host() {
        Some(host) => is_blocked_vod_proxy_host(host),
        None => true,
    }
}

fn vod_upstream_redirect_policy() -> reqwest::redirect::Policy {
    reqwest::redirect::Policy::custom(|attempt| {
        if is_unsafe_vod_upstream_url(attempt.url()) {
            attempt.stop()
        } else {
            attempt.follow()
        }
    })
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
    if upstream_url.len() > MAX_VOD_UPSTREAM_URL_LENGTH {
        return Err(AppError::bad_request("VOD upstream URL is too long"));
    }
    let parsed_upstream_url =
        Url::parse(&upstream_url).map_err(|_| AppError::bad_request("Invalid VOD upstream URL"))?;
    if is_unsafe_vod_upstream_url(&parsed_upstream_url) {
        return Err(AppError::bad_request("Disallowed VOD upstream URL"));
    }

    let api_site = config
        .api_sites
        .iter()
        .find(|item| item.key == source && !item.disabled)
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
    fetch_vod_proxy_upstream_with_encoding(client, api_site, upstream_url, request_headers, false)
        .await
}

async fn fetch_vod_proxy_upstream_with_identity_encoding(
    client: &reqwest::Client,
    api_site: &ApiSite,
    upstream_url: &str,
    request_headers: &HeaderMap,
) -> AppResult<reqwest::Response> {
    fetch_vod_proxy_upstream_with_encoding(client, api_site, upstream_url, request_headers, true)
        .await
}

async fn fetch_vod_proxy_upstream_with_encoding(
    client: &reqwest::Client,
    api_site: &ApiSite,
    upstream_url: &str,
    request_headers: &HeaderMap,
    request_identity_encoding: bool,
) -> AppResult<reqwest::Response> {
    let mut headers = build_downstream_headers(api_site, DEFAULT_WEB_UA, Some(request_headers));
    if request_identity_encoding {
        headers.insert(ACCEPT_ENCODING, HeaderValue::from_static("identity"));
    }

    client
        .get(upstream_url)
        .headers(headers)
        .timeout(Duration::from_millis(DEFAULT_PROXY_TIMEOUT_MS))
        .send()
        .await
        .map_err(|error| AppError::internal(error.to_string()))
}

fn upstream_response_uses_non_identity_encoding(response: &reqwest::Response) -> bool {
    response
        .headers()
        .get(CONTENT_ENCODING)
        .and_then(|value| value.to_str().ok())
        .map(|value| {
            value
                .split(',')
                .map(str::trim)
                .any(|encoding| !encoding.is_empty() && !encoding.eq_ignore_ascii_case("identity"))
        })
        .unwrap_or(false)
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

#[derive(Debug, Clone)]
struct VodAdFilterConfig {
    enabled: bool,
    min_ad_duration: f64,
    max_ad_duration: f64,
    max_consecutive_ad_segments: usize,
}

#[derive(Debug, Clone)]
struct ParsedVodAdSegment {
    duration: f64,
    discontinuity_group: usize,
    line_index: usize,
    url_line_index: Option<usize>,
    url: Option<String>,
    is_ad_domain: bool,
}

#[derive(Debug)]
struct ParsedVodAdManifest {
    lines: Vec<String>,
    segments: Vec<ParsedVodAdSegment>,
    discontinuity_count: usize,
}

#[derive(Debug)]
struct FilteredVodManifest {
    filtered: String,
    ads_removed: usize,
    ads_duration: f64,
    changed: bool,
}

fn parse_bool_flag(value: Option<&str>) -> Option<bool> {
    let normalized = value?.trim().to_ascii_lowercase();
    match normalized.as_str() {
        "true" | "1" | "on" | "server" | "proxy" => Some(true),
        "false" | "0" | "off" | "direct" => Some(false),
        _ => None,
    }
}

fn parse_f64_env(name: &str, fallback: f64) -> f64 {
    env::var(name)
        .ok()
        .and_then(|value| value.parse::<f64>().ok())
        .filter(|value| value.is_finite() && *value > 0.0)
        .unwrap_or(fallback)
}

fn parse_usize_env(name: &str, fallback: usize) -> usize {
    env::var(name)
        .ok()
        .and_then(|value| value.parse::<usize>().ok())
        .filter(|value| *value > 0)
        .unwrap_or(fallback)
}

fn build_vod_ad_filter_config(enabled: bool) -> VodAdFilterConfig {
    VodAdFilterConfig {
        enabled,
        min_ad_duration: parse_f64_env(
            "AD_FILTER_MIN_DURATION",
            DEFAULT_VOD_AD_FILTER_MIN_DURATION,
        ),
        max_ad_duration: parse_f64_env(
            "AD_FILTER_MAX_DURATION",
            DEFAULT_VOD_AD_FILTER_MAX_DURATION,
        ),
        max_consecutive_ad_segments: parse_usize_env(
            "AD_FILTER_MAX_SEGMENTS",
            DEFAULT_VOD_AD_FILTER_MAX_SEGMENTS,
        ),
    }
}

fn should_apply_vod_ad_filter(
    config: &ServiceConfig,
    api_site: &ApiSite,
    query_mode: Option<bool>,
) -> bool {
    if api_site.disable_ad_filter {
        return false;
    }

    if let Some(mode) = query_mode {
        return mode;
    }

    if let Some(env_override) = parse_bool_flag(env::var("ENABLE_AD_FILTER").ok().as_deref()) {
        return env_override;
    }

    config.vod_ad_filter_enabled
}

fn is_vod_ad_domain(url: &str) -> bool {
    if url.trim().is_empty() {
        return false;
    }

    let lower_url = url.to_ascii_lowercase();

    for pattern in FORCE_VOD_AD_DOMAIN_PATTERNS {
        if lower_url.contains(pattern) {
            return true;
        }
    }

    for safe_domain in VOD_AD_FILTER_SAFE_DOMAINS {
        if lower_url.contains(safe_domain) {
            return false;
        }
    }

    for pattern in VOD_AD_FILTER_DOMAIN_PATTERNS {
        if lower_url.contains(pattern) {
            return true;
        }
    }

    false
}

fn parse_vod_ad_manifest(content: &str) -> ParsedVodAdManifest {
    let lines = content
        .split('\n')
        .map(|line| line.trim().to_string())
        .collect::<Vec<_>>();
    let mut segments = Vec::new();
    let mut current_segment: Option<ParsedVodAdSegment> = None;
    let mut discontinuity_count = 0usize;
    let mut current_discontinuity_group = 0usize;

    for (index, line) in lines.iter().enumerate() {
        if line.starts_with("#EXT-X-DISCONTINUITY") {
            discontinuity_count += 1;
            current_discontinuity_group = discontinuity_count;
            continue;
        }

        if let Some(duration) = line
            .strip_prefix("#EXTINF:")
            .and_then(|value| value.split(',').next())
            .and_then(|value| value.parse::<f64>().ok())
        {
            current_segment = Some(ParsedVodAdSegment {
                duration,
                discontinuity_group: current_discontinuity_group,
                line_index: index,
                url_line_index: None,
                url: None,
                is_ad_domain: false,
            });
            continue;
        }

        if let Some(segment) = current_segment.as_mut() {
            if !line.is_empty() && !line.starts_with('#') {
                segment.url = Some(line.clone());
                segment.url_line_index = Some(index);
                segment.is_ad_domain = is_vod_ad_domain(line);
                segments.push(segment.clone());
                current_segment = None;
            }
        }
    }

    ParsedVodAdManifest {
        lines,
        segments,
        discontinuity_count,
    }
}

fn detect_vod_ad_segment_indices(
    segments: &[ParsedVodAdSegment],
    config: &VodAdFilterConfig,
) -> BTreeSet<usize> {
    let mut ad_segment_indices = BTreeSet::new();
    let mut groups = BTreeMap::<usize, Vec<usize>>::new();

    for (index, segment) in segments.iter().enumerate() {
        if segment.is_ad_domain {
            ad_segment_indices.insert(index);
        }
        groups
            .entry(segment.discontinuity_group)
            .or_default()
            .push(index);
    }

    if groups.len() <= 1 {
        return ad_segment_indices;
    }

    let mut group_durations = BTreeMap::<usize, f64>::new();
    let mut max_duration = 0.0f64;
    let mut main_content_group = 0usize;

    for (group_key, indices) in &groups {
        let duration = indices
            .iter()
            .map(|index| segments[*index].duration)
            .sum::<f64>();
        group_durations.insert(*group_key, duration);

        if duration > max_duration {
            max_duration = duration;
            main_content_group = *group_key;
        }
    }

    for (group_key, indices) in &groups {
        if *group_key == main_content_group {
            continue;
        }

        let group_duration = *group_durations.get(group_key).unwrap_or(&0.0);
        if group_duration > config.max_ad_duration {
            continue;
        }

        let is_ad_by_duration =
            group_duration >= config.min_ad_duration && group_duration <= config.max_ad_duration;
        let is_ad_by_segment_count = indices.len() <= config.max_consecutive_ad_segments;

        if is_ad_by_duration && is_ad_by_segment_count {
            for index in indices {
                ad_segment_indices.insert(*index);
            }
        }
    }

    ad_segment_indices
}

fn filter_vod_manifest_ads(content: &str, config: &VodAdFilterConfig) -> FilteredVodManifest {
    if !config.enabled || content.contains("#EXT-X-STREAM-INF") {
        return FilteredVodManifest {
            filtered: content.to_string(),
            ads_removed: 0,
            ads_duration: 0.0,
            changed: false,
        };
    }

    let parsed = parse_vod_ad_manifest(content);
    if parsed.discontinuity_count == 0
        && !parsed.segments.iter().any(|segment| segment.is_ad_domain)
    {
        return FilteredVodManifest {
            filtered: content.to_string(),
            ads_removed: 0,
            ads_duration: 0.0,
            changed: false,
        };
    }

    let ad_indices = detect_vod_ad_segment_indices(&parsed.segments, config);
    if ad_indices.is_empty() {
        return FilteredVodManifest {
            filtered: content.to_string(),
            ads_removed: 0,
            ads_duration: 0.0,
            changed: false,
        };
    }

    let url_to_segment_index = parsed
        .segments
        .iter()
        .enumerate()
        .filter_map(|(index, segment)| segment.url.as_ref().map(|url| (url.clone(), index)))
        .collect::<BTreeMap<_, _>>();

    let ads_duration = ad_indices
        .iter()
        .map(|index| parsed.segments[*index].duration)
        .sum::<f64>();

    let mut lines_to_remove = BTreeSet::new();
    for index in &ad_indices {
        let segment = &parsed.segments[*index];
        lines_to_remove.insert(segment.line_index);
        if let Some(url_line_index) = segment.url_line_index {
            lines_to_remove.insert(url_line_index);
        }
    }

    let mut filtered_lines = Vec::new();
    let mut had_content_before = false;
    let mut removed_ad_group = false;

    for (index, line) in parsed.lines.iter().enumerate() {
        if line.starts_with("#EXT-X-DISCONTINUITY") {
            let mut all_ads = true;
            let mut has_segments = false;
            let mut cursor = index + 1;

            while cursor < parsed.lines.len() {
                let next_line = &parsed.lines[cursor];
                if next_line.starts_with("#EXT-X-DISCONTINUITY")
                    || next_line.starts_with("#EXT-X-ENDLIST")
                {
                    break;
                }

                if !next_line.is_empty() && !next_line.starts_with('#') {
                    has_segments = true;
                    if let Some(segment_index) = url_to_segment_index.get(next_line) {
                        if !ad_indices.contains(segment_index) {
                            all_ads = false;
                            break;
                        }
                    }
                }

                cursor += 1;
            }

            if has_segments && all_ads {
                removed_ad_group = true;
                continue;
            }

            if removed_ad_group && had_content_before {
                filtered_lines.push(line.clone());
                removed_ad_group = false;
                continue;
            }
        }

        if !lines_to_remove.contains(&index) {
            filtered_lines.push(line.clone());
            if !line.is_empty() && !line.starts_with('#') {
                if let Some(segment_index) = url_to_segment_index.get(line) {
                    if !ad_indices.contains(segment_index) {
                        had_content_before = true;
                    }
                }
            }
        }
    }

    let mut cleaned_lines = Vec::new();
    for (index, line) in filtered_lines.iter().enumerate() {
        if line.starts_with("#EXT-X-DISCONTINUITY") {
            let mut next_non_empty = "";
            for next_line in filtered_lines.iter().skip(index + 1) {
                if !next_line.trim().is_empty() {
                    next_non_empty = next_line;
                    break;
                }
            }

            if next_non_empty.starts_with("#EXT-X-DISCONTINUITY")
                || next_non_empty.starts_with("#EXT-X-ENDLIST")
                || next_non_empty.is_empty()
            {
                continue;
            }
        }

        cleaned_lines.push(line.clone());
    }

    let mut final_lines = Vec::new();
    let mut found_first_segment = false;
    for line in cleaned_lines {
        if !found_first_segment && line.starts_with("#EXT-X-DISCONTINUITY") {
            continue;
        }

        if line.starts_with("#EXTINF:") {
            found_first_segment = true;
        }

        final_lines.push(line);
    }

    let filtered = final_lines
        .into_iter()
        .filter(|line| !line.starts_with("#EXT-X-DISCONTINUITY"))
        .collect::<Vec<_>>()
        .join("\n");

    FilteredVodManifest {
        filtered,
        ads_removed: ad_indices.len(),
        ads_duration,
        changed: true,
    }
}

fn append_ad_filter_response_headers(headers: &mut HeaderMap, result: &FilteredVodManifest) {
    let existing_exposed_headers = headers
        .get(ACCESS_CONTROL_EXPOSE_HEADERS)
        .and_then(|value| value.to_str().ok())
        .unwrap_or("Content-Length, Content-Range");
    let mut header_names = existing_exposed_headers
        .split(',')
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .collect::<BTreeSet<_>>();

    header_names.insert("X-Ads-Removed".to_string());
    header_names.insert("X-Ads-Duration".to_string());

    if let Ok(value) =
        HeaderValue::from_str(&header_names.into_iter().collect::<Vec<_>>().join(", "))
    {
        headers.insert(ACCESS_CONTROL_EXPOSE_HEADERS, value);
    }

    if result.ads_removed > 0 {
        if let Ok(value) = HeaderValue::from_str(&result.ads_removed.to_string()) {
            headers.insert(HeaderName::from_static("x-ads-removed"), value);
        }
        if let Ok(value) = HeaderValue::from_str(&format!("{:.1}", result.ads_duration)) {
            headers.insert(HeaderName::from_static("x-ads-duration"), value);
        }
    }
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
#[cfg(test)]
mod tests;
