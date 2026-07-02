use std::collections::BTreeMap;

use anyhow::Result;
use moontv_storage::sqlite::DesktopSqlite;
use serde::{Deserialize, Serialize, de::DeserializeOwned};

pub type PlayRecordMap = BTreeMap<String, PlayRecord>;
pub type FavoriteMap = BTreeMap<String, Favorite>;
pub type FollowRecordMap = BTreeMap<String, FollowRecord>;
pub type SkipConfigMap = BTreeMap<String, SkipConfig>;

const PLAY_RECORDS_DOMAIN_KEY: &str = "playrecords";
const FAVORITES_DOMAIN_KEY: &str = "favorites";
const FOLLOW_RECORDS_DOMAIN_KEY: &str = "follows";
const SEARCH_HISTORY_DOMAIN_KEY: &str = "searchhistory";
const SKIP_CONFIGS_DOMAIN_KEY: &str = "skipconfigs";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct PlayRecord {
    pub title: String,
    pub source_name: String,
    pub year: String,
    pub cover: String,
    pub index: i64,
    pub total_episodes: i64,
    pub play_time: i64,
    pub total_time: i64,
    pub save_time: i64,
    pub search_title: Option<String>,
    pub playback_mode: Option<String>,
    pub offline_content_id: Option<String>,
    pub is_adult: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct Favorite {
    pub title: String,
    pub source_name: String,
    pub year: String,
    pub cover: String,
    pub total_episodes: i64,
    pub save_time: i64,
    pub search_title: Option<String>,
    pub playback_mode: Option<String>,
    pub offline_content_id: Option<String>,
    pub is_adult: Option<bool>,
    pub origin: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct FollowRecord {
    pub title: String,
    pub source_name: String,
    pub year: String,
    pub cover: String,
    pub search_title: Option<String>,
    pub followed_at: i64,
    pub followed_episode_count: i64,
    pub acknowledged_episode_count: i64,
    pub latest_episode_count: i64,
    pub last_checked_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct SkipConfig {
    pub enable: bool,
    pub intro_time: i64,
    pub outro_time: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct LocalProfileAccount {
    pub username: String,
    pub role: String,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct LocalProfileSnapshot {
    pub play_records: PlayRecordMap,
    pub favorites: FavoriteMap,
    pub follow_records: FollowRecordMap,
    pub search_history: Vec<String>,
    pub skip_configs: SkipConfigMap,
}

#[derive(Debug, Clone)]
pub struct LocalDesktopProfileStore {
    sqlite: DesktopSqlite,
}

impl LocalDesktopProfileStore {
    pub fn new(sqlite: DesktopSqlite) -> Self {
        Self { sqlite }
    }

    pub fn sqlite(&self) -> &DesktopSqlite {
        &self.sqlite
    }

    pub fn load_snapshot(&self, username: &str) -> Result<LocalProfileSnapshot> {
        Ok(LocalProfileSnapshot {
            play_records: self.load_play_records(username)?,
            favorites: self.load_favorites(username)?,
            follow_records: self.load_follow_records(username)?,
            search_history: self.load_search_history(username)?,
            skip_configs: self.load_skip_configs(username)?,
        })
    }

    pub fn load_play_records(&self, username: &str) -> Result<PlayRecordMap> {
        self.load_domain(username, PLAY_RECORDS_DOMAIN_KEY)
    }

    pub fn save_play_records(&self, username: &str, records: &PlayRecordMap) -> Result<()> {
        self.save_domain(username, PLAY_RECORDS_DOMAIN_KEY, records)
    }

    pub fn clear_play_records(&self, username: &str) -> Result<bool> {
        self.clear_domain(username, PLAY_RECORDS_DOMAIN_KEY)
    }

    pub fn load_favorites(&self, username: &str) -> Result<FavoriteMap> {
        self.load_domain(username, FAVORITES_DOMAIN_KEY)
    }

    pub fn save_favorites(&self, username: &str, favorites: &FavoriteMap) -> Result<()> {
        self.save_domain(username, FAVORITES_DOMAIN_KEY, favorites)
    }

    pub fn clear_favorites(&self, username: &str) -> Result<bool> {
        self.clear_domain(username, FAVORITES_DOMAIN_KEY)
    }

    pub fn load_follow_records(&self, username: &str) -> Result<FollowRecordMap> {
        self.load_domain(username, FOLLOW_RECORDS_DOMAIN_KEY)
    }

    pub fn save_follow_records(
        &self,
        username: &str,
        follow_records: &FollowRecordMap,
    ) -> Result<()> {
        self.save_domain(username, FOLLOW_RECORDS_DOMAIN_KEY, follow_records)
    }

    pub fn clear_follow_records(&self, username: &str) -> Result<bool> {
        self.clear_domain(username, FOLLOW_RECORDS_DOMAIN_KEY)
    }

    pub fn load_search_history(&self, username: &str) -> Result<Vec<String>> {
        self.load_domain(username, SEARCH_HISTORY_DOMAIN_KEY)
    }

    pub fn save_search_history(&self, username: &str, search_history: &[String]) -> Result<()> {
        self.save_domain(username, SEARCH_HISTORY_DOMAIN_KEY, search_history)
    }

    pub fn clear_search_history(&self, username: &str) -> Result<bool> {
        self.clear_domain(username, SEARCH_HISTORY_DOMAIN_KEY)
    }

    pub fn load_skip_configs(&self, username: &str) -> Result<SkipConfigMap> {
        self.load_domain(username, SKIP_CONFIGS_DOMAIN_KEY)
    }

    pub fn save_skip_configs(&self, username: &str, skip_configs: &SkipConfigMap) -> Result<()> {
        self.save_domain(username, SKIP_CONFIGS_DOMAIN_KEY, skip_configs)
    }

    pub fn clear_skip_configs(&self, username: &str) -> Result<bool> {
        self.clear_domain(username, SKIP_CONFIGS_DOMAIN_KEY)
    }

    fn load_domain<T>(&self, username: &str, domain: &str) -> Result<T>
    where
        T: DeserializeOwned + Default,
    {
        Ok(self
            .sqlite
            .read_app_metadata(&domain_metadata_key(username, domain))?
            .unwrap_or_default())
    }

    fn save_domain<T>(&self, username: &str, domain: &str, value: &T) -> Result<()>
    where
        T: Serialize + ?Sized,
    {
        self.sqlite
            .write_app_metadata(&domain_metadata_key(username, domain), value)
    }

    fn clear_domain(&self, username: &str, domain: &str) -> Result<bool> {
        self.sqlite
            .delete_app_metadata(&domain_metadata_key(username, domain))
    }
}

fn domain_metadata_key(username: &str, domain: &str) -> String {
    format!("profile:{username}:{domain}")
}

#[cfg(test)]
mod tests {
    use std::{
        env, fs,
        path::PathBuf,
        sync::atomic::{AtomicU64, Ordering},
    };

    use super::{
        Favorite, FavoriteMap, FollowRecord, FollowRecordMap, LocalDesktopProfileStore,
        PlayRecord, PlayRecordMap, SkipConfig, SkipConfigMap,
    };
    use moontv_storage::sqlite::DesktopSqlite;

    static TEST_COUNTER: AtomicU64 = AtomicU64::new(0);

    #[test]
    fn local_profile_store_round_trips_all_domains() {
        let temp_dir = TestDir::new();
        let sqlite =
            DesktopSqlite::initialize(temp_dir.path.join("desktop.sqlite3")).expect("sqlite");
        let store = LocalDesktopProfileStore::new(sqlite);

        store
            .save_play_records(
                "alice",
                &PlayRecordMap::from([(
                    "demo+1".to_string(),
                    PlayRecord {
                        title: "Demo".to_string(),
                        source_name: "Demo Source".to_string(),
                        year: "2026".to_string(),
                        cover: "cover.jpg".to_string(),
                        index: 1,
                        total_episodes: 12,
                        play_time: 30,
                        total_time: 60,
                        save_time: 1,
                        search_title: Some("Demo Search".to_string()),
                        playback_mode: Some("online".to_string()),
                        offline_content_id: None,
                        is_adult: Some(false),
                    },
                )]),
            )
            .expect("save play records");
        store
            .save_favorites(
                "alice",
                &FavoriteMap::from([(
                    "demo+1".to_string(),
                    Favorite {
                        title: "Demo".to_string(),
                        source_name: "Demo Source".to_string(),
                        year: "2026".to_string(),
                        cover: "cover.jpg".to_string(),
                        total_episodes: 12,
                        save_time: 2,
                        search_title: None,
                        playback_mode: Some("online".to_string()),
                        offline_content_id: None,
                        is_adult: Some(false),
                        origin: Some("vod".to_string()),
                    },
                )]),
            )
            .expect("save favorites");
        store
            .save_follow_records(
                "alice",
                &FollowRecordMap::from([(
                    "demo+1".to_string(),
                    FollowRecord {
                        title: "Demo".to_string(),
                        source_name: "Demo Source".to_string(),
                        year: "2026".to_string(),
                        cover: "cover.jpg".to_string(),
                        search_title: None,
                        followed_at: 1,
                        followed_episode_count: 1,
                        acknowledged_episode_count: 1,
                        latest_episode_count: 2,
                        last_checked_at: 3,
                    },
                )]),
            )
            .expect("save follow records");
        store
            .save_search_history(
                "alice",
                &["demo::movie".to_string(), "demo::series".to_string()],
            )
            .expect("save search history");
        store
            .save_skip_configs(
                "alice",
                &SkipConfigMap::from([(
                    "demo+1".to_string(),
                    SkipConfig {
                        enable: true,
                        intro_time: 12,
                        outro_time: 34,
                    },
                )]),
            )
            .expect("save skip configs");
        let snapshot = store.load_snapshot("alice").expect("load snapshot");

        assert_eq!(snapshot.play_records.len(), 1);
        assert_eq!(snapshot.favorites.len(), 1);
        assert_eq!(snapshot.follow_records.len(), 1);
        assert_eq!(
            snapshot.search_history,
            vec!["demo::movie".to_string(), "demo::series".to_string()]
        );
        assert_eq!(snapshot.skip_configs.len(), 1);
    }

    #[test]
    fn local_profile_store_isolates_user_domains() {
        let temp_dir = TestDir::new();
        let sqlite =
            DesktopSqlite::initialize(temp_dir.path.join("desktop.sqlite3")).expect("sqlite");
        let store = LocalDesktopProfileStore::new(sqlite);

        store
            .save_play_records(
                "alice",
                &PlayRecordMap::from([(
                    "demo+1".to_string(),
                    PlayRecord {
                        title: "Alice Demo".to_string(),
                        source_name: "Demo Source".to_string(),
                        year: "2026".to_string(),
                        cover: "cover.jpg".to_string(),
                        index: 1,
                        total_episodes: 12,
                        play_time: 30,
                        total_time: 60,
                        save_time: 1,
                        search_title: None,
                        playback_mode: None,
                        offline_content_id: None,
                        is_adult: None,
                    },
                )]),
            )
            .expect("save alice play records");
        store
            .save_play_records(
                "bob",
                &PlayRecordMap::from([(
                    "demo+1".to_string(),
                    PlayRecord {
                        title: "Bob Demo".to_string(),
                        source_name: "Demo Source".to_string(),
                        year: "2026".to_string(),
                        cover: "cover.jpg".to_string(),
                        index: 2,
                        total_episodes: 24,
                        play_time: 40,
                        total_time: 80,
                        save_time: 2,
                        search_title: None,
                        playback_mode: None,
                        offline_content_id: None,
                        is_adult: None,
                    },
                )]),
            )
            .expect("save bob play records");

        let alice_records = store
            .load_play_records("alice")
            .expect("load alice play records");
        let bob_records = store
            .load_play_records("bob")
            .expect("load bob play records");

        assert_eq!(
            alice_records
                .get("demo+1")
                .map(|record| record.title.as_str()),
            Some("Alice Demo")
        );
        assert_eq!(
            bob_records
                .get("demo+1")
                .map(|record| record.title.as_str()),
            Some("Bob Demo")
        );

        assert!(
            store
                .clear_play_records("alice")
                .expect("clear alice play records")
        );
        assert_eq!(
            store.load_play_records("alice").expect("reload alice"),
            PlayRecordMap::default()
        );
        assert_eq!(
            store
                .load_play_records("bob")
                .expect("reload bob")
                .get("demo+1")
                .map(|record| record.title.as_str()),
            Some("Bob Demo")
        );
    }

    struct TestDir {
        path: PathBuf,
    }

    impl TestDir {
        fn new() -> Self {
            let unique = TEST_COUNTER.fetch_add(1, Ordering::Relaxed);
            let path = env::temp_dir().join(format!("moontv-profile-test-{unique}"));
            fs::create_dir_all(&path).expect("create test dir");
            Self { path }
        }
    }

    impl Drop for TestDir {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.path);
        }
    }
}
