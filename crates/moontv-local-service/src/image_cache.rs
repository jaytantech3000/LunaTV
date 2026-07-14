use std::{
    fs, io,
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
    time::SystemTime,
};

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

const IMAGE_CACHE_DIR_NAME: &str = "image-cache";
const IMAGE_CACHE_MAX_BYTES: u64 = 100 * 1024 * 1024;

#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize)]
pub(crate) struct CachedImage {
    pub(crate) content_type: String,
    pub(crate) body: Vec<u8>,
}

#[derive(Clone, Debug)]
pub(crate) struct ImageCache {
    root: PathBuf,
    max_bytes: u64,
    access_lock: Arc<Mutex<()>>,
}

#[derive(Debug, Deserialize, Serialize)]
struct ImageCacheMeta {
    content_type: String,
    body_len: usize,
}

impl ImageCache {
    pub(crate) fn new(data_dir: &Path) -> io::Result<Self> {
        let root = data_dir.join(IMAGE_CACHE_DIR_NAME);
        fs::create_dir_all(&root)?;
        Ok(Self {
            root,
            max_bytes: IMAGE_CACHE_MAX_BYTES,
            access_lock: Arc::new(Mutex::new(())),
        })
    }

    pub(crate) fn get(&self, url: &str) -> io::Result<Option<CachedImage>> {
        let _access_lock = self
            .access_lock
            .lock()
            .map_err(|_| io::Error::other("image cache access lock poisoned"))?;
        let key = cache_key(url);
        let body_path = self.root.join(format!("{key}.body"));
        let meta_path = self.root.join(format!("{key}.meta.json"));

        let (body, meta) = match (fs::read(&body_path), fs::read(&meta_path)) {
            (Ok(body), Ok(meta_bytes)) => {
                match serde_json::from_slice::<ImageCacheMeta>(&meta_bytes) {
                    Ok(meta) if meta.body_len == body.len() => (body, meta),
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

        Ok(Some(CachedImage {
            content_type: meta.content_type,
            body,
        }))
    }

    pub(crate) fn store(&self, url: &str, image: &CachedImage) -> io::Result<()> {
        let _access_lock = self
            .access_lock
            .lock()
            .map_err(|_| io::Error::other("image cache access lock poisoned"))?;
        let key = cache_key(url);
        let body_path = self.root.join(format!("{key}.body"));
        let meta_path = self.root.join(format!("{key}.meta.json"));
        self.evict_to_fit(image.body.len() as u64, &body_path)?;
        let meta = serde_json::to_vec(&ImageCacheMeta {
            content_type: image.content_type.clone(),
            body_len: image.body.len(),
        })
        .expect("image cache metadata serializes");

        atomic_write(&body_path, &image.body)?;
        if let Err(error) = atomic_write(&meta_path, &meta) {
            let _ = fs::remove_file(&body_path);
            return Err(error);
        }
        Ok(())
    }

    fn remove_entry(&self, body_path: &Path, meta_path: &Path) {
        let _ = fs::remove_file(body_path);
        let _ = fs::remove_file(meta_path);
    }

    fn evict_to_fit(&self, incoming_bytes: u64, preserve_body_path: &Path) -> io::Result<()> {
        if incoming_bytes > self.max_bytes {
            return Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                "image exceeds cache byte limit",
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
            let metadata = entry.metadata()?;
            let body_len = metadata.len();
            let modified_at = metadata.modified().unwrap_or(SystemTime::UNIX_EPOCH);
            let Some(key) = body_path.file_stem().and_then(|key| key.to_str()) else {
                continue;
            };
            entries.push((
                modified_at,
                body_len,
                body_path.clone(),
                self.root.join(format!("{key}.meta.json")),
            ));
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
        entries.sort_by_key(|(modified_at, _, _, _)| *modified_at);
        for (_, body_len, body_path, meta_path) in entries {
            if total_bytes.saturating_add(incoming_bytes) <= self.max_bytes {
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
}

fn cache_key(url: &str) -> String {
    format!("{:x}", Sha256::digest(url.as_bytes()))
}

fn atomic_write(path: &Path, bytes: &[u8]) -> io::Result<()> {
    let tmp_path = path.with_extension(format!("tmp-{}", std::process::id()));
    fs::write(&tmp_path, bytes)?;
    if let Err(error) = fs::rename(&tmp_path, path) {
        let _ = fs::remove_file(&tmp_path);
        return Err(error);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{CachedImage, ImageCache};
    use std::{
        env, fs,
        path::PathBuf,
        sync::{
            Arc, Barrier,
            atomic::{AtomicBool, AtomicU64, Ordering},
        },
        thread,
    };

    static NEXT_TEST_DIR_ID: AtomicU64 = AtomicU64::new(0);

    struct TestDir {
        path: PathBuf,
    }

    impl TestDir {
        fn new() -> Self {
            let id = NEXT_TEST_DIR_ID.fetch_add(1, Ordering::Relaxed);
            let path = env::temp_dir().join(format!(
                "moontv-image-cache-test-{}-{id}",
                std::process::id()
            ));
            fs::create_dir_all(&path).expect("create temporary cache test directory");
            Self { path }
        }
    }

    impl Drop for TestDir {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.path);
        }
    }

    #[test]
    fn cache_persists_an_image_under_the_data_directory() {
        let temp_dir = TestDir::new();
        let url = "https://img1.doubanio.com/view/photo/raw/public/p1.jpg";
        let image = CachedImage {
            content_type: "image/jpeg".to_string(),
            body: vec![1, 2, 3, 4],
        };

        let cache = ImageCache::new(&temp_dir.path).expect("create image cache");
        cache.store(url, &image).expect("store cached image");

        let reopened_cache = ImageCache::new(&temp_dir.path).expect("reopen image cache");
        assert_eq!(
            reopened_cache.get(url).expect("read cached image"),
            Some(image)
        );
    }

    #[test]
    fn cache_evicts_oldest_entries_to_stay_within_its_byte_budget() {
        let temp_dir = TestDir::new();
        let mut cache = ImageCache::new(&temp_dir.path).expect("create image cache");
        cache.max_bytes = 6;
        let image = CachedImage {
            content_type: "image/jpeg".to_string(),
            body: vec![1, 2, 3, 4],
        };

        cache
            .store("https://img1.doubanio.com/first.jpg", &image)
            .expect("store first cached image");
        cache
            .store("https://img1.doubanio.com/second.jpg", &image)
            .expect("store second cached image");

        assert_eq!(
            cache
                .get("https://img1.doubanio.com/first.jpg")
                .expect("read evicted image"),
            None
        );
        assert_eq!(
            cache
                .get("https://img1.doubanio.com/second.jpg")
                .expect("read retained image"),
            Some(image)
        );
    }

    #[test]
    fn concurrent_readers_never_observe_a_partially_replaced_entry() {
        let temp_dir = TestDir::new();
        let cache = Arc::new(ImageCache::new(&temp_dir.path).expect("create image cache"));
        let url = "https://img1.doubanio.com/concurrent.jpg";
        let jpeg = CachedImage {
            content_type: "image/jpeg".to_string(),
            body: vec![1; 1024],
        };
        let png = CachedImage {
            content_type: "image/png".to_string(),
            body: vec![2; 1024],
        };
        cache.store(url, &jpeg).expect("seed image cache");

        let start = Arc::new(Barrier::new(10));
        let observed_partial_entry = Arc::new(AtomicBool::new(false));
        let mut workers = Vec::new();

        for image in [jpeg.clone(), png.clone()] {
            let cache = cache.clone();
            let start = start.clone();
            let url = url.to_string();
            workers.push(thread::spawn(move || {
                start.wait();
                for _ in 0..2_000 {
                    cache.store(&url, &image).expect("concurrent cache store");
                }
            }));
        }

        for _ in 0..8 {
            let cache = cache.clone();
            let start = start.clone();
            let observed_partial_entry = observed_partial_entry.clone();
            let url = url.to_string();
            let jpeg = jpeg.clone();
            let png = png.clone();
            workers.push(thread::spawn(move || {
                start.wait();
                for _ in 0..2_000 {
                    match cache.get(&url).expect("concurrent cache read") {
                        Some(image) if image == jpeg || image == png => {}
                        Some(_) | None => {
                            observed_partial_entry.store(true, Ordering::Relaxed);
                            return;
                        }
                    }
                }
            }));
        }

        for worker in workers {
            worker.join().expect("cache worker did not panic");
        }

        assert!(
            !observed_partial_entry.load(Ordering::Relaxed),
            "a reader observed a missing or mismatched body/metadata pair while replacement was in progress"
        );
    }

    #[test]
    fn concurrent_eviction_never_exposes_a_partially_removed_entry() {
        let temp_dir = TestDir::new();
        let mut cache = ImageCache::new(&temp_dir.path).expect("create image cache");
        cache.max_bytes = 2 * 1024;
        let cache = Arc::new(cache);
        let url = "https://img1.doubanio.com/evicted.jpg";
        let retained = CachedImage {
            content_type: "image/jpeg".to_string(),
            body: vec![3; 1024],
        };
        let replacing = CachedImage {
            content_type: "image/png".to_string(),
            body: vec![4; 1024],
        };
        cache.store(url, &retained).expect("seed cache entry");

        let start = Arc::new(Barrier::new(10));
        let observed_partial_entry = Arc::new(AtomicBool::new(false));
        let mut workers = Vec::new();
        for _ in 0..2 {
            let cache = cache.clone();
            let start = start.clone();
            let replacing = replacing.clone();
            workers.push(thread::spawn(move || {
                start.wait();
                for index in 0..500 {
                    cache
                        .store(
                            &format!("https://img1.doubanio.com/filler-{index}.jpg"),
                            &replacing,
                        )
                        .expect("store filler cache entry");
                }
            }));
        }
        for _ in 0..8 {
            let cache = cache.clone();
            let start = start.clone();
            let observed_partial_entry = observed_partial_entry.clone();
            let url = url.to_string();
            let retained = retained.clone();
            workers.push(thread::spawn(move || {
                start.wait();
                for _ in 0..500 {
                    match cache.get(&url).expect("concurrent evicting cache read") {
                        Some(image) if image == retained => {}
                        None => {}
                        Some(_) => {
                            observed_partial_entry.store(true, Ordering::Relaxed);
                            return;
                        }
                    }
                }
            }));
        }

        for worker in workers {
            worker.join().expect("cache worker did not panic");
        }
        assert!(
            !observed_partial_entry.load(Ordering::Relaxed),
            "a reader observed mixed body and metadata while eviction was in progress"
        );
    }
}
