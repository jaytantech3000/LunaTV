use std::{
    collections::{BTreeMap, BTreeSet},
    convert::Infallible,
    env, fs,
    io::{Read, Write},
    path::{Path, PathBuf},
    sync::{Arc, OnceLock},
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
            ACCEPT_RANGES, ACCESS_CONTROL_ALLOW_HEADERS, ACCESS_CONTROL_ALLOW_METHODS,
            ACCESS_CONTROL_ALLOW_ORIGIN, ACCESS_CONTROL_EXPOSE_HEADERS, CACHE_CONTROL,
            CONTENT_DISPOSITION, CONTENT_LENGTH, CONTENT_RANGE, CONTENT_TYPE, ORIGIN, RANGE,
            REFERER, USER_AGENT,
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
use moontv_profile::LocalDesktopProfileStore;
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
mod image_proxy;
mod live_proxy;
mod playback_prefetch;
mod profile_local;
mod profile_sync;
mod profile_sync_onboarding;
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
use image_proxy::get_image_proxy;
use live_proxy::{get_live_key, get_live_logo, get_live_m3u8, get_live_precheck, get_live_segment};
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
use vod_proxy::{get_vod_key, get_vod_m3u8, get_vod_segment};

const DEFAULT_HOST: &str = "127.0.0.1";
const DEFAULT_PORT: u16 = 8787;
const LOCAL_SERVICE_ACCESS_TOKEN_HEADER: &str = "x-moontv-local-token";
const DEFAULT_CONFIG_FILE_NAME: &str = "config.example.json";
const DEFAULT_DATA_DIR_NAME: &str = ".lunatv-desktop";
const DEFAULT_SQLITE_FILE_NAME: &str = "moontv-desktop.sqlite3";
const ADMIN_PERSISTENCE_FILE_NAME: &str = "desktop-admin-state.json";
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
    download_engine: Arc<RwLock<DesktopDownloadEngine>>,
    download_engine_snapshot_tx: watch::Sender<DesktopDownloadEngineSnapshot>,
    download_runtime_active_tasks: Arc<Mutex<BTreeSet<String>>>,
    download_runtime_schedule_lock: Arc<Mutex<()>>,
    profile_sync: ProfileSyncClient,
    profile_sync_session: Arc<RwLock<Option<ProfileSyncSession>>>,
    access_token: Option<String>,
    bangumi_api_base_url: String,
    douban_api_base_url: String,
    douban_movie_api_base_url: String,
    douban_search_api_base_url: String,
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

        let state = Self::try_new(
            cli.host.clone(),
            cli.port,
            config_path,
            data_dir,
            sqlite_path,
        )?;
        Ok(match cli.access_token.clone() {
            Some(access_token) => state.with_access_token(access_token),
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

        Ok(Self {
            host,
            port,
            public_base_url,
            config_path,
            data_dir,
            sqlite_path,
            sqlite,
            client: reqwest::Client::new(),
            download_engine: Arc::new(RwLock::new(download_engine)),
            download_engine_snapshot_tx,
            download_runtime_active_tasks: Arc::new(Mutex::new(BTreeSet::new())),
            download_runtime_schedule_lock: Arc::new(Mutex::new(())),
            profile_sync: ProfileSyncClient::new(
                reqwest::Client::builder()
                    .cookie_store(true)
                    .build()
                    .expect("failed to build profile sync http client"),
            ),
            profile_sync_session: Arc::new(RwLock::new(None)),
            access_token: None,
            bangumi_api_base_url: DEFAULT_BANGUMI_API_BASE_URL.to_string(),
            douban_api_base_url: DEFAULT_DOUBAN_API_BASE_URL.to_string(),
            douban_movie_api_base_url: DEFAULT_DOUBAN_MOVIE_API_BASE_URL.to_string(),
            douban_search_api_base_url: DEFAULT_DOUBAN_SEARCH_API_BASE_URL.to_string(),
            live_channels_cache: Arc::new(RwLock::new(BTreeMap::new())),
        })
    }

    fn bind_addr(&self) -> String {
        format!("{}:{}", effective_bind_host(&self.host), self.port)
    }

    pub fn with_access_token(mut self, access_token: String) -> Self {
        self.access_token = normalize_optional_string(Some(access_token));
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
        self.ensure_download_runtime_dirs()?;
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

        fs::write(&body_path, body)
            .with_context(|| format!("failed to write {}", body_path.display()))?;
        write_json_file(&meta_path, &entry)?;
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

        if !self.cached_download_body_path(url).exists() {
            return Ok(None);
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
        load_admin_persistence(&self.config_path, &self.admin_persistence_path())
    }

    fn save_admin_persistence(&self, persistence: &DesktopAdminPersistence) -> Result<()> {
        save_admin_persistence(&self.admin_persistence_path(), persistence)
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

#[derive(Debug)]
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
        .with_state(state.clone())
        .layer(middleware::from_fn_with_state(
            state,
            local_service_access_middleware,
        ))
        .layer(middleware::from_fn(cors_middleware))
}

fn spawn_background_tasks(state: AppState) {
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
    headers.insert(
        ACCESS_CONTROL_ALLOW_ORIGIN,
        HeaderValue::from_static("tauri://localhost"),
    );
    headers.insert(
        ACCESS_CONTROL_ALLOW_METHODS,
        HeaderValue::from_static("GET, POST, PUT, PATCH, DELETE, HEAD, OPTIONS"),
    );
    headers.insert(
        ACCESS_CONTROL_ALLOW_HEADERS,
        HeaderValue::from_static(
            "Content-Type, Range, Origin, Accept, Authorization, X-MoonTV-Response-Status, X-MoonTV-Download-Intent, X-MoonTV-Local-Token",
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
    if is_authorized {
        return next.run(request).await;
    }

    AppError::new(StatusCode::UNAUTHORIZED, "Unauthorized").into_response()
}

fn requires_local_service_access_token(path: &str) -> bool {
    matches!(
        path,
        "/api/login"
            | "/api/logout"
            | "/api/change-password"
            | "/api/profile-sync/status"
            | "/api/profile-sync/sync-now"
    ) || path.starts_with("/api/admin/")
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

    let mut persistence = state.load_admin_persistence()?;
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

fn save_admin_persistence(path: &Path, persistence: &DesktopAdminPersistence) -> Result<()> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .with_context(|| format!("failed to create {}", parent.display()))?;
    }

    let contents = serde_json::to_string_pretty(persistence)
        .context("failed to serialize desktop admin persistence")?;
    fs::write(path, contents).with_context(|| format!("failed to write {}", path.display()))
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
fn resolve_owner_username_for_import(admin_config: &DesktopAdminConfig) -> Option<String> {
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

fn write_json_file<T: Serialize>(path: &Path, payload: &T) -> Result<()> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .with_context(|| format!("failed to create {}", parent.display()))?;
    }
    let contents = serde_json::to_string_pretty(payload).context("failed to encode json")?;
    fs::write(path, contents).with_context(|| format!("failed to write {}", path.display()))
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
mod tests {
    use super::*;
    use crate::content_detail::parse_detail_payload;
    use crate::playback_prefetch::{
        PlaybackSourcePrefetchRequest, build_playback_search_queries,
        filter_playback_search_results,
    };

    use std::env;
    use std::sync::atomic::{AtomicU64, Ordering};
    use std::sync::{Arc, Mutex};

    use axum::{body::to_bytes, http::Request, response::IntoResponse};
    use futures::StreamExt;
    use moontv_profile::{Favorite, FollowRecord, PlayRecord, SkipConfig};
    use tower::ServiceExt;

    fn build_test_playback_search_result(
        id: &str,
        title: &str,
        year: &str,
        douban_id: Option<i64>,
        source: &str,
        source_name: &str,
        episodes: &[&str],
    ) -> SearchResult {
        SearchResult {
            id: id.to_string(),
            title: title.to_string(),
            poster: String::new(),
            episodes: episodes.iter().map(|episode| episode.to_string()).collect(),
            episodes_titles: (1..=episodes.len())
                .map(|index| format!("第{index}集"))
                .collect(),
            source: source.to_string(),
            source_name: source_name.to_string(),
            class: None,
            year: year.to_string(),
            desc: None,
            type_name: None,
            douban_id,
        }
    }

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
        let state = AppState::new(
            DEFAULT_HOST.to_string(),
            DEFAULT_PORT,
            config_path,
            temp_dir.path.join("data"),
            temp_dir.path.join("data/moontv.sqlite3"),
        );
        let app = build_router(state);

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
        assert_eq!(
            payload.get("sqlite_schema_version"),
            Some(&Value::Number(1.into()))
        );
        assert_eq!(
            payload.get("sqlite_migration_count"),
            Some(&Value::Number(1.into()))
        );
        assert_eq!(
            payload.get("version"),
            Some(&Value::String(env!("CARGO_PKG_VERSION").to_string()))
        );
    }

    #[test]
    fn effective_bind_host_preserves_the_configured_loopback_address() {
        assert_eq!(effective_bind_host(DEFAULT_HOST), DEFAULT_HOST);
        assert_eq!(effective_bind_host("192.168.1.8"), "192.168.1.8");
    }

    #[test]
    fn legacy_download_store_snapshot_is_migrated_into_sqlite() {
        let temp_dir = TestDir::new();
        let config_path = write_test_config(
            &temp_dir,
            json!({
              "cache_time": 7200,
              "api_site": {}
            }),
        );
        let data_dir = temp_dir.path.join("data");
        let legacy_snapshot_path = data_dir
            .join(DOWNLOAD_RUNTIME_DIR_NAME)
            .join(DOWNLOAD_RUNTIME_STORE_FILE_NAME);
        let legacy_snapshot = json!({
            "maxConcurrentTasks": 3,
            "ownerUsername": "desktop-owner",
            "tasks": {
                "task-1": {
                    "id": "task-1",
                    "status": "paused"
                }
            },
            "library": {}
        });

        write_json_file(&legacy_snapshot_path, &legacy_snapshot)
            .expect("write legacy download store snapshot");

        let state = AppState::new(
            DEFAULT_HOST.to_string(),
            DEFAULT_PORT,
            config_path,
            data_dir,
            temp_dir.path.join("data/moontv.sqlite3"),
        );

        let snapshot = state
            .read_download_store_snapshot()
            .expect("read migrated snapshot")
            .expect("snapshot should exist");

        assert_eq!(snapshot, legacy_snapshot);
        assert!(
            !legacy_snapshot_path.exists(),
            "legacy snapshot file should be removed after migration"
        );
        assert_eq!(
            state
                .sqlite
                .read_download_store_snapshot()
                .expect("read sqlite snapshot")
                .expect("sqlite snapshot should exist"),
            legacy_snapshot
        );
    }

    #[tokio::test]
    async fn cors_preflight_allows_download_intent_header() {
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
                    .method(Method::OPTIONS)
                    .uri("/api/proxy/vod/m3u8")
                    .header(ORIGIN, "https://tauri.localhost")
                    .header("Access-Control-Request-Method", "GET")
                    .header("Access-Control-Request-Headers", "x-moontv-download-intent")
                    .body(Body::empty())
                    .expect("cors preflight request"),
            )
            .await
            .expect("cors preflight response");

        assert_eq!(response.status(), StatusCode::NO_CONTENT);
        let allow_headers = response
            .headers()
            .get(ACCESS_CONTROL_ALLOW_HEADERS)
            .and_then(|value| value.to_str().ok())
            .expect("cors allow headers");
        assert!(
            allow_headers
                .to_ascii_lowercase()
                .contains("x-moontv-download-intent"),
            "expected allow headers to include x-moontv-download-intent, got: {allow_headers}"
        );
    }

    #[tokio::test]
    async fn configured_local_service_rejects_api_requests_without_access_token() {
        let temp_dir = TestDir::new();
        let config_path = write_test_config(
            &temp_dir,
            json!({
              "cache_time": 7200,
              "api_site": {}
            }),
        );
        let app = build_router(
            AppState::new(
                DEFAULT_HOST.to_string(),
                DEFAULT_PORT,
                config_path,
                temp_dir.path.join("data"),
                temp_dir.path.join("data/moontv.sqlite3"),
            )
            .with_access_token("test-access-token".to_string()),
        );

        let unauthorized = app
            .clone()
            .oneshot(
                Request::builder()
                    .uri("/api/profile-sync/status")
                    .body(Body::empty())
                    .expect("unauthorized request"),
            )
            .await
            .expect("unauthorized response");
        assert_eq!(unauthorized.status(), StatusCode::UNAUTHORIZED);

        let authorized = app
            .oneshot(
                Request::builder()
                    .uri("/api/profile-sync/status")
                    .header("X-MoonTV-Local-Token", "test-access-token")
                    .body(Body::empty())
                    .expect("authorized request"),
            )
            .await
            .expect("authorized response");
        assert_ne!(authorized.status(), StatusCode::UNAUTHORIZED);
    }

    #[tokio::test]
    async fn unconfigured_local_service_keeps_internal_test_routes_available() {
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
                    .uri("/api/profile-sync/status")
                    .body(Body::empty())
                    .expect("unconfigured access-token request"),
            )
            .await
            .expect("unconfigured access-token response");

        assert_ne!(response.status(), StatusCode::UNAUTHORIZED);
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
    fn vod_ad_filter_removes_known_ad_domains() {
        let manifest = [
            "#EXTM3U",
            "#EXT-X-VERSION:3",
            "#EXTINF:6.0,",
            "/api/proxy/vod/segment?source=demo&url=https%3A%2F%2Fvip.ffzyad.com%2Fcasino-roll.ts",
            "#EXTINF:10.0,",
            "/api/proxy/vod/segment?source=demo&url=https%3A%2F%2Fvideo.example.com%2Fmain.ts",
            "#EXT-X-ENDLIST",
        ]
        .join("\n");

        let result = filter_vod_manifest_ads(&manifest, &build_vod_ad_filter_config(true));

        assert!(result.changed);
        assert_eq!(result.ads_removed, 1);
        assert!(!result.filtered.contains("vip.ffzyad.com"));
        assert!(result.filtered.contains("video.example.com"));
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
            disabled: false,
            disable_ad_filter: false,
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

    #[test]
    fn build_collection_api_url_encodes_plain_source_queries_like_web() {
        let url = build_collection_api_url(
            "https://example.com/api.php/provide/vod",
            &[("ac", "videolist"), ("wd", "Anny Walker")],
        )
        .expect("plain api url");

        assert_eq!(
            url,
            "https://example.com/api.php/provide/vod?ac=videolist&wd=Anny%20Walker"
        );
    }

    #[test]
    fn build_collection_api_url_keeps_wrapped_target_query_inside_url_param() {
        let url = build_collection_api_url(
            "https://proxy.example.com/?url=https://91md.me/api.php/provide/vod",
            &[("ac", "videolist"), ("wd", "Anny Walker")],
        )
        .expect("wrapped api url");

        assert_eq!(
            url,
            "https://proxy.example.com/?url=https://91md.me/api.php/provide/vod?ac=videolist&wd=Anny%20Walker"
        );
    }

    #[test]
    fn build_collection_api_url_preserves_non_wrapped_query_params() {
        let url = build_collection_api_url(
            "https://example.com/api.php/provide/vod?token=demo",
            &[("ac", "videolist"), ("wd", "Anny Walker")],
        )
        .expect("api url with existing query");

        assert_eq!(
            url,
            "https://example.com/api.php/provide/vod?token=demo&ac=videolist&wd=Anny%20Walker"
        );
    }

    #[test]
    fn playback_search_queries_add_year_fallbacks() {
        let queries = build_playback_search_queries(&PlaybackSourcePrefetchRequest {
            title: "雨霖铃".to_string(),
            year: Some("2026".to_string()),
            search_type: None,
            query: None,
            douban_id: None,
            allow_adult_candidates: None,
        });

        assert_eq!(
            queries,
            vec![
                "雨霖铃".to_string(),
                "雨霖铃 2026".to_string(),
                "雨霖铃2026".to_string(),
                "雨霖铃 (2026)".to_string(),
                "雨霖铃(2026)".to_string(),
            ]
        );
    }

    #[test]
    fn playback_search_results_prioritize_exact_douban_matches() {
        let matched = build_test_playback_search_result(
            "matched",
            "租借女友第5季",
            "2026",
            Some(129836),
            "matched-source",
            "演示源",
            &["https://example.com/matched/index.m3u8"],
        );
        let similar = build_test_playback_search_result(
            "similar",
            "租借女友 第五季 特别篇",
            "2026",
            Some(888888),
            "similar-source",
            "演示源",
            &["https://example.com/similar/index.m3u8"],
        );

        let results = filter_playback_search_results(
            vec![similar, matched],
            &PlaybackSourcePrefetchRequest {
                title: "租借女友 第五季".to_string(),
                year: Some("2026".to_string()),
                search_type: Some("tv".to_string()),
                query: None,
                douban_id: Some(129836),
                allow_adult_candidates: None,
            },
        );

        assert_eq!(
            results
                .into_iter()
                .map(|result| result.id)
                .collect::<Vec<_>>(),
            vec!["matched".to_string()]
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
    async fn content_search_endpoint_supports_proxy_wrapped_sources() {
        let upstream = spawn_mock_server(mock_upstream_router()).await;
        let temp_dir = TestDir::new();
        let config_path = write_test_config(
            &temp_dir,
            json!({
              "cache_time": 7200,
              "api_site": {
                "mock": {
                  "api": format!(
                    "{}/proxy?url={}/api.php/provide/vod",
                    upstream.base_url(),
                    upstream.base_url()
                  ),
                  "name": "Wrapped Mock Resource"
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
                    .uri("/content/search?q=Anny%20Walker")
                    .body(Body::empty())
                    .expect("wrapped search request"),
            )
            .await
            .expect("wrapped search response");

        assert_eq!(response.status(), StatusCode::OK);
        let body = to_bytes(response.into_body(), usize::MAX)
            .await
            .expect("wrapped search body");
        let payload: Value = serde_json::from_slice(&body).expect("wrapped search payload json");

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
                .and_then(|item| item.get("title"))
                .and_then(Value::as_str),
            Some("Mock Search Result")
        );

        upstream.abort();
    }

    #[tokio::test]
    async fn content_detail_endpoint_supports_proxy_wrapped_sources() {
        let upstream = spawn_mock_server(mock_upstream_router()).await;
        let temp_dir = TestDir::new();
        let config_path = write_test_config(
            &temp_dir,
            json!({
              "cache_time": 7200,
              "api_site": {
                "mock": {
                  "api": format!(
                    "{}/proxy?url={}/api.php/provide/vod",
                    upstream.base_url(),
                    upstream.base_url()
                  ),
                  "name": "Wrapped Mock Resource"
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
                    .uri("/api/detail?source=mock&id=1")
                    .body(Body::empty())
                    .expect("wrapped detail request"),
            )
            .await
            .expect("wrapped detail response");

        assert_eq!(response.status(), StatusCode::OK);
        let body = to_bytes(response.into_body(), usize::MAX)
            .await
            .expect("wrapped detail body");
        let payload: Value = serde_json::from_slice(&body).expect("wrapped detail payload json");

        assert_eq!(
            payload.get("title").and_then(Value::as_str),
            Some("Mock Detail")
        );
        assert_eq!(
            payload
                .get("episodes")
                .and_then(Value::as_array)
                .and_then(|items| items.first())
                .and_then(Value::as_str),
            Some("https://cdn.example.com/mock/index.m3u8")
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
              "disable_yellow_filter": true,
              "douban_proxy_type": "custom",
              "douban_proxy": "https://proxy.example.com/fetch?url=",
              "douban_image_proxy_type": "custom",
              "douban_image_proxy": "https://img.example.com/fetch?url=",
              "player_enhancements": {
                "audio_spike_protection_level": "strong",
                "audio_dynamic_protection": false,
                "audio_fixed_ceiling": true,
                "visual_enhancement_level": "light"
              },
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
            payload.get("disableYellowFilter").and_then(Value::as_bool),
            Some(true)
        );
        assert_eq!(
            payload
                .get("playerAudioSpikeProtection")
                .and_then(Value::as_bool),
            Some(true)
        );
        assert_eq!(
            payload
                .get("playerAudioSpikeProtectionLevel")
                .and_then(Value::as_str),
            Some("strong")
        );
        assert_eq!(
            payload
                .get("playerAudioDynamicProtection")
                .and_then(Value::as_bool),
            Some(false)
        );
        assert_eq!(
            payload
                .get("playerAudioFixedCeiling")
                .and_then(Value::as_bool),
            Some(true)
        );
        assert_eq!(
            payload
                .get("playerVisualEnhancement")
                .and_then(Value::as_bool),
            Some(true)
        );
        assert_eq!(
            payload
                .get("playerVisualEnhancementLevel")
                .and_then(Value::as_str),
            Some("light")
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
    async fn profile_bootstrap_endpoint_returns_runtime_sync_and_local_auth_snapshot() {
        let temp_dir = TestDir::new();
        let raw_config = json!({
          "auth": {
            "username": "desktop-owner",
            "password": "owner-secret"
          },
          "site_name": "Bootstrap LunaTV",
          "announcement": "Bootstrap ready",
          "api_site": {}
        });
        let config_path = write_test_config(&temp_dir, raw_config.clone());
        write_test_admin_persistence(
            &temp_dir,
            json!({
              "config": {
                "ConfigSubscribtion": {
                  "URL": "",
                  "AutoUpdate": false,
                  "LastCheck": ""
                },
                "ConfigFile": serde_json::to_string_pretty(&raw_config)
                  .expect("serialize raw config"),
                "SiteConfig": {
                  "SiteName": "Bootstrap LunaTV",
                  "Announcement": "Bootstrap ready",
                  "SearchDownstreamMaxPage": 5,
                  "SiteInterfaceCacheTime": 7200,
                  "DoubanProxyType": "custom",
                  "DoubanProxy": "",
                  "DoubanImageProxyType": "custom",
                  "DoubanImageProxy": "",
                  "DisableYellowFilter": false,
                  "FluidSearch": true,
                  "EnableWebLive": false
                },
                "UserConfig": {
                  "Users": [
                    {
                      "username": "desktop-owner",
                      "role": "owner"
                    },
                    {
                      "username": "kid",
                      "role": "user",
                      "banned": false
                    }
                  ],
                  "Tags": []
                },
                "SourceConfig": [],
                "CustomCategories": [],
                "LiveConfig": []
              },
              "userPasswords": {
                "kid": "kid-secret"
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
                    .uri("/api/profile/bootstrap")
                    .body(Body::empty())
                    .expect("profile bootstrap request"),
            )
            .await
            .expect("profile bootstrap response");

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
            .expect("profile bootstrap body");
        let payload: Value = serde_json::from_slice(&body).expect("profile bootstrap payload json");

        assert_eq!(
            payload.get("appTarget").and_then(Value::as_str),
            Some("desktop")
        );
        assert_eq!(
            payload
                .get("runtime")
                .and_then(|value| value.get("siteName"))
                .and_then(Value::as_str),
            Some("Bootstrap LunaTV")
        );
        assert_eq!(
            payload
                .get("runtime")
                .and_then(|value| value.get("profileSyncEnabled"))
                .and_then(Value::as_bool),
            Some(false)
        );
        assert_eq!(
            payload
                .get("profileSync")
                .and_then(|value| value.get("enabled"))
                .and_then(Value::as_bool),
            Some(false)
        );
        assert_eq!(
            payload
                .get("profileSync")
                .and_then(|value| value.get("errorKind")),
            Some(&Value::Null)
        );
        assert_eq!(
            payload
                .get("profileSync")
                .and_then(|value| value.get("syncDomains"))
                .and_then(Value::as_array)
                .map(Vec::len),
            Some(5)
        );
        assert_eq!(
            payload
                .get("localAuth")
                .and_then(|value| value.get("username"))
                .and_then(Value::as_str),
            Some("desktop-owner")
        );
        assert_eq!(
            payload
                .get("localAuth")
                .and_then(|value| value.get("passwordRequired"))
                .and_then(Value::as_bool),
            Some(true)
        );
        assert_eq!(
            payload
                .get("localAuth")
                .and_then(|value| value.get("multiUser"))
                .and_then(Value::as_bool),
            Some(true)
        );
        assert_eq!(
            payload
                .get("localAuth")
                .and_then(|value| value.get("ownerPasswordConfigured"))
                .and_then(Value::as_bool),
            Some(true)
        );
    }

    #[tokio::test]
    async fn profile_sync_status_endpoint_reports_disabled_when_not_configured() {
        let temp_dir = TestDir::new();
        let config_path = write_test_config(
            &temp_dir,
            json!({
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
                    .uri("/api/profile-sync/status")
                    .body(Body::empty())
                    .expect("profile sync status without config request"),
            )
            .await
            .expect("profile sync status without config response");

        assert_eq!(response.status(), StatusCode::OK);
        let payload = read_json_body(response).await;

        assert_eq!(payload.get("enabled").and_then(Value::as_bool), Some(false));
        assert_eq!(
            payload.get("reachable").and_then(Value::as_bool),
            Some(false)
        );
        assert_eq!(
            payload.get("authenticated").and_then(Value::as_bool),
            Some(false)
        );
        assert_eq!(payload.get("errorKind"), Some(&Value::Null));
        assert_eq!(
            payload
                .get("syncDomains")
                .and_then(Value::as_array)
                .map(Vec::len),
            Some(5)
        );
    }

    #[tokio::test]
    async fn profile_sync_status_endpoint_exposes_error_kind_and_domains() {
        let temp_dir = TestDir::new();
        let config_path = write_test_config(
            &temp_dir,
            json!({
              "profile_sync": {
                "api_base_url": "not a url"
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
                    .uri("/api/profile-sync/status")
                    .body(Body::empty())
                    .expect("profile sync status request"),
            )
            .await
            .expect("profile sync status response");

        assert_eq!(response.status(), StatusCode::OK);
        let payload = read_json_body(response).await;

        assert_eq!(payload.get("enabled").and_then(Value::as_bool), Some(true));
        assert_eq!(
            payload.get("reachable").and_then(Value::as_bool),
            Some(false)
        );
        assert_eq!(
            payload.get("errorKind").and_then(Value::as_str),
            Some("invalid-base-url")
        );
        assert_eq!(
            payload
                .get("syncDomains")
                .and_then(Value::as_array)
                .map(Vec::len),
            Some(5)
        );
    }

    #[tokio::test]
    async fn profile_sync_status_endpoint_exposes_configured_sync_domains() {
        let temp_dir = TestDir::new();
        let config_path = write_test_config(
            &temp_dir,
            json!({
              "profile_sync": {
                "api_base_url": "not a url",
                "sync_domains": ["playrecords", "adminsettings"]
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
                    .uri("/api/profile-sync/status")
                    .body(Body::empty())
                    .expect("profile sync status request"),
            )
            .await
            .expect("profile sync status response");

        assert_eq!(response.status(), StatusCode::OK);
        let payload = read_json_body(response).await;

        assert_eq!(
            payload.get("syncDomains"),
            Some(&json!(["playrecords", "adminsettings"]))
        );
    }

    #[tokio::test]
    async fn admin_config_endpoint_returns_merged_desktop_state() {
        let upstream = spawn_mock_server(mock_upstream_router()).await;
        let temp_dir = TestDir::new();
        let config_path = write_test_config(
            &temp_dir,
            json!({
              "auth": {
                "username": "desktop-owner"
              },
              "api_site": {
                "raw": {
                  "api": format!("{}/api.php/provide/vod", upstream.base_url()),
                  "name": "Raw Source"
                }
              }
            }),
        );
        write_test_admin_persistence(
            &temp_dir,
            json!({
              "config": {
                "ConfigSubscribtion": {
                  "URL": "https://example.com/sub",
                  "AutoUpdate": true,
                  "LastCheck": "2026-06-09T00:00:00.000Z"
                },
                "ConfigFile": "",
                "SiteConfig": {
                  "SiteName": "Desktop LunaTV",
                  "Announcement": "local admin",
                  "SearchDownstreamMaxPage": 3,
                  "SiteInterfaceCacheTime": 1800,
                  "DoubanProxyType": "custom",
                  "DoubanProxy": "https://proxy.example.com/?url=",
                  "DoubanImageProxyType": "custom",
                  "DoubanImageProxy": "https://img.example.com/?url=",
                  "DisableYellowFilter": false,
                  "FluidSearch": false,
                  "EnableWebLive": false
                },
                "UserConfig": {
                  "Users": [
                    {
                      "username": "desktop-owner",
                      "role": "owner"
                    },
                    {
                      "username": "kid",
                      "role": "user",
                      "tags": ["children"]
                    }
                  ],
                  "Tags": [
                    {
                      "name": "children",
                      "enabledApis": ["raw"]
                    }
                  ]
                },
                "SourceConfig": [
                  {
                    "key": "raw",
                    "name": "Raw Source Edited",
                    "api": format!("{}/api.php/provide/vod", upstream.base_url()),
                    "from": "config",
                    "disabled": true
                  },
                  {
                    "key": "custom",
                    "name": "Custom Source",
                    "api": format!("{}/api.php/provide/vod", upstream.base_url()),
                    "from": "custom",
                    "disabled": false
                  }
                ],
                "CustomCategories": [],
                "LiveConfig": []
              },
              "userPasswords": {
                "kid": "123456"
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
                    .uri("/api/admin/config")
                    .body(Body::empty())
                    .expect("admin config request"),
            )
            .await
            .expect("admin config response");

        assert_eq!(response.status(), StatusCode::OK);
        let body = to_bytes(response.into_body(), usize::MAX)
            .await
            .expect("admin config body");
        let payload: Value = serde_json::from_slice(&body).expect("admin config payload json");

        assert_eq!(payload.get("Role").and_then(Value::as_str), Some("owner"));
        assert_eq!(
            payload
                .get("Config")
                .and_then(|config| config.get("SiteConfig"))
                .and_then(|site| site.get("SiteName"))
                .and_then(Value::as_str),
            Some("Desktop LunaTV")
        );
        assert_eq!(
            payload
                .get("Config")
                .and_then(|config| config.get("UserConfig"))
                .and_then(|users| users.get("Users"))
                .and_then(Value::as_array)
                .map(Vec::len),
            Some(2)
        );
        assert_eq!(
            payload
                .get("Config")
                .and_then(|config| config.get("SourceConfig"))
                .and_then(Value::as_array)
                .map(Vec::len),
            Some(2)
        );
        assert_eq!(
            payload
                .get("Config")
                .and_then(|config| config.get("SourceConfig"))
                .and_then(Value::as_array)
                .and_then(|items| items.first())
                .and_then(|item| item.get("disabled"))
                .and_then(Value::as_bool),
            Some(true)
        );

        upstream.abort();
    }

    #[tokio::test]
    async fn admin_data_migration_export_route_omits_local_identity_payloads() {
        let temp_dir = TestDir::new();
        let config_path = write_test_config(
            &temp_dir,
            json!({
              "auth": {
                "username": "desktop-owner",
                "password": "owner-secret"
              },
              "api_site": {
                "raw": {
                  "api": "https://example.com/api.php/provide/vod",
                  "name": "Raw Source"
                }
              }
            }),
        );
        write_test_admin_persistence(
            &temp_dir,
            json!({
              "config": {
                "ConfigSubscribtion": {
                  "URL": "https://example.com/sub",
                  "AutoUpdate": true,
                  "LastCheck": ""
                },
                "ConfigFile": "",
                "SiteConfig": {
                  "SiteName": "Desktop LunaTV",
                  "Announcement": "local admin",
                  "SearchDownstreamMaxPage": 3,
                  "SiteInterfaceCacheTime": 1800,
                  "DoubanProxyType": "custom",
                  "DoubanProxy": "",
                  "DoubanImageProxyType": "custom",
                  "DoubanImageProxy": "",
                  "DisableYellowFilter": false,
                  "FluidSearch": true,
                  "EnableWebLive": false
                },
                "UserConfig": {
                  "Users": [
                    {
                      "username": "desktop-owner",
                      "role": "owner"
                    },
                    {
                      "username": "kid",
                      "role": "user"
                    }
                  ],
                  "Tags": []
                },
                "SourceConfig": [
                  {
                    "key": "raw",
                    "name": "Raw Source",
                    "api": "https://example.com/api.php/provide/vod",
                    "from": "config",
                    "disabled": false
                  }
                ],
                "CustomCategories": [],
                "LiveConfig": []
              },
              "userPasswords": {
                "kid": "123456"
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
                    .method("POST")
                    .uri("/api/admin/data_migration/export")
                    .header(CONTENT_TYPE, "application/json")
                    .body(Body::from(
                        json!({
                          "password": "backup-secret"
                        })
                        .to_string(),
                    ))
                    .expect("admin data migration export request"),
            )
            .await
            .expect("admin data migration export response");

        assert_eq!(response.status(), StatusCode::OK);
        assert_eq!(
            response
                .headers()
                .get(CONTENT_TYPE)
                .and_then(|value| value.to_str().ok()),
            Some("application/octet-stream")
        );

        let body = to_bytes(response.into_body(), usize::MAX)
            .await
            .expect("admin data migration export body");
        let encrypted = String::from_utf8(body.to_vec()).expect("encrypted backup utf8");
        let archive = parse_local_admin_data_migration_archive(&encrypted, "backup-secret")
            .expect("parse local backup archive");

        assert_eq!(
            archive.data.admin_config.site_config.site_name,
            "Desktop LunaTV"
        );
        assert!(archive.data.user_data.is_empty());
        assert!(archive.data.admin_config.user_config.users.is_empty());
        assert_eq!(archive.data.admin_config.config_file, "");
        assert_eq!(
            archive
                .data
                .desktop_metadata
                .as_ref()
                .map(|metadata| metadata.note.as_str()),
            Some(DESKTOP_LOCAL_DATA_MIGRATION_NOTE)
        );
    }

    #[tokio::test]
    async fn admin_data_migration_import_route_preserves_local_identity_layer() {
        let temp_dir = TestDir::new();
        let config_path = write_test_config(
            &temp_dir,
            json!({
              "auth": {
                "username": "old-owner",
                "password": "old-secret"
              },
              "api_site": {}
            }),
        );
        let state = AppState::new(
            DEFAULT_HOST.to_string(),
            DEFAULT_PORT,
            config_path,
            temp_dir.path.join("data"),
            temp_dir.path.join("data/moontv.sqlite3"),
        );
        let app = build_router(state.clone());

        let mut admin_config = DesktopAdminConfig::default();
        admin_config.config_subscribtion.url = "https://example.com/sub".to_string();
        admin_config.config_subscribtion.auto_update = true;
        admin_config.config_file = serde_json::to_string_pretty(&json!({
          "auth": {
            "username": "new-owner"
          },
          "site_name": "Imported Raw Site",
          "api_site": {
            "raw": {
              "api": "https://example.com/api.php/provide/vod",
              "name": "Raw Source"
            }
          }
        }))
        .expect("serialize imported config file");
        admin_config.site_config.site_name = "Imported LunaTV".to_string();
        admin_config.source_config.push(DesktopSourceConfigItem {
            key: "raw".to_string(),
            name: "Raw Source".to_string(),
            api: "https://example.com/api.php/provide/vod".to_string(),
            detail: None,
            ua: None,
            referer: None,
            from: "config".to_string(),
            disabled: false,
            disable_ad_filter: false,
        });
        admin_config.user_config.users = vec![
            DesktopUserConfigItem {
                username: "new-owner".to_string(),
                role: "owner".to_string(),
                banned: false,
                enabled_apis: Vec::new(),
                tags: Vec::new(),
            },
            DesktopUserConfigItem {
                username: "kid".to_string(),
                role: "user".to_string(),
                banned: false,
                enabled_apis: Vec::new(),
                tags: Vec::new(),
            },
        ];

        let archive = AdminDataMigrationArchive {
            timestamp: current_iso_timestamp(),
            server_version: env!("CARGO_PKG_VERSION").to_string(),
            data: AdminDataMigrationArchiveData {
                admin_config,
                user_data: BTreeMap::from([
                    (
                        "new-owner".to_string(),
                        AdminDataMigrationUserData {
                            play_records: BTreeMap::from([(
                                "raw+1".to_string(),
                                json!({ "title": "Skipped play record" }),
                            )]),
                            password: Some("owner-secret".to_string()),
                            ..AdminDataMigrationUserData::default()
                        },
                    ),
                    (
                        "kid".to_string(),
                        AdminDataMigrationUserData {
                            favorites: BTreeMap::from([(
                                "raw+1".to_string(),
                                json!({ "title": "Skipped favorite" }),
                            )]),
                            password: Some("kid-secret".to_string()),
                            ..AdminDataMigrationUserData::default()
                        },
                    ),
                ]),
                desktop_metadata: None,
            },
        };
        let archive_json = serde_json::to_vec(&archive).expect("serialize archive");
        let compressed = gzip_bytes(&archive_json).expect("gzip archive");
        let encrypted =
            cryptojs_aes_encrypt_text(&BASE64_STANDARD.encode(&compressed), "import-secret")
                .expect("encrypt archive");
        let boundary = "----LunaTVBoundary";
        let multipart_body = build_multipart_form_data(boundary, &encrypted, "import-secret");

        let response = app
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/api/admin/data_migration/import")
                    .header(
                        CONTENT_TYPE,
                        format!("multipart/form-data; boundary={boundary}"),
                    )
                    .body(Body::from(multipart_body))
                    .expect("admin data migration import request"),
            )
            .await
            .expect("admin data migration import response");

        assert_eq!(response.status(), StatusCode::OK);
        let body = to_bytes(response.into_body(), usize::MAX)
            .await
            .expect("admin data migration import body");
        let payload: Value =
            serde_json::from_slice(&body).expect("admin data migration import payload");

        assert_eq!(
            payload.get("note").and_then(Value::as_str),
            Some(DESKTOP_LOCAL_DATA_MIGRATION_NOTE)
        );

        let persistence = state
            .load_admin_persistence()
            .expect("load imported admin persistence");
        assert_eq!(persistence.config.site_config.site_name, "Imported LunaTV");
        assert_eq!(
            resolve_owner_username_for_import(&persistence.config).as_deref(),
            Some("old-owner")
        );
        assert_eq!(
            extract_owner_password_from_config_file(&persistence.config.config_file).as_deref(),
            Some("old-secret")
        );
        assert_eq!(persistence.user_passwords.get("kid"), None);
        assert!(
            persistence
                .config
                .user_config
                .users
                .iter()
                .all(|user| user.username != "new-owner")
        );
    }

    #[tokio::test]
    async fn refresh_admin_config_subscription_if_due_updates_local_state() {
        let subscription_config = json!({
          "auth": {
            "username": "desktop-owner"
          },
          "site_name": "Updated LunaTV",
          "api_site": {
            "raw": {
              "api": "https://example.com/api.php/provide/vod",
              "name": "Raw Source"
            }
          }
        });
        let encoded_subscription = bs58::encode(
            serde_json::to_string(&subscription_config).expect("serialize subscription config"),
        )
        .into_string();
        let upstream = spawn_mock_server(Router::new().route(
            "/subscription",
            get({
                let encoded_subscription = encoded_subscription.clone();
                move || {
                    let encoded_subscription = encoded_subscription.clone();
                    async move { encoded_subscription }
                }
            }),
        ))
        .await;
        let temp_dir = TestDir::new();
        let config_path = write_test_config(
            &temp_dir,
            json!({
              "auth": {
                "username": "desktop-owner"
              },
              "site_name": "Old LunaTV",
              "api_site": {}
            }),
        );
        write_test_admin_persistence(
            &temp_dir,
            json!({
              "config": {
                "ConfigSubscribtion": {
                  "URL": format!("{}/subscription", upstream.base_url()),
                  "AutoUpdate": true,
                  "LastCheck": ""
                },
                "ConfigFile": "",
                "SiteConfig": {
                  "SiteName": "Old LunaTV",
                  "Announcement": "",
                  "SearchDownstreamMaxPage": 5,
                  "SiteInterfaceCacheTime": 7200,
                  "DoubanProxyType": "custom",
                  "DoubanProxy": "",
                  "DoubanImageProxyType": "custom",
                  "DoubanImageProxy": "",
                  "DisableYellowFilter": false,
                  "FluidSearch": true,
                  "EnableWebLive": false
                },
                "UserConfig": {
                  "Users": [
                    {
                      "username": "desktop-owner",
                      "role": "owner"
                    }
                  ],
                  "Tags": []
                },
                "SourceConfig": [],
                "CustomCategories": [],
                "LiveConfig": []
              }
            }),
        );
        let state = AppState::new(
            DEFAULT_HOST.to_string(),
            DEFAULT_PORT,
            config_path.clone(),
            temp_dir.path.join("data"),
            temp_dir.path.join("data/moontv.sqlite3"),
        );

        refresh_admin_config_subscription_if_due(&state)
            .await
            .expect("refresh desktop config subscription");

        let persistence = state
            .load_admin_persistence()
            .expect("load refreshed admin persistence");
        assert!(!persistence.config.config_subscribtion.last_check.is_empty());
        assert!(persistence.config.config_file.contains("Updated LunaTV"));
        assert!(
            persistence
                .config
                .source_config
                .iter()
                .any(|source| source.key == "raw" && source.name == "Raw Source")
        );

        let raw_config = fs::read_to_string(config_path).expect("read refreshed raw config");
        assert!(raw_config.contains("Updated LunaTV"));

        upstream.abort();
    }

    #[test]
    fn load_admin_persistence_defaults_missing_owner_username_to_admin() {
        let temp_dir = TestDir::new();
        let config_path = write_test_config(
            &temp_dir,
            json!({
              "site_name": "Default LunaTV",
              "api_site": {}
            }),
        );

        let persistence = load_admin_persistence(
            &config_path,
            &temp_dir.path.join("data").join(ADMIN_PERSISTENCE_FILE_NAME),
        )
        .expect("load admin persistence");

        assert_eq!(
            resolve_owner_username_for_import(&persistence.config).as_deref(),
            Some("admin")
        );
        assert!(
            persistence
                .config
                .user_config
                .users
                .iter()
                .any(|user| user.username == "admin" && user.role == "owner")
        );
    }

    #[tokio::test]
    async fn refresh_admin_config_subscription_if_due_preserves_profile_sync_and_synced_owner() {
        let subscription_config = json!({
          "auth": {
            "username": "owner"
          },
          "site_name": "Updated LunaTV",
          "api_site": {
            "remote": {
              "api": "https://example.com/api.php/provide/vod",
              "name": "Remote Source"
            }
          }
        });
        let encoded_subscription = bs58::encode(
            serde_json::to_string(&subscription_config).expect("serialize subscription config"),
        )
        .into_string();
        let upstream = spawn_mock_server(Router::new().route(
            "/subscription",
            get({
                let encoded_subscription = encoded_subscription.clone();
                move || {
                    let encoded_subscription = encoded_subscription.clone();
                    async move { encoded_subscription }
                }
            }),
        ))
        .await;
        let temp_dir = TestDir::new();
        let config_path = write_test_config(
            &temp_dir,
            json!({
              "auth": {
                "username": "admin",
                "password": "admin-secret"
              },
              "profile_sync": {
                "api_base_url": "https://sync.example.com",
                "sync_domains": ["adminsettings", "favorites"]
              },
              "site_name": "Synced LunaTV",
              "api_site": {}
            }),
        );
        write_test_admin_persistence(
            &temp_dir,
            json!({
              "profile_sync_api_base_url": "https://sync.example.com",
              "profileSyncSyncDomains": ["adminsettings", "favorites"],
              "config": {
                "ConfigSubscribtion": {
                  "URL": format!("{}/subscription", upstream.base_url()),
                  "AutoUpdate": true,
                  "LastCheck": ""
                },
                "UserConfig": {
                  "Users": [
                    {
                      "username": "admin",
                      "role": "owner"
                    },
                    {
                      "username": "owner",
                      "role": "user"
                    }
                  ],
                  "Tags": []
                }
              }
            }),
        );
        let state = AppState::new(
            DEFAULT_HOST.to_string(),
            DEFAULT_PORT,
            config_path.clone(),
            temp_dir.path.join("data"),
            temp_dir.path.join("data/moontv.sqlite3"),
        );

        refresh_admin_config_subscription_if_due(&state)
            .await
            .expect("refresh desktop config subscription");

        let refreshed_raw_config = serde_json::from_str::<Value>(
            &fs::read_to_string(&config_path).expect("read refreshed raw config"),
        )
        .expect("parse refreshed raw config");
        assert_eq!(
            refreshed_raw_config["auth"]["username"],
            Value::String("admin".to_string())
        );
        assert_eq!(
            refreshed_raw_config["auth"]["password"],
            Value::String("admin-secret".to_string())
        );
        assert_eq!(
            refreshed_raw_config["profile_sync"]["api_base_url"],
            Value::String("https://sync.example.com".to_string())
        );
        assert_eq!(
            refreshed_raw_config["profile_sync"]["sync_domains"],
            json!(["adminsettings", "favorites"])
        );

        let persistence = state
            .load_admin_persistence()
            .expect("load refreshed admin persistence");
        assert_eq!(
            resolve_owner_username_for_import(&persistence.config).as_deref(),
            Some("admin")
        );
        assert!(
            persistence
                .config
                .user_config
                .users
                .iter()
                .any(|user| user.username == "admin" && user.role == "owner")
        );
        assert!(
            persistence
                .config
                .user_config
                .users
                .iter()
                .any(|user| user.username == "owner" && user.role == "user")
        );
        assert_eq!(
            state
                .load_config()
                .expect("load runtime config")
                .profile_sync_api_base_url
                .as_deref(),
            Some("https://sync.example.com")
        );

        upstream.abort();
    }

    #[tokio::test]
    async fn admin_data_migration_export_route_proxies_profile_sync_mode() {
        let upstream = spawn_mock_server(Router::new().route(
            "/api/admin/data_migration/export",
            post(|| async move {
                (
                    [(CONTENT_TYPE, "application/octet-stream")],
                    "REMOTE_BACKUP",
                )
            }),
        ))
        .await;
        let temp_dir = TestDir::new();
        let config_path = write_test_config(
            &temp_dir,
            json!({
              "profile_sync": {
                "api_base_url": upstream.base_url()
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
                    .method("POST")
                    .uri("/api/admin/data_migration/export")
                    .header(CONTENT_TYPE, "application/json")
                    .body(Body::from(
                        json!({
                          "password": "backup-secret"
                        })
                        .to_string(),
                    ))
                    .expect("proxied admin data migration export request"),
            )
            .await
            .expect("proxied admin data migration export response");

        assert_eq!(response.status(), StatusCode::OK);
        let body = to_bytes(response.into_body(), usize::MAX)
            .await
            .expect("proxied admin data migration export body");
        assert_eq!(body.as_ref(), b"REMOTE_BACKUP");

        upstream.abort();
    }

    #[tokio::test]
    async fn playback_source_prefetch_route_uses_year_fallback_queries_until_exact_match() {
        let upstream = spawn_mock_server(
            Router::new().route(
                "/api.php/provide/vod",
                get(|Query(params): Query<BTreeMap<String, String>>| async move {
                    let query = params.get("wd").map(String::as_str).unwrap_or_default();

                    let payload = match query {
                        "雨霖铃" => json!({
                          "list": [{
                            "vod_id": "trailer",
                            "vod_name": "雨霖铃预告片",
                            "vod_pic": "https://img.example.com/trailer.jpg",
                            "vod_play_url": "第1集$https://cdn.example.com/trailer/index.m3u8",
                            "vod_year": "2025",
                            "vod_douban_id": "36310054",
                            "vod_content": "预告片"
                          }]
                        }),
                        "雨霖铃 2026" => json!({
                          "list": [{
                            "vod_id": "series",
                            "vod_name": "雨霖铃2026",
                            "vod_pic": "https://img.example.com/series.jpg",
                            "vod_play_url": "第1集$https://cdn.example.com/series/episode-1/index.m3u8#第2集$https://cdn.example.com/series/episode-2/index.m3u8",
                            "vod_year": "2026",
                            "vod_douban_id": "36310054",
                            "vod_content": "正片"
                          }]
                        }),
                        _ => json!({ "list": [] }),
                    };

                    Json(payload).into_response()
                }),
            ),
        )
        .await;
        let temp_dir = TestDir::new();
        let config_path = write_test_config(
            &temp_dir,
            json!({
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
                    .method("POST")
                    .uri("/api/playback/search-sources")
                    .header(CONTENT_TYPE, "application/json")
                    .body(Body::from(
                        json!({
                          "title": "雨霖铃",
                          "year": "2026",
                          "doubanId": 36310054
                        })
                        .to_string(),
                    ))
                    .expect("playback search prefetch request"),
            )
            .await
            .expect("playback search prefetch response");

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
            .expect("playback search prefetch body");
        let payload: Value =
            serde_json::from_slice(&body).expect("playback search prefetch payload");

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
                .and_then(|item| item.get("id"))
                .and_then(Value::as_str),
            Some("series")
        );

        upstream.abort();
    }

    #[tokio::test]
    async fn admin_data_migration_import_route_proxies_profile_sync_mode() {
        let upstream = spawn_mock_server(Router::new().route(
            "/api/admin/data_migration/import",
            post(|headers: HeaderMap, body: String| async move {
                assert!(
                    headers
                        .get(CONTENT_TYPE)
                        .and_then(|value| value.to_str().ok())
                        .is_some_and(|value| value.contains("multipart/form-data"))
                );
                assert!(body.contains("import-secret"));
                assert!(body.contains("encrypted-backup-payload"));

                Json(json!({
                  "message": "远端导入成功",
                  "importedUsers": 2
                }))
                .into_response()
            }),
        ))
        .await;
        let temp_dir = TestDir::new();
        let config_path = write_test_config(
            &temp_dir,
            json!({
              "profile_sync": {
                "api_base_url": upstream.base_url()
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

        let boundary = "----LunaTVBoundary";
        let multipart_body =
            build_multipart_form_data(boundary, "encrypted-backup-payload", "import-secret");

        let response = app
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/api/admin/data_migration/import")
                    .header(
                        CONTENT_TYPE,
                        format!("multipart/form-data; boundary={boundary}"),
                    )
                    .body(Body::from(multipart_body))
                    .expect("proxied admin data migration import request"),
            )
            .await
            .expect("proxied admin data migration import response");

        assert_eq!(response.status(), StatusCode::OK);
        let body = to_bytes(response.into_body(), usize::MAX)
            .await
            .expect("proxied admin data migration import body");
        let payload: Value =
            serde_json::from_slice(&body).expect("proxied admin data migration import payload");
        assert_eq!(
            payload.get("message").and_then(Value::as_str),
            Some("远端导入成功")
        );
        assert_eq!(
            payload.get("importedUsers").and_then(Value::as_u64),
            Some(2)
        );

        upstream.abort();
    }

    #[tokio::test]
    async fn profile_playrecords_route_uses_owner_fallback_when_local_auth_is_optional() {
        let temp_dir = TestDir::new();
        let config_path = write_test_config(
            &temp_dir,
            json!({
              "auth": {
                "username": "desktop-owner"
              },
              "api_site": {}
            }),
        );
        let state = AppState::new(
            DEFAULT_HOST.to_string(),
            DEFAULT_PORT,
            config_path,
            temp_dir.path.join("data"),
            temp_dir.path.join("data/moontv.sqlite3"),
        );
        let app = build_router(state.clone());

        let post_response = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/api/playrecords")
                    .header(CONTENT_TYPE, "application/json")
                    .body(Body::from(
                        json!({
                          "key": "demo+1",
                          "record": {
                            "title": "Demo Episode",
                            "source_name": "Demo Source",
                            "year": "2026",
                            "cover": "cover.jpg",
                            "index": 1,
                            "total_episodes": 12,
                            "play_time": 30,
                            "total_time": 60,
                            "save_time": 1,
                            "search_title": "Demo Search",
                            "playback_mode": "online",
                            "offline_content_id": null,
                            "is_adult": false
                          }
                        })
                        .to_string(),
                    ))
                    .expect("local playrecords post request"),
            )
            .await
            .expect("local playrecords post response");

        assert_eq!(post_response.status(), StatusCode::OK);

        let get_response = app
            .oneshot(
                Request::builder()
                    .uri("/api/playrecords")
                    .body(Body::empty())
                    .expect("local playrecords get request"),
            )
            .await
            .expect("local playrecords get response");

        assert_eq!(get_response.status(), StatusCode::OK);
        let payload = read_json_body(get_response).await;
        assert_eq!(
            payload
                .get("demo+1")
                .and_then(|record| record.get("title"))
                .and_then(Value::as_str),
            Some("Demo Episode")
        );
        assert_eq!(
            state
                .profile_store()
                .load_play_records("desktop-owner")
                .expect("owner play records")
                .get("demo+1")
                .map(|record| record.title.as_str()),
            Some("Demo Episode")
        );
    }

    #[tokio::test]
    async fn profile_playrecords_route_requires_auth_when_local_password_is_enabled() {
        let temp_dir = TestDir::new();
        let config_path = write_test_config(
            &temp_dir,
            json!({
              "auth": {
                "username": "desktop-owner",
                "password": "owner-secret"
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
                    .uri("/api/playrecords")
                    .body(Body::empty())
                    .expect("unauthorized local playrecords request"),
            )
            .await
            .expect("unauthorized local playrecords response");

        assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
        let payload = read_json_body(response).await;
        assert_eq!(
            payload.get("error").and_then(Value::as_str),
            Some("Unauthorized")
        );
    }

    #[tokio::test]
    async fn profile_local_routes_round_trip_all_domains_for_authenticated_user() {
        let temp_dir = TestDir::new();
        let raw_config = json!({
          "auth": {
            "username": "desktop-owner",
            "password": "owner-secret"
          },
          "api_site": {}
        });
        let config_path = write_test_config(&temp_dir, raw_config);
        let state = AppState::new(
            DEFAULT_HOST.to_string(),
            DEFAULT_PORT,
            config_path,
            temp_dir.path.join("data"),
            temp_dir.path.join("data/moontv.sqlite3"),
        );
        let mut persistence = state
            .load_admin_persistence()
            .expect("load default admin persistence");
        persistence
            .config
            .user_config
            .users
            .push(DesktopUserConfigItem {
                username: "kid".to_string(),
                role: "user".to_string(),
                banned: false,
                enabled_apis: Vec::new(),
                tags: Vec::new(),
            });
        persistence
            .user_passwords
            .insert("kid".to_string(), "kid-secret".to_string());
        state
            .save_admin_persistence(&persistence)
            .expect("save updated admin persistence");
        let auth_cookie = build_test_auth_cookie("kid", "user", "desktop-local");
        let app = build_router(state.clone());

        let playrecords_post = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/api/playrecords")
                    .header("cookie", auth_cookie.clone())
                    .header(CONTENT_TYPE, "application/json")
                    .body(Body::from(
                        json!({
                          "key": "demo+1",
                          "record": {
                            "title": "Kid Episode",
                            "source_name": "Demo Source",
                            "year": "2026",
                            "cover": "cover.jpg",
                            "index": 2,
                            "total_episodes": 24,
                            "play_time": 90,
                            "total_time": 180,
                            "save_time": 10,
                            "search_title": "Kid Search",
                            "playback_mode": "online",
                            "offline_content_id": null,
                            "is_adult": false
                          }
                        })
                        .to_string(),
                    ))
                    .expect("kid playrecords post request"),
            )
            .await
            .expect("kid playrecords post response");
        assert_eq!(playrecords_post.status(), StatusCode::OK);

        let playrecords_get = app
            .clone()
            .oneshot(
                Request::builder()
                    .uri("/api/playrecords")
                    .header("cookie", auth_cookie.clone())
                    .body(Body::empty())
                    .expect("kid playrecords get request"),
            )
            .await
            .expect("kid playrecords get response");
        let playrecords_payload = read_json_body(playrecords_get).await;
        assert_eq!(
            playrecords_payload
                .get("demo+1")
                .and_then(|record| record.get("index"))
                .and_then(Value::as_i64),
            Some(2)
        );

        let favorites_post = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/api/favorites")
                    .header("cookie", auth_cookie.clone())
                    .header(CONTENT_TYPE, "application/json")
                    .body(Body::from(
                        json!({
                          "key": "demo+1",
                          "favorite": {
                            "title": "Kid Favorite",
                            "source_name": "Demo Source",
                            "year": "2026",
                            "cover": "favorite.jpg",
                            "total_episodes": 24,
                            "save_time": 20,
                            "search_title": "Kid Favorite Search",
                            "playback_mode": "online",
                            "offline_content_id": null,
                            "is_adult": false,
                            "origin": "vod"
                          }
                        })
                        .to_string(),
                    ))
                    .expect("kid favorites post request"),
            )
            .await
            .expect("kid favorites post response");
        assert_eq!(favorites_post.status(), StatusCode::OK);

        let favorites_get = app
            .clone()
            .oneshot(
                Request::builder()
                    .uri("/api/favorites?key=demo%2B1")
                    .header("cookie", auth_cookie.clone())
                    .body(Body::empty())
                    .expect("kid favorites get request"),
            )
            .await
            .expect("kid favorites get response");
        let favorites_payload = read_json_body(favorites_get).await;
        assert_eq!(
            favorites_payload.get("title").and_then(Value::as_str),
            Some("Kid Favorite")
        );

        let follows_post = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/api/follows")
                    .header("cookie", auth_cookie.clone())
                    .header(CONTENT_TYPE, "application/json")
                    .body(Body::from(
                        json!({
                          "key": "demo+1",
                          "follow": {
                            "title": "Kid Follow",
                            "source_name": "Demo Source",
                            "year": "2026",
                            "cover": "follow.jpg",
                            "search_title": "Kid Follow Search",
                            "followed_at": 100,
                            "followed_episode_count": 2,
                            "acknowledged_episode_count": 0,
                            "latest_episode_count": 0,
                            "last_checked_at": 0
                          }
                        })
                        .to_string(),
                    ))
                    .expect("kid follows post request"),
            )
            .await
            .expect("kid follows post response");
        assert_eq!(follows_post.status(), StatusCode::OK);

        let follows_get = app
            .clone()
            .oneshot(
                Request::builder()
                    .uri("/api/follows?key=demo%2B1")
                    .header("cookie", auth_cookie.clone())
                    .body(Body::empty())
                    .expect("kid follows get request"),
            )
            .await
            .expect("kid follows get response");
        let follows_payload = read_json_body(follows_get).await;
        assert_eq!(
            follows_payload
                .get("acknowledged_episode_count")
                .and_then(Value::as_i64),
            Some(2)
        );
        assert_eq!(
            follows_payload
                .get("latest_episode_count")
                .and_then(Value::as_i64),
            Some(2)
        );

        let search_history_post = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/api/searchhistory")
                    .header("cookie", auth_cookie.clone())
                    .header(CONTENT_TYPE, "application/json")
                    .body(Body::from(
                        json!({
                          "keyword": "  Demo Query  "
                        })
                        .to_string(),
                    ))
                    .expect("kid search history post request"),
            )
            .await
            .expect("kid search history post response");
        assert_eq!(search_history_post.status(), StatusCode::OK);
        let search_history_post_payload = read_json_body(search_history_post).await;
        assert_eq!(
            search_history_post_payload
                .as_array()
                .and_then(|items| items.first())
                .and_then(Value::as_str),
            Some("Demo Query")
        );

        let search_history_get = app
            .clone()
            .oneshot(
                Request::builder()
                    .uri("/api/searchhistory")
                    .header("cookie", auth_cookie.clone())
                    .body(Body::empty())
                    .expect("kid search history get request"),
            )
            .await
            .expect("kid search history get response");
        let search_history_payload = read_json_body(search_history_get).await;
        assert_eq!(
            search_history_payload
                .as_array()
                .and_then(|items| items.first())
                .and_then(Value::as_str),
            Some("Demo Query")
        );

        let skip_configs_post = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/api/skipconfigs")
                    .header("cookie", auth_cookie.clone())
                    .header(CONTENT_TYPE, "application/json")
                    .body(Body::from(
                        json!({
                          "key": "demo+1",
                          "config": {
                            "enable": true,
                            "intro_time": 12,
                            "outro_time": 34
                          }
                        })
                        .to_string(),
                    ))
                    .expect("kid skip configs post request"),
            )
            .await
            .expect("kid skip configs post response");
        assert_eq!(skip_configs_post.status(), StatusCode::OK);

        let skip_configs_get = app
            .oneshot(
                Request::builder()
                    .uri("/api/skipconfigs?source=demo&id=1")
                    .header("cookie", auth_cookie)
                    .body(Body::empty())
                    .expect("kid skip configs get request"),
            )
            .await
            .expect("kid skip configs get response");
        let skip_configs_payload = read_json_body(skip_configs_get).await;
        assert_eq!(
            skip_configs_payload
                .get("intro_time")
                .and_then(Value::as_i64),
            Some(12)
        );

        let kid_snapshot = state
            .profile_store()
            .load_snapshot("kid")
            .expect("load kid profile snapshot");
        assert_eq!(kid_snapshot.play_records.len(), 1);
        assert_eq!(kid_snapshot.favorites.len(), 1);
        assert_eq!(kid_snapshot.follow_records.len(), 1);
        assert_eq!(kid_snapshot.search_history, vec!["Demo Query".to_string()]);
        assert_eq!(kid_snapshot.skip_configs.len(), 1);

        let owner_snapshot = state
            .profile_store()
            .load_snapshot("desktop-owner")
            .expect("load owner profile snapshot");
        assert!(owner_snapshot.play_records.is_empty());
        assert!(owner_snapshot.favorites.is_empty());
        assert!(owner_snapshot.follow_records.is_empty());
        assert!(owner_snapshot.search_history.is_empty());
        assert!(owner_snapshot.skip_configs.is_empty());
    }

    #[tokio::test]
    async fn profile_playrecords_route_proxies_profile_sync_mode() {
        let upstream = spawn_mock_server(Router::new().route(
            "/api/playrecords",
            get(|| async move {
                Json(json!({
                  "demo+remote": {
                    "title": "Remote Demo",
                    "source_name": "Remote Source",
                    "year": "2026",
                    "cover": "remote.jpg",
                    "index": 1,
                    "total_episodes": 12,
                    "play_time": 30,
                    "total_time": 60,
                    "save_time": 99,
                    "search_title": null,
                    "playback_mode": null,
                    "offline_content_id": null,
                    "is_adult": false
                  }
                }))
            }),
        ))
        .await;
        let temp_dir = TestDir::new();
        let config_path = write_test_config(
            &temp_dir,
            json!({
              "profile_sync": {
                "api_base_url": upstream.base_url()
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
                    .uri("/api/playrecords")
                    .body(Body::empty())
                    .expect("proxied playrecords request"),
            )
            .await
            .expect("proxied playrecords response");

        assert_eq!(response.status(), StatusCode::OK);
        let payload = read_json_body(response).await;
        assert_eq!(
            payload
                .get("demo+remote")
                .and_then(|record| record.get("title"))
                .and_then(Value::as_str),
            Some("Remote Demo")
        );

        upstream.abort();
    }

    #[tokio::test]
    async fn profile_sync_user_data_routes_proxy_all_domains() {
        let upstream = spawn_mock_server(
            Router::new()
                .route(
                    "/api/playrecords",
                    get(|| async move { Json(json!({ "domain": "playrecords" })) }),
                )
                .route(
                    "/api/favorites",
                    get(|| async move { Json(json!({ "domain": "favorites" })) }),
                )
                .route(
                    "/api/follows",
                    get(|| async move { Json(json!({ "domain": "follows" })) }),
                )
                .route(
                    "/api/searchhistory",
                    get(|| async move { Json(json!({ "domain": "searchhistory" })) }),
                )
                .route(
                    "/api/skipconfigs",
                    get(|| async move { Json(json!({ "domain": "skipconfigs" })) }),
                ),
        )
        .await;
        let temp_dir = TestDir::new();
        let config_path = write_test_config(
            &temp_dir,
            json!({
              "profile_sync": {
                "api_base_url": upstream.base_url()
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

        for (path, expected_domain) in [
            ("/api/playrecords", "playrecords"),
            ("/api/favorites", "favorites"),
            ("/api/follows", "follows"),
            ("/api/searchhistory", "searchhistory"),
            ("/api/skipconfigs", "skipconfigs"),
        ] {
            let response = app
                .clone()
                .oneshot(
                    Request::builder()
                        .uri(path)
                        .body(Body::empty())
                        .expect("profile sync user-data request"),
                )
                .await
                .expect("profile sync user-data response");

            assert_eq!(response.status(), StatusCode::OK);
            let payload = read_json_body(response).await;
            assert_eq!(
                payload.get("domain").and_then(Value::as_str),
                Some(expected_domain)
            );
        }

        upstream.abort();
    }

    #[tokio::test]
    async fn profile_sync_login_session_is_carried_and_cleared_after_401() {
        let upstream = spawn_mock_server(
            Router::new()
                .route(
                    "/api/login",
                    post(|| async move {
                        Json(json!({
                            "ok": true,
                            "username": "remote-user",
                            "role": "user"
                        }))
                    }),
                )
                .route(
                    "/api/server-config",
                    get(|| async move {
                        Json(json!({
                            "StorageType": "redis",
                            "ProfileMode": "shared-multi-user"
                        }))
                    }),
                )
                .route(
                    "/api/playrecords",
                    get(|| async move { StatusCode::UNAUTHORIZED.into_response() }),
                ),
        )
        .await;
        let temp_dir = TestDir::new();
        let config_path = write_test_config(
            &temp_dir,
            json!({
              "profile_sync": {
                "api_base_url": upstream.base_url()
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

        let login_response = app
            .clone()
            .oneshot(
                Request::builder()
                    .method(Method::POST)
                    .uri("/api/login")
                    .header(CONTENT_TYPE, "application/json")
                    .body(Body::from(r#"{"password":"demo"}"#))
                    .expect("profile sync login request"),
            )
            .await
            .expect("profile sync login response");
        assert_eq!(login_response.status(), StatusCode::OK);

        let status_before_401 = app
            .clone()
            .oneshot(
                Request::builder()
                    .uri("/api/profile-sync/status")
                    .body(Body::empty())
                    .expect("profile sync status before 401 request"),
            )
            .await
            .expect("profile sync status before 401 response");
        let payload_before_401 = read_json_body(status_before_401).await;
        assert_eq!(
            payload_before_401
                .get("authenticated")
                .and_then(Value::as_bool),
            Some(true)
        );
        assert_eq!(
            payload_before_401.get("username").and_then(Value::as_str),
            Some("remote-user")
        );

        let proxied_401_response = app
            .clone()
            .oneshot(
                Request::builder()
                    .uri("/api/playrecords")
                    .body(Body::empty())
                    .expect("profile sync passthrough request"),
            )
            .await
            .expect("profile sync passthrough response");
        assert_eq!(proxied_401_response.status(), StatusCode::UNAUTHORIZED);

        let status_after_401 = app
            .oneshot(
                Request::builder()
                    .uri("/api/profile-sync/status")
                    .body(Body::empty())
                    .expect("profile sync status after 401 request"),
            )
            .await
            .expect("profile sync status after 401 response");
        let payload_after_401 = read_json_body(status_after_401).await;
        assert_eq!(
            payload_after_401
                .get("authenticated")
                .and_then(Value::as_bool),
            Some(false)
        );
        assert_eq!(payload_after_401.get("username"), Some(&Value::Null));
        assert_eq!(
            payload_after_401.get("reachable").and_then(Value::as_bool),
            Some(true)
        );

        upstream.abort();
    }

    #[tokio::test]
    async fn profile_sync_onboarding_routes_are_registered() {
        let temp_dir = TestDir::new();
        let config_path = write_test_config(
            &temp_dir,
            json!({
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

        for path in [
            "/api/admin/profile-sync/onboarding/preview",
            "/api/admin/profile-sync/onboarding/execute",
        ] {
            let response = app
                .clone()
                .oneshot(
                    Request::builder()
                        .method(Method::POST)
                        .uri(path)
                        .header(CONTENT_TYPE, "application/json")
                        .body(Body::from("{}"))
                        .expect("profile sync onboarding request"),
                )
                .await
                .expect("profile sync onboarding response");

            assert_eq!(response.status(), StatusCode::BAD_REQUEST);
            let payload = read_json_body(response).await;
            assert_eq!(
                payload.get("error").and_then(Value::as_str),
                Some("缺少 Web 用户名")
            );
        }
    }

    #[tokio::test]
    async fn profile_sync_onboarding_execute_surfaces_merge_route_version_mismatch_cleanly() {
        let upstream = spawn_mock_server(
            Router::new()
                .route(
                    "/api/login",
                    post(|| async move {
                        Json(json!({
                            "ok": true,
                            "username": "admin",
                            "role": "admin"
                        }))
                    }),
                )
                .route(
                    "/api/admin/config",
                    get(|| async move {
                        Json(json!({
                            "Role": "admin",
                            "Config": {
                                "UserConfig": {
                                    "Users": [
                                        {
                                            "username": "admin"
                                        }
                                    ]
                                }
                            }
                        }))
                    }),
                )
                .route(
                    "/api/admin/profile-sync/merge",
                    post(|| async move {
                        (
                            StatusCode::NOT_FOUND,
                            [(CONTENT_TYPE, "text/html; charset=utf-8")],
                            "<!DOCTYPE html><html><body>404</body></html>",
                        )
                    }),
                ),
        )
        .await;
        let temp_dir = TestDir::new();
        let raw_config = json!({
          "auth": {
            "username": "owner",
            "password": "owner-secret"
          },
          "api_site": {}
        });
        let config_path = write_test_config(&temp_dir, raw_config.clone());
        write_test_admin_persistence(
            &temp_dir,
            json!({
              "config": {
                "ConfigSubscribtion": {
                  "URL": "",
                  "AutoUpdate": false,
                  "LastCheck": ""
                },
                "ConfigFile": serde_json::to_string_pretty(&raw_config)
                  .expect("serialize raw config"),
                "SiteConfig": {
                  "SiteName": "Desktop LunaTV",
                  "Announcement": "",
                  "SearchDownstreamMaxPage": 5,
                  "SiteInterfaceCacheTime": 7200,
                  "DoubanProxyType": "custom",
                  "DoubanProxy": "",
                  "DoubanImageProxyType": "custom",
                  "DoubanImageProxy": "",
                  "DisableYellowFilter": false,
                  "FluidSearch": true,
                  "EnableWebLive": false
                },
                "UserConfig": {
                  "Users": [
                    {
                      "username": "owner",
                      "role": "owner"
                    }
                  ],
                  "Tags": []
                },
                "SourceConfig": [],
                "CustomCategories": [],
                "LiveConfig": []
              },
              "userPasswords": {}
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
                    .method(Method::POST)
                    .uri("/api/admin/profile-sync/onboarding/execute")
                    .header(CONTENT_TYPE, "application/json")
                    .body(Body::from(
                        json!({
                          "remoteBaseUrl": upstream.base_url(),
                          "username": "admin",
                          "password": "secret",
                          "currentLocalUsername": "owner",
                          "strategy": "web-first"
                        })
                        .to_string(),
                    ))
                    .expect("profile sync onboarding execute request"),
            )
            .await
            .expect("profile sync onboarding execute response");

        assert_eq!(response.status(), StatusCode::BAD_REQUEST);
        let payload = read_json_body(response).await;
        let error_text = payload
            .get("error")
            .and_then(Value::as_str)
            .expect("profile sync onboarding execute error text");
        assert!(
            error_text.contains("远端资料迁移接口异常"),
            "unexpected error text: {error_text}"
        );
        assert!(
            error_text.contains(&format!(
                "POST {}/api/admin/profile-sync/merge",
                upstream.base_url()
            )),
            "unexpected error text: {error_text}"
        );
        assert!(
            error_text.contains("404 Not Found"),
            "unexpected error text: {error_text}"
        );
        assert!(
            error_text.contains("text/html; charset=utf-8"),
            "unexpected error text: {error_text}"
        );
        assert!(
            error_text.contains("<!DOCTYPE html><html><body>404</body></html>"),
            "unexpected error text: {error_text}"
        );

        upstream.abort();
    }

    #[tokio::test]
    async fn profile_sync_sync_now_rejects_adminsettings_for_non_admin_role() {
        let merge_call_count = Arc::new(Mutex::new(0usize));
        let merge_call_count_for_route = Arc::clone(&merge_call_count);
        let upstream = spawn_mock_server(Router::new().route(
            "/api/admin/profile-sync/merge",
            post(move || {
                let merge_call_count = Arc::clone(&merge_call_count_for_route);
                async move {
                    *merge_call_count.lock().expect("merge call count") += 1;
                    Json(json!({
                        "summary": {
                            "playRecordCount": 0,
                            "favoriteCount": 0,
                            "followCount": 0,
                            "searchHistoryCount": 0,
                            "skipConfigCount": 0
                        }
                    }))
                }
            }),
        ))
        .await;
        let temp_dir = TestDir::new();
        let config_path = write_test_config(
            &temp_dir,
            json!({
              "auth": {
                "username": "desktop-owner",
                "password": "owner-secret"
              },
              "profile_sync": {
                "api_base_url": upstream.base_url()
              },
              "api_site": {}
            }),
        );
        let state = AppState::new(
            DEFAULT_HOST.to_string(),
            DEFAULT_PORT,
            config_path,
            temp_dir.path.join("data"),
            temp_dir.path.join("data/moontv.sqlite3"),
        );
        *state.profile_sync_session.write().await = Some(ProfileSyncSession {
            username: "kid".to_string(),
            role: "user".to_string(),
        });
        let app = build_router(state);

        let response = app
            .oneshot(
                Request::builder()
                    .method(Method::POST)
                    .uri("/api/profile-sync/sync-now")
                    .header(CONTENT_TYPE, "application/json")
                    .body(Body::from(
                        json!({
                          "syncDomains": ["playrecords", "adminsettings"]
                        })
                        .to_string(),
                    ))
                    .expect("profile sync sync-now request"),
            )
            .await
            .expect("profile sync sync-now response");

        assert_eq!(response.status(), StatusCode::FORBIDDEN);
        let payload = read_json_body(response).await;
        assert_eq!(
            payload.get("error").and_then(Value::as_str),
            Some("只有 Web owner/admin 可以同步管理员设置")
        );
        assert_eq!(
            *merge_call_count.lock().expect("merge call count"),
            0,
            "merge route should not be called for non-admin adminsettings sync"
        );

        upstream.abort();
    }

    #[tokio::test]
    async fn profile_sync_sync_now_merges_only_selected_domains_and_persists_scope() {
        let captured_payloads = Arc::new(Mutex::new(Vec::<Value>::new()));
        let captured_payloads_for_route = Arc::clone(&captured_payloads);
        let upstream = spawn_mock_server(
            Router::new()
                .route(
                    "/api/server-config",
                    get(|| async move {
                        Json(json!({
                            "StorageType": "redis",
                            "ProfileMode": "shared-multi-user"
                        }))
                    }),
                )
                .route(
                    "/api/admin/profile-sync/merge",
                    post(move |Json(payload): Json<Value>| {
                        let captured_payloads = Arc::clone(&captured_payloads_for_route);
                        async move {
                            captured_payloads
                                .lock()
                                .expect("capture merge payloads")
                                .push(payload.clone());
                            Json(json!({
                                "summary": {
                                    "playRecordCount": 0,
                                    "favoriteCount": 1,
                                    "followCount": 0,
                                    "searchHistoryCount": 0,
                                    "skipConfigCount": 0
                                }
                            }))
                        }
                    }),
                ),
        )
        .await;
        let temp_dir = TestDir::new();
        let config_path = write_test_config(
            &temp_dir,
            json!({
              "auth": {
                "username": "remote-owner",
                "password": "owner-secret"
              },
              "profile_sync": {
                "api_base_url": upstream.base_url()
              },
              "api_site": {}
            }),
        );
        let state = AppState::new(
            DEFAULT_HOST.to_string(),
            DEFAULT_PORT,
            config_path,
            temp_dir.path.join("data"),
            temp_dir.path.join("data/moontv.sqlite3"),
        );
        *state.profile_sync_session.write().await = Some(ProfileSyncSession {
            username: "remote-owner".to_string(),
            role: "owner".to_string(),
        });
        state
            .profile_store()
            .save_play_records(
                "remote-owner",
                &BTreeMap::from([(
                    "play+1".to_string(),
                    PlayRecord {
                        title: "Demo Play".to_string(),
                        source_name: "demo".to_string(),
                        year: "2026".to_string(),
                        cover: String::new(),
                        index: 1,
                        total_episodes: 12,
                        play_time: 60,
                        total_time: 120,
                        save_time: 1,
                        search_title: None,
                        playback_mode: None,
                        offline_content_id: None,
                        is_adult: None,
                    },
                )]),
            )
            .expect("save play records");
        state
            .profile_store()
            .save_favorites(
                "remote-owner",
                &BTreeMap::from([(
                    "fav+1".to_string(),
                    Favorite {
                        title: "Demo Favorite".to_string(),
                        source_name: "demo".to_string(),
                        year: "2026".to_string(),
                        cover: String::new(),
                        total_episodes: 12,
                        save_time: 1,
                        search_title: None,
                        playback_mode: None,
                        offline_content_id: None,
                        is_adult: None,
                        origin: None,
                    },
                )]),
            )
            .expect("save favorites");
        state
            .profile_store()
            .save_follow_records(
                "remote-owner",
                &BTreeMap::from([(
                    "follow+1".to_string(),
                    FollowRecord {
                        title: "Demo Follow".to_string(),
                        source_name: "demo".to_string(),
                        year: "2026".to_string(),
                        cover: String::new(),
                        search_title: None,
                        followed_at: 1,
                        followed_episode_count: 1,
                        acknowledged_episode_count: 0,
                        latest_episode_count: 1,
                        last_checked_at: 1,
                    },
                )]),
            )
            .expect("save follow records");
        state
            .profile_store()
            .save_search_history("remote-owner", &["Demo Query".to_string()])
            .expect("save search history");
        state
            .profile_store()
            .save_skip_configs(
                "remote-owner",
                &BTreeMap::from([(
                    "skip+1".to_string(),
                    SkipConfig {
                        enable: true,
                        intro_time: 30,
                        outro_time: 90,
                    },
                )]),
            )
            .expect("save skip configs");
        let app = build_router(state);

        let response = app
            .clone()
            .oneshot(
                Request::builder()
                    .method(Method::POST)
                    .uri("/api/profile-sync/sync-now")
                    .header(CONTENT_TYPE, "application/json")
                    .body(Body::from(
                        json!({
                          "syncDomains": ["favorites"],
                          "strategy": "web-first"
                        })
                        .to_string(),
                    ))
                    .expect("profile sync sync-now request"),
            )
            .await
            .expect("profile sync sync-now response");

        assert_eq!(response.status(), StatusCode::OK);
        let payload = read_json_body(response).await;
        assert_eq!(payload.get("syncDomains"), Some(&json!(["favorites"])));

        let captured_payloads = captured_payloads.lock().expect("captured payloads");
        assert_eq!(captured_payloads.len(), 1);
        assert_eq!(
            captured_payloads[0].get("strategy").and_then(Value::as_str),
            Some("web-first")
        );
        assert_eq!(
            captured_payloads[0]
                .get("snapshot")
                .and_then(|value| value.get("favorites"))
                .and_then(|value| value.get("fav+1"))
                .and_then(|value| value.get("title"))
                .and_then(Value::as_str),
            Some("Demo Favorite")
        );
        assert_eq!(
            captured_payloads[0]
                .get("snapshot")
                .and_then(|value| value.get("playRecords")),
            Some(&json!({}))
        );
        assert_eq!(
            captured_payloads[0]
                .get("snapshot")
                .and_then(|value| value.get("follows")),
            Some(&json!({}))
        );
        assert_eq!(
            captured_payloads[0]
                .get("snapshot")
                .and_then(|value| value.get("searchHistory")),
            Some(&json!([]))
        );
        assert_eq!(
            captured_payloads[0]
                .get("snapshot")
                .and_then(|value| value.get("skipConfigs")),
            Some(&json!({}))
        );
        assert_eq!(captured_payloads[0].get("adminConfig"), None);
        drop(captured_payloads);

        let status_response = app
            .oneshot(
                Request::builder()
                    .uri("/api/profile-sync/status")
                    .body(Body::empty())
                    .expect("profile sync status request"),
            )
            .await
            .expect("profile sync status response");

        assert_eq!(status_response.status(), StatusCode::OK);
        let status_payload = read_json_body(status_response).await;
        assert_eq!(
            status_payload.get("syncDomains"),
            Some(&json!(["favorites"]))
        );

        upstream.abort();
    }

    #[tokio::test]
    async fn profile_sync_sync_now_web_first_with_adminsettings_applies_remote_admin_config_locally()
     {
        let captured_payloads = Arc::new(Mutex::new(Vec::<Value>::new()));
        let captured_payloads_for_route = Arc::clone(&captured_payloads);
        let remote_raw_config = json!({
          "auth": {
            "username": "remote-owner",
            "password": "remote-owner-secret"
          },
          "api_site": {
            "remote": {
              "api": "https://remote.example/api.php/provide/vod",
              "name": "Remote Source"
            }
          }
        });
        let remote_admin_config_response = json!({
          "Role": "owner",
          "Config": {
            "ConfigSubscribtion": {
              "URL": "https://remote.example/subscription",
              "AutoUpdate": true,
              "LastCheck": "2026-07-02T00:00:00Z"
            },
            "ConfigFile": serde_json::to_string_pretty(&remote_raw_config)
              .expect("serialize remote raw config"),
            "SiteConfig": {
              "SiteName": "Remote LunaTV",
              "Announcement": "Remote announcement",
              "SearchDownstreamMaxPage": 8,
              "SiteInterfaceCacheTime": 3600,
              "DoubanProxyType": "custom",
              "DoubanProxy": "https://remote.example/douban",
              "DoubanImageProxyType": "custom",
              "DoubanImageProxy": "https://remote.example/image",
              "DisableYellowFilter": true,
              "FluidSearch": false,
              "EnableWebLive": true
            },
            "UserConfig": {
              "Users": [
                {
                  "username": "remote-owner",
                  "role": "owner"
                },
                {
                  "username": "remote-admin",
                  "role": "admin"
                }
              ],
              "Tags": [
                {
                  "name": "remote-tag",
                  "enabledApis": ["remote"]
                }
              ]
            },
            "SourceConfig": [
              {
                "key": "remote",
                "name": "Remote Source",
                "api": "https://remote.example/api.php/provide/vod",
                "detail": null,
                "ua": null,
                "referer": null,
                "from": "config",
                "disabled": false,
                "disable_ad_filter": false
              }
            ],
            "CustomCategories": [],
            "LiveConfig": [],
            "AdFilterConfig": {
              "enabled": false
            },
            "PlayerEnhancementConfig": {
              "AudioSpikeProtection": true,
              "VisualEnhancement": true
            }
          }
        });
        let upstream = spawn_mock_server(
            Router::new()
                .route(
                    "/api/server-config",
                    get(|| async move {
                        Json(json!({
                            "StorageType": "redis",
                            "ProfileMode": "shared-multi-user"
                        }))
                    }),
                )
                .route(
                    "/api/admin/config",
                    get({
                        let remote_admin_config_response = remote_admin_config_response.clone();
                        move || {
                            let remote_admin_config_response = remote_admin_config_response.clone();
                            async move { Json(remote_admin_config_response) }
                        }
                    }),
                )
                .route(
                    "/api/admin/profile-sync/merge",
                    post(move |Json(payload): Json<Value>| {
                        let captured_payloads = Arc::clone(&captured_payloads_for_route);
                        async move {
                            captured_payloads
                                .lock()
                                .expect("capture merge payloads")
                                .push(payload.clone());
                            Json(json!({
                                "summary": {
                                    "playRecordCount": 0,
                                    "favoriteCount": 0,
                                    "followCount": 0,
                                    "searchHistoryCount": 0,
                                    "skipConfigCount": 0
                                }
                            }))
                        }
                    }),
                ),
        )
        .await;
        let temp_dir = TestDir::new();
        let local_raw_config = json!({
          "auth": {
            "username": "remote-owner",
            "password": "local-owner-secret"
          },
          "profile_sync": {
            "api_base_url": upstream.base_url()
          },
          "api_site": {
            "local": {
              "api": "https://local.example/api.php/provide/vod",
              "name": "Local Source"
            }
          }
        });
        let config_path = write_test_config(&temp_dir, local_raw_config.clone());
        write_test_admin_persistence(
            &temp_dir,
            json!({
              "config": {
                "ConfigSubscribtion": {
                  "URL": "https://local.example/subscription",
                  "AutoUpdate": false,
                  "LastCheck": ""
                },
                "ConfigFile": serde_json::to_string_pretty(&local_raw_config)
                  .expect("serialize local raw config"),
                "SiteConfig": {
                  "SiteName": "Local LunaTV",
                  "Announcement": "",
                  "SearchDownstreamMaxPage": 5,
                  "SiteInterfaceCacheTime": 7200,
                  "DoubanProxyType": "custom",
                  "DoubanProxy": "",
                  "DoubanImageProxyType": "custom",
                  "DoubanImageProxy": "",
                  "DisableYellowFilter": false,
                  "FluidSearch": true,
                  "EnableWebLive": false
                },
                "UserConfig": {
                  "Users": [
                    {
                      "username": "remote-owner",
                      "role": "owner"
                    }
                  ],
                  "Tags": []
                },
                "SourceConfig": [
                  {
                    "key": "local",
                    "name": "Local Source",
                    "api": "https://local.example/api.php/provide/vod",
                    "detail": null,
                    "ua": null,
                    "referer": null,
                    "from": "config",
                    "disabled": false,
                    "disable_ad_filter": false
                  }
                ],
                "CustomCategories": [],
                "LiveConfig": []
              },
              "userPasswords": {}
            }),
        );
        let state = AppState::new(
            DEFAULT_HOST.to_string(),
            DEFAULT_PORT,
            config_path,
            temp_dir.path.join("data"),
            temp_dir.path.join("data/moontv.sqlite3"),
        );
        *state.profile_sync_session.write().await = Some(ProfileSyncSession {
            username: "remote-owner".to_string(),
            role: "owner".to_string(),
        });
        let app = build_router(state);

        let response = app
            .clone()
            .oneshot(
                Request::builder()
                    .method(Method::POST)
                    .uri("/api/profile-sync/sync-now")
                    .header(CONTENT_TYPE, "application/json")
                    .body(Body::from(
                        json!({
                          "syncDomains": ["adminsettings"],
                          "strategy": "web-first"
                        })
                        .to_string(),
                    ))
                    .expect("profile sync sync-now request"),
            )
            .await
            .expect("profile sync sync-now response");

        assert_eq!(response.status(), StatusCode::OK);
        let payload = read_json_body(response).await;
        assert_eq!(payload.get("syncDomains"), Some(&json!(["adminsettings"])));

        let captured_payloads = captured_payloads.lock().expect("captured payloads");
        assert_eq!(captured_payloads.len(), 1);
        assert_eq!(captured_payloads[0].get("adminConfig"), None);
        drop(captured_payloads);

        let admin_response = app
            .oneshot(
                Request::builder()
                    .uri("/api/admin/config")
                    .body(Body::empty())
                    .expect("admin config request"),
            )
            .await
            .expect("admin config response");

        assert_eq!(admin_response.status(), StatusCode::OK);
        let admin_payload = read_json_body(admin_response).await;
        assert_eq!(
            admin_payload
                .get("Config")
                .and_then(|value| value.get("SiteConfig"))
                .and_then(|value| value.get("SiteName"))
                .and_then(Value::as_str),
            Some("Remote LunaTV")
        );
        assert_eq!(
            admin_payload
                .get("Config")
                .and_then(|value| value.get("ConfigSubscribtion"))
                .and_then(|value| value.get("URL"))
                .and_then(Value::as_str),
            Some("https://local.example/subscription")
        );
        assert_eq!(
            admin_payload
                .get("Config")
                .and_then(|value| value.get("SourceConfig"))
                .and_then(Value::as_array)
                .and_then(|value| value.first())
                .and_then(|value| value.get("key"))
                .and_then(Value::as_str),
            Some("remote")
        );
        assert!(
            admin_payload
                .get("Config")
                .and_then(|value| value.get("UserConfig"))
                .and_then(|value| value.get("Users"))
                .and_then(Value::as_array)
                .is_some_and(|users| users.iter().all(|user| {
                    user.get("username").and_then(Value::as_str) != Some("remote-admin")
                })),
            "expected local user config to stay intact"
        );
        assert!(
            admin_payload
                .get("Config")
                .and_then(|value| value.get("ConfigFile"))
                .and_then(Value::as_str)
                .is_some_and(|config_file| {
                    config_file.contains("local-owner-secret")
                        && config_file.contains(&upstream.base_url())
                        && config_file.contains("adminsettings")
                        && !config_file.contains("remote-owner-secret")
                }),
            "expected local auth plus persisted profile sync settings in config file"
        );

        upstream.abort();
    }

    #[tokio::test]
    async fn profile_sync_onboarding_execute_skips_password_warning_when_no_account_is_created() {
        let upstream = spawn_mock_server(
            Router::new()
                .route(
                    "/api/login",
                    post(|| async move {
                        Json(json!({
                            "ok": true,
                            "username": "remote-owner",
                            "role": "owner"
                        }))
                    }),
                )
                .route(
                    "/api/admin/config",
                    get(|| async move {
                        Json(json!({
                            "Role": "owner",
                            "Config": {
                                "UserConfig": {
                                    "Users": [
                                        {
                                            "username": "remote-owner"
                                        }
                                    ]
                                }
                            }
                        }))
                    }),
                )
                .route(
                    "/api/admin/profile-sync/merge",
                    post(|| async move {
                        Json(json!({
                            "summary": {
                                "playRecordCount": 0,
                                "favoriteCount": 0,
                                "followCount": 0,
                                "searchHistoryCount": 0,
                                "skipConfigCount": 0
                            }
                        }))
                    }),
                ),
        )
        .await;
        let temp_dir = TestDir::new();
        let raw_config = json!({
          "auth": {
            "username": "owner",
            "password": "owner-secret"
          },
          "api_site": {}
        });
        let config_path = write_test_config(&temp_dir, raw_config.clone());
        write_test_admin_persistence(
            &temp_dir,
            json!({
              "config": {
                "ConfigSubscribtion": {
                  "URL": "",
                  "AutoUpdate": false,
                  "LastCheck": ""
                },
                "ConfigFile": serde_json::to_string_pretty(&raw_config)
                  .expect("serialize raw config"),
                "SiteConfig": {
                  "SiteName": "Desktop LunaTV",
                  "Announcement": "",
                  "SearchDownstreamMaxPage": 5,
                  "SiteInterfaceCacheTime": 7200,
                  "DoubanProxyType": "custom",
                  "DoubanProxy": "",
                  "DoubanImageProxyType": "custom",
                  "DoubanImageProxy": "",
                  "DisableYellowFilter": false,
                  "FluidSearch": true,
                  "EnableWebLive": false
                },
                "UserConfig": {
                  "Users": [
                    {
                      "username": "owner",
                      "role": "owner"
                    }
                  ],
                  "Tags": []
                },
                "SourceConfig": [],
                "CustomCategories": [],
                "LiveConfig": []
              },
              "userPasswords": {}
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
                    .method(Method::POST)
                    .uri("/api/admin/profile-sync/onboarding/execute")
                    .header(CONTENT_TYPE, "application/json")
                    .body(Body::from(
                        json!({
                          "remoteBaseUrl": upstream.base_url(),
                          "username": "remote-owner",
                          "password": "secret",
                          "currentLocalUsername": "owner",
                          "strategy": "web-first"
                        })
                        .to_string(),
                    ))
                    .expect("profile sync onboarding execute request"),
            )
            .await
            .expect("profile sync onboarding execute response");

        assert_eq!(response.status(), StatusCode::OK);
        let payload = read_json_body(response).await;
        assert_eq!(
            payload
                .get("createdAccounts")
                .and_then(Value::as_array)
                .map(Vec::len),
            Some(0)
        );
        let warnings = payload
            .get("warnings")
            .and_then(Value::as_array)
            .expect("profile sync onboarding execute warnings");
        let warning_texts = warnings
            .iter()
            .map(|warning| {
                warning
                    .as_str()
                    .expect("profile sync onboarding warning text")
            })
            .collect::<Vec<_>>();
        assert_eq!(
            warning_texts,
            vec!["仅当前仍保留的这套离线下载可以迁移，之前已清理的旧归属无法恢复。"]
        );

        upstream.abort();
    }

    #[tokio::test]
    async fn profile_sync_onboarding_execute_persists_selected_sync_domains() {
        let upstream = spawn_mock_server(
            Router::new()
                .route(
                    "/api/login",
                    post(|| async move {
                        Json(json!({
                            "ok": true,
                            "username": "remote-owner",
                            "role": "owner"
                        }))
                    }),
                )
                .route(
                    "/api/admin/config",
                    get(|| async move {
                        Json(json!({
                            "Role": "owner",
                            "Config": {
                                "UserConfig": {
                                    "Users": [
                                        {
                                            "username": "remote-owner"
                                        }
                                    ]
                                }
                            }
                        }))
                    }),
                )
                .route(
                    "/api/admin/profile-sync/merge",
                    post(|| async move {
                        Json(json!({
                            "summary": {
                                "playRecordCount": 0,
                                "favoriteCount": 0,
                                "followCount": 0,
                                "searchHistoryCount": 0,
                                "skipConfigCount": 0
                            }
                        }))
                    }),
                ),
        )
        .await;
        let temp_dir = TestDir::new();
        let raw_config = json!({
          "auth": {
            "username": "owner",
            "password": "owner-secret"
          },
          "api_site": {}
        });
        let config_path = write_test_config(&temp_dir, raw_config.clone());
        write_test_admin_persistence(
            &temp_dir,
            json!({
              "config": {
                "ConfigSubscribtion": {
                  "URL": "",
                  "AutoUpdate": false,
                  "LastCheck": ""
                },
                "ConfigFile": serde_json::to_string_pretty(&raw_config)
                  .expect("serialize raw config"),
                "SiteConfig": {
                  "SiteName": "Desktop LunaTV",
                  "Announcement": "",
                  "SearchDownstreamMaxPage": 5,
                  "SiteInterfaceCacheTime": 7200,
                  "DoubanProxyType": "custom",
                  "DoubanProxy": "",
                  "DoubanImageProxyType": "custom",
                  "DoubanImageProxy": "",
                  "DisableYellowFilter": false,
                  "FluidSearch": true,
                  "EnableWebLive": false
                },
                "UserConfig": {
                  "Users": [
                    {
                      "username": "owner",
                      "role": "owner"
                    }
                  ],
                  "Tags": []
                },
                "SourceConfig": [],
                "CustomCategories": [],
                "LiveConfig": []
              },
              "userPasswords": {}
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
            .clone()
            .oneshot(
                Request::builder()
                    .method(Method::POST)
                    .uri("/api/admin/profile-sync/onboarding/execute")
                    .header(CONTENT_TYPE, "application/json")
                    .body(Body::from(
                        json!({
                          "remoteBaseUrl": upstream.base_url(),
                          "username": "remote-owner",
                          "password": "secret",
                          "currentLocalUsername": "owner",
                          "strategy": "web-first",
                          "syncDomains": ["favorites"]
                        })
                        .to_string(),
                    ))
                    .expect("profile sync onboarding execute request"),
            )
            .await
            .expect("profile sync onboarding execute response");

        assert_eq!(response.status(), StatusCode::OK);

        let status_response = app
            .oneshot(
                Request::builder()
                    .uri("/api/profile-sync/status")
                    .body(Body::empty())
                    .expect("profile sync status request"),
            )
            .await
            .expect("profile sync status response");

        assert_eq!(status_response.status(), StatusCode::OK);
        let status_payload = read_json_body(status_response).await;
        assert_eq!(
            status_payload.get("syncDomains"),
            Some(&json!(["favorites"]))
        );

        upstream.abort();
    }

    #[tokio::test]
    async fn profile_sync_onboarding_execute_sends_admin_config_snapshot_to_merge_route_when_adminsettings_selected_and_localfirst()
     {
        let upstream = spawn_mock_server(
            Router::new()
                .route(
                    "/api/login",
                    post(|| async move {
                        Json(json!({
                            "ok": true,
                            "username": "remote-owner",
                            "role": "owner"
                        }))
                    }),
                )
                .route(
                    "/api/admin/config",
                    get(|| async move {
                        Json(json!({
                            "Role": "owner",
                            "Config": {
                                "UserConfig": {
                                    "Users": [
                                        {
                                            "username": "remote-owner"
                                        }
                                    ]
                                }
                            }
                        }))
                    }),
                )
                .route(
                    "/api/admin/profile-sync/merge",
                    post(|Json(payload): Json<Value>| async move {
                        assert_eq!(
                            payload
                                .get("adminConfig")
                                .and_then(|value| value.get("SiteConfig"))
                                .and_then(|value| value.get("SiteName"))
                                .and_then(Value::as_str),
                            Some("Desktop LunaTV")
                        );
                        assert_eq!(
                            payload
                                .get("adminConfig")
                                .and_then(|value| value.get("SourceConfig"))
                                .and_then(Value::as_array)
                                .map(Vec::len),
                            Some(1)
                        );
                        assert_eq!(
                            payload
                                .get("adminConfig")
                                .and_then(|value| value.get("ConfigFile")),
                            None
                        );
                        assert_eq!(
                            payload
                                .get("adminConfig")
                                .and_then(|value| value.get("UserConfig")),
                            None
                        );

                        Json(json!({
                            "summary": {
                                "playRecordCount": 0,
                                "favoriteCount": 0,
                                "followCount": 0,
                                "searchHistoryCount": 0,
                                "skipConfigCount": 0
                            }
                        }))
                    }),
                ),
        )
        .await;
        let temp_dir = TestDir::new();
        let raw_config = json!({
          "auth": {
            "username": "owner",
            "password": "owner-secret"
          },
          "api_site": {
            "demo": {
              "api": "https://example.com/api.php/provide/vod",
              "name": "Demo Source"
            }
          }
        });
        let config_path = write_test_config(&temp_dir, raw_config.clone());
        write_test_admin_persistence(
            &temp_dir,
            json!({
              "config": {
                "ConfigSubscribtion": {
                  "URL": "",
                  "AutoUpdate": false,
                  "LastCheck": ""
                },
                "ConfigFile": serde_json::to_string_pretty(&raw_config)
                  .expect("serialize raw config"),
                "SiteConfig": {
                  "SiteName": "Desktop LunaTV",
                  "Announcement": "",
                  "SearchDownstreamMaxPage": 5,
                  "SiteInterfaceCacheTime": 7200,
                  "DoubanProxyType": "custom",
                  "DoubanProxy": "",
                  "DoubanImageProxyType": "custom",
                  "DoubanImageProxy": "",
                  "DisableYellowFilter": false,
                  "FluidSearch": true,
                  "EnableWebLive": false
                },
                "UserConfig": {
                  "Users": [
                    {
                      "username": "owner",
                      "role": "owner"
                    }
                  ],
                  "Tags": []
                },
                "SourceConfig": [
                  {
                    "key": "demo",
                    "name": "Demo Source",
                    "api": "https://example.com/api.php/provide/vod",
                    "detail": null,
                    "ua": null,
                    "referer": null,
                    "from": "config",
                    "disabled": false,
                    "disable_ad_filter": false
                  }
                ],
                "CustomCategories": [],
                "LiveConfig": []
              },
              "userPasswords": {}
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
                    .method(Method::POST)
                    .uri("/api/admin/profile-sync/onboarding/execute")
                    .header(CONTENT_TYPE, "application/json")
                    .body(Body::from(
                        json!({
                          "remoteBaseUrl": upstream.base_url(),
                          "username": "remote-owner",
                          "password": "secret",
                          "currentLocalUsername": "owner",
                          "strategy": "local-first",
                          "syncDomains": ["playrecords", "adminsettings"]
                        })
                        .to_string(),
                    ))
                    .expect("profile sync onboarding execute request"),
            )
            .await
            .expect("profile sync onboarding execute response");

        assert_eq!(response.status(), StatusCode::OK);

        upstream.abort();
    }

    #[tokio::test]
    async fn profile_sync_onboarding_execute_web_first_with_adminsettings_applies_remote_admin_config_locally()
     {
        let captured_payloads = Arc::new(Mutex::new(Vec::<Value>::new()));
        let captured_payloads_for_route = Arc::clone(&captured_payloads);
        let remote_raw_config = json!({
          "auth": {
            "username": "remote-owner",
            "password": "remote-owner-secret"
          },
          "api_site": {
            "remote": {
              "api": "https://remote.example/api.php/provide/vod",
              "name": "Remote Source"
            }
          }
        });
        let remote_admin_config_response = json!({
          "Role": "owner",
          "Config": {
            "ConfigSubscribtion": {
              "URL": "https://remote.example/subscription",
              "AutoUpdate": true,
              "LastCheck": "2026-07-02T00:00:00Z"
            },
            "ConfigFile": serde_json::to_string_pretty(&remote_raw_config)
              .expect("serialize remote raw config"),
            "SiteConfig": {
              "SiteName": "Remote LunaTV",
              "Announcement": "Remote announcement",
              "SearchDownstreamMaxPage": 8,
              "SiteInterfaceCacheTime": 3600,
              "DoubanProxyType": "custom",
              "DoubanProxy": "https://remote.example/douban",
              "DoubanImageProxyType": "custom",
              "DoubanImageProxy": "https://remote.example/image",
              "DisableYellowFilter": true,
              "FluidSearch": false,
              "EnableWebLive": true
            },
            "UserConfig": {
              "Users": [
                {
                  "username": "remote-owner",
                  "role": "owner"
                },
                {
                  "username": "remote-admin",
                  "role": "admin"
                }
              ],
              "Tags": [
                {
                  "name": "remote-tag",
                  "enabledApis": ["remote"]
                }
              ]
            },
            "SourceConfig": [
              {
                "key": "remote",
                "name": "Remote Source",
                "api": "https://remote.example/api.php/provide/vod",
                "detail": null,
                "ua": null,
                "referer": null,
                "from": "config",
                "disabled": false,
                "disable_ad_filter": false
              }
            ],
            "CustomCategories": [],
            "LiveConfig": [],
            "AdFilterConfig": {
              "enabled": false
            },
            "PlayerEnhancementConfig": {
              "AudioSpikeProtection": true,
              "VisualEnhancement": true
            }
          }
        });
        let upstream = spawn_mock_server(
            Router::new()
                .route(
                    "/api/login",
                    post(|| async move {
                        Json(json!({
                            "ok": true,
                            "username": "remote-owner",
                            "role": "owner"
                        }))
                    }),
                )
                .route(
                    "/api/admin/config",
                    get({
                        let remote_admin_config_response = remote_admin_config_response.clone();
                        move || {
                            let remote_admin_config_response = remote_admin_config_response.clone();
                            async move { Json(remote_admin_config_response) }
                        }
                    }),
                )
                .route(
                    "/api/admin/profile-sync/merge",
                    post(move |Json(payload): Json<Value>| {
                        let captured_payloads = Arc::clone(&captured_payloads_for_route);
                        async move {
                            captured_payloads
                                .lock()
                                .expect("capture merge payloads")
                                .push(payload.clone());
                            Json(json!({
                                "summary": {
                                    "playRecordCount": 0,
                                    "favoriteCount": 0,
                                    "followCount": 0,
                                    "searchHistoryCount": 0,
                                    "skipConfigCount": 0
                                }
                            }))
                        }
                    }),
                ),
        )
        .await;
        let temp_dir = TestDir::new();
        let local_raw_config = json!({
          "auth": {
            "username": "owner",
            "password": "local-owner-secret"
          },
          "api_site": {
            "local": {
              "api": "https://local.example/api.php/provide/vod",
              "name": "Local Source"
            }
          }
        });
        let config_path = write_test_config(&temp_dir, local_raw_config.clone());
        write_test_admin_persistence(
            &temp_dir,
            json!({
              "config": {
                "ConfigSubscribtion": {
                  "URL": "https://local.example/subscription",
                  "AutoUpdate": false,
                  "LastCheck": ""
                },
                "ConfigFile": serde_json::to_string_pretty(&local_raw_config)
                  .expect("serialize local raw config"),
                "SiteConfig": {
                  "SiteName": "Local LunaTV",
                  "Announcement": "",
                  "SearchDownstreamMaxPage": 5,
                  "SiteInterfaceCacheTime": 7200,
                  "DoubanProxyType": "custom",
                  "DoubanProxy": "",
                  "DoubanImageProxyType": "custom",
                  "DoubanImageProxy": "",
                  "DisableYellowFilter": false,
                  "FluidSearch": true,
                  "EnableWebLive": false
                },
                "UserConfig": {
                  "Users": [
                    {
                      "username": "owner",
                      "role": "owner"
                    }
                  ],
                  "Tags": []
                },
                "SourceConfig": [
                  {
                    "key": "local",
                    "name": "Local Source",
                    "api": "https://local.example/api.php/provide/vod",
                    "detail": null,
                    "ua": null,
                    "referer": null,
                    "from": "config",
                    "disabled": false,
                    "disable_ad_filter": false
                  }
                ],
                "CustomCategories": [],
                "LiveConfig": []
              },
              "userPasswords": {}
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
            .clone()
            .oneshot(
                Request::builder()
                    .method(Method::POST)
                    .uri("/api/admin/profile-sync/onboarding/execute")
                    .header(CONTENT_TYPE, "application/json")
                    .body(Body::from(
                        json!({
                          "remoteBaseUrl": upstream.base_url(),
                          "username": "remote-owner",
                          "password": "secret",
                          "currentLocalUsername": "owner",
                          "strategy": "web-first",
                          "syncDomains": ["adminsettings"]
                        })
                        .to_string(),
                    ))
                    .expect("profile sync onboarding execute request"),
            )
            .await
            .expect("profile sync onboarding execute response");

        assert_eq!(response.status(), StatusCode::OK);
        let payload = read_json_body(response).await;
        assert_eq!(
            payload
                .get("createdAccounts")
                .and_then(Value::as_array)
                .map(Vec::len),
            Some(0)
        );

        let captured_payloads = captured_payloads.lock().expect("captured payloads");
        assert_eq!(captured_payloads.len(), 1);
        assert_eq!(captured_payloads[0].get("adminConfig"), None);
        drop(captured_payloads);

        let admin_response = app
            .oneshot(
                Request::builder()
                    .uri("/api/admin/config")
                    .body(Body::empty())
                    .expect("admin config request"),
            )
            .await
            .expect("admin config response");

        assert_eq!(admin_response.status(), StatusCode::OK);
        let admin_payload = read_json_body(admin_response).await;
        assert_eq!(
            admin_payload
                .get("Config")
                .and_then(|value| value.get("SiteConfig"))
                .and_then(|value| value.get("SiteName"))
                .and_then(Value::as_str),
            Some("Remote LunaTV")
        );
        assert_eq!(
            admin_payload
                .get("Config")
                .and_then(|value| value.get("ConfigSubscribtion"))
                .and_then(|value| value.get("URL"))
                .and_then(Value::as_str),
            Some("https://local.example/subscription")
        );
        assert_eq!(
            admin_payload
                .get("Config")
                .and_then(|value| value.get("SourceConfig"))
                .and_then(Value::as_array)
                .and_then(|value| value.first())
                .and_then(|value| value.get("key"))
                .and_then(Value::as_str),
            Some("remote")
        );
        assert!(
            admin_payload
                .get("Config")
                .and_then(|value| value.get("UserConfig"))
                .and_then(|value| value.get("Users"))
                .and_then(Value::as_array)
                .is_some_and(|users| users.iter().all(|user| {
                    user.get("username").and_then(Value::as_str) != Some("remote-admin")
                })),
            "expected local user config to stay intact"
        );
        assert!(
            admin_payload
                .get("Config")
                .and_then(|value| value.get("ConfigFile"))
                .and_then(Value::as_str)
                .is_some_and(|config_file| {
                    config_file.contains("local-owner-secret")
                        && config_file.contains(&upstream.base_url())
                        && config_file.contains("adminsettings")
                        && !config_file.contains("remote-owner-secret")
                }),
            "expected local auth plus persisted profile sync settings in config file"
        );

        upstream.abort();
    }

    #[tokio::test]
    async fn admin_source_disable_affects_runtime_search() {
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

        let update_response = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/api/admin/source")
                    .header(CONTENT_TYPE, "application/json")
                    .body(Body::from(
                        json!({
                          "action": "disable",
                          "key": "mock"
                        })
                        .to_string(),
                    ))
                    .expect("disable source request"),
            )
            .await
            .expect("disable source response");

        assert_eq!(update_response.status(), StatusCode::OK);

        let search_response = app
            .oneshot(
                Request::builder()
                    .uri("/content/search?q=test")
                    .body(Body::empty())
                    .expect("search request"),
            )
            .await
            .expect("search response");

        assert_eq!(search_response.status(), StatusCode::OK);
        let body = to_bytes(search_response.into_body(), usize::MAX)
            .await
            .expect("search body");
        let payload: Value = serde_json::from_slice(&body).expect("search payload json");

        assert_eq!(
            payload
                .get("results")
                .and_then(Value::as_array)
                .map(Vec::len),
            Some(0)
        );

        upstream.abort();
    }

    #[tokio::test]
    async fn content_search_stream_endpoint_emits_progressive_events() {
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
                    .uri("/api/search/ws?q=test")
                    .body(Body::empty())
                    .expect("search stream request"),
            )
            .await
            .expect("search stream response");

        assert_eq!(response.status(), StatusCode::OK);
        assert_eq!(
            response
                .headers()
                .get(CONTENT_TYPE)
                .and_then(|value| value.to_str().ok()),
            Some("text/event-stream")
        );

        let body = to_bytes(response.into_body(), usize::MAX)
            .await
            .expect("search stream body");
        let body_text = String::from_utf8(body.to_vec()).expect("search stream body text");

        assert!(body_text.contains("\"type\":\"start\""));
        assert!(body_text.contains("\"totalSources\":1"));
        assert!(body_text.contains("\"type\":\"source_result\""));
        assert!(body_text.contains("\"source\":\"mock\""));
        assert!(body_text.contains("\"type\":\"complete\""));

        upstream.abort();
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
    async fn douban_search_endpoint_returns_title_results() {
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
        state.douban_api_base_url = upstream.base_url();
        state.douban_movie_api_base_url = upstream.base_url();
        state.douban_search_api_base_url = upstream.base_url();
        let app = build_router(state);

        let response = app
            .oneshot(
                Request::builder()
                    .uri("/api/douban/search?q=%E7%94%84%E5%AC%9B%E4%BC%A0&limit=5")
                    .body(Body::empty())
                    .expect("douban search request"),
            )
            .await
            .expect("douban search response");

        assert_eq!(response.status(), StatusCode::OK);
        let body = to_bytes(response.into_body(), usize::MAX)
            .await
            .expect("douban search body");
        let payload: Value = serde_json::from_slice(&body).expect("douban search json");

        assert_eq!(
            payload
                .get("list")
                .and_then(Value::as_array)
                .and_then(|items| items.first())
                .and_then(|item| item.get("title"))
                .and_then(Value::as_str),
            Some("后宫·甄嬛传")
        );
        assert_eq!(
            payload
                .get("list")
                .and_then(Value::as_array)
                .and_then(|items| items.first())
                .and_then(|item| item.get("playType"))
                .and_then(Value::as_str),
            Some("tv")
        );
        assert_eq!(
            payload
                .get("list")
                .and_then(Value::as_array)
                .and_then(|items| items.first())
                .and_then(|item| item.get("year"))
                .and_then(Value::as_str),
            Some("2011")
        );

        upstream.abort();
    }

    #[tokio::test]
    async fn douban_recommends_endpoint_filters_non_subject_cards() {
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
        state.douban_api_base_url = upstream.base_url();
        state.douban_movie_api_base_url = upstream.base_url();
        state.douban_search_api_base_url = upstream.base_url();
        let app = build_router(state);

        let response = app
            .oneshot(
                Request::builder()
                    .uri("/api/douban/recommends?kind=movie&limit=5&start=0&sort=T")
                    .body(Body::empty())
                    .expect("douban recommends request"),
            )
            .await
            .expect("douban recommends response");

        assert_eq!(response.status(), StatusCode::OK);
        let body = to_bytes(response.into_body(), usize::MAX)
            .await
            .expect("douban recommends body");
        let payload: Value = serde_json::from_slice(&body).expect("douban recommends json");
        let list = payload
            .get("list")
            .and_then(Value::as_array)
            .expect("douban recommends list array");

        assert_eq!(list.len(), 2);
        assert_eq!(
            list.first()
                .and_then(|item| item.get("id"))
                .and_then(Value::as_str),
            Some("1001")
        );
        assert_eq!(
            list.get(1)
                .and_then(|item| item.get("id"))
                .and_then(Value::as_str),
            Some("1002")
        );

        upstream.abort();
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

    #[tokio::test]
    async fn image_proxy_endpoint_fetches_images_through_local_service() {
        let upstream = spawn_mock_server(Router::new().route(
            "/cover.jpg",
            get(|headers: HeaderMap| async move {
                assert_eq!(
                    headers.get(REFERER).and_then(|value| value.to_str().ok()),
                    Some("https://movie.douban.com/")
                );
                assert_eq!(
                    headers
                        .get(USER_AGENT)
                        .and_then(|value| value.to_str().ok())
                        .map(|value| value.contains("Mozilla/5.0")),
                    Some(true)
                );

                Response::builder()
                    .status(StatusCode::OK)
                    .header(CONTENT_TYPE, "image/jpeg")
                    .header(CONTENT_LENGTH, "4")
                    .body(Body::from(vec![1_u8, 2, 3, 4]))
                    .expect("image response")
            }),
        ))
        .await;
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
        let image_url = format!("{}/cover.jpg", upstream.base_url());

        let response = app
            .oneshot(
                Request::builder()
                    .uri(format!(
                        "/api/image-proxy?url={}",
                        form_urlencoded::byte_serialize(image_url.as_bytes()).collect::<String>()
                    ))
                    .body(Body::empty())
                    .expect("image proxy request"),
            )
            .await
            .expect("image proxy response");

        assert_eq!(response.status(), StatusCode::OK);
        assert_eq!(
            response
                .headers()
                .get(CONTENT_TYPE)
                .and_then(|value| value.to_str().ok()),
            Some("image/jpeg")
        );
        assert_eq!(
            response
                .headers()
                .get(CACHE_CONTROL)
                .and_then(|value| value.to_str().ok()),
            Some("public, max-age=15720000, s-maxage=15720000")
        );
        let body = to_bytes(response.into_body(), usize::MAX)
            .await
            .expect("image proxy body");
        assert_eq!(body.as_ref(), &[1_u8, 2, 3, 4]);

        upstream.abort();
    }

    #[tokio::test]
    async fn download_runtime_task_snapshot_persists_across_state_restart() {
        let temp_dir = TestDir::new();
        let config_path = write_test_config(
            &temp_dir,
            json!({
              "api_site": {}
            }),
        );
        let data_dir = temp_dir.path.join("data");
        let sqlite_path = temp_dir.path.join("data/moontv.sqlite3");
        let app = build_router(AppState::new(
            DEFAULT_HOST.to_string(),
            DEFAULT_PORT,
            config_path.clone(),
            data_dir.clone(),
            sqlite_path.clone(),
        ));

        let settings_response = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("PUT")
                    .uri("/api/download-runtime/tasks/settings")
                    .header(CONTENT_TYPE, "application/json")
                    .body(Body::from(
                        json!({
                          "maxConcurrentTasks": 9
                        })
                        .to_string(),
                    ))
                    .expect("download runtime settings request"),
            )
            .await
            .expect("download runtime settings response");

        assert_eq!(settings_response.status(), StatusCode::OK);
        let settings_payload = read_json_body(settings_response).await;
        assert_eq!(
            settings_payload
                .get("maxConcurrentTasks")
                .and_then(Value::as_u64),
            Some(5)
        );

        let task_id = "task-demo-1";
        let create_response = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/api/download-runtime/tasks")
                    .header(CONTENT_TYPE, "application/json")
                    .body(Body::from(
                        build_download_runtime_task_payload(task_id, "downloading").to_string(),
                    ))
                    .expect("download runtime create request"),
            )
            .await
            .expect("download runtime create response");

        assert_eq!(create_response.status(), StatusCode::OK);
        let create_payload = read_json_body(create_response).await;
        assert_eq!(
            create_payload
                .get("tasks")
                .and_then(|tasks| tasks.get(task_id))
                .and_then(|task| task.get("status"))
                .and_then(Value::as_str),
            Some("downloading")
        );

        let restarted_app = build_router(AppState::new(
            DEFAULT_HOST.to_string(),
            DEFAULT_PORT,
            config_path,
            data_dir,
            sqlite_path,
        ));

        let snapshot_response = restarted_app
            .oneshot(
                Request::builder()
                    .uri("/api/download-runtime/tasks")
                    .body(Body::empty())
                    .expect("download runtime snapshot request"),
            )
            .await
            .expect("download runtime snapshot response");

        assert_eq!(snapshot_response.status(), StatusCode::OK);
        let snapshot_payload = read_json_body(snapshot_response).await;
        assert_eq!(
            snapshot_payload
                .get("maxConcurrentTasks")
                .and_then(Value::as_u64),
            Some(5)
        );
        assert_eq!(
            snapshot_payload
                .get("tasks")
                .and_then(|tasks| tasks.get(task_id))
                .and_then(|task| task.get("status"))
                .and_then(Value::as_str),
            Some("paused")
        );
    }

    #[tokio::test]
    async fn download_runtime_task_stream_emits_initial_and_updated_snapshots() {
        let temp_dir = TestDir::new();
        let config_path = write_test_config(
            &temp_dir,
            json!({
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
        let task_id = "task-stream-demo";

        let response = app
            .clone()
            .oneshot(
                Request::builder()
                    .uri("/api/download-runtime/tasks/stream")
                    .body(Body::empty())
                    .expect("download runtime stream request"),
            )
            .await
            .expect("download runtime stream response");

        assert_eq!(response.status(), StatusCode::OK);
        assert_eq!(
            response
                .headers()
                .get(CONTENT_TYPE)
                .and_then(|value| value.to_str().ok()),
            Some("text/event-stream")
        );

        let mut stream = response.into_body().into_data_stream();
        let initial_chunk = tokio::time::timeout(Duration::from_secs(1), stream.next())
            .await
            .expect("download runtime initial stream event timeout")
            .expect("download runtime initial stream event")
            .expect("download runtime initial stream chunk");
        let initial_text = String::from_utf8(initial_chunk.to_vec())
            .expect("download runtime initial stream text");

        assert!(initial_text.contains("\"maxConcurrentTasks\":3"));
        assert!(initial_text.contains("\"tasks\":{}"));

        let create_response = app
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/api/download-runtime/tasks")
                    .header(CONTENT_TYPE, "application/json")
                    .body(Body::from(
                        build_download_runtime_task_payload(task_id, "queued").to_string(),
                    ))
                    .expect("download runtime create request"),
            )
            .await
            .expect("download runtime create response");

        assert_eq!(create_response.status(), StatusCode::OK);

        let updated_chunk = tokio::time::timeout(Duration::from_secs(1), stream.next())
            .await
            .expect("download runtime updated stream event timeout")
            .expect("download runtime updated stream event")
            .expect("download runtime updated stream chunk");
        let updated_text = String::from_utf8(updated_chunk.to_vec())
            .expect("download runtime updated stream text");

        assert!(updated_text.contains(task_id));
        assert!(updated_text.contains("\"status\":\"queued\""));
    }

    #[tokio::test]
    async fn download_runtime_manifest_resolve_endpoint_falls_back_and_caches_manifest() {
        let upstream = spawn_mock_server(
            Router::new()
                .route(
                    "/blocked.m3u8",
                    get(|| async {
                        Response::builder()
                            .status(StatusCode::FORBIDDEN)
                            .header(CONTENT_TYPE, "application/json")
                            .body(Body::from(r#"{"error":"blocked"}"#))
                            .expect("blocked manifest response")
                    }),
                )
                .route(
                    "/playable.m3u8",
                    get(|| async {
                        Response::builder()
                            .status(StatusCode::OK)
                            .header(CONTENT_TYPE, "application/vnd.apple.mpegurl")
                            .body(Body::from(
                                "#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=5000000\nplayback-1080.m3u8\n",
                            ))
                            .expect("playable manifest response")
                    }),
                )
                .route(
                    "/playback-1080.m3u8",
                    get(|| async {
                        Response::builder()
                            .status(StatusCode::OK)
                            .header(CONTENT_TYPE, "application/vnd.apple.mpegurl")
                            .body(Body::from(
                                "#EXTM3U\n#EXTINF:4.0,\nsegment-0001.ts\n",
                            ))
                            .expect("playback manifest response")
                    }),
                ),
        )
        .await;
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
        let blocked_candidate_url = format!(
            "/api/proxy/vod/m3u8?source=mock&url={}",
            url::form_urlencoded::byte_serialize(
                format!("{}/blocked.m3u8", upstream.base_url()).as_bytes()
            )
            .collect::<String>()
        );
        let playable_candidate_url = format!(
            "/api/proxy/vod/m3u8?source=mock&url={}",
            url::form_urlencoded::byte_serialize(
                format!("{}/playable.m3u8", upstream.base_url()).as_bytes()
            )
            .collect::<String>()
        );

        let response = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/api/download-runtime/manifest/resolve")
                    .header(CONTENT_TYPE, "application/json")
                    .body(Body::from(
                        json!({
                            "entryManifestUrls": [
                                blocked_candidate_url.clone(),
                                playable_candidate_url.clone(),
                            ]
                        })
                        .to_string(),
                    ))
                    .expect("download runtime manifest resolve request"),
            )
            .await
            .expect("download runtime manifest resolve response");

        assert_eq!(response.status(), StatusCode::OK);
        let payload = read_json_body(response).await;
        assert_eq!(
            payload.get("rootManifestUrl").and_then(Value::as_str),
            Some(playable_candidate_url.as_str())
        );
        assert_eq!(
            payload
                .get("playbackManifestUrl")
                .and_then(Value::as_str)
                .map(|value| value.contains("playback-1080.m3u8")),
            Some(true)
        );
        assert_eq!(
            payload
                .get("resourceUrls")
                .and_then(Value::as_array)
                .map(Vec::len),
            Some(3)
        );
        let playback_manifest_url = payload
            .get("playbackManifestUrl")
            .and_then(Value::as_str)
            .expect("playback manifest url")
            .to_string();

        let cache_meta_response = app
            .oneshot(
                Request::builder()
                    .uri(format!(
                        "/api/download-runtime/cache/meta?url={}",
                        url::form_urlencoded::byte_serialize(playback_manifest_url.as_bytes())
                            .collect::<String>()
                    ))
                    .body(Body::empty())
                    .expect("download runtime cache meta request"),
            )
            .await
            .expect("download runtime cache meta response");

        assert_eq!(cache_meta_response.status(), StatusCode::OK);
        let cache_meta_payload = read_json_body(cache_meta_response).await;
        assert_eq!(
            cache_meta_payload.get("exists").and_then(Value::as_bool),
            Some(true)
        );

        upstream.abort();
    }

    #[tokio::test]
    async fn download_runtime_manifest_resolve_endpoint_retries_retryable_failures() {
        let attempt_count = std::sync::Arc::new(AtomicU64::new(0));
        let upstream_attempt_count = attempt_count.clone();
        let upstream = spawn_mock_server(Router::new().route(
            "/flaky.m3u8",
            get(move || {
                let attempt_count = upstream_attempt_count.clone();
                async move {
                    let current_attempt = attempt_count.fetch_add(1, Ordering::SeqCst);

                    if current_attempt == 0 {
                        Response::builder()
                            .status(StatusCode::BAD_GATEWAY)
                            .header(CONTENT_TYPE, "text/plain; charset=utf-8")
                            .body(Body::from("bad gateway"))
                            .expect("retryable error response")
                    } else {
                        Response::builder()
                            .status(StatusCode::OK)
                            .header(CONTENT_TYPE, "application/vnd.apple.mpegurl")
                            .body(Body::from("#EXTM3U\n#EXTINF:4.0,\nsegment-0001.ts\n"))
                            .expect("successful retry response")
                    }
                }
            }),
        ))
        .await;
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
        let candidate_url = format!(
            "/api/proxy/vod/m3u8?source=mock&url={}",
            url::form_urlencoded::byte_serialize(
                format!("{}/flaky.m3u8", upstream.base_url()).as_bytes()
            )
            .collect::<String>()
        );

        let response = app
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/api/download-runtime/manifest/resolve")
                    .header(CONTENT_TYPE, "application/json")
                    .body(Body::from(
                        json!({
                            "entryManifestUrls": [candidate_url.clone()]
                        })
                        .to_string(),
                    ))
                    .expect("retryable manifest resolve request"),
            )
            .await
            .expect("retryable manifest resolve response");

        assert_eq!(response.status(), StatusCode::OK);
        assert_eq!(attempt_count.load(Ordering::SeqCst), 2);

        upstream.abort();
    }

    #[tokio::test]
    async fn download_runtime_cache_fetch_endpoint_fetches_and_caches_vod_proxy_assets() {
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
        let runtime_url = format!(
            "http://127.0.0.1:8787/media/vod/segment?source=mock&url={}",
            form_urlencoded::byte_serialize(
                format!("{}/upstream/segment.ts", upstream.base_url()).as_bytes()
            )
            .collect::<String>()
        );
        let encoded_runtime_url =
            form_urlencoded::byte_serialize(runtime_url.as_bytes()).collect::<String>();

        let response = app
            .clone()
            .oneshot(
                Request::builder()
                    .uri(format!(
                        "/api/download-runtime/cache/fetch?url={encoded_runtime_url}"
                    ))
                    .body(Body::empty())
                    .expect("download runtime cache fetch request"),
            )
            .await
            .expect("download runtime cache fetch response");

        assert_eq!(response.status(), StatusCode::OK);
        assert_eq!(
            response
                .headers()
                .get(CONTENT_TYPE)
                .and_then(|value| value.to_str().ok()),
            Some("video/mp2t")
        );
        let body = to_bytes(response.into_body(), usize::MAX)
            .await
            .expect("download runtime cache fetch body");
        assert_eq!(body.as_ref(), b"mockdata");

        let cache_meta_response = app
            .clone()
            .oneshot(
                Request::builder()
                    .uri(format!(
                        "/api/download-runtime/cache/meta?url={encoded_runtime_url}"
                    ))
                    .body(Body::empty())
                    .expect("download runtime cache meta request"),
            )
            .await
            .expect("download runtime cache meta response");

        assert_eq!(cache_meta_response.status(), StatusCode::OK);
        let cache_meta_payload = read_json_body(cache_meta_response).await;
        assert_eq!(
            cache_meta_payload.get("exists").and_then(Value::as_bool),
            Some(true)
        );

        upstream.abort();

        let cached_response = app
            .oneshot(
                Request::builder()
                    .uri(format!(
                        "/api/download-runtime/cache/fetch?url={encoded_runtime_url}"
                    ))
                    .body(Body::empty())
                    .expect("download runtime cached fetch request"),
            )
            .await
            .expect("download runtime cached fetch response");

        assert_eq!(cached_response.status(), StatusCode::OK);
        let cached_body = to_bytes(cached_response.into_body(), usize::MAX)
            .await
            .expect("download runtime cached fetch body");
        assert_eq!(cached_body.as_ref(), b"mockdata");
    }

    #[tokio::test]
    async fn download_runtime_task_commands_update_snapshot() {
        let temp_dir = TestDir::new();
        let config_path = write_test_config(
            &temp_dir,
            json!({
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
        let task_id = "task-demo-2";

        let create_response = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/api/download-runtime/tasks")
                    .header(CONTENT_TYPE, "application/json")
                    .body(Body::from(
                        build_download_runtime_task_payload(task_id, "queued").to_string(),
                    ))
                    .expect("download runtime create request"),
            )
            .await
            .expect("download runtime create response");

        assert_eq!(create_response.status(), StatusCode::OK);

        let pause_response = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri(format!("/api/download-runtime/tasks/{task_id}/pause"))
                    .body(Body::empty())
                    .expect("download runtime pause request"),
            )
            .await
            .expect("download runtime pause response");

        assert_eq!(pause_response.status(), StatusCode::OK);
        let pause_payload = read_json_body(pause_response).await;
        assert_eq!(
            pause_payload
                .get("tasks")
                .and_then(|tasks| tasks.get(task_id))
                .and_then(|task| task.get("status"))
                .and_then(Value::as_str),
            Some("paused")
        );
        assert_eq!(
            pause_payload
                .get("lastEvent")
                .and_then(|event| event.get("type"))
                .and_then(Value::as_str),
            Some("taskStatusChanged")
        );
        assert_eq!(
            pause_payload
                .get("lastEvent")
                .and_then(|event| event.get("command"))
                .and_then(Value::as_str),
            Some("pause")
        );

        let resume_response = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri(format!("/api/download-runtime/tasks/{task_id}/resume"))
                    .body(Body::empty())
                    .expect("download runtime resume request"),
            )
            .await
            .expect("download runtime resume response");

        assert_eq!(resume_response.status(), StatusCode::OK);
        let resume_payload = read_json_body(resume_response).await;
        assert_eq!(
            resume_payload
                .get("tasks")
                .and_then(|tasks| tasks.get(task_id))
                .and_then(|task| task.get("status"))
                .and_then(Value::as_str),
            Some("queued")
        );
        assert_eq!(
            resume_payload
                .get("lastEvent")
                .and_then(|event| event.get("command"))
                .and_then(Value::as_str),
            Some("resume")
        );

        let missing_response = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/api/download-runtime/tasks/missing/pause")
                    .body(Body::empty())
                    .expect("download runtime missing pause request"),
            )
            .await
            .expect("download runtime missing pause response");

        assert_eq!(missing_response.status(), StatusCode::NOT_FOUND);
        let missing_payload = read_json_body(missing_response).await;
        assert_eq!(
            missing_payload.get("error").and_then(Value::as_str),
            Some("download runtime task not found")
        );
        assert_eq!(
            missing_payload.get("code").and_then(Value::as_str),
            Some("download_runtime_task_not_found")
        );

        let delete_response = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("DELETE")
                    .uri(format!("/api/download-runtime/tasks/{task_id}"))
                    .body(Body::empty())
                    .expect("download runtime delete request"),
            )
            .await
            .expect("download runtime delete response");

        assert_eq!(delete_response.status(), StatusCode::OK);
        let delete_payload = read_json_body(delete_response).await;
        assert_eq!(
            delete_payload
                .get("tasks")
                .and_then(Value::as_object)
                .map(|tasks| tasks.len()),
            Some(0)
        );
        assert_eq!(
            delete_payload
                .get("lastEvent")
                .and_then(|event| event.get("reason"))
                .and_then(Value::as_str),
            Some("deleted")
        );

        let recreate_response = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/api/download-runtime/tasks")
                    .header(CONTENT_TYPE, "application/json")
                    .body(Body::from(
                        build_download_runtime_task_payload(task_id, "queued").to_string(),
                    ))
                    .expect("download runtime recreate request"),
            )
            .await
            .expect("download runtime recreate response");

        assert_eq!(recreate_response.status(), StatusCode::OK);

        let cancel_response = app
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri(format!("/api/download-runtime/tasks/{task_id}/cancel"))
                    .body(Body::empty())
                    .expect("download runtime cancel request"),
            )
            .await
            .expect("download runtime cancel response");

        assert_eq!(cancel_response.status(), StatusCode::OK);
        let cancel_payload = read_json_body(cancel_response).await;
        assert_eq!(
            cancel_payload
                .get("tasks")
                .and_then(Value::as_object)
                .map(|tasks| tasks.len()),
            Some(0)
        );
        assert_eq!(
            cancel_payload
                .get("lastEvent")
                .and_then(|event| event.get("reason"))
                .and_then(Value::as_str),
            Some("cancelled")
        );
    }

    #[tokio::test]
    async fn download_runtime_task_detail_retry_and_bulk_commands() {
        let temp_dir = TestDir::new();
        let config_path = write_test_config(
            &temp_dir,
            json!({
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
        let error_task_id = "task-error";
        let queued_task_id = "task-bulk-queued";
        let paused_task_id = "task-bulk-paused";
        let mut error_payload = build_download_runtime_task_payload(error_task_id, "error");
        error_payload["errorMessage"] = Value::String("network failed".to_string());

        let error_create_response = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/api/download-runtime/tasks")
                    .header(CONTENT_TYPE, "application/json")
                    .body(Body::from(error_payload.to_string()))
                    .expect("download runtime error task create request"),
            )
            .await
            .expect("download runtime error task create response");

        assert_eq!(error_create_response.status(), StatusCode::OK);

        let detail_response = app
            .clone()
            .oneshot(
                Request::builder()
                    .uri(format!("/api/download-runtime/tasks/{error_task_id}"))
                    .body(Body::empty())
                    .expect("download runtime task detail request"),
            )
            .await
            .expect("download runtime task detail response");

        assert_eq!(detail_response.status(), StatusCode::OK);
        let detail_payload = read_json_body(detail_response).await;
        assert_eq!(
            detail_payload.get("id").and_then(Value::as_str),
            Some(error_task_id)
        );
        assert_eq!(
            detail_payload.get("status").and_then(Value::as_str),
            Some("error")
        );
        assert_eq!(
            detail_payload.get("errorMessage").and_then(Value::as_str),
            Some("network failed")
        );

        let retry_response = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri(format!("/api/download-runtime/tasks/{error_task_id}/retry"))
                    .body(Body::empty())
                    .expect("download runtime retry request"),
            )
            .await
            .expect("download runtime retry response");

        assert_eq!(retry_response.status(), StatusCode::OK);
        let retry_payload = read_json_body(retry_response).await;
        assert_eq!(
            retry_payload
                .get("tasks")
                .and_then(|tasks| tasks.get(error_task_id))
                .and_then(|task| task.get("status"))
                .and_then(Value::as_str),
            Some("queued")
        );
        assert!(
            retry_payload
                .get("tasks")
                .and_then(|tasks| tasks.get(error_task_id))
                .and_then(|task| task.get("errorMessage"))
                .is_none()
        );
        assert_eq!(
            retry_payload
                .get("lastEvent")
                .and_then(|event| event.get("command"))
                .and_then(Value::as_str),
            Some("retry")
        );

        for (task_id, status) in [(queued_task_id, "queued"), (paused_task_id, "paused")] {
            let create_response = app
                .clone()
                .oneshot(
                    Request::builder()
                        .method("POST")
                        .uri("/api/download-runtime/tasks")
                        .header(CONTENT_TYPE, "application/json")
                        .body(Body::from(
                            build_download_runtime_task_payload(task_id, status).to_string(),
                        ))
                        .expect("download runtime bulk seed request"),
                )
                .await
                .expect("download runtime bulk seed response");

            assert_eq!(create_response.status(), StatusCode::OK);
        }

        let bulk_pause_response = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/api/download-runtime/tasks/bulk")
                    .header(CONTENT_TYPE, "application/json")
                    .body(Body::from(
                        json!({
                            "command": "pause",
                            "taskIds": [queued_task_id, "missing-task"],
                        })
                        .to_string(),
                    ))
                    .expect("download runtime bulk pause request"),
            )
            .await
            .expect("download runtime bulk pause response");

        assert_eq!(bulk_pause_response.status(), StatusCode::OK);
        let bulk_pause_payload = read_json_body(bulk_pause_response).await;
        assert_eq!(
            bulk_pause_payload
                .get("tasks")
                .and_then(|tasks| tasks.get(queued_task_id))
                .and_then(|task| task.get("status"))
                .and_then(Value::as_str),
            Some("paused")
        );
        assert_eq!(
            bulk_pause_payload
                .get("lastEvent")
                .and_then(|event| event.get("command"))
                .and_then(Value::as_str),
            Some("pause")
        );

        let bulk_resume_response = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/api/download-runtime/tasks/bulk")
                    .header(CONTENT_TYPE, "application/json")
                    .body(Body::from(
                        json!({
                            "command": "resume",
                            "taskIds": [paused_task_id],
                        })
                        .to_string(),
                    ))
                    .expect("download runtime bulk resume request"),
            )
            .await
            .expect("download runtime bulk resume response");

        assert_eq!(bulk_resume_response.status(), StatusCode::OK);
        let bulk_resume_payload = read_json_body(bulk_resume_response).await;
        assert_eq!(
            bulk_resume_payload
                .get("tasks")
                .and_then(|tasks| tasks.get(paused_task_id))
                .and_then(|task| task.get("status"))
                .and_then(Value::as_str),
            Some("queued")
        );
        assert_eq!(
            bulk_resume_payload
                .get("lastEvent")
                .and_then(|event| event.get("command"))
                .and_then(Value::as_str),
            Some("resume")
        );

        let mut bulk_error_payload = build_download_runtime_task_payload(error_task_id, "error");
        bulk_error_payload["errorMessage"] = Value::String("retry me".to_string());
        let bulk_error_response = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/api/download-runtime/tasks")
                    .header(CONTENT_TYPE, "application/json")
                    .body(Body::from(bulk_error_payload.to_string()))
                    .expect("download runtime bulk retry seed request"),
            )
            .await
            .expect("download runtime bulk retry seed response");

        assert_eq!(bulk_error_response.status(), StatusCode::OK);

        let bulk_retry_response = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/api/download-runtime/tasks/bulk")
                    .header(CONTENT_TYPE, "application/json")
                    .body(Body::from(
                        json!({
                            "command": "retry",
                            "taskIds": [error_task_id],
                        })
                        .to_string(),
                    ))
                    .expect("download runtime bulk retry request"),
            )
            .await
            .expect("download runtime bulk retry response");

        assert_eq!(bulk_retry_response.status(), StatusCode::OK);
        let bulk_retry_payload = read_json_body(bulk_retry_response).await;
        assert_eq!(
            bulk_retry_payload
                .get("tasks")
                .and_then(|tasks| tasks.get(error_task_id))
                .and_then(|task| task.get("status"))
                .and_then(Value::as_str),
            Some("queued")
        );
        assert!(
            bulk_retry_payload
                .get("tasks")
                .and_then(|tasks| tasks.get(error_task_id))
                .and_then(|task| task.get("errorMessage"))
                .is_none()
        );
        assert_eq!(
            bulk_retry_payload
                .get("lastEvent")
                .and_then(|event| event.get("command"))
                .and_then(Value::as_str),
            Some("retry")
        );

        let bulk_cancel_response = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/api/download-runtime/tasks/bulk")
                    .header(CONTENT_TYPE, "application/json")
                    .body(Body::from(
                        json!({
                            "command": "cancel",
                            "taskIds": [queued_task_id, paused_task_id],
                        })
                        .to_string(),
                    ))
                    .expect("download runtime bulk cancel request"),
            )
            .await
            .expect("download runtime bulk cancel response");

        assert_eq!(bulk_cancel_response.status(), StatusCode::OK);
        let bulk_cancel_payload = read_json_body(bulk_cancel_response).await;
        let remaining_tasks = bulk_cancel_payload
            .get("tasks")
            .and_then(Value::as_object)
            .expect("remaining task map");
        assert!(!remaining_tasks.contains_key(queued_task_id));
        assert!(!remaining_tasks.contains_key(paused_task_id));
        assert_eq!(
            bulk_cancel_payload
                .get("lastEvent")
                .and_then(|event| event.get("reason"))
                .and_then(Value::as_str),
            Some("cancelled")
        );

        let missing_detail_response = app
            .oneshot(
                Request::builder()
                    .uri(format!("/api/download-runtime/tasks/{queued_task_id}"))
                    .body(Body::empty())
                    .expect("download runtime missing task detail request"),
            )
            .await
            .expect("download runtime missing task detail response");

        assert_eq!(missing_detail_response.status(), StatusCode::NOT_FOUND);
    }

    #[tokio::test]
    async fn download_runtime_worker_executes_queued_tasks_and_persists_cached_resources() {
        let upstream = spawn_mock_server(mock_upstream_router()).await;
        let temp_dir = TestDir::new();
        let config_path = write_test_config(
            &temp_dir,
            json!({
              "api_site": {
                "mock": {
                  "api": format!("{}/api.php/provide/vod", upstream.base_url()),
                  "name": "Mock Runtime Source"
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
        let task_id = "task-runtime-worker";
        let candidate_url = format!(
            "/api/proxy/vod/m3u8?source=mock&url={}",
            form_urlencoded::byte_serialize(
                format!("{}/upstream/master.m3u8", upstream.base_url()).as_bytes()
            )
            .collect::<String>()
        );
        let mut payload = build_download_runtime_task_payload(task_id, "queued");
        payload["entryManifestUrl"] = Value::String(candidate_url.clone());
        payload["manifestCandidateUrls"] = json!([candidate_url]);

        let create_response = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/api/download-runtime/tasks")
                    .header(CONTENT_TYPE, "application/json")
                    .body(Body::from(payload.to_string()))
                    .expect("download runtime worker create request"),
            )
            .await
            .expect("download runtime worker create response");

        assert_eq!(create_response.status(), StatusCode::OK);
        let create_payload = read_json_body(create_response).await;
        assert_eq!(
            create_payload
                .get("tasks")
                .and_then(|tasks| tasks.get(task_id))
                .and_then(|task| task.get("status"))
                .and_then(Value::as_str),
            Some("queued")
        );

        let done_payload =
            wait_for_download_runtime_task_status(app.clone(), task_id, "done").await;
        let done_task = done_payload
            .get("tasks")
            .and_then(|tasks| tasks.get(task_id))
            .cloned()
            .expect("completed runtime task payload");
        assert_eq!(
            done_task.get("downloadedResources").and_then(Value::as_u64),
            Some(3)
        );
        assert_eq!(done_task.get("progress").and_then(Value::as_u64), Some(100));

        let cache_index_id = form_urlencoded::byte_serialize(format!("cache:{task_id}").as_bytes())
            .collect::<String>();
        let resource_index_response = app
            .clone()
            .oneshot(
                Request::builder()
                    .uri(format!(
                        "/api/download-runtime/resource-index?id={cache_index_id}"
                    ))
                    .body(Body::empty())
                    .expect("download runtime resource index request"),
            )
            .await
            .expect("download runtime resource index response");

        assert_eq!(resource_index_response.status(), StatusCode::OK);
        let resource_index_payload = read_json_body(resource_index_response).await;
        let resource_urls = resource_index_payload
            .get("urls")
            .and_then(Value::as_array)
            .cloned()
            .expect("resource index urls");
        assert_eq!(resource_urls.len(), 3);

        let cached_resource_url = resource_urls
            .iter()
            .filter_map(Value::as_str)
            .find(|url| Url::parse(url).is_ok())
            .expect("absolute cached resource url");
        let cached_url =
            form_urlencoded::byte_serialize(cached_resource_url.as_bytes()).collect::<String>();
        let cache_meta_response = app
            .oneshot(
                Request::builder()
                    .uri(format!("/api/download-runtime/cache/meta?url={cached_url}"))
                    .body(Body::empty())
                    .expect("download runtime cache meta request"),
            )
            .await
            .expect("download runtime cache meta response");

        assert_eq!(cache_meta_response.status(), StatusCode::OK);
        let cache_meta_payload = read_json_body(cache_meta_response).await;
        assert_eq!(
            cache_meta_payload.get("exists").and_then(Value::as_bool),
            Some(true)
        );

        upstream.abort();
    }

    #[tokio::test]
    async fn clear_download_runtime_tasks_resets_snapshot_tasks_only() {
        let temp_dir = TestDir::new();
        let config_path = write_test_config(
            &temp_dir,
            json!({
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
        let task_id = "task-clear-demo";

        let settings_response = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("PUT")
                    .uri("/api/download-runtime/tasks/settings")
                    .header(CONTENT_TYPE, "application/json")
                    .body(Body::from(
                        json!({
                            "maxConcurrentTasks": 5,
                        })
                        .to_string(),
                    ))
                    .expect("download runtime settings request"),
            )
            .await
            .expect("download runtime settings response");

        assert_eq!(settings_response.status(), StatusCode::OK);

        let create_response = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/api/download-runtime/tasks")
                    .header(CONTENT_TYPE, "application/json")
                    .body(Body::from(
                        build_download_runtime_task_payload(task_id, "queued").to_string(),
                    ))
                    .expect("download runtime create request"),
            )
            .await
            .expect("download runtime create response");

        assert_eq!(create_response.status(), StatusCode::OK);

        let clear_response = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("DELETE")
                    .uri("/api/download-runtime/tasks")
                    .body(Body::empty())
                    .expect("download runtime clear request"),
            )
            .await
            .expect("download runtime clear response");

        assert_eq!(clear_response.status(), StatusCode::OK);
        let clear_payload = read_json_body(clear_response).await;
        assert_eq!(
            clear_payload
                .get("maxConcurrentTasks")
                .and_then(Value::as_u64),
            Some(5)
        );
        assert_eq!(
            clear_payload
                .get("tasks")
                .and_then(Value::as_object)
                .map(|tasks| tasks.len()),
            Some(0)
        );
        assert!(clear_payload.get("lastEvent").is_none());

        let get_response = app
            .oneshot(
                Request::builder()
                    .uri("/api/download-runtime/tasks")
                    .body(Body::empty())
                    .expect("download runtime get request"),
            )
            .await
            .expect("download runtime get response");

        assert_eq!(get_response.status(), StatusCode::OK);
        let get_payload = read_json_body(get_response).await;
        assert_eq!(
            get_payload
                .get("maxConcurrentTasks")
                .and_then(Value::as_u64),
            Some(5)
        );
        assert_eq!(
            get_payload
                .get("tasks")
                .and_then(Value::as_object)
                .map(|tasks| tasks.len()),
            Some(0)
        );
        assert!(get_payload.get("lastEvent").is_none());
    }

    fn build_download_runtime_task_payload(task_id: &str, status: &str) -> Value {
        json!({
          "id": task_id,
          "contentId": "demo:1",
          "source": "demo",
          "sourceName": "Demo Source",
          "vodId": "1",
          "episodeIndex": 0,
          "title": "Demo Title",
          "searchTitle": "Demo Search",
          "searchType": "tv",
          "poster": "https://img.example.com/demo.jpg",
          "remarks": "Demo remarks",
          "year": "2026",
          "desc": "Demo description",
          "typeName": "tv",
          "doubanId": 1001,
          "episodeTitle": "第1集",
          "originalM3u8Url": "https://cdn.example.com/root.m3u8",
          "entryManifestUrl": "https://cdn.example.com/root.m3u8",
          "manifestCandidateUrls": ["https://cdn.example.com/root.m3u8"],
          "playbackManifestUrl": "https://cdn.example.com/playback.m3u8",
          "cacheIndexId": format!("cache:{task_id}"),
          "status": status,
          "progress": 12,
          "totalResources": 20,
          "downloadedResources": 3,
          "sizeBytes": 1024,
          "currentSizeBytes": 2048,
          "estimatedTotalSizeBytes": 4096,
          "downloadSpeedBytesPerSecond": 512,
          "createdAt": 100,
          "updatedAt": 200
        })
    }

    fn mock_vod_api_response(params: &BTreeMap<String, String>) -> Response {
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
    }

    fn mock_upstream_router() -> Router {
        Router::new()
      .route(
        "/proxy",
        get(|uri: OriginalUri| async move {
          let query = uri.query().unwrap_or_default();
          let Some(target) = query.strip_prefix("url=") else {
            return StatusCode::BAD_REQUEST.into_response();
          };
          let Ok(target_url) = Url::parse(target) else {
            return StatusCode::BAD_REQUEST.into_response();
          };
          let params = target_url
            .query_pairs()
            .map(|(key, value)| (key.into_owned(), value.into_owned()))
            .collect::<BTreeMap<_, _>>();
          mock_vod_api_response(&params)
        }),
      )
      .route(
        "/api.php/provide/vod",
        get(|Query(params): Query<BTreeMap<String, String>>| async move {
          mock_vod_api_response(&params)
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
      .route(
        "/movie/subject_search",
        get(|| async move {
          let html = r#"<!DOCTYPE html><html><head><script>window.__DATA__ = {"count":2,"start":0,"total":2,"text":"甄嬛传","items":[{"tpl_name":"search_subject","id":4922787,"title":"后宫·甄嬛传（2011）","cover_url":"https://img.example.com/zhenhuan.jpg","labels":[{"text":"剧集"}],"rating":{"value":9.4,"count":1000}},{"tpl_name":"search_subject","id":25812730,"title":"如懿传（2018）","cover_url":"https://img.example.com/ruyi.jpg","labels":[{"text":"剧集"}],"rating":{"value":7.5,"count":500}},{"tpl_name":"other_card","id":1,"title":"ignored"}]};</script></head><body></body></html>"#;
          (
            [(CONTENT_TYPE, "text/html; charset=utf-8")],
            html,
          )
        }),
      )
      .route(
        "/rexxar/api/v2/subject/recent_hot/movie",
        get(|| async move {
          Json(json!({
            "total": 1,
            "items": [{
              "id": "1001",
              "title": "Mock Category Item",
              "card_subtitle": "2026 / 中国大陆 / 剧情",
              "pic": {
                "large": "https://img.example.com/category-large.jpg",
                "normal": "https://img.example.com/category-normal.jpg"
              },
              "rating": {
                "value": 8.6
              }
            }]
          }))
        }),
      )
      .route(
        "/j/search_subjects",
        get(|| async move {
          Json(json!({
            "subjects": [{
              "id": "1001",
              "title": "Mock Douban List Item",
              "cover": "https://img.example.com/list.jpg",
              "rate": "8.2",
              "card_subtitle": "2026 / 中国大陆 / 剧情"
            }]
          }))
        }),
      )
      .route(
        "/rexxar/api/v2/movie/recommend",
        get(|| async move {
          Json(json!({
            "items": [
              {
                "id": "playlist-1",
                "title": "A playlist card",
                "type": "playlist"
              },
              {
                "data": {
                  "type": "movie",
                  "unit": "dale_movie_ad_second_banner"
                },
                "type": "ad"
              },
              {
                "id": "1001",
                "title": "Mock Recommend Movie",
                "year": "2025",
                "type": "movie",
                "pic": {
                  "large": "https://img.example.com/recommend-large.jpg",
                  "normal": "https://img.example.com/recommend-normal.jpg"
                },
                "rating": {
                  "value": 8.1
                }
              },
              {
                "id": "1002",
                "title": "Mock Recommend TV",
                "year": "2026",
                "type": "tv",
                "pic": {
                  "large": "https://img.example.com/recommend-tv-large.jpg",
                  "normal": "https://img.example.com/recommend-tv-normal.jpg"
                },
                "rating": {
                  "value": 7.9
                }
              }
            ]
          }))
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

    async fn read_json_body(response: Response) -> Value {
        let body = to_bytes(response.into_body(), usize::MAX)
            .await
            .expect("read response body");
        serde_json::from_slice(&body).expect("parse response json")
    }

    async fn wait_for_download_runtime_task_status(
        app: Router,
        task_id: &str,
        expected_status: &str,
    ) -> Value {
        let deadline = tokio::time::Instant::now() + Duration::from_secs(2);

        loop {
            let response = app
                .clone()
                .oneshot(
                    Request::builder()
                        .uri("/api/download-runtime/tasks")
                        .body(Body::empty())
                        .expect("download runtime task poll request"),
                )
                .await
                .expect("download runtime task poll response");
            let payload = read_json_body(response).await;
            let current_status = payload
                .get("tasks")
                .and_then(|tasks| tasks.get(task_id))
                .and_then(|task| task.get("status"))
                .and_then(Value::as_str);

            if current_status == Some(expected_status) {
                return payload;
            }

            assert!(
                tokio::time::Instant::now() < deadline,
                "timed out waiting for runtime task {task_id} to reach status {expected_status}; current status: {:?}",
                current_status
            );

            tokio::time::sleep(Duration::from_millis(20)).await;
        }
    }

    fn build_test_auth_cookie(username: &str, role: &str, session_mode: &str) -> String {
        let payload = serde_json::to_string(&json!({
            "username": username,
            "role": role,
            "sessionMode": session_mode
        }))
        .expect("serialize auth cookie payload");
        let encoded = form_urlencoded::byte_serialize(payload.as_bytes()).collect::<String>();
        format!("auth={encoded}")
    }

    fn build_multipart_form_data(boundary: &str, encrypted: &str, password: &str) -> String {
        format!(
            concat!(
                "--{boundary}\r\n",
                "Content-Disposition: form-data; name=\"file\"; filename=\"backup.dat\"\r\n",
                "Content-Type: application/octet-stream\r\n\r\n",
                "{encrypted}\r\n",
                "--{boundary}\r\n",
                "Content-Disposition: form-data; name=\"password\"\r\n\r\n",
                "{password}\r\n",
                "--{boundary}--\r\n"
            ),
            boundary = boundary,
            encrypted = encrypted,
            password = password,
        )
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

    fn write_test_admin_persistence(dir: &TestDir, payload: Value) -> PathBuf {
        let data_dir = dir.path.join("data");
        fs::create_dir_all(&data_dir).expect("create data dir");
        let path = data_dir.join(ADMIN_PERSISTENCE_FILE_NAME);
        fs::write(
            &path,
            serde_json::to_string_pretty(&payload).expect("serialize admin persistence"),
        )
        .expect("write admin persistence");
        path
    }
}
