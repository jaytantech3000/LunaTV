use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    io,
    path::{Path, PathBuf},
};
use tokio::fs;

#[derive(Clone, Debug)]
pub struct Storage {
    cache_body_dir: PathBuf,
    cache_meta_dir: PathBuf,
    resource_index_dir: PathBuf,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CacheMetaRecord {
    pub content_type: String,
    pub created_at: u64,
    pub size_bytes: u64,
    pub status: u16,
    pub updated_at: u64,
    pub url: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ResourceIndexRecord {
    pub content_id: String,
    pub created_at: u64,
    pub episode_index: u32,
    pub id: String,
    pub owner_username: String,
    pub source: String,
    pub task_id: String,
    pub updated_at: u64,
    pub urls: Vec<String>,
    pub vod_id: String,
}

impl Storage {
    pub fn new(data_dir: impl AsRef<Path>) -> Self {
        let root = data_dir.as_ref().to_path_buf();
        Self {
            cache_body_dir: root.join("cache-body"),
            cache_meta_dir: root.join("cache-meta"),
            resource_index_dir: root.join("resource-index"),
        }
    }

    pub async fn ensure_dirs(&self) -> io::Result<()> {
        fs::create_dir_all(&self.cache_body_dir).await?;
        fs::create_dir_all(&self.cache_meta_dir).await?;
        fs::create_dir_all(&self.resource_index_dir).await?;
        Ok(())
    }

    pub async fn put_cached_download(
        &self,
        url: &str,
        status: u16,
        content_type: &str,
        body: &[u8],
        now_ms: u64,
    ) -> io::Result<CacheMetaRecord> {
        self.ensure_dirs().await?;

        let meta_path = self.cache_meta_path(url);
        let created_at = self
            .read_json::<CacheMetaRecord>(&meta_path)
            .await?
            .map(|record| record.created_at)
            .unwrap_or(now_ms);

        fs::write(self.cache_body_path(url), body).await?;

        let record = CacheMetaRecord {
            content_type: content_type.to_string(),
            created_at,
            size_bytes: body.len() as u64,
            status,
            updated_at: now_ms,
            url: url.to_string(),
        };

        self.write_json(meta_path, &record).await?;
        Ok(record)
    }

    pub async fn get_cached_download(
        &self,
        url: &str,
    ) -> io::Result<Option<(CacheMetaRecord, Vec<u8>)>> {
        let meta_path = self.cache_meta_path(url);
        let body_path = self.cache_body_path(url);
        let meta = match self.read_json::<CacheMetaRecord>(&meta_path).await? {
            Some(value) => value,
            None => return Ok(None),
        };

        let body = match fs::read(body_path).await {
            Ok(bytes) => bytes,
            Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(None),
            Err(error) => return Err(error),
        };

        Ok(Some((meta, body)))
    }

    pub async fn get_cached_download_meta(&self, url: &str) -> io::Result<Option<CacheMetaRecord>> {
        self.read_json(&self.cache_meta_path(url)).await
    }

    pub async fn delete_cached_download(&self, url: &str) -> io::Result<bool> {
        let deleted_body = remove_file_if_exists(&self.cache_body_path(url)).await?;
        let deleted_meta = remove_file_if_exists(&self.cache_meta_path(url)).await?;
        Ok(deleted_body || deleted_meta)
    }

    pub async fn clear_cached_downloads(&self) -> io::Result<()> {
        recreate_dir(&self.cache_body_dir).await?;
        recreate_dir(&self.cache_meta_dir).await
    }

    pub async fn put_resource_index(
        &self,
        record: &ResourceIndexRecord,
    ) -> io::Result<ResourceIndexRecord> {
        self.ensure_dirs().await?;
        let path = self.resource_index_path(&record.id);
        self.write_json(path, record).await?;
        Ok(record.clone())
    }

    pub async fn get_resource_index(&self, id: &str) -> io::Result<Option<ResourceIndexRecord>> {
        self.read_json(&self.resource_index_path(id)).await
    }

    pub async fn delete_resource_index(&self, id: &str) -> io::Result<bool> {
        remove_file_if_exists(&self.resource_index_path(id)).await
    }

    pub async fn clear_resource_indexes(&self) -> io::Result<()> {
        recreate_dir(&self.resource_index_dir).await
    }

    fn cache_body_path(&self, url: &str) -> PathBuf {
        self.cache_body_dir.join(format!("{}.bin", digest_key(url)))
    }

    fn cache_meta_path(&self, url: &str) -> PathBuf {
        self.cache_meta_dir
            .join(format!("{}.json", digest_key(url)))
    }

    fn resource_index_path(&self, id: &str) -> PathBuf {
        self.resource_index_dir
            .join(format!("{}.json", digest_key(id)))
    }

    async fn read_json<T>(&self, path: &Path) -> io::Result<Option<T>>
    where
        T: for<'de> Deserialize<'de>,
    {
        let content = match fs::read_to_string(path).await {
            Ok(value) => value,
            Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(None),
            Err(error) => return Err(error),
        };

        serde_json::from_str(&content)
            .map(Some)
            .map_err(|error| io::Error::new(io::ErrorKind::InvalidData, error))
    }

    async fn write_json<T>(&self, path: PathBuf, value: &T) -> io::Result<()>
    where
        T: Serialize,
    {
        let bytes = serde_json::to_vec(value)
            .map_err(|error| io::Error::new(io::ErrorKind::InvalidData, error))?;
        fs::write(path, bytes).await
    }
}

async fn recreate_dir(path: &Path) -> io::Result<()> {
    match fs::remove_dir_all(path).await {
        Ok(()) => {}
        Err(error) if error.kind() == io::ErrorKind::NotFound => {}
        Err(error) => return Err(error),
    }

    fs::create_dir_all(path).await
}

async fn remove_file_if_exists(path: &Path) -> io::Result<bool> {
    match fs::remove_file(path).await {
        Ok(()) => Ok(true),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(false),
        Err(error) => Err(error),
    }
}

fn digest_key(value: &str) -> String {
    let mut digest = Sha256::new();
    digest.update(value.as_bytes());
    hex::encode(digest.finalize())
}
