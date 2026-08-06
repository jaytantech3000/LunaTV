use std::{
    collections::BTreeSet,
    fs::{self, File, OpenOptions},
    io::{self, Write},
    path::{Path, PathBuf},
    sync::{
        Arc, Mutex,
        atomic::{AtomicU64, AtomicUsize, Ordering},
    },
};

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

const ONLINE_VOD_CACHE_DIR_NAME: &str = "online-vod-cache";
const ONLINE_VOD_CACHE_MAX_BYTES: u64 = 512 * 1024 * 1024;
pub(crate) const ONLINE_VOD_CACHE_FULL_EPISODE_MAX_BYTES: u64 = ONLINE_VOD_CACHE_MAX_BYTES * 2;
const ONLINE_VOD_CACHE_MAX_ENTRY_BYTES: u64 = 32 * 1024 * 1024;
const ONLINE_VOD_CACHE_MAX_ACTIVE_WRITERS: usize = 4;

const ONLINE_VOD_MANIFEST_TTL_MS: u64 = 15 * 1_000;
const ONLINE_VOD_KEY_TTL_MS: u64 = 60 * 60 * 1_000;
const ONLINE_VOD_SEGMENT_TTL_MS: u64 = 24 * 60 * 60 * 1_000;

static NEXT_TEMP_FILE_ID: AtomicU64 = AtomicU64::new(0);

#[derive(Clone, Copy, Debug)]
pub(crate) enum OnlineVodCachePolicy {
    Manifest,
    Segment,
    Key,
}

impl OnlineVodCachePolicy {
    fn ttl_ms(self) -> u64 {
        match self {
            Self::Manifest => ONLINE_VOD_MANIFEST_TTL_MS,
            Self::Segment => ONLINE_VOD_SEGMENT_TTL_MS,
            Self::Key => ONLINE_VOD_KEY_TTL_MS,
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct CachedOnlineVodAsset {
    pub(crate) status: u16,
    pub(crate) content_type: Option<String>,
    pub(crate) body: Vec<u8>,
}

#[derive(Clone, Debug)]
pub(crate) struct OnlineVodCache {
    root: PathBuf,
    max_bytes: u64,
    max_entry_bytes: u64,
    access_lock: Arc<Mutex<()>>,
    active_writers: Arc<AtomicUsize>,
    temporary_max_bytes: Arc<AtomicU64>,
    retired_prefetch_sessions: Arc<Mutex<BTreeSet<String>>>,
}

#[derive(Debug, Deserialize, Serialize)]
struct OnlineVodCacheMeta {
    request_url: String,
    status: u16,
    content_type: Option<String>,
    body_len: u64,
    created_at_ms: u64,
    last_accessed_at_ms: u64,
    expires_at_ms: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    prefetch_session_id: Option<String>,
}

pub(crate) struct OnlineVodCacheWriter {
    cache: OnlineVodCache,
    request_url: String,
    status: u16,
    content_type: Option<String>,
    created_at_ms: u64,
    expires_at_ms: u64,
    body_len: u64,
    body_path: PathBuf,
    meta_path: PathBuf,
    temp_body_path: PathBuf,
    file: Option<File>,
    _writer_slot: OnlineVodCacheWriterSlot,
    committed: bool,
    prefetch_session_id: Option<String>,
}

struct OnlineVodCacheWriterSlot {
    active_writers: Arc<AtomicUsize>,
}

impl OnlineVodCache {
    pub(crate) fn new(data_dir: &Path) -> io::Result<Self> {
        let root = data_dir.join(ONLINE_VOD_CACHE_DIR_NAME);
        fs::create_dir_all(&root)?;
        Ok(Self {
            root,
            max_bytes: ONLINE_VOD_CACHE_MAX_BYTES,
            max_entry_bytes: ONLINE_VOD_CACHE_MAX_ENTRY_BYTES,
            access_lock: Arc::new(Mutex::new(())),
            active_writers: Arc::new(AtomicUsize::new(0)),
            temporary_max_bytes: Arc::new(AtomicU64::new(0)),
            retired_prefetch_sessions: Arc::new(Mutex::new(BTreeSet::new())),
        })
    }

    pub(crate) fn get(
        &self,
        request_url: &str,
        now_ms: u64,
    ) -> io::Result<Option<CachedOnlineVodAsset>> {
        let _access_lock = self.lock_access()?;
        let (body_path, meta_path) = self.entry_paths(request_url);
        let (body, mut meta) = match (fs::read(&body_path), fs::read(&meta_path)) {
            (Ok(body), Ok(meta_bytes)) => {
                match serde_json::from_slice::<OnlineVodCacheMeta>(&meta_bytes) {
                    Ok(meta)
                        if meta.request_url == request_url
                            && meta.body_len == body.len() as u64
                            && meta.expires_at_ms > now_ms =>
                    {
                        (body, meta)
                    }
                    _ => {
                        self.remove_entry(&body_path, &meta_path);
                        return Ok(None);
                    }
                }
            }
            (Err(error), _) | (_, Err(error)) if error.kind() == io::ErrorKind::NotFound => {
                self.remove_entry(&body_path, &meta_path);
                return Ok(None);
            }
            (Err(error), _) | (_, Err(error)) => return Err(error),
        };

        meta.last_accessed_at_ms = now_ms;
        self.write_meta(&meta_path, &meta)?;

        Ok(Some(CachedOnlineVodAsset {
            status: meta.status,
            content_type: meta.content_type,
            body,
        }))
    }

    pub(crate) fn store(
        &self,
        request_url: &str,
        status: u16,
        content_type: Option<&str>,
        body: &[u8],
        policy: OnlineVodCachePolicy,
        now_ms: u64,
    ) -> io::Result<()> {
        self.store_for_prefetch_session(
            request_url,
            status,
            content_type,
            body,
            policy,
            now_ms,
            None,
        )
    }

    pub(crate) fn store_for_prefetch_session(
        &self,
        request_url: &str,
        status: u16,
        content_type: Option<&str>,
        body: &[u8],
        policy: OnlineVodCachePolicy,
        now_ms: u64,
        prefetch_session_id: Option<&str>,
    ) -> io::Result<()> {
        let Some(mut writer) = self.begin_write(
            request_url,
            status,
            content_type,
            Some(body.len() as u64),
            policy,
            now_ms,
            prefetch_session_id,
        )?
        else {
            return Ok(());
        };

        writer.write_chunk(body)?;
        writer.finish()
    }

    pub(crate) fn begin_write(
        &self,
        request_url: &str,
        status: u16,
        content_type: Option<&str>,
        expected_body_len: Option<u64>,
        policy: OnlineVodCachePolicy,
        now_ms: u64,
        prefetch_session_id: Option<&str>,
    ) -> io::Result<Option<OnlineVodCacheWriter>> {
        if expected_body_len.is_some_and(|length| length > self.max_entry_bytes) {
            return Ok(None);
        }
        let Some(writer_slot) = self.try_acquire_writer_slot() else {
            return Ok(None);
        };

        let (body_path, meta_path) = self.entry_paths(request_url);
        let temp_body_path = self.new_temp_path(&body_path);
        let file = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temp_body_path)?;

        Ok(Some(OnlineVodCacheWriter {
            cache: self.clone(),
            request_url: request_url.to_string(),
            status,
            content_type: normalize_optional_text(content_type),
            created_at_ms: now_ms,
            expires_at_ms: now_ms.saturating_add(policy.ttl_ms()),
            body_len: 0,
            body_path,
            meta_path,
            temp_body_path,
            file: Some(file),
            _writer_slot: writer_slot,
            committed: false,
            prefetch_session_id: normalize_optional_text(prefetch_session_id),
        }))
    }

    fn commit(&self, writer: &OnlineVodCacheWriter) -> io::Result<()> {
        let _access_lock = self.lock_access()?;
        if writer
            .prefetch_session_id
            .as_deref()
            .is_some_and(|session_id| self.is_prefetch_session_retired(session_id))
        {
            let _ = fs::remove_file(&writer.temp_body_path);
            return Ok(());
        }
        self.evict_to_fit(writer.body_len, &writer.body_path)?;
        self.remove_entry(&writer.body_path, &writer.meta_path);
        fs::rename(&writer.temp_body_path, &writer.body_path)?;

        let meta = OnlineVodCacheMeta {
            request_url: writer.request_url.clone(),
            status: writer.status,
            content_type: writer.content_type.clone(),
            body_len: writer.body_len,
            created_at_ms: writer.created_at_ms,
            last_accessed_at_ms: writer.created_at_ms,
            expires_at_ms: writer.expires_at_ms,
            prefetch_session_id: writer.prefetch_session_id.clone(),
        };
        if let Err(error) = self.write_meta(&writer.meta_path, &meta) {
            self.remove_entry(&writer.body_path, &writer.meta_path);
            return Err(error);
        }

        Ok(())
    }

    fn lock_access(&self) -> io::Result<std::sync::MutexGuard<'_, ()>> {
        self.access_lock
            .lock()
            .map_err(|_| io::Error::other("online VOD cache access lock poisoned"))
    }

    fn try_acquire_writer_slot(&self) -> Option<OnlineVodCacheWriterSlot> {
        loop {
            let active_writers = self.active_writers.load(Ordering::Acquire);
            if active_writers >= ONLINE_VOD_CACHE_MAX_ACTIVE_WRITERS {
                return None;
            }
            if self
                .active_writers
                .compare_exchange_weak(
                    active_writers,
                    active_writers + 1,
                    Ordering::AcqRel,
                    Ordering::Acquire,
                )
                .is_ok()
            {
                return Some(OnlineVodCacheWriterSlot {
                    active_writers: Arc::clone(&self.active_writers),
                });
            }
        }
    }

    fn entry_paths(&self, request_url: &str) -> (PathBuf, PathBuf) {
        let key = cache_key(request_url);
        (
            self.root.join(format!("{key}.body")),
            self.root.join(format!("{key}.meta.json")),
        )
    }

    fn new_temp_path(&self, body_path: &Path) -> PathBuf {
        let id = NEXT_TEMP_FILE_ID.fetch_add(1, Ordering::Relaxed);
        body_path.with_extension(format!("body.tmp-{}-{id}", std::process::id()))
    }

    fn write_meta(&self, path: &Path, meta: &OnlineVodCacheMeta) -> io::Result<()> {
        let bytes = serde_json::to_vec(meta).map_err(|error| {
            io::Error::other(format!("serialize online VOD cache metadata: {error}"))
        })?;
        atomic_write(path, &bytes)
    }

    fn remove_entry(&self, body_path: &Path, meta_path: &Path) {
        let _ = fs::remove_file(body_path);
        let _ = fs::remove_file(meta_path);
    }

    fn evict_to_fit(&self, incoming_bytes: u64, preserve_body_path: &Path) -> io::Result<()> {
        let max_bytes = self.effective_max_bytes();
        if incoming_bytes > max_bytes {
            return Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                "online VOD asset exceeds cache byte limit",
            ));
        }

        let mut entries = Vec::new();
        for entry in fs::read_dir(&self.root)? {
            let entry = entry?;
            let body_path = entry.path();
            if body_path
                .extension()
                .is_none_or(|extension| extension != "body")
            {
                continue;
            }

            let Some(key) = body_path.file_stem().and_then(|key| key.to_str()) else {
                continue;
            };
            let meta_path = self.root.join(format!("{key}.meta.json"));
            let body_len = entry.metadata()?.len();
            let last_accessed_at_ms = fs::read(&meta_path)
                .ok()
                .and_then(|bytes| serde_json::from_slice::<OnlineVodCacheMeta>(&bytes).ok())
                .filter(|meta| meta.body_len == body_len)
                .map(|meta| meta.last_accessed_at_ms)
                .unwrap_or_default();
            entries.push((last_accessed_at_ms, body_len, body_path, meta_path));
        }

        let mut total_bytes = entries
            .iter()
            .map(|(_, body_len, _, _)| *body_len)
            .sum::<u64>();
        if let Some((_, body_len, _, _)) = entries
            .iter()
            .find(|(_, _, body_path, _)| body_path == preserve_body_path)
        {
            total_bytes = total_bytes.saturating_sub(*body_len);
        }

        entries.sort_by_key(|(last_accessed_at_ms, _, _, _)| *last_accessed_at_ms);
        for (_, body_len, body_path, meta_path) in entries {
            if total_bytes.saturating_add(incoming_bytes) <= max_bytes {
                break;
            }
            if body_path == preserve_body_path {
                continue;
            }
            self.remove_entry(&body_path, &meta_path);
            total_bytes = total_bytes.saturating_sub(body_len);
        }

        Ok(())
    }

    pub(crate) fn set_temporary_max_bytes(&self, max_bytes: u64) {
        self.temporary_max_bytes.store(max_bytes, Ordering::Release);
    }

    pub(crate) fn activate_prefetch_session(&self, session_id: &str) -> io::Result<()> {
        self.retired_prefetch_sessions
            .lock()
            .map_err(|_| io::Error::other("online VOD cache session lock poisoned"))?
            .remove(session_id);
        Ok(())
    }

    pub(crate) fn clear_temporary_max_bytes(&self) {
        self.temporary_max_bytes.store(0, Ordering::Release);
    }

    pub(crate) fn remove_prefetch_session_entries(&self, session_id: &str) -> io::Result<u64> {
        let _access_lock = self.lock_access()?;
        self.retire_prefetch_session(session_id)?;
        let mut removed = 0_u64;
        for entry in fs::read_dir(&self.root)? {
            let entry = entry?;
            let body_path = entry.path();
            if body_path
                .extension()
                .is_none_or(|extension| extension != "body")
            {
                continue;
            }

            let Some(key) = body_path.file_stem().and_then(|key| key.to_str()) else {
                continue;
            };
            let meta_path = self.root.join(format!("{key}.meta.json"));
            let matches_session = fs::read(&meta_path)
                .ok()
                .and_then(|bytes| serde_json::from_slice::<OnlineVodCacheMeta>(&bytes).ok())
                .is_some_and(|meta| meta.prefetch_session_id.as_deref() == Some(session_id));
            if matches_session {
                removed = removed.saturating_add(entry.metadata()?.len());
                self.remove_entry(&body_path, &meta_path);
            }
        }
        Ok(removed)
    }

    pub(crate) fn byte_len(&self) -> io::Result<u64> {
        let _access_lock = self.lock_access()?;
        fs::read_dir(&self.root)?.try_fold(0_u64, |total, entry| {
            let entry = entry?;
            let path = entry.path();
            if path
                .extension()
                .is_some_and(|extension| extension == "body")
            {
                Ok(total.saturating_add(entry.metadata()?.len()))
            } else {
                Ok(total)
            }
        })
    }

    fn effective_max_bytes(&self) -> u64 {
        let temporary_max_bytes = self.temporary_max_bytes.load(Ordering::Acquire);
        if temporary_max_bytes == 0 {
            self.max_bytes
        } else {
            temporary_max_bytes
        }
    }

    fn retire_prefetch_session(&self, session_id: &str) -> io::Result<()> {
        self.retired_prefetch_sessions
            .lock()
            .map_err(|_| io::Error::other("online VOD cache session lock poisoned"))?
            .insert(session_id.to_string());
        Ok(())
    }

    fn is_prefetch_session_retired(&self, session_id: &str) -> bool {
        self.retired_prefetch_sessions
            .lock()
            .map(|sessions| sessions.contains(session_id))
            .unwrap_or(true)
    }
}

impl OnlineVodCacheWriter {
    pub(crate) fn write_chunk(&mut self, chunk: &[u8]) -> io::Result<()> {
        let next_len = self
            .body_len
            .checked_add(chunk.len() as u64)
            .ok_or_else(|| io::Error::other("online VOD cache asset length overflow"))?;
        if next_len > self.cache.max_entry_bytes {
            return Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                "online VOD asset exceeds per-entry byte limit",
            ));
        }

        let file = self
            .file
            .as_mut()
            .ok_or_else(|| io::Error::other("online VOD cache writer is already closed"))?;
        file.write_all(chunk)?;
        self.body_len = next_len;
        Ok(())
    }

    pub(crate) fn finish(mut self) -> io::Result<()> {
        let Some(mut file) = self.file.take() else {
            return Err(io::Error::other(
                "online VOD cache writer is already closed",
            ));
        };
        file.flush()?;
        drop(file);

        self.cache.commit(&self)?;
        self.committed = true;
        Ok(())
    }
}

impl Drop for OnlineVodCacheWriter {
    fn drop(&mut self) {
        if !self.committed {
            let _ = fs::remove_file(&self.temp_body_path);
        }
    }
}

impl Drop for OnlineVodCacheWriterSlot {
    fn drop(&mut self) {
        self.active_writers.fetch_sub(1, Ordering::Release);
    }
}

fn normalize_optional_text(value: Option<&str>) -> Option<String> {
    value.and_then(|item| {
        let normalized = item.trim();
        (!normalized.is_empty()).then(|| normalized.to_string())
    })
}

fn cache_key(request_url: &str) -> String {
    format!("{:x}", Sha256::digest(request_url.as_bytes()))
}

fn atomic_write(path: &Path, bytes: &[u8]) -> io::Result<()> {
    let id = NEXT_TEMP_FILE_ID.fetch_add(1, Ordering::Relaxed);
    let temp_path = path.with_extension(format!("json.tmp-{}-{id}", std::process::id()));
    fs::write(&temp_path, bytes)?;
    if let Err(error) = fs::rename(&temp_path, path) {
        let _ = fs::remove_file(&temp_path);
        return Err(error);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{
        CachedOnlineVodAsset, ONLINE_VOD_CACHE_DIR_NAME, OnlineVodCache, OnlineVodCachePolicy,
    };
    use std::{
        env, fs,
        path::PathBuf,
        sync::atomic::{AtomicU64, Ordering},
    };

    static NEXT_TEST_DIR_ID: AtomicU64 = AtomicU64::new(0);

    struct TestDir {
        path: PathBuf,
    }

    impl TestDir {
        fn new() -> Self {
            let id = NEXT_TEST_DIR_ID.fetch_add(1, Ordering::Relaxed);
            let path = env::temp_dir().join(format!(
                "moontv-online-vod-cache-test-{}-{id}",
                std::process::id()
            ));
            fs::create_dir_all(&path).expect("create temporary online VOD cache directory");
            Self { path }
        }
    }

    impl Drop for TestDir {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.path);
        }
    }

    #[test]
    fn cache_persists_complete_assets_under_a_dedicated_directory() {
        let temp_dir = TestDir::new();
        let cache = OnlineVodCache::new(&temp_dir.path).expect("create online VOD cache");
        let request_url = "http://127.0.0.1:8787/media/vod/segment?source=mock&url=one";

        cache
            .store(
                request_url,
                200,
                Some("video/mp2t"),
                b"segment",
                OnlineVodCachePolicy::Segment,
                100,
            )
            .expect("store online VOD asset");

        assert!(temp_dir.path.join(ONLINE_VOD_CACHE_DIR_NAME).is_dir());
        assert_eq!(
            cache.get(request_url, 101).expect("read online VOD asset"),
            Some(CachedOnlineVodAsset {
                status: 200,
                content_type: Some("video/mp2t".to_string()),
                body: b"segment".to_vec(),
            })
        );
    }

    #[test]
    fn cache_evicts_the_least_recently_used_asset_within_its_byte_budget() {
        let temp_dir = TestDir::new();
        let mut cache = OnlineVodCache::new(&temp_dir.path).expect("create online VOD cache");
        cache.max_bytes = 8;
        let first = "http://127.0.0.1:8787/media/vod/segment?url=first";
        let second = "http://127.0.0.1:8787/media/vod/segment?url=second";
        let third = "http://127.0.0.1:8787/media/vod/segment?url=third";

        for (request_url, timestamp) in [(first, 1), (second, 2)] {
            cache
                .store(
                    request_url,
                    200,
                    Some("video/mp2t"),
                    b"1234",
                    OnlineVodCachePolicy::Segment,
                    timestamp,
                )
                .expect("store online VOD asset");
        }
        cache.get(first, 3).expect("touch first asset");
        cache
            .store(
                third,
                200,
                Some("video/mp2t"),
                b"5678",
                OnlineVodCachePolicy::Segment,
                4,
            )
            .expect("store third online VOD asset");

        assert!(cache.get(first, 5).expect("read first asset").is_some());
        assert!(cache.get(second, 5).expect("read second asset").is_none());
        assert!(cache.get(third, 5).expect("read third asset").is_some());
    }

    #[test]
    fn full_episode_session_cleanup_preserves_passive_cache_entries() {
        let temp_dir = TestDir::new();
        let cache = OnlineVodCache::new(&temp_dir.path).expect("create online VOD cache");
        let passive_url = "http://127.0.0.1:8787/media/vod/segment?url=passive";
        let prefetched_url = "http://127.0.0.1:8787/media/vod/segment?url=prefetched";

        cache
            .store(
                passive_url,
                200,
                Some("video/mp2t"),
                b"passive",
                OnlineVodCachePolicy::Segment,
                1,
            )
            .expect("store passive cache entry");
        cache
            .store_for_prefetch_session(
                prefetched_url,
                200,
                Some("video/mp2t"),
                b"prefetched",
                OnlineVodCachePolicy::Segment,
                2,
                Some("vod-session"),
            )
            .expect("store full episode prefetch entry");

        assert_eq!(
            cache
                .remove_prefetch_session_entries("vod-session")
                .expect("remove full episode session entries"),
            b"prefetched".len() as u64
        );
        assert!(
            cache
                .get(passive_url, 3)
                .expect("read passive entry")
                .is_some()
        );
        assert!(
            cache
                .get(prefetched_url, 3)
                .expect("read prefetch entry")
                .is_none()
        );
        cache
            .store_for_prefetch_session(
                prefetched_url,
                200,
                Some("video/mp2t"),
                b"late-write",
                OnlineVodCachePolicy::Segment,
                4,
                Some("vod-session"),
            )
            .expect("ignore retired full episode write");
        assert!(
            cache
                .get(prefetched_url, 5)
                .expect("read retired prefetch entry")
                .is_none()
        );
    }

    #[test]
    fn temporary_limit_allows_full_episode_prefetch_to_exceed_the_baseline() {
        let temp_dir = TestDir::new();
        let mut cache = OnlineVodCache::new(&temp_dir.path).expect("create online VOD cache");
        cache.max_bytes = 8;
        cache.set_temporary_max_bytes(16);
        for (request_url, body) in [
            (
                "http://127.0.0.1:8787/media/vod/segment?url=first",
                b"12345678".as_slice(),
            ),
            (
                "http://127.0.0.1:8787/media/vod/segment?url=second",
                b"abcdefgh".as_slice(),
            ),
        ] {
            cache
                .store_for_prefetch_session(
                    request_url,
                    200,
                    Some("video/mp2t"),
                    body,
                    OnlineVodCachePolicy::Segment,
                    1,
                    Some("vod-session"),
                )
                .expect("store full episode entry within temporary limit");
        }

        assert_eq!(cache.byte_len().expect("read cache byte length"), 16);
        cache.clear_temporary_max_bytes();
    }

    #[test]
    fn cache_drops_expired_manifests() {
        let temp_dir = TestDir::new();
        let cache = OnlineVodCache::new(&temp_dir.path).expect("create online VOD cache");
        let request_url = "http://127.0.0.1:8787/media/vod/m3u8?url=master";

        cache
            .store(
                request_url,
                200,
                Some("application/vnd.apple.mpegurl"),
                b"#EXTM3U",
                OnlineVodCachePolicy::Manifest,
                100,
            )
            .expect("store manifest");

        assert!(
            cache
                .get(request_url, 100)
                .expect("read manifest")
                .is_some()
        );
        assert!(
            cache
                .get(request_url, 100 + super::ONLINE_VOD_MANIFEST_TTL_MS)
                .expect("read expired manifest")
                .is_none()
        );
    }

    #[test]
    fn incomplete_writes_never_become_cache_hits() {
        let temp_dir = TestDir::new();
        let cache = OnlineVodCache::new(&temp_dir.path).expect("create online VOD cache");
        let request_url = "http://127.0.0.1:8787/media/vod/segment?url=incomplete";

        let mut writer = cache
            .begin_write(
                request_url,
                200,
                Some("video/mp2t"),
                Some(8),
                OnlineVodCachePolicy::Segment,
                100,
                None,
            )
            .expect("start cache write")
            .expect("cache write should be accepted");
        writer.write_chunk(b"mock").expect("write partial chunk");
        drop(writer);

        assert!(
            cache
                .get(request_url, 101)
                .expect("read incomplete cache entry")
                .is_none()
        );
    }
}
