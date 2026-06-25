use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

pub const MIN_CONCURRENT_DOWNLOAD_TASKS: u8 = 1;
pub const MAX_CONCURRENT_DOWNLOAD_TASKS: u8 = 5;
pub const DEFAULT_CONCURRENT_DOWNLOAD_TASKS: u8 = 3;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum DesktopDownloadTaskStatus {
    Queued,
    Downloading,
    Paused,
    Done,
    Error,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum DesktopDownloadCommand {
    Pause,
    Resume,
    Cancel,
    Delete,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum DesktopDownloadTaskRemovedReason {
    Cancelled,
    Deleted,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", tag = "type")]
pub enum DesktopDownloadEngineEvent {
    TaskUpserted {
        task_id: String,
        status: DesktopDownloadTaskStatus,
    },
    TaskStatusChanged {
        task_id: String,
        status: DesktopDownloadTaskStatus,
        command: DesktopDownloadCommand,
    },
    TaskRemoved {
        task_id: String,
        reason: DesktopDownloadTaskRemovedReason,
    },
    MaxConcurrentTasksChanged {
        max_concurrent_tasks: u8,
    },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopDownloadTask {
    pub id: String,
    pub content_id: String,
    pub source: String,
    pub source_name: String,
    pub vod_id: String,
    pub episode_index: u32,
    pub title: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub search_title: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub search_type: Option<String>,
    pub poster: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub remarks: Option<String>,
    pub year: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub desc: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub type_name: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub douban_id: Option<i64>,
    pub episode_title: String,
    pub original_m3u8_url: String,
    pub entry_manifest_url: String,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub manifest_candidate_urls: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub playback_manifest_url: Option<String>,
    pub cache_index_id: String,
    pub status: DesktopDownloadTaskStatus,
    pub progress: u8,
    pub total_resources: u32,
    pub downloaded_resources: u32,
    pub size_bytes: u64,
    pub current_size_bytes: u64,
    pub estimated_total_size_bytes: u64,
    pub download_speed_bytes_per_second: u64,
    pub created_at: u64,
    pub updated_at: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error_message: Option<String>,
}

impl DesktopDownloadTask {
    pub fn validate(&self) -> Result<(), String> {
        require_non_empty("id", &self.id)?;
        require_non_empty("contentId", &self.content_id)?;
        require_non_empty("source", &self.source)?;
        require_non_empty("sourceName", &self.source_name)?;
        require_non_empty("vodId", &self.vod_id)?;
        require_non_empty("title", &self.title)?;
        require_non_empty("poster", &self.poster)?;
        require_non_empty("year", &self.year)?;
        require_non_empty("episodeTitle", &self.episode_title)?;
        require_non_empty("originalM3u8Url", &self.original_m3u8_url)?;
        require_non_empty("entryManifestUrl", &self.entry_manifest_url)?;
        require_non_empty("cacheIndexId", &self.cache_index_id)?;
        Ok(())
    }

    fn normalize(self) -> Self {
        let progress = self.progress.min(100);
        let normalized_total_resources = self.total_resources.max(self.downloaded_resources);
        let normalized_downloaded_resources =
            self.downloaded_resources.min(normalized_total_resources);
        let normalized_size_bytes = self.size_bytes.min(self.current_size_bytes);
        let normalized_current_size_bytes = self.current_size_bytes.max(self.size_bytes);
        let normalized_estimated_total_size_bytes = self
            .estimated_total_size_bytes
            .max(normalized_current_size_bytes);

        Self {
            id: normalize_required_text(self.id),
            content_id: normalize_required_text(self.content_id),
            source: normalize_required_text(self.source),
            source_name: normalize_required_text(self.source_name),
            vod_id: normalize_required_text(self.vod_id),
            episode_index: self.episode_index,
            title: normalize_required_text(self.title),
            search_title: normalize_optional_text(self.search_title),
            search_type: normalize_optional_text(self.search_type),
            poster: normalize_required_text(self.poster),
            remarks: normalize_optional_text(self.remarks),
            year: normalize_required_text(self.year),
            desc: normalize_optional_text(self.desc),
            type_name: normalize_optional_text(self.type_name),
            douban_id: self.douban_id.filter(|value| *value > 0),
            episode_title: normalize_required_text(self.episode_title),
            original_m3u8_url: normalize_required_text(self.original_m3u8_url),
            entry_manifest_url: normalize_required_text(self.entry_manifest_url),
            manifest_candidate_urls: normalize_text_list(self.manifest_candidate_urls),
            playback_manifest_url: normalize_optional_text(self.playback_manifest_url),
            cache_index_id: normalize_required_text(self.cache_index_id),
            status: self.status,
            progress,
            total_resources: normalized_total_resources,
            downloaded_resources: normalized_downloaded_resources,
            size_bytes: normalized_size_bytes,
            current_size_bytes: normalized_current_size_bytes,
            estimated_total_size_bytes: normalized_estimated_total_size_bytes,
            download_speed_bytes_per_second: self.download_speed_bytes_per_second,
            created_at: self.created_at,
            updated_at: self.updated_at.max(self.created_at),
            error_message: normalize_optional_text(self.error_message),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopDownloadEngineSettingsUpdate {
    pub max_concurrent_tasks: u8,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopDownloadEngineSnapshot {
    pub max_concurrent_tasks: u8,
    #[serde(default)]
    pub tasks: BTreeMap<String, DesktopDownloadTask>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_event: Option<DesktopDownloadEngineEvent>,
}

impl Default for DesktopDownloadEngineSnapshot {
    fn default() -> Self {
        Self {
            max_concurrent_tasks: DEFAULT_CONCURRENT_DOWNLOAD_TASKS,
            tasks: BTreeMap::new(),
            last_event: None,
        }
    }
}

#[derive(Debug, Clone, Default)]
pub struct DesktopDownloadEngine {
    snapshot: DesktopDownloadEngineSnapshot,
}

impl DesktopDownloadEngine {
    pub fn new() -> Self {
        Self::from_snapshot(DesktopDownloadEngineSnapshot::default())
    }

    pub fn from_snapshot(snapshot: DesktopDownloadEngineSnapshot) -> Self {
        let tasks = snapshot
            .tasks
            .into_iter()
            .map(|(task_id, task)| {
                let mut normalized_task = task.normalize();
                if normalized_task.status == DesktopDownloadTaskStatus::Downloading {
                    normalized_task.status = DesktopDownloadTaskStatus::Paused;
                }
                (task_id, normalized_task)
            })
            .collect();

        Self {
            snapshot: DesktopDownloadEngineSnapshot {
                max_concurrent_tasks: normalize_concurrent_download_tasks(
                    snapshot.max_concurrent_tasks,
                ),
                tasks,
                last_event: snapshot.last_event,
            },
        }
    }

    pub fn snapshot(&self) -> DesktopDownloadEngineSnapshot {
        self.snapshot.clone()
    }

    pub fn update_settings(
        &mut self,
        settings: DesktopDownloadEngineSettingsUpdate,
    ) -> &DesktopDownloadEngineSnapshot {
        let max_concurrent_tasks =
            normalize_concurrent_download_tasks(settings.max_concurrent_tasks);
        self.snapshot.max_concurrent_tasks = max_concurrent_tasks;
        self.snapshot.last_event = Some(DesktopDownloadEngineEvent::MaxConcurrentTasksChanged {
            max_concurrent_tasks,
        });
        &self.snapshot
    }

    pub fn upsert_task(
        &mut self,
        task: DesktopDownloadTask,
    ) -> Result<&DesktopDownloadEngineSnapshot, String> {
        task.validate()?;
        let normalized_task = task.normalize();
        let task_id = normalized_task.id.clone();
        let status = normalized_task.status;
        self.snapshot.tasks.insert(task_id.clone(), normalized_task);
        self.snapshot.last_event =
            Some(DesktopDownloadEngineEvent::TaskUpserted { task_id, status });
        Ok(&self.snapshot)
    }

    pub fn pause_task(&mut self, task_id: &str) -> Option<&DesktopDownloadEngineSnapshot> {
        let next_status = {
            let task = self.snapshot.tasks.get_mut(task_id)?;
            if matches!(
                task.status,
                DesktopDownloadTaskStatus::Queued | DesktopDownloadTaskStatus::Downloading
            ) {
                task.status = DesktopDownloadTaskStatus::Paused;
            }
            task.status
        };

        self.snapshot.last_event = Some(DesktopDownloadEngineEvent::TaskStatusChanged {
            task_id: task_id.to_string(),
            status: next_status,
            command: DesktopDownloadCommand::Pause,
        });
        Some(&self.snapshot)
    }

    pub fn resume_task(&mut self, task_id: &str) -> Option<&DesktopDownloadEngineSnapshot> {
        let next_status = {
            let task = self.snapshot.tasks.get_mut(task_id)?;
            if matches!(
                task.status,
                DesktopDownloadTaskStatus::Paused | DesktopDownloadTaskStatus::Error
            ) {
                task.status = DesktopDownloadTaskStatus::Queued;
            }
            task.status
        };

        self.snapshot.last_event = Some(DesktopDownloadEngineEvent::TaskStatusChanged {
            task_id: task_id.to_string(),
            status: next_status,
            command: DesktopDownloadCommand::Resume,
        });
        Some(&self.snapshot)
    }

    pub fn cancel_task(&mut self, task_id: &str) -> Option<DesktopDownloadTask> {
        let removed_task = self.snapshot.tasks.remove(task_id)?;
        self.snapshot.last_event = Some(DesktopDownloadEngineEvent::TaskRemoved {
            task_id: task_id.to_string(),
            reason: DesktopDownloadTaskRemovedReason::Cancelled,
        });
        Some(removed_task)
    }

    pub fn delete_task(&mut self, task_id: &str) -> Option<DesktopDownloadTask> {
        let removed_task = self.snapshot.tasks.remove(task_id)?;
        self.snapshot.last_event = Some(DesktopDownloadEngineEvent::TaskRemoved {
            task_id: task_id.to_string(),
            reason: DesktopDownloadTaskRemovedReason::Deleted,
        });
        Some(removed_task)
    }

    pub fn clear_tasks(&mut self) -> &DesktopDownloadEngineSnapshot {
        self.snapshot.tasks.clear();
        self.snapshot.last_event = None;
        &self.snapshot
    }
}

pub fn normalize_concurrent_download_tasks(value: u8) -> u8 {
    value.clamp(MIN_CONCURRENT_DOWNLOAD_TASKS, MAX_CONCURRENT_DOWNLOAD_TASKS)
}

fn require_non_empty(name: &str, value: &str) -> Result<(), String> {
    if value.trim().is_empty() {
        return Err(format!("missing desktop download task {name}"));
    }

    Ok(())
}

fn normalize_required_text(value: String) -> String {
    value.trim().to_string()
}

fn normalize_optional_text(value: Option<String>) -> Option<String> {
    value.and_then(|next| {
        let normalized = next.trim();
        if normalized.is_empty() {
            return None;
        }
        Some(normalized.to_string())
    })
}

fn normalize_text_list(values: Vec<String>) -> Vec<String> {
    let mut normalized_values = Vec::new();

    for value in values {
        let normalized = value.trim();
        if normalized.is_empty() {
            continue;
        }

        if normalized_values
            .iter()
            .any(|existing: &String| existing == normalized)
        {
            continue;
        }

        normalized_values.push(normalized.to_string());
    }

    normalized_values
}

#[cfg(test)]
mod tests {
    use super::*;

    fn build_task(status: DesktopDownloadTaskStatus) -> DesktopDownloadTask {
        DesktopDownloadTask {
            id: "task:demo:1".to_string(),
            content_id: "demo:1".to_string(),
            source: "demo".to_string(),
            source_name: "Demo Source".to_string(),
            vod_id: "1".to_string(),
            episode_index: 0,
            title: "Demo Title".to_string(),
            search_title: Some("Demo Search".to_string()),
            search_type: Some("tv".to_string()),
            poster: "https://img.example.com/demo.jpg".to_string(),
            remarks: Some("Demo remarks".to_string()),
            year: "2026".to_string(),
            desc: Some("Demo description".to_string()),
            type_name: Some("tv".to_string()),
            douban_id: Some(1001),
            episode_title: "第1集".to_string(),
            original_m3u8_url: "https://example.com/root.m3u8".to_string(),
            entry_manifest_url: "https://example.com/root.m3u8".to_string(),
            manifest_candidate_urls: vec![
                "https://example.com/root.m3u8".to_string(),
                "https://example.com/root.m3u8".to_string(),
                "   ".to_string(),
            ],
            playback_manifest_url: Some("https://example.com/playback.m3u8".to_string()),
            cache_index_id: "cache:demo:1".to_string(),
            status,
            progress: 120,
            total_resources: 4,
            downloaded_resources: 2,
            size_bytes: 100,
            current_size_bytes: 150,
            estimated_total_size_bytes: 120,
            download_speed_bytes_per_second: 2048,
            created_at: 10,
            updated_at: 9,
            error_message: Some("".to_string()),
        }
    }

    #[test]
    fn restore_snapshot_pauses_in_progress_downloads_and_normalizes_fields() {
        let mut tasks = BTreeMap::new();
        tasks.insert(
            "task:demo:1".to_string(),
            build_task(DesktopDownloadTaskStatus::Downloading),
        );
        let engine = DesktopDownloadEngine::from_snapshot(DesktopDownloadEngineSnapshot {
            max_concurrent_tasks: 99,
            tasks,
            last_event: None,
        });

        let snapshot = engine.snapshot();
        let task = snapshot
            .tasks
            .get("task:demo:1")
            .expect("task should exist");

        assert_eq!(snapshot.max_concurrent_tasks, MAX_CONCURRENT_DOWNLOAD_TASKS);
        assert_eq!(task.status, DesktopDownloadTaskStatus::Paused);
        assert_eq!(task.progress, 100);
        assert_eq!(task.manifest_candidate_urls.len(), 1);
        assert_eq!(task.updated_at, 10);
        assert_eq!(task.error_message, None);
    }

    #[test]
    fn commands_emit_events_and_update_queue_snapshot() {
        let mut engine = DesktopDownloadEngine::new();
        let task = build_task(DesktopDownloadTaskStatus::Queued);

        engine.upsert_task(task).expect("task should upsert");
        assert_eq!(
            engine.snapshot().last_event,
            Some(DesktopDownloadEngineEvent::TaskUpserted {
                task_id: "task:demo:1".to_string(),
                status: DesktopDownloadTaskStatus::Queued,
            })
        );

        engine.pause_task("task:demo:1").expect("task should pause");
        assert_eq!(
            engine
                .snapshot()
                .tasks
                .get("task:demo:1")
                .expect("task should exist")
                .status,
            DesktopDownloadTaskStatus::Paused
        );

        engine
            .resume_task("task:demo:1")
            .expect("task should resume");
        assert_eq!(
            engine
                .snapshot()
                .tasks
                .get("task:demo:1")
                .expect("task should exist")
                .status,
            DesktopDownloadTaskStatus::Queued
        );

        engine
            .cancel_task("task:demo:1")
            .expect("task should cancel");
        assert!(engine.snapshot().tasks.is_empty());
        assert_eq!(
            engine.snapshot().last_event,
            Some(DesktopDownloadEngineEvent::TaskRemoved {
                task_id: "task:demo:1".to_string(),
                reason: DesktopDownloadTaskRemovedReason::Cancelled,
            })
        );
    }

    #[test]
    fn settings_update_clamps_max_concurrent_tasks() {
        let mut engine = DesktopDownloadEngine::new();

        engine.update_settings(DesktopDownloadEngineSettingsUpdate {
            max_concurrent_tasks: 0,
        });
        assert_eq!(
            engine.snapshot().max_concurrent_tasks,
            MIN_CONCURRENT_DOWNLOAD_TASKS
        );

        engine.update_settings(DesktopDownloadEngineSettingsUpdate {
            max_concurrent_tasks: 9,
        });
        assert_eq!(
            engine.snapshot().max_concurrent_tasks,
            MAX_CONCURRENT_DOWNLOAD_TASKS
        );
    }

    #[test]
    fn clear_tasks_removes_tasks_without_resetting_settings() {
        let mut engine = DesktopDownloadEngine::new();

        engine.update_settings(DesktopDownloadEngineSettingsUpdate {
            max_concurrent_tasks: 5,
        });
        engine
            .upsert_task(build_task(DesktopDownloadTaskStatus::Queued))
            .expect("task should upsert");

        let snapshot = engine.clear_tasks().clone();

        assert_eq!(snapshot.max_concurrent_tasks, 5);
        assert!(snapshot.tasks.is_empty());
        assert_eq!(snapshot.last_event, None);
    }
}
