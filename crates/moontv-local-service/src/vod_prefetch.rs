use std::{
    collections::BTreeSet,
    fs, io,
    path::{Path, PathBuf},
    sync::{
        Arc,
        atomic::{AtomicBool, Ordering},
    },
};

use axum::{
    Json,
    extract::{Query, State},
    http::{HeaderMap, StatusCode},
};
use serde::{Deserialize, Serialize};
use tokio::sync::Mutex;
use url::Url;

use crate::{
    AppError, AppResult, AppState, OnlineVodCache, OnlineVodCachePolicy,
    vod_proxy::{fetch_vod_proxy_asset_bytes, parse_vod_proxy_url},
};

const VOD_PREFETCH_SESSION_FILE_NAME: &str = "vod-prefetch-session.json";
const MAX_SESSION_ID_LENGTH: usize = 128;
const PREFETCH_RETRY_COUNT: usize = 2;
const MAX_VOD_PREFETCH_SEGMENTS: usize = 10_000;

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum VodPrefetchWindowMode {
    #[serde(rename = "30s")]
    Seconds30,
    #[serde(rename = "60s")]
    Seconds60,
    Episode,
}

impl VodPrefetchWindowMode {
    fn target_duration_seconds(self) -> Option<f64> {
        match self {
            Self::Seconds30 => Some(30.0),
            Self::Seconds60 => Some(60.0),
            Self::Episode => None,
        }
    }

    fn is_full_episode(self) -> bool {
        matches!(self, Self::Episode)
    }
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct VodPrefetchStatus {
    pub(crate) session_id: String,
    pub(crate) state: VodPrefetchTaskState,
    pub(crate) window_mode: VodPrefetchWindowMode,
    pub(crate) queued_count: usize,
    pub(crate) completed_count: usize,
    pub(crate) cached_count: usize,
    pub(crate) cache_bytes: u64,
    pub(crate) current_rendition: String,
    pub(crate) failure_reason: Option<String>,
    pub(crate) can_retry: bool,
}

#[derive(Clone, Copy, Debug, Serialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum VodPrefetchTaskState {
    Running,
    Paused,
    Completed,
    Stopped,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct StartVodPrefetchRequest {
    session_id: String,
    manifest_url: String,
    window_mode: VodPrefetchWindowMode,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AdvanceVodPrefetchRequest {
    session_id: String,
    segment_url: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct VodPrefetchSessionQuery {
    session_id: Option<String>,
}

#[derive(Debug, Deserialize, Serialize)]
struct PersistedFullEpisodeSession {
    session_id: String,
}

#[derive(Clone, Debug)]
pub(crate) struct VodPrefetchManager {
    cache: OnlineVodCache,
    session_file_path: PathBuf,
    inner: Arc<Mutex<VodPrefetchManagerInner>>,
}

#[derive(Debug, Default)]
struct VodPrefetchManagerInner {
    active: Option<ActiveVodPrefetchSession>,
    next_generation: u64,
}

#[derive(Debug)]
struct ActiveVodPrefetchSession {
    session_id: String,
    manifest_url: String,
    window_mode: VodPrefetchWindowMode,
    last_segment_url: Option<String>,
    generation: u64,
    cancellation: Arc<AtomicBool>,
    task: Option<tokio::task::JoinHandle<()>>,
    status: VodPrefetchStatus,
}

#[derive(Clone)]
struct VodPrefetchTaskConfig {
    session_id: String,
    manifest_url: String,
    window_mode: VodPrefetchWindowMode,
    last_segment_url: Option<String>,
    generation: u64,
    cancellation: Arc<AtomicBool>,
}

#[derive(Clone, Debug)]
struct VodPrefetchResource {
    url: String,
    duration_seconds: f64,
}

#[derive(Clone, Debug)]
struct VodPrefetchSegment {
    dependencies: Vec<VodPrefetchResource>,
    resource: VodPrefetchResource,
}

impl VodPrefetchManager {
    pub(crate) fn new(data_dir: &Path, cache: OnlineVodCache) -> io::Result<Self> {
        fs::create_dir_all(data_dir)?;
        Ok(Self {
            cache,
            session_file_path: data_dir.join(VOD_PREFETCH_SESSION_FILE_NAME),
            inner: Arc::new(Mutex::new(VodPrefetchManagerInner::default())),
        })
    }

    pub(crate) fn recover_stale_full_episode_session(&self) -> io::Result<()> {
        let session = match fs::read(&self.session_file_path) {
            Ok(bytes) => serde_json::from_slice::<PersistedFullEpisodeSession>(&bytes).ok(),
            Err(error) if error.kind() == io::ErrorKind::NotFound => None,
            Err(error) => return Err(error),
        };
        if let Some(session) = session {
            self.cache
                .remove_prefetch_session_entries(&session.session_id)?;
        }
        self.cache.clear_temporary_max_bytes();
        remove_file_if_exists(&self.session_file_path)
    }

    async fn start(
        &self,
        state: AppState,
        mut request: StartVodPrefetchRequest,
    ) -> AppResult<VodPrefetchStatus> {
        validate_session_id(&request.session_id)?;
        request.manifest_url = canonicalize_local_vod_proxy_url(&state, &request.manifest_url)?;
        validate_local_media_playlist_url(&state, &request.manifest_url)?;

        let mut cleanup_session_id = None;
        let mut register_full_session = None;
        let mut clear_full_session = None;
        let task = {
            let mut inner = self.inner.lock().await;
            let old_session = inner.active.take();

            if let Some(mut old_session) = old_session {
                if old_session.session_id == request.session_id
                    && old_session.manifest_url == request.manifest_url
                    && old_session.window_mode == request.window_mode
                {
                    let status = old_session.status.clone();
                    inner.active = Some(old_session);
                    return Ok(status);
                }

                old_session.cancellation.store(true, Ordering::Release);
                if let Some(old_task) = old_session.task.take() {
                    old_task.abort();
                }
                if old_session.session_id != request.session_id
                    && old_session.window_mode.is_full_episode()
                {
                    cleanup_session_id = Some(old_session.session_id);
                } else if old_session.session_id == request.session_id
                    && old_session.window_mode.is_full_episode()
                    && !request.window_mode.is_full_episode()
                {
                    clear_full_session = Some(old_session.session_id);
                }
            }

            inner.next_generation = inner.next_generation.wrapping_add(1);
            let generation = inner.next_generation;
            let cancellation = Arc::new(AtomicBool::new(false));
            let status = VodPrefetchStatus {
                session_id: request.session_id.clone(),
                state: VodPrefetchTaskState::Running,
                window_mode: request.window_mode,
                queued_count: 0,
                completed_count: 0,
                cached_count: 0,
                cache_bytes: 0,
                current_rendition: request.manifest_url.clone(),
                failure_reason: None,
                can_retry: false,
            };
            let task = VodPrefetchTaskConfig {
                session_id: request.session_id.clone(),
                manifest_url: request.manifest_url.clone(),
                window_mode: request.window_mode,
                last_segment_url: None,
                generation,
                cancellation: Arc::clone(&cancellation),
            };
            if request.window_mode.is_full_episode() {
                register_full_session = Some(request.session_id.clone());
            }
            inner.active = Some(ActiveVodPrefetchSession {
                session_id: request.session_id,
                manifest_url: request.manifest_url,
                window_mode: request.window_mode,
                last_segment_url: None,
                generation,
                cancellation,
                task: None,
                status,
            });
            task
        };

        if let Some(session_id) = cleanup_session_id.or(clear_full_session) {
            if let Err(error) = self.cleanup_full_episode_session(&session_id) {
                self.discard_pending_task(task.generation).await;
                return Err(error);
            }
        }
        if let Some(session_id) = register_full_session {
            if let Err(error) = self.cache.activate_prefetch_session(&session_id) {
                self.discard_pending_task(task.generation).await;
                return Err(AppError::internal(format!("激活整集预取会话失败: {error}")));
            }
            if let Err(error) = self.persist_full_episode_session(&session_id) {
                self.discard_pending_task(task.generation).await;
                return Err(AppError::internal(format!("保存整集预取会话失败: {error}")));
            }
            self.cache.set_temporary_max_bytes(
                crate::online_vod_cache::ONLINE_VOD_CACHE_FULL_EPISODE_MAX_BYTES,
            );
        } else {
            self.cache.clear_temporary_max_bytes();
        }

        let handle = self.spawn_task(state, task.clone());
        self.track_task(task.generation, handle).await;
        Ok(self
            .status_for_generation(task.generation)
            .await
            .unwrap_or(VodPrefetchStatus {
                session_id: task.session_id,
                state: VodPrefetchTaskState::Stopped,
                window_mode: task.window_mode,
                queued_count: 0,
                completed_count: 0,
                cached_count: 0,
                cache_bytes: 0,
                current_rendition: task.manifest_url,
                failure_reason: None,
                can_retry: false,
            }))
    }

    async fn advance(
        &self,
        state: AppState,
        mut request: AdvanceVodPrefetchRequest,
    ) -> AppResult<VodPrefetchStatus> {
        validate_session_id(&request.session_id)?;
        request.segment_url = canonicalize_local_vod_proxy_url(&state, &request.segment_url)?;
        validate_local_vod_asset_url(&state, &request.segment_url)?;

        let task = {
            let mut inner = self.inner.lock().await;
            let (session_id, manifest_url, window_mode, last_segment_url) = {
                let Some(active) = inner.active.as_mut() else {
                    return Err(AppError::bad_request("没有可推进的 VOD 预取会话"));
                };
                if active.session_id != request.session_id {
                    return Err(AppError::bad_request("VOD 预取会话已过期"));
                }
                active.last_segment_url = Some(request.segment_url);
                if active.window_mode.is_full_episode()
                    || matches!(active.status.state, VodPrefetchTaskState::Paused)
                {
                    return Ok(active.status.clone());
                }
                active.cancellation.store(true, Ordering::Release);
                if let Some(active_task) = active.task.take() {
                    active_task.abort();
                }
                (
                    active.session_id.clone(),
                    active.manifest_url.clone(),
                    active.window_mode,
                    active.last_segment_url.clone(),
                )
            };
            inner.next_generation = inner.next_generation.wrapping_add(1);
            let generation = inner.next_generation;
            let cancellation = Arc::new(AtomicBool::new(false));
            let active = inner
                .active
                .as_mut()
                .ok_or_else(|| AppError::internal("VOD 预取会话状态丢失"))?;
            active.generation = generation;
            active.cancellation = Arc::clone(&cancellation);
            active.task = None;
            active.status = VodPrefetchStatus {
                session_id: session_id.clone(),
                state: VodPrefetchTaskState::Running,
                window_mode,
                queued_count: 0,
                completed_count: 0,
                cached_count: 0,
                cache_bytes: 0,
                current_rendition: manifest_url.clone(),
                failure_reason: None,
                can_retry: false,
            };
            VodPrefetchTaskConfig {
                session_id,
                manifest_url,
                window_mode,
                last_segment_url,
                generation,
                cancellation,
            }
        };
        let handle = self.spawn_task(state, task.clone());
        self.track_task(task.generation, handle).await;
        self.status_for_generation(task.generation)
            .await
            .ok_or_else(|| AppError::internal("VOD 预取会话状态丢失"))
    }

    async fn retry(&self, state: AppState, session_id: &str) -> AppResult<VodPrefetchStatus> {
        validate_session_id(session_id)?;
        let task = {
            let mut inner = self.inner.lock().await;
            let (active_session_id, manifest_url, window_mode, last_segment_url) = {
                let Some(active) = inner.active.as_mut() else {
                    return Err(AppError::bad_request("没有可重试的 VOD 预取会话"));
                };
                if active.session_id != session_id {
                    return Err(AppError::bad_request("VOD 预取会话已过期"));
                }
                if !matches!(active.status.state, VodPrefetchTaskState::Paused) {
                    return Ok(active.status.clone());
                }
                (
                    active.session_id.clone(),
                    active.manifest_url.clone(),
                    active.window_mode,
                    active.last_segment_url.clone(),
                )
            };
            inner.next_generation = inner.next_generation.wrapping_add(1);
            let generation = inner.next_generation;
            let cancellation = Arc::new(AtomicBool::new(false));
            let active = inner
                .active
                .as_mut()
                .ok_or_else(|| AppError::internal("VOD 预取会话状态丢失"))?;
            active.generation = generation;
            active.cancellation = Arc::clone(&cancellation);
            active.task = None;
            active.status.state = VodPrefetchTaskState::Running;
            active.status.failure_reason = None;
            active.status.can_retry = false;
            active.status.queued_count = 0;
            active.status.completed_count = 0;
            active.status.cached_count = 0;
            active.status.cache_bytes = 0;
            VodPrefetchTaskConfig {
                session_id: active_session_id,
                manifest_url,
                window_mode,
                last_segment_url,
                generation,
                cancellation,
            }
        };
        let handle = self.spawn_task(state, task.clone());
        self.track_task(task.generation, handle).await;
        self.status_for_generation(task.generation)
            .await
            .ok_or_else(|| AppError::internal("VOD 预取会话状态丢失"))
    }

    async fn stop(&self, session_id: Option<&str>) -> AppResult<Option<VodPrefetchStatus>> {
        if let Some(session_id) = session_id {
            validate_session_id(session_id)?;
        }
        let active = {
            let mut inner = self.inner.lock().await;
            let Some(mut active) = inner.active.take() else {
                return Ok(None);
            };
            if session_id.is_some_and(|session_id| session_id != active.session_id) {
                inner.active = Some(active);
                return Err(AppError::bad_request("VOD 预取会话已过期"));
            }
            active.cancellation.store(true, Ordering::Release);
            if let Some(active_task) = active.task.take() {
                active_task.abort();
            }
            active
        };
        if active.window_mode.is_full_episode() {
            self.cleanup_full_episode_session(&active.session_id)?;
        } else {
            self.cache.clear_temporary_max_bytes();
        }
        Ok(Some(VodPrefetchStatus {
            state: VodPrefetchTaskState::Stopped,
            can_retry: false,
            failure_reason: None,
            ..active.status
        }))
    }

    async fn status(&self, session_id: Option<&str>) -> AppResult<Option<VodPrefetchStatus>> {
        if let Some(session_id) = session_id {
            validate_session_id(session_id)?;
        }
        let inner = self.inner.lock().await;
        let status = inner.active.as_ref().and_then(|active| {
            if session_id.is_none_or(|session_id| session_id == active.session_id) {
                Some(active.status.clone())
            } else {
                None
            }
        });
        Ok(status)
    }

    fn spawn_task(&self, state: AppState, task: VodPrefetchTaskConfig) -> tokio::task::JoinHandle<()> {
        let manager = self.clone();
        tokio::spawn(async move {
            let full_episode = task.window_mode.is_full_episode();
            let result = prefetch_vod_assets(&state, &manager, &task).await;
            manager
                .finish_task(task.generation, result, full_episode)
                .await;
        })
    }

    async fn track_task(&self, generation: u64, handle: tokio::task::JoinHandle<()>) {
        let mut inner = self.inner.lock().await;
        if let Some(active) = inner
            .active
            .as_mut()
            .filter(|active| active.generation == generation)
        {
            if let Some(previous) = active.task.replace(handle) {
                previous.abort();
            }
        } else {
            handle.abort();
        }
    }

    async fn set_queue(&self, generation: u64, queued_count: usize) {
        self.update_status(generation, |status| {
            status.queued_count = queued_count;
        })
        .await;
    }

    async fn record_prefetched_asset(&self, generation: u64, cache_hit: bool) {
        self.update_status(generation, |status| {
            status.completed_count = status.completed_count.saturating_add(1);
            if cache_hit {
                status.cached_count = status.cached_count.saturating_add(1);
            }
        })
        .await;
    }

    async fn finish_task(&self, generation: u64, result: AppResult<()>, full_episode: bool) {
        let cache_bytes = self.cache.byte_len().unwrap_or_default();
        let clear_temporary_ceiling = {
            let mut inner = self.inner.lock().await;
            let is_current = inner
                .active
                .as_ref()
                .is_some_and(|active| active.generation == generation);
            if is_current {
                if let Some(active) = inner.active.as_mut() {
                    active.task = None;
                    active.status.cache_bytes = cache_bytes;
                    match result {
                        Ok(()) => {
                            active.status.state = VodPrefetchTaskState::Completed;
                            active.status.failure_reason = None;
                            active.status.can_retry = false;
                        }
                        Err(error) => {
                            active.status.state = VodPrefetchTaskState::Paused;
                            active.status.failure_reason = Some(error.message);
                            active.status.can_retry = true;
                        }
                    }
                }
            }
            full_episode && is_current
        };
        if clear_temporary_ceiling {
            self.cache.clear_temporary_max_bytes();
        }
    }

    async fn update_status(&self, generation: u64, update: impl FnOnce(&mut VodPrefetchStatus)) {
        let mut inner = self.inner.lock().await;
        if let Some(active) = inner
            .active
            .as_mut()
            .filter(|active| active.generation == generation)
        {
            update(&mut active.status);
        }
    }

    async fn status_for_generation(&self, generation: u64) -> Option<VodPrefetchStatus> {
        self.inner
            .lock()
            .await
            .active
            .as_ref()
            .filter(|active| active.generation == generation)
            .map(|active| active.status.clone())
    }

    async fn discard_pending_task(&self, generation: u64) {
        let mut inner = self.inner.lock().await;
        if inner
            .active
            .as_ref()
            .is_some_and(|active| active.generation == generation)
        {
            if let Some(mut active) = inner.active.take() {
                active.cancellation.store(true, Ordering::Release);
                if let Some(active_task) = active.task.take() {
                    active_task.abort();
                }
            }
        }
    }

    fn persist_full_episode_session(&self, session_id: &str) -> io::Result<()> {
        let payload = serde_json::to_vec(&PersistedFullEpisodeSession {
            session_id: session_id.to_string(),
        })
        .map_err(|error| io::Error::other(format!("serialize VOD prefetch session: {error}")))?;
        let temporary_path = self
            .session_file_path
            .with_extension(format!("json.tmp-{}", std::process::id()));
        fs::write(&temporary_path, payload)?;
        if let Err(error) = fs::rename(&temporary_path, &self.session_file_path) {
            let _ = fs::remove_file(temporary_path);
            return Err(error);
        }
        Ok(())
    }

    fn cleanup_full_episode_session(&self, session_id: &str) -> AppResult<()> {
        self.cache
            .remove_prefetch_session_entries(session_id)
            .map_err(|error| AppError::internal(format!("清理整集预取缓存失败: {error}")))?;
        self.cache.clear_temporary_max_bytes();
        let persisted_session = fs::read(&self.session_file_path)
            .ok()
            .and_then(|bytes| serde_json::from_slice::<PersistedFullEpisodeSession>(&bytes).ok());
        if persisted_session
            .as_ref()
            .is_some_and(|session| session.session_id == session_id)
        {
            remove_file_if_exists(&self.session_file_path).map_err(|error| {
                AppError::internal(format!("清理整集预取会话记录失败: {error}"))
            })?;
        }
        Ok(())
    }
}

pub(crate) async fn post_vod_prefetch_session(
    State(state): State<AppState>,
    Json(request): Json<StartVodPrefetchRequest>,
) -> AppResult<Json<VodPrefetchStatus>> {
    let status = state.vod_prefetch.start(state.clone(), request).await?;
    Ok(Json(status))
}

pub(crate) async fn post_vod_prefetch_advance(
    State(state): State<AppState>,
    Json(request): Json<AdvanceVodPrefetchRequest>,
) -> AppResult<Json<VodPrefetchStatus>> {
    let status = state.vod_prefetch.advance(state.clone(), request).await?;
    Ok(Json(status))
}

pub(crate) async fn post_vod_prefetch_retry(
    State(state): State<AppState>,
    Json(query): Json<VodPrefetchSessionQuery>,
) -> AppResult<Json<VodPrefetchStatus>> {
    let session_id = query
        .session_id
        .as_deref()
        .ok_or_else(|| AppError::bad_request("缺少 VOD 预取会话 ID"))?;
    let status = state.vod_prefetch.retry(state.clone(), session_id).await?;
    Ok(Json(status))
}

pub(crate) async fn get_vod_prefetch_session(
    State(state): State<AppState>,
    Query(query): Query<VodPrefetchSessionQuery>,
) -> AppResult<Json<Option<VodPrefetchStatus>>> {
    Ok(Json(
        state
            .vod_prefetch
            .status(query.session_id.as_deref())
            .await?,
    ))
}

pub(crate) async fn stop_vod_prefetch_session(
    State(state): State<AppState>,
    Query(query): Query<VodPrefetchSessionQuery>,
) -> AppResult<Json<Option<VodPrefetchStatus>>> {
    Ok(Json(
        state.vod_prefetch.stop(query.session_id.as_deref()).await?,
    ))
}

async fn prefetch_vod_assets(
    state: &AppState,
    manager: &VodPrefetchManager,
    task: &VodPrefetchTaskConfig,
) -> AppResult<()> {
    if task.cancellation.load(Ordering::Acquire) {
        return Ok(());
    }

    let manifest_asset = fetch_or_read_vod_asset(state, task, &task.manifest_url).await?;
    let manifest = String::from_utf8(manifest_asset.body)
        .map_err(|_| AppError::bad_request("VOD 预取仅支持 UTF-8 媒体清单"))?;
    let segments = parse_media_playlist(&manifest)?;
    let resources = select_resources_for_prefetch(
        &segments,
        task.window_mode,
        task.last_segment_url.as_deref(),
    );
    manager.set_queue(task.generation, resources.len()).await;

    for resource in resources {
        if task.cancellation.load(Ordering::Acquire) {
            return Ok(());
        }
        let cache_hit = state.read_cached_online_vod_asset(&resource.url).is_some();
        if !cache_hit {
            let mut last_error = None;
            for attempt in 0..PREFETCH_RETRY_COUNT {
                match fetch_or_read_vod_asset(state, task, &resource.url).await {
                    Ok(_) => {
                        last_error = None;
                        break;
                    }
                    Err(error) => {
                        last_error = Some(error);
                        if attempt + 1 < PREFETCH_RETRY_COUNT {
                            tokio::time::sleep(std::time::Duration::from_millis(350)).await;
                        }
                    }
                }
            }
            if let Some(error) = last_error {
                return Err(error);
            }
        }
        manager
            .record_prefetched_asset(task.generation, cache_hit)
            .await;
    }
    Ok(())
}

async fn fetch_or_read_vod_asset(
    state: &AppState,
    task: &VodPrefetchTaskConfig,
    request_url: &str,
) -> AppResult<crate::vod_proxy::VodProxyFetchedAsset> {
    if let Some(asset) = state.read_cached_online_vod_asset(request_url) {
        return Ok(crate::vod_proxy::VodProxyFetchedAsset {
            status: StatusCode::from_u16(asset.status).unwrap_or(StatusCode::INTERNAL_SERVER_ERROR),
            content_type: asset.content_type,
            body: asset.body,
        });
    }
    let (path, params) = validate_local_vod_asset_url(state, request_url)?;
    let fetched =
        fetch_vod_proxy_asset_bytes(state, &path, params, &HeaderMap::new(), false).await?;
    if !fetched.status.is_success() {
        return Err(AppError::internal(format!(
            "VOD 预取请求失败: {}",
            fetched.status
        )));
    }
    if task.cancellation.load(Ordering::Acquire) {
        return Ok(fetched);
    }
    let policy = cache_policy_for_vod_path(&path)?;
    let session_id = task
        .window_mode
        .is_full_episode()
        .then_some(task.session_id.as_str());
    state.cache_online_vod_prefetch_asset(
        request_url,
        fetched.status,
        fetched.content_type.as_deref(),
        &fetched.body,
        policy,
        session_id,
    )?;
    Ok(fetched)
}

fn cache_policy_for_vod_path(path: &str) -> AppResult<OnlineVodCachePolicy> {
    match path {
        "/api/proxy/vod/m3u8" | "/media/vod/m3u8" => Ok(OnlineVodCachePolicy::Manifest),
        "/api/proxy/vod/segment" | "/media/vod/segment" => Ok(OnlineVodCachePolicy::Segment),
        "/api/proxy/vod/key" | "/media/vod/key" => Ok(OnlineVodCachePolicy::Key),
        _ => Err(AppError::bad_request("不支持的 VOD 预取资源")),
    }
}

fn validate_session_id(session_id: &str) -> AppResult<()> {
    if session_id.is_empty()
        || session_id.len() > MAX_SESSION_ID_LENGTH
        || !session_id
            .bytes()
            .all(|character| character.is_ascii_alphanumeric() || matches!(character, b'-' | b'_'))
    {
        return Err(AppError::bad_request("VOD 预取会话 ID 无效"));
    }
    Ok(())
}

fn validate_local_media_playlist_url(
    state: &AppState,
    request_url: &str,
) -> AppResult<(String, crate::VodProxyQueryParams)> {
    let (path, params) = validate_local_vod_asset_url(state, request_url)?;
    if !matches!(path.as_str(), "/api/proxy/vod/m3u8" | "/media/vod/m3u8") {
        return Err(AppError::bad_request("VOD 预取只接受媒体清单 URL"));
    }
    Ok((path, params))
}

fn validate_local_vod_asset_url(
    state: &AppState,
    request_url: &str,
) -> AppResult<(String, crate::VodProxyQueryParams)> {
    let canonical_url = canonicalize_local_vod_proxy_url(state, request_url)?;
    let (path, params) = parse_vod_proxy_url(&canonical_url)
        .ok_or_else(|| AppError::bad_request("VOD 预取 URL 不是合法的本地代理资源"))?;
    cache_policy_for_vod_path(&path)?;
    Ok((path, params))
}

fn canonicalize_local_vod_proxy_url(state: &AppState, request_url: &str) -> AppResult<String> {
    let local_base =
        Url::parse(state.public_base_url()).map_err(|_| AppError::internal("本地服务地址无效"))?;
    let parsed = Url::parse(request_url)
        .or_else(|_| {
            Url::parse(&format!(
                "{}/{}",
                state.public_base_url().trim_end_matches('/'),
                request_url.trim_start_matches('/')
            ))
        })
        .map_err(|_| AppError::bad_request("VOD 预取 URL 无效"))?;
    if parsed.scheme() != local_base.scheme()
        || parsed.host_str() != local_base.host_str()
        || parsed.port_or_known_default() != local_base.port_or_known_default()
    {
        return Err(AppError::bad_request("VOD 预取仅接受本地代理 URL"));
    }
    let canonical_url = parsed.to_string();
    let (path, _) = parse_vod_proxy_url(&canonical_url)
        .ok_or_else(|| AppError::bad_request("VOD 预取 URL 不是合法的本地代理资源"))?;
    cache_policy_for_vod_path(&path)?;
    Ok(canonical_url)
}

fn parse_media_playlist(manifest: &str) -> AppResult<Vec<VodPrefetchSegment>> {
    if manifest
        .lines()
        .any(|line| line.trim_start().starts_with("#EXT-X-STREAM-INF:"))
    {
        return Err(AppError::bad_request(
            "VOD 预取等待播放器选定实际清晰度后再开始",
        ));
    }

    let mut segments = Vec::new();
    let mut dependencies = Vec::new();
    let mut duration_seconds = 0.0;
    for line in manifest.lines() {
        let line = line.trim();
        if let Some(value) = line.strip_prefix("#EXTINF:") {
            duration_seconds = value
                .split(',')
                .next()
                .and_then(|value| value.parse::<f64>().ok())
                .filter(|value| value.is_finite() && *value >= 0.0)
                .unwrap_or(0.0);
            continue;
        }
        if line.starts_with("#EXT-X-KEY:") {
            if let Some(url) = extract_attribute_uri(line) {
                dependencies.push(VodPrefetchResource {
                    url,
                    duration_seconds: 0.0,
                });
            }
            continue;
        }
        if line.starts_with("#EXT-X-MAP:") {
            if let Some(url) = extract_attribute_uri(line) {
                dependencies.push(VodPrefetchResource {
                    url,
                    duration_seconds: 0.0,
                });
            }
            continue;
        }
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        segments.push(VodPrefetchSegment {
            dependencies: dependencies.clone(),
            resource: VodPrefetchResource {
                url: line.to_string(),
                duration_seconds,
            },
        });
        if segments.len() > MAX_VOD_PREFETCH_SEGMENTS {
            return Err(AppError::bad_request("VOD 媒体清单分段数量超出上限"));
        }
        duration_seconds = 0.0;
    }
    if segments.is_empty() {
        return Err(AppError::bad_request("VOD 媒体清单没有可预取的分片"));
    }
    Ok(segments)
}

fn select_resources_for_prefetch(
    segments: &[VodPrefetchSegment],
    window_mode: VodPrefetchWindowMode,
    last_segment_url: Option<&str>,
) -> Vec<VodPrefetchResource> {
    let start = last_segment_url
        .and_then(|url| {
            segments
                .iter()
                .position(|segment| segment.resource.url == url)
                .map(|index| index.saturating_add(1))
        })
        .unwrap_or(0);
    let target_duration = window_mode.target_duration_seconds();
    let mut total_duration = 0.0;
    let mut seen_urls = BTreeSet::new();
    let mut resources = Vec::new();

    for segment in segments.iter().skip(start) {
        if target_duration.is_some_and(|target| total_duration >= target) {
            break;
        }
        for dependency in &segment.dependencies {
            if seen_urls.insert(dependency.url.clone()) {
                resources.push(dependency.clone());
            }
        }
        if seen_urls.insert(segment.resource.url.clone()) {
            resources.push(segment.resource.clone());
        }
        total_duration += segment.resource.duration_seconds;
    }
    resources
}

fn extract_attribute_uri(line: &str) -> Option<String> {
    let start = line.find("URI=\"")?.saturating_add("URI=\"".len());
    let rest = &line[start..];
    let end = rest.find('"')?;
    let value = rest[..end].trim();
    (!value.is_empty()).then(|| value.to_string())
}

fn remove_file_if_exists(path: &Path) -> io::Result<()> {
    match fs::remove_file(path) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(error),
    }
}

#[cfg(test)]
mod tests {
    use super::{VodPrefetchWindowMode, parse_media_playlist, select_resources_for_prefetch};

    const MEDIA_PLAYLIST: &str = "#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI=\"http://127.0.0.1:8787/media/vod/key?source=demo&url=key\"\n#EXT-X-MAP:URI=\"http://127.0.0.1:8787/media/vod/segment?source=demo&url=init\"\n#EXTINF:12.0,\nhttp://127.0.0.1:8787/media/vod/segment?source=demo&url=one\n#EXTINF:12.0,\nhttp://127.0.0.1:8787/media/vod/segment?source=demo&url=two\n#EXTINF:12.0,\nhttp://127.0.0.1:8787/media/vod/segment?source=demo&url=three\n";

    #[test]
    fn selects_a_duration_window_after_the_last_played_segment() {
        let segments = parse_media_playlist(MEDIA_PLAYLIST).expect("parse media playlist");
        let resources = select_resources_for_prefetch(
            &segments,
            VodPrefetchWindowMode::Seconds30,
            Some("http://127.0.0.1:8787/media/vod/segment?source=demo&url=one"),
        );
        let urls = resources
            .into_iter()
            .map(|resource| resource.url)
            .collect::<Vec<_>>();
        assert!(urls.iter().any(|url| url.ends_with("url=two")));
        assert!(urls.iter().any(|url| url.ends_with("url=three")));
        assert!(!urls.iter().any(|url| url.ends_with("url=one")));
    }

    #[test]
    fn rejects_master_playlists_until_a_media_rendition_is_observed() {
        let error = parse_media_playlist("#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1\nlevel.m3u8")
            .expect_err("master playlist should not prefetch a guessed rendition");
        assert_eq!(error.status, axum::http::StatusCode::BAD_REQUEST);
    }
}
