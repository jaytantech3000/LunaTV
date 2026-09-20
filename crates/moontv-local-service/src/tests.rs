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

    #[test]
    fn rejects_unsafe_vod_upstream_urls() {
        // 拒绝云元数据 / 链路本地 / 非 http(s)，阻断借代理进行的 SSRF。
        assert!(is_unsafe_vod_upstream_url(
            &Url::parse("http://169.254.169.254/latest/meta-data/").unwrap()
        ));
        assert!(is_unsafe_vod_upstream_url(
            &Url::parse("http://0.0.0.0/x.m3u8").unwrap()
        ));
        assert!(is_unsafe_vod_upstream_url(
            &Url::parse("file:///etc/passwd").unwrap()
        ));
        assert!(is_unsafe_vod_upstream_url(
            &Url::parse("ftp://example.com/x.ts").unwrap()
        ));
        // 回环 / 私网 / 公网域名继续放行：自建 LAN 源与本地测试 mock 依赖它们。
        assert!(!is_unsafe_vod_upstream_url(
            &Url::parse("http://127.0.0.1:18080/mock/index.m3u8").unwrap()
        ));
        assert!(!is_unsafe_vod_upstream_url(
            &Url::parse("http://192.168.1.50/index.m3u8").unwrap()
        ));
        assert!(!is_unsafe_vod_upstream_url(
            &Url::parse("https://cdn.example.com/index.m3u8").unwrap()
        ));
    }

    fn empty_remote_profile_snapshot() -> Value {
        json!({
            "playRecords": {},
            "favorites": {},
            "follows": {},
            "searchHistory": [],
            "skipConfigs": {}
        })
    }

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
            Some(&Value::Number(3.into()))
        );
        assert_eq!(
            payload.get("sqlite_migration_count"),
            Some(&Value::Number(3.into()))
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

    #[test]
    fn legacy_admin_persistence_is_migrated_and_sqlite_remains_authoritative() {
        let temp_dir = TestDir::new();
        let config_path = write_test_config(
            &temp_dir,
            json!({
                "auth": {
                    "username": "owner",
                    "password": "owner-secret"
                }
            }),
        );
        let legacy_path = write_test_admin_persistence(
            &temp_dir,
            json!({
                "config": {
                    "SiteConfig": {
                        "SiteName": "SQLite LunaTV"
                    },
                    "UserConfig": {
                        "Users": [
                            {
                                "username": "owner",
                                "role": "owner"
                            }
                        ]
                    }
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

        assert!(!legacy_path.exists());
        assert!(
            state
                .sqlite
                .read_app_metadata::<DesktopAdminPersistence>(ADMIN_PERSISTENCE_METADATA_KEY)
                .expect("read sqlite admin persistence")
                .is_some()
        );

        write_test_admin_persistence(
            &temp_dir,
            json!({
                "config": {
                    "SiteConfig": {
                        "SiteName": "Stale Legacy LunaTV"
                    }
                }
            }),
        );
        let persistence = state
            .load_admin_persistence()
            .expect("load sqlite admin persistence");

        assert!(!legacy_path.exists());
        assert_eq!(persistence.config.site_config.site_name, "SQLite LunaTV");
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
        assert_eq!(
            response
                .headers()
                .get(ACCESS_CONTROL_ALLOW_ORIGIN)
                .and_then(|value| value.to_str().ok()),
            Some("https://tauri.localhost")
        );
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
    async fn cors_allows_the_desktop_dev_frontend_origin() {
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
                    .header(ORIGIN, "http://127.0.0.1:3000")
                    .body(Body::empty())
                    .expect("desktop dev request"),
            )
            .await
            .expect("desktop dev response");

        assert_eq!(response.status(), StatusCode::OK);
        assert_eq!(
            response
                .headers()
                .get(ACCESS_CONTROL_ALLOW_ORIGIN)
                .and_then(|value| value.to_str().ok()),
            Some("http://127.0.0.1:3000")
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

        let unauthorized_prefetch = app
            .clone()
            .oneshot(
                Request::builder()
                    .uri("/api/vod-prefetch/session")
                    .body(Body::empty())
                    .expect("unauthorized VOD prefetch request"),
            )
            .await
            .expect("unauthorized VOD prefetch response");
        assert_eq!(unauthorized_prefetch.status(), StatusCode::UNAUTHORIZED);

        let unauthorized_download_runtime = app
            .clone()
            .oneshot(
                Request::builder()
                    .uri("/api/download-runtime/tasks")
                    .body(Body::empty())
                    .expect("unauthorized download runtime request"),
            )
            .await
            .expect("unauthorized download runtime response");
        assert_eq!(
            unauthorized_download_runtime.status(),
            StatusCode::UNAUTHORIZED
        );

        let authorized_download_runtime = app
            .clone()
            .oneshot(
                Request::builder()
                    .uri("/api/download-runtime/tasks")
                    .header("X-MoonTV-Local-Token", "test-access-token")
                    .body(Body::empty())
                    .expect("authorized download runtime request"),
            )
            .await
            .expect("authorized download runtime response");
        assert_eq!(authorized_download_runtime.status(), StatusCode::OK);

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
    async fn vod_prefetch_rejects_non_local_proxy_urls() {
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
                    .method(Method::POST)
                    .uri("/api/vod-prefetch/session")
                    .header(CONTENT_TYPE, "application/json")
                    .body(Body::from(
                        json!({
                          "sessionId": "vod-session",
                          "manifestUrl": "https://example.invalid/playlist.m3u8",
                          "windowMode": "30s"
                        })
                        .to_string(),
                    ))
                    .expect("VOD prefetch request"),
            )
            .await
            .expect("VOD prefetch response");

        assert_eq!(response.status(), StatusCode::BAD_REQUEST);
    }

    #[tokio::test]
    async fn configured_local_service_rejects_admin_requests_with_only_access_token() {
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
            .with_access_token("test-access-token".to_string())
            .with_admin_capability("test-admin-capability".to_string()),
        );

        for path in [
            "/api/admin/config",
            "/api/admin/profile-sync/onboarding/preview",
            "/api/admin/profile-sync/onboarding/execute",
        ] {
            let response = app
                .clone()
                .oneshot(
                    Request::builder()
                        .method(Method::POST)
                        .uri(path)
                        .header("X-MoonTV-Local-Token", "test-access-token")
                        .body(Body::empty())
                        .expect("access-token-only admin request"),
                )
                .await
                .expect("access-token-only admin response");

            assert_eq!(response.status(), StatusCode::UNAUTHORIZED, "{path}");

            let authorized = app
                .clone()
                .oneshot(
                    Request::builder()
                        .method(Method::POST)
                        .uri(path)
                        .header("X-MoonTV-Local-Token", "test-access-token")
                        .header("X-MoonTV-Admin-Capability", "test-admin-capability")
                        .body(Body::empty())
                        .expect("capability-authorized admin request"),
                )
                .await
                .expect("capability-authorized admin response");

            assert_ne!(authorized.status(), StatusCode::UNAUTHORIZED, "{path}");
        }
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
    async fn profile_outbox_worker_pushes_only_the_due_head_and_exposes_pending_status() {
        let requests = Arc::new(Mutex::new(Vec::<(Method, String, Value)>::new()));
        let captured_requests = requests.clone();
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
                    "/api/favorites",
                    post(move |request: axum::extract::Request| {
                        let captured_requests = captured_requests.clone();
                        async move {
                            let uri = request.uri().to_string();
                            let method = request.method().clone();
                            let body = to_bytes(request.into_body(), usize::MAX)
                                .await
                                .expect("read outbox request body");
                            captured_requests.lock().expect("capture requests").push((
                                method,
                                uri,
                                serde_json::from_slice(&body).expect("parse outbox request body"),
                            ));
                            Json(json!({ "success": true }))
                        }
                    }),
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
        let state = AppState::new(
            DEFAULT_HOST.to_string(),
            DEFAULT_PORT,
            config_path,
            temp_dir.path.join("data"),
            temp_dir.path.join("data/moontv.sqlite3"),
        );
        state.profile_sync_session.write().await.session = Some(ProfileSyncSession {
            username: "remote-user".to_string(),
            role: "user".to_string(),
        });
        let store = state.profile_store();
        let device_id = store.get_or_create_device_id().expect("device id");
        let favorite = Favorite {
            title: "Queued favorite".to_string(),
            source_name: "Demo".to_string(),
            year: "2026".to_string(),
            cover: "cover.jpg".to_string(),
            total_episodes: 1,
            save_time: 1,
            search_title: None,
            playback_mode: None,
            offline_content_id: None,
            is_adult: None,
            origin: None,
        };
        store
            .apply_local_mutation_and_enqueue(
                "remote-user",
                &device_id,
                moontv_profile::ProfileDomain::Favorites,
                &std::collections::BTreeMap::from([("demo+1".to_string(), favorite.clone())]),
                moontv_profile::ProfileMutation::Upsert {
                    entity_key: "demo+1".to_string(),
                    value: serde_json::to_value(&favorite).expect("serialize favorite"),
                },
            )
            .expect("enqueue favorite upsert");
        store
            .apply_local_mutation_and_enqueue(
                "remote-user",
                &device_id,
                moontv_profile::ProfileDomain::Favorites,
                &std::collections::BTreeMap::<String, Favorite>::new(),
                moontv_profile::ProfileMutation::Delete {
                    entity_key: "demo+1".to_string(),
                },
            )
            .expect("enqueue favorite delete");

        crate::profile_sync_worker::run_profile_outbox_worker_tick(&state).await;

        assert_eq!(store.pending_outbox_count("remote-user").unwrap(), 1);
        assert_eq!(requests.lock().expect("capture requests").len(), 1);
        assert_eq!(
            requests.lock().expect("capture requests")[0],
            (
                Method::POST,
                "/api/favorites".to_string(),
                json!({ "key": "demo+1", "favorite": favorite })
            )
        );

        let app = build_router(state.clone());
        let status = read_json_body(
            app.oneshot(
                Request::builder()
                    .uri("/api/profile-sync/status")
                    .body(Body::empty())
                    .expect("profile sync status request"),
            )
            .await
            .expect("profile sync status response"),
        )
        .await;
        assert_eq!(
            status.get("pendingOutboxCount").and_then(Value::as_u64),
            Some(1)
        );
        assert_eq!(
            status.get("reauthRequired").and_then(Value::as_bool),
            Some(false)
        );
        assert_eq!(status.get("lastOutboxError"), Some(&Value::Null));
        assert_eq!(status.get("nextOutboxAttemptAt"), Some(&Value::Null));

        upstream.abort();
    }

    #[tokio::test]
    async fn profile_sync_status_survives_sidecar_restart_with_latest_auth_blocked_profile() {
        let temp_dir = TestDir::new();
        let config_path = write_test_config(
            &temp_dir,
            json!({
              "profile_sync": { "api_base_url": "http://127.0.0.1:1" },
              "api_site": {}
            }),
        );
        let data_dir = temp_dir.path.join("data");
        let sqlite_path = data_dir.join("moontv.sqlite3");
        let before_restart = AppState::new(
            DEFAULT_HOST.to_string(),
            DEFAULT_PORT,
            config_path.clone(),
            data_dir.clone(),
            sqlite_path.clone(),
        );
        let store = before_restart.profile_store();
        let device_id = store.get_or_create_device_id().expect("device id");
        for (username, title) in [
            ("older-user", "Older queued favorite"),
            ("newer-user", "Newer queued favorite"),
        ] {
            let favorite = Favorite {
                title: title.to_string(),
                source_name: "Demo".to_string(),
                year: "2026".to_string(),
                cover: "cover.jpg".to_string(),
                total_episodes: 1,
                save_time: 1,
                search_title: None,
                playback_mode: None,
                offline_content_id: None,
                is_adult: None,
                origin: None,
            };
            store
                .apply_local_mutation_and_enqueue(
                    username,
                    &device_id,
                    moontv_profile::ProfileDomain::Favorites,
                    &std::collections::BTreeMap::from([("demo+1".to_string(), favorite.clone())]),
                    moontv_profile::ProfileMutation::Upsert {
                        entity_key: "demo+1".to_string(),
                        value: serde_json::to_value(favorite).expect("serialize favorite"),
                    },
                )
                .expect("enqueue favorite");
        }
        before_restart
            .sqlite
            .block_profile_sync_auth("older-user", 30, "older session expired")
            .expect("block older profile");
        before_restart
            .sqlite
            .block_profile_sync_auth("newer-user", 40, "newer session expired")
            .expect("block newer profile");
        drop(before_restart);

        let after_restart = AppState::new(
            DEFAULT_HOST.to_string(),
            DEFAULT_PORT,
            config_path,
            data_dir,
            sqlite_path,
        );
        assert!(
            after_restart
                .profile_sync_session
                .read()
                .await
                .session
                .is_none()
        );
        assert!(
            after_restart
                .profile_sync_last_username
                .read()
                .await
                .is_none()
        );

        let status = read_json_body(
            build_router(after_restart)
                .oneshot(
                    Request::builder()
                        .uri("/api/profile-sync/status")
                        .body(Body::empty())
                        .expect("profile sync status request"),
                )
                .await
                .expect("profile sync status response"),
        )
        .await;

        assert_eq!(
            status.get("pendingOutboxCount").and_then(Value::as_u64),
            Some(1)
        );
        assert_eq!(
            status.get("reauthRequired").and_then(Value::as_bool),
            Some(true)
        );
        assert_eq!(
            status.get("lastOutboxError").and_then(Value::as_str),
            Some("newer session expired")
        );
    }

    #[tokio::test]
    async fn profile_outbox_worker_blocks_auth_and_login_clears_the_block() {
        let favorite_attempts = Arc::new(AtomicU64::new(0));
        let next_favorite_attempt = favorite_attempts.clone();
        let upstream = spawn_mock_server(
            Router::new()
                .route(
                    "/api/favorites",
                    post(move || {
                        let next_favorite_attempt = next_favorite_attempt.clone();
                        async move {
                            if next_favorite_attempt.fetch_add(1, Ordering::Relaxed) == 0 {
                                StatusCode::UNAUTHORIZED
                            } else {
                                StatusCode::OK
                            }
                        }
                    }),
                )
                .route(
                    "/api/login",
                    post(|| async move {
                        Json(json!({
                            "ok": true,
                            "username": "remote-user",
                            "role": "user"
                        }))
                    }),
                ),
        )
        .await;
        let temp_dir = TestDir::new();
        let config_path = write_test_config(
            &temp_dir,
            json!({
              "profile_sync": { "api_base_url": upstream.base_url() },
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
        state.profile_sync_session.write().await.session = Some(ProfileSyncSession {
            username: "remote-user".to_string(),
            role: "user".to_string(),
        });
        let store = state.profile_store();
        let device_id = store.get_or_create_device_id().expect("device id");
        let favorite = Favorite {
            title: "Queued favorite".to_string(),
            source_name: "Demo".to_string(),
            year: "2026".to_string(),
            cover: "cover.jpg".to_string(),
            total_episodes: 1,
            save_time: 1,
            search_title: None,
            playback_mode: None,
            offline_content_id: None,
            is_adult: None,
            origin: None,
        };
        store
            .apply_local_mutation_and_enqueue(
                "remote-user",
                &device_id,
                moontv_profile::ProfileDomain::Favorites,
                &std::collections::BTreeMap::from([("demo+1".to_string(), favorite.clone())]),
                moontv_profile::ProfileMutation::Upsert {
                    entity_key: "demo+1".to_string(),
                    value: serde_json::to_value(favorite).expect("serialize favorite"),
                },
            )
            .expect("enqueue favorite upsert");

        crate::profile_sync_worker::run_profile_outbox_worker_tick(&state).await;

        assert!(state.profile_sync_session.read().await.session.is_none());
        let blocked = state
            .sqlite
            .profile_sync_worker_state("remote-user")
            .expect("worker state query")
            .expect("worker state");
        assert!(blocked.auth_blocked_at_ms.is_some());
        assert_eq!(
            blocked.auth_blocked_error.as_deref(),
            Some("远端账号同步后端返回 401")
        );
        assert_eq!(store.pending_outbox_count("remote-user").unwrap(), 1);

        let blocked_status = read_json_body(
            build_router(state.clone())
                .oneshot(
                    Request::builder()
                        .uri("/api/profile-sync/status")
                        .body(Body::empty())
                        .expect("blocked profile sync status request"),
                )
                .await
                .expect("blocked profile sync status response"),
        )
        .await;
        assert_eq!(
            blocked_status
                .get("pendingOutboxCount")
                .and_then(Value::as_u64),
            Some(1)
        );
        assert_eq!(
            blocked_status
                .get("reauthRequired")
                .and_then(Value::as_bool),
            Some(true)
        );
        assert_eq!(
            blocked_status
                .get("lastOutboxError")
                .and_then(Value::as_str),
            Some("远端账号同步后端返回 401")
        );

        let app = build_router(state.clone());
        let login_response = app
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
        assert!(
            state
                .sqlite
                .profile_sync_worker_state("remote-user")
                .expect("worker state query")
                .expect("worker state")
                .auth_blocked_at_ms
                .is_none()
        );

        upstream.abort();
    }

    #[tokio::test]
    async fn profile_sync_session_persists_unselected_domain_without_enqueuing_outbox() {
        let temp_dir = TestDir::new();
        let config_path = write_test_config(
            &temp_dir,
            json!({
              "auth": {
                "username": "local-user"
              },
              "profile_sync": {
                "api_base_url": "http://127.0.0.1:1",
                "sync_domains": ["playrecords"]
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
        state.profile_sync_session.write().await.session = Some(ProfileSyncSession {
            username: "remote-user".to_string(),
            role: "user".to_string(),
        });
        let app = build_router(state.clone());
        let sync_cookie = build_test_auth_cookie("local-user", "user", "desktop-local");

        let response = app
            .oneshot(
                Request::builder()
                    .method(Method::POST)
                    .uri("/api/favorites")
                    .header("cookie", sync_cookie)
                    .header(CONTENT_TYPE, "application/json")
                    .body(Body::from(
                        json!({
                          "key": "demo+1",
                          "favorite": {
                            "title": "Local-only Favorite",
                            "source_name": "Demo Source",
                            "year": "2026",
                            "cover": "favorite.jpg",
                            "total_episodes": 24,
                            "save_time": 20,
                            "search_title": null,
                            "playback_mode": null,
                            "offline_content_id": null,
                            "is_adult": false,
                            "origin": null
                          }
                        })
                        .to_string(),
                    ))
                    .expect("local-only favorite post request"),
            )
            .await
            .expect("local-only favorite post response");

        assert_eq!(response.status(), StatusCode::OK);
        assert_eq!(
            state
                .profile_store()
                .load_favorites("local-user")
                .expect("load local-only favorite")
                .get("demo+1")
                .map(|favorite| favorite.title.as_str()),
            Some("Local-only Favorite")
        );
        assert_eq!(
            state
                .profile_store()
                .pending_outbox_count("local-user")
                .expect("count local-only outbox"),
            0,
            "unselected domain must not enqueue a remote journal operation"
        );
    }

    #[tokio::test]
    async fn concurrent_profile_sync_favorite_writes_preserve_both_keys() {
        let temp_dir = TestDir::new();
        let config_path = write_test_config(
            &temp_dir,
            json!({
              "auth": {
                "username": "local-user"
              },
              "profile_sync": {
                "api_base_url": "http://127.0.0.1:1",
                "sync_domains": ["favorites"]
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
        state.profile_sync_session.write().await.session = Some(ProfileSyncSession {
            username: "remote-user".to_string(),
            role: "user".to_string(),
        });
        let app = build_router(state.clone());
        let sync_cookie = build_test_auth_cookie("local-user", "user", "desktop-local");
        let first_request = Request::builder()
            .method(Method::POST)
            .uri("/api/favorites")
            .header("cookie", sync_cookie.clone())
            .header(CONTENT_TYPE, "application/json")
            .body(Body::from(
                json!({
                  "key": "demo+1",
                  "favorite": {
                    "title": "First Favorite",
                    "source_name": "Demo Source",
                    "year": "2026",
                    "cover": "first.jpg",
                    "total_episodes": 24,
                    "save_time": 20,
                    "search_title": null,
                    "playback_mode": null,
                    "offline_content_id": null,
                    "is_adult": false,
                    "origin": null
                  }
                })
                .to_string(),
            ))
            .expect("first favorite request");
        let second_request = Request::builder()
            .method(Method::POST)
            .uri("/api/favorites")
            .header("cookie", sync_cookie)
            .header(CONTENT_TYPE, "application/json")
            .body(Body::from(
                json!({
                  "key": "demo+2",
                  "favorite": {
                    "title": "Second Favorite",
                    "source_name": "Demo Source",
                    "year": "2026",
                    "cover": "second.jpg",
                    "total_episodes": 24,
                    "save_time": 20,
                    "search_title": null,
                    "playback_mode": null,
                    "offline_content_id": null,
                    "is_adult": false,
                    "origin": null
                  }
                })
                .to_string(),
            ))
            .expect("second favorite request");

        let (first_response, second_response) = tokio::join!(
            app.clone().oneshot(first_request),
            app.oneshot(second_request),
        );
        assert_eq!(
            first_response.expect("first favorite response").status(),
            StatusCode::OK
        );
        assert_eq!(
            second_response.expect("second favorite response").status(),
            StatusCode::OK
        );

        let favorites = state
            .profile_store()
            .load_favorites("local-user")
            .expect("load concurrent favorites");
        assert_eq!(favorites.len(), 2);
        assert!(favorites.contains_key("demo+1"));
        assert!(favorites.contains_key("demo+2"));
        assert_eq!(
            state
                .profile_store()
                .pending_outbox_count("local-user")
                .expect("count concurrent outbox"),
            2
        );
    }

    #[tokio::test]
    async fn profile_sync_session_uses_local_favorites_when_remote_is_unreachable() {
        let temp_dir = TestDir::new();
        let config_path = write_test_config(
            &temp_dir,
            json!({
              "auth": {
                "username": "local-user"
              },
              "profile_sync": {
                "api_base_url": "http://127.0.0.1:1"
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
        state.profile_sync_session.write().await.session = Some(ProfileSyncSession {
            username: "remote-user".to_string(),
            role: "user".to_string(),
        });
        let app = build_router(state.clone());
        let sync_cookie = build_test_auth_cookie("local-user", "user", "desktop-local");

        let post_response = app
            .clone()
            .oneshot(
                Request::builder()
                    .method(Method::POST)
                    .uri("/api/favorites")
                    .header("cookie", sync_cookie.clone())
                    .header(CONTENT_TYPE, "application/json")
                    .body(Body::from(
                        json!({
                          "key": "demo+1",
                          "favorite": {
                            "title": "Remote Session Favorite",
                            "source_name": "Demo Source",
                            "year": "2026",
                            "cover": "favorite.jpg",
                            "total_episodes": 24,
                            "save_time": 20,
                            "search_title": null,
                            "playback_mode": null,
                            "offline_content_id": null,
                            "is_adult": false,
                            "origin": null
                          }
                        })
                        .to_string(),
                    ))
                    .expect("local profile favorite post request"),
            )
            .await
            .expect("local profile favorite post response");
        assert_eq!(post_response.status(), StatusCode::OK);

        let get_response = app
            .clone()
            .oneshot(
                Request::builder()
                    .uri("/api/favorites?key=demo%2B1")
                    .header("cookie", sync_cookie.clone())
                    .body(Body::empty())
                    .expect("local profile favorite get request"),
            )
            .await
            .expect("local profile favorite get response");
        assert_eq!(get_response.status(), StatusCode::OK);
        let get_payload = read_json_body(get_response).await;
        assert_eq!(
            get_payload.get("title").and_then(Value::as_str),
            Some("Remote Session Favorite")
        );

        let delete_response = app
            .oneshot(
                Request::builder()
                    .method(Method::DELETE)
                    .uri("/api/favorites?key=demo%2B1")
                    .header("cookie", sync_cookie)
                    .body(Body::empty())
                    .expect("local profile favorite delete request"),
            )
            .await
            .expect("local profile favorite delete response");
        assert_eq!(delete_response.status(), StatusCode::OK);
        assert!(
            state
                .profile_store()
                .load_favorites("local-user")
                .expect("load locally persisted favorites")
                .is_empty()
        );
        assert_eq!(
            state
                .profile_store()
                .pending_outbox_count("local-user")
                .expect("load local profile outbox"),
            2
        );
    }

    #[tokio::test]
    async fn profile_playrecords_route_keeps_desktop_sync_mode_local() {
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
                    .expect("local playrecords request"),
            )
            .await
            .expect("local playrecords response");

        assert_eq!(response.status(), StatusCode::OK);
        let payload = read_json_body(response).await;
        assert!(payload.as_object().is_some_and(|object| object.is_empty()));

        upstream.abort();
    }

    #[tokio::test]
    async fn profile_sync_user_data_routes_stay_local_for_all_domains() {
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

        for (path, expected) in [
            ("/api/playrecords", json!({})),
            ("/api/favorites", json!({})),
            ("/api/follows", json!({})),
            ("/api/searchhistory", json!([])),
            ("/api/skipconfigs", json!({})),
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
            assert_eq!(read_json_body(response).await, expected);
        }

        upstream.abort();
    }

    #[tokio::test]
    async fn profile_sync_login_session_survives_local_user_data_requests() {
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

        let local_response = app
            .clone()
            .oneshot(
                Request::builder()
                    .uri("/api/playrecords")
                    .body(Body::empty())
                    .expect("local profile request"),
            )
            .await
            .expect("local profile response");
        assert_eq!(local_response.status(), StatusCode::OK);

        let status_after_local_request = app
            .oneshot(
                Request::builder()
                    .uri("/api/profile-sync/status")
                    .body(Body::empty())
                    .expect("profile sync status after local request"),
            )
            .await
            .expect("profile sync status after local request response");
        let payload_after_401 = read_json_body(status_after_local_request).await;
        assert_eq!(
            payload_after_401
                .get("authenticated")
                .and_then(Value::as_bool),
            Some(true)
        );
        assert_eq!(
            payload_after_401.get("username").and_then(Value::as_str),
            Some("remote-user")
        );
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
                        },
                        "mergedSnapshot": empty_remote_profile_snapshot(),
                        "revision": "test-revision"
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
        state.profile_sync_session.write().await.session = Some(ProfileSyncSession {
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
                                },
                                "mergedSnapshot": {
                                    "playRecords": {},
                                    "favorites": {
                                        "web-only+1": {
                                            "title": "Web Only Favorite",
                                            "source_name": "remote",
                                            "year": "2026",
                                            "cover": "remote.jpg",
                                            "total_episodes": 1,
                                            "save_time": 2,
                                            "search_title": null,
                                            "playback_mode": null,
                                            "offline_content_id": null,
                                            "is_adult": null,
                                            "origin": null
                                        }
                                    },
                                    "follows": {},
                                    "searchHistory": [],
                                    "skipConfigs": {}
                                },
                                "revision": "test-revision"
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
        state.profile_sync_session.write().await.session = Some(ProfileSyncSession {
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
            .apply_local_mutation_and_enqueue(
                "remote-owner",
                "device-a",
                moontv_profile::ProfileDomain::Favorites,
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
                moontv_profile::ProfileMutation::Upsert {
                    entity_key: "fav+1".to_string(),
                    value: json!({
                        "title": "Demo Favorite",
                        "source_name": "demo",
                        "year": "2026",
                        "cover": "",
                        "total_episodes": 12,
                        "save_time": 1,
                        "search_title": null,
                        "playback_mode": null,
                        "offline_content_id": null,
                        "is_adult": null,
                        "origin": null
                    }),
                },
            )
            .expect("enqueue pre-merge favorite");
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
        let profile_store = state.profile_store();
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
        assert_eq!(
            profile_store
                .pending_outbox_count("remote-owner")
                .expect("old selected outbox is rebaselined"),
            0
        );
        assert_eq!(
            profile_store
                .load_favorites("remote-owner")
                .expect("load merged favorites")
                .get("web-only+1")
                .map(|favorite| favorite.title.as_str()),
            Some("Web Only Favorite")
        );
        assert!(
            profile_store
                .load_play_records("remote-owner")
                .expect("load unselected play records")
                .contains_key("play+1")
        );

        let captured_payloads = captured_payloads.lock().expect("captured payloads");
        assert_eq!(captured_payloads.len(), 1);
        assert_eq!(
            captured_payloads[0].get("strategy").and_then(Value::as_str),
            Some("web-first")
        );
        assert_eq!(
            captured_payloads[0].get("domains"),
            Some(&json!(["favorites"])),
            "only selected profile domains must be sent to the Web merge route"
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
                                },
                                "mergedSnapshot": empty_remote_profile_snapshot(),
                                "revision": "test-revision"
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
        state.profile_sync_session.write().await.session = Some(ProfileSyncSession {
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
                            },
                            "mergedSnapshot": empty_remote_profile_snapshot(),
                            "revision": "test-revision"
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
                            },
                            "mergedSnapshot": empty_remote_profile_snapshot(),
                            "revision": "test-revision"
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
                                .and_then(|value| value.get("CustomCategories"))
                                .and_then(Value::as_array)
                                .map(Vec::len),
                            Some(1)
                        );
                        assert_eq!(
                            payload
                                .get("adminConfig")
                                .and_then(|value| value.get("LiveConfig"))
                                .and_then(Value::as_array)
                                .map(Vec::len),
                            Some(1)
                        );
                        assert_eq!(
                            payload
                                .get("adminConfig")
                                .and_then(|value| value.get("AdFilterConfig"))
                                .and_then(|value| value.get("enabled"))
                                .and_then(Value::as_bool),
                            Some(false)
                        );
                        assert_eq!(
                            payload
                                .get("adminConfig")
                                .and_then(|value| value.get("PlayerEnhancementConfig"))
                                .and_then(|value| value.get("VisualEnhancement"))
                                .and_then(Value::as_bool),
                            Some(true)
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
                            },
                            "mergedSnapshot": empty_remote_profile_snapshot(),
                            "revision": "test-revision"
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
                "CustomCategories": [
                  {
                    "name": "Desktop Movies",
                    "type": "movie",
                    "query": "desktop-movies",
                    "from": "custom",
                    "disabled": false
                  }
                ],
                "LiveConfig": [
                  {
                    "key": "desktop-live",
                    "name": "Desktop Live",
                    "url": "https://desktop.example/live.m3u",
                    "from": "custom",
                    "channelNumber": 0,
                    "disabled": false
                  }
                ],
                "AdFilterConfig": {
                  "enabled": false
                },
                "PlayerEnhancementConfig": {
                  "AudioSpikeProtection": true,
                  "VisualEnhancement": true
                }
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
                                },
                                "mergedSnapshot": empty_remote_profile_snapshot(),
                                "revision": "test-revision"
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
    async fn vod_m3u8_endpoint_reuses_the_short_ttl_online_cache() {
        let upstream_request_count = Arc::new(AtomicU64::new(0));
        let upstream_request_count_for_route = Arc::clone(&upstream_request_count);
        let upstream = spawn_mock_server(Router::new().route(
            "/upstream/cacheable.m3u8",
            get(move || {
                let upstream_request_count = Arc::clone(&upstream_request_count_for_route);
                async move {
                    upstream_request_count.fetch_add(1, Ordering::SeqCst);
                    (
                        [(CONTENT_TYPE, "application/vnd.apple.mpegurl")],
                        "#EXTM3U\n#EXTINF:4.0,\nsegment.ts\n",
                    )
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
        let state = AppState::new(
            DEFAULT_HOST.to_string(),
            DEFAULT_PORT,
            config_path,
            temp_dir.path.join("data"),
            temp_dir.path.join("data/moontv.sqlite3"),
        );
        let app = build_router(state.clone());
        let manifest_url = format!("{}/upstream/cacheable.m3u8", upstream.base_url());
        let service_url = format!(
            "/media/vod/m3u8?source=mock&url={}",
            form_urlencoded::byte_serialize(manifest_url.as_bytes()).collect::<String>()
        );

        let first_response = app
            .clone()
            .oneshot(
                Request::builder()
                    .uri(&service_url)
                    .body(Body::empty())
                    .expect("first manifest request"),
            )
            .await
            .expect("first manifest response");
        assert_eq!(first_response.status(), StatusCode::OK);
        let first_body = to_bytes(first_response.into_body(), usize::MAX)
            .await
            .expect("first manifest body");

        let cache_request_url = format!("{}{}", state.public_base_url, service_url);
        let deadline = tokio::time::Instant::now() + Duration::from_secs(2);
        while state
            .read_cached_online_vod_asset(&cache_request_url)
            .is_none()
        {
            assert!(
                tokio::time::Instant::now() < deadline,
                "online VOD manifest cache did not finish"
            );
            tokio::time::sleep(Duration::from_millis(10)).await;
        }

        let cached_response = app
            .oneshot(
                Request::builder()
                    .uri(&service_url)
                    .body(Body::empty())
                    .expect("cached manifest request"),
            )
            .await
            .expect("cached manifest response");
        assert_eq!(cached_response.status(), StatusCode::OK);
        assert_eq!(
            to_bytes(cached_response.into_body(), usize::MAX)
                .await
                .expect("cached manifest body"),
            first_body
        );
        assert_eq!(upstream_request_count.load(Ordering::SeqCst), 1);

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
    async fn vod_segment_endpoint_reuses_the_completed_online_cache_for_range_requests() {
        let upstream_request_count = Arc::new(AtomicU64::new(0));
        let upstream_request_count_for_route = Arc::clone(&upstream_request_count);
        let upstream = spawn_mock_server(Router::new().route(
            "/upstream/cacheable.ts",
            get(move || {
                let upstream_request_count = Arc::clone(&upstream_request_count_for_route);
                async move {
                    upstream_request_count.fetch_add(1, Ordering::SeqCst);
                    (
                        StatusCode::OK,
                        [
                            (CONTENT_TYPE, "video/mp2t"),
                            (CONTENT_LENGTH, "8"),
                            (ACCEPT_RANGES, "bytes"),
                        ],
                        "mockdata",
                    )
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
        let state = AppState::new(
            DEFAULT_HOST.to_string(),
            DEFAULT_PORT,
            config_path,
            temp_dir.path.join("data"),
            temp_dir.path.join("data/moontv.sqlite3"),
        );
        let app = build_router(state.clone());
        let segment_url = format!("{}/upstream/cacheable.ts", upstream.base_url());
        let service_url = format!(
            "/media/vod/segment?source=mock&url={}",
            form_urlencoded::byte_serialize(segment_url.as_bytes()).collect::<String>()
        );

        let first_response = app
            .clone()
            .oneshot(
                Request::builder()
                    .uri(&service_url)
                    .body(Body::empty())
                    .expect("first segment request"),
            )
            .await
            .expect("first segment response");
        assert_eq!(first_response.status(), StatusCode::OK);
        assert_eq!(
            to_bytes(first_response.into_body(), usize::MAX)
                .await
                .expect("first segment body")
                .as_ref(),
            b"mockdata"
        );

        let cache_request_url = format!("{}{}", state.public_base_url, service_url);
        let deadline = tokio::time::Instant::now() + Duration::from_secs(2);
        while state
            .read_cached_online_vod_asset(&cache_request_url)
            .is_none()
        {
            assert!(
                tokio::time::Instant::now() < deadline,
                "online VOD segment cache did not finish"
            );
            tokio::time::sleep(Duration::from_millis(10)).await;
        }

        let cached_range_response = app
            .oneshot(
                Request::builder()
                    .uri(&service_url)
                    .header(RANGE, "bytes=0-3")
                    .body(Body::empty())
                    .expect("cached range request"),
            )
            .await
            .expect("cached range response");
        assert_eq!(cached_range_response.status(), StatusCode::PARTIAL_CONTENT);
        assert_eq!(
            cached_range_response
                .headers()
                .get(CONTENT_RANGE)
                .and_then(|value| value.to_str().ok()),
            Some("bytes 0-3/8")
        );
        assert_eq!(
            to_bytes(cached_range_response.into_body(), usize::MAX)
                .await
                .expect("cached range body")
                .as_ref(),
            b"mock"
        );
        assert_eq!(upstream_request_count.load(Ordering::SeqCst), 1);

        upstream.abort();
    }

    #[tokio::test]
    async fn image_proxy_endpoint_serves_a_cached_douban_image() {
        let temp_dir = TestDir::new();
        let config_path = write_test_config(
            &temp_dir,
            json!({
              "cache_time": 7200,
              "api_site": {}
            }),
        );
        let image_url = "https://img1.doubanio.com/cover.jpg";
        let state = AppState::new(
            DEFAULT_HOST.to_string(),
            DEFAULT_PORT,
            config_path,
            temp_dir.path.join("data"),
            temp_dir.path.join("data/moontv.sqlite3"),
        );
        state
            .write_cached_image(
                image_url,
                &CachedImage {
                    content_type: "image/jpeg".to_string(),
                    body: vec![1_u8, 2, 3, 4],
                },
            )
            .expect("seed image cache");
        let app = build_router(state);

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
    }

    #[tokio::test]
    async fn image_proxy_followers_return_the_leaders_payload_limit_error() {
        let (request_started_tx, request_started_rx) = tokio::sync::oneshot::channel();
        let request_started = Arc::new(Mutex::new(Some(request_started_tx)));
        let upstream = spawn_mock_server(Router::new().route(
            "/image.jpg",
            get(move || {
                let request_started = request_started.clone();
                async move {
                    if let Some(sender) = request_started
                        .lock()
                        .expect("lock image request start sender")
                        .take()
                    {
                        let _ = sender.send(());
                    }
                    tokio::time::sleep(Duration::from_millis(50)).await;
                    let mut response = Response::new(Body::from(vec![0_u8; 10 * 1024 * 1024 + 1]));
                    response
                        .headers_mut()
                        .insert(CONTENT_TYPE, HeaderValue::from_static("image/jpeg"));
                    response
                }
            }),
        ))
        .await;
        let temp_dir = TestDir::new();
        let config_path = write_test_config(&temp_dir, json!({ "api_site": {} }));
        let state = AppState::new(
            DEFAULT_HOST.to_string(),
            DEFAULT_PORT,
            config_path,
            temp_dir.path.join("data"),
            temp_dir.path.join("data/moontv.sqlite3"),
        );
        let image_url = Url::parse(&format!("{}/image.jpg", upstream.base_url()))
            .expect("parse mock image URL");

        let leader_state = state.clone();
        let leader_url = image_url.clone();
        let leader = tokio::spawn(async move {
            image_proxy::get_or_fetch_image(&leader_state, leader_url).await
        });
        request_started_rx
            .await
            .expect("leader requested upstream image");

        let mut followers = Vec::new();
        for _ in 0..4 {
            let follower_state = state.clone();
            let follower_url = image_url.clone();
            followers.push(tokio::spawn(async move {
                image_proxy::get_or_fetch_image(&follower_state, follower_url).await
            }));
        }

        let leader_error = leader
            .await
            .expect("leader task did not panic")
            .expect_err("leader must reject an oversized image");
        assert_eq!(leader_error.status, StatusCode::PAYLOAD_TOO_LARGE);
        for follower in followers {
            let follower_error = follower
                .await
                .expect("follower task did not panic")
                .expect_err("follower must receive the leader failure");
            assert_eq!(
                follower_error.status,
                StatusCode::PAYLOAD_TOO_LARGE,
                "follower must preserve the leader's error classification"
            );
        }

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
        let restored_status = snapshot_payload
            .get("tasks")
            .and_then(|tasks| tasks.get(task_id))
            .and_then(|task| task.get("status"))
            .and_then(Value::as_str);
        assert!(
            restored_status == Some("queued") || restored_status == Some("downloading"),
            "interrupted downloads should auto-resume after restart, got {restored_status:?}"
        );
    }

    #[tokio::test]
    async fn download_runtime_keeps_explicitly_paused_tasks_across_restart() {
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
        let task_id = "task-paused-keep";

        let create_response = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/api/download-runtime/tasks")
                    .header(CONTENT_TYPE, "application/json")
                    .body(Body::from(
                        build_download_runtime_task_payload(task_id, "paused").to_string(),
                    ))
                    .expect("download runtime create request"),
            )
            .await
            .expect("download runtime create response");

        assert_eq!(create_response.status(), StatusCode::OK);

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
    async fn download_runtime_direct_resource_requests_identity_encoding() {
        let upstream = spawn_mock_server(Router::new().route(
            "/segment.ts",
            get(|headers: HeaderMap| async move {
                if headers
                    .get(ACCEPT_ENCODING)
                    .and_then(|value| value.to_str().ok())
                    == Some("identity")
                {
                    return Response::builder()
                        .status(StatusCode::OK)
                        .header(CONTENT_TYPE, "video/mp2t")
                        .body(Body::from("identity-segment"))
                        .expect("identity segment response");
                }

                Response::builder()
                    .status(StatusCode::OK)
                    .header(CONTENT_TYPE, "video/mp2t")
                    .header(CONTENT_ENCODING, "gzip")
                    .body(Body::from("not-gzip"))
                    .expect("unexpected encoded segment response")
            }),
        ))
        .await;
        let temp_dir = TestDir::new();
        let config_path = write_test_config(&temp_dir, json!({ "api_site": {} }));
        let app = build_router(AppState::new(
            DEFAULT_HOST.to_string(),
            DEFAULT_PORT,
            config_path,
            temp_dir.path.join("data"),
            temp_dir.path.join("data/moontv.sqlite3"),
        ));
        let resource_url = format!("{}/segment.ts", upstream.base_url());
        let encoded_resource_url =
            form_urlencoded::byte_serialize(resource_url.as_bytes()).collect::<String>();

        let response = app
            .oneshot(
                Request::builder()
                    .uri(format!(
                        "/api/download-runtime/cache/fetch?url={encoded_resource_url}"
                    ))
                    .body(Body::empty())
                    .expect("identity resource request"),
            )
            .await
            .expect("identity resource response");

        assert_eq!(response.status(), StatusCode::OK);
        let body = to_bytes(response.into_body(), usize::MAX)
            .await
            .expect("identity resource body");
        assert_eq!(body.as_ref(), b"identity-segment");

        upstream.abort();
    }

    #[tokio::test]
    async fn download_runtime_vod_proxy_manifest_requests_identity_encoding() {
        let upstream = spawn_mock_server(Router::new().route(
            "/playlist.m3u8",
            get(|headers: HeaderMap| async move {
                if headers
                    .get(ACCEPT_ENCODING)
                    .and_then(|value| value.to_str().ok())
                    == Some("identity")
                {
                    return Response::builder()
                        .status(StatusCode::OK)
                        .header(CONTENT_TYPE, "application/vnd.apple.mpegurl")
                        .body(Body::from("#EXTM3U\n#EXTINF:4.0,\nsegment.ts\n"))
                        .expect("identity manifest response");
                }

                Response::builder()
                    .status(StatusCode::OK)
                    .header(CONTENT_TYPE, "application/vnd.apple.mpegurl")
                    .header(CONTENT_ENCODING, "gzip")
                    .body(Body::from("not-gzip"))
                    .expect("unexpected encoded manifest response")
            }),
        ))
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
        let candidate_url = format!(
            "/media/vod/m3u8?source=mock&url={}",
            form_urlencoded::byte_serialize(
                format!("{}/playlist.m3u8", upstream.base_url()).as_bytes()
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
                        json!({ "entryManifestUrls": [candidate_url] }).to_string(),
                    ))
                    .expect("identity manifest resolve request"),
            )
            .await
            .expect("identity manifest resolve response");

        assert_eq!(response.status(), StatusCode::OK);
        let payload = read_json_body(response).await;
        assert_eq!(
            payload
                .get("resourceUrls")
                .and_then(Value::as_array)
                .map(Vec::len),
            Some(2)
        );

        upstream.abort();
    }

    #[tokio::test]
    async fn download_runtime_vod_proxy_resource_requests_identity_encoding() {
        let upstream = spawn_mock_server(Router::new().route(
            "/segment.ts",
            get(|headers: HeaderMap| async move {
                if headers
                    .get(ACCEPT_ENCODING)
                    .and_then(|value| value.to_str().ok())
                    == Some("identity")
                {
                    return Response::builder()
                        .status(StatusCode::OK)
                        .header(CONTENT_TYPE, "video/mp2t")
                        .body(Body::from("proxy-identity-segment"))
                        .expect("proxy identity segment response");
                }

                Response::builder()
                    .status(StatusCode::OK)
                    .header(CONTENT_TYPE, "video/mp2t")
                    .header(CONTENT_ENCODING, "gzip")
                    .body(Body::from("not-gzip"))
                    .expect("unexpected proxy encoded segment response")
            }),
        ))
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
        let runtime_url = format!(
            "http://127.0.0.1:8787/media/vod/segment?source=mock&url={}",
            form_urlencoded::byte_serialize(
                format!("{}/segment.ts", upstream.base_url()).as_bytes()
            )
            .collect::<String>()
        );
        let encoded_runtime_url =
            form_urlencoded::byte_serialize(runtime_url.as_bytes()).collect::<String>();

        let response = app
            .oneshot(
                Request::builder()
                    .uri(format!(
                        "/api/download-runtime/cache/fetch?url={encoded_runtime_url}"
                    ))
                    .body(Body::empty())
                    .expect("proxy identity resource request"),
            )
            .await
            .expect("proxy identity resource response");

        assert_eq!(response.status(), StatusCode::OK);
        let body = to_bytes(response.into_body(), usize::MAX)
            .await
            .expect("proxy identity resource body");
        assert_eq!(body.as_ref(), b"proxy-identity-segment");

        upstream.abort();
    }

    #[tokio::test]
    async fn download_runtime_retries_valid_encoded_resource_with_default_client() {
        let request_count = Arc::new(AtomicU64::new(0));
        let upstream_request_count = Arc::clone(&request_count);
        let compressed_body = gzip_bytes(b"gzip-segment").expect("gzip segment body");
        let upstream = spawn_mock_server(Router::new().route(
            "/segment.ts",
            get(move || {
                let request_count = Arc::clone(&upstream_request_count);
                let compressed_body = compressed_body.clone();
                async move {
                    request_count.fetch_add(1, Ordering::SeqCst);
                    Response::builder()
                        .status(StatusCode::OK)
                        .header(CONTENT_TYPE, "video/mp2t")
                        .header(CONTENT_ENCODING, "gzip")
                        .body(Body::from(compressed_body))
                        .expect("gzip segment response")
                }
            }),
        ))
        .await;
        let temp_dir = TestDir::new();
        let config_path = write_test_config(&temp_dir, json!({ "api_site": {} }));
        let app = build_router(AppState::new(
            DEFAULT_HOST.to_string(),
            DEFAULT_PORT,
            config_path,
            temp_dir.path.join("data"),
            temp_dir.path.join("data/moontv.sqlite3"),
        ));
        let resource_url = format!("{}/segment.ts", upstream.base_url());
        let encoded_resource_url =
            form_urlencoded::byte_serialize(resource_url.as_bytes()).collect::<String>();

        let response = app
            .oneshot(
                Request::builder()
                    .uri(format!(
                        "/api/download-runtime/cache/fetch?url={encoded_resource_url}"
                    ))
                    .body(Body::empty())
                    .expect("gzip fallback resource request"),
            )
            .await
            .expect("gzip fallback resource response");

        assert_eq!(response.status(), StatusCode::OK);
        let body = to_bytes(response.into_body(), usize::MAX)
            .await
            .expect("gzip fallback resource body");
        assert_eq!(body.as_ref(), b"gzip-segment");
        assert_eq!(request_count.load(Ordering::SeqCst), 2);

        upstream.abort();
    }

    #[tokio::test]
    async fn download_runtime_vod_proxy_does_not_cache_malformed_encoded_resource() {
        let upstream = spawn_mock_server(Router::new().route(
            "/segment.ts",
            get(|| async {
                Response::builder()
                    .status(StatusCode::OK)
                    .header(CONTENT_TYPE, "video/mp2t")
                    .header(CONTENT_ENCODING, "gzip")
                    .body(Body::from("not-gzip"))
                    .expect("malformed encoded segment response")
            }),
        ))
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
        let runtime_url = format!(
            "http://127.0.0.1:8787/media/vod/segment?source=mock&url={}",
            form_urlencoded::byte_serialize(
                format!("{}/segment.ts", upstream.base_url()).as_bytes()
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
                    .expect("malformed resource request"),
            )
            .await
            .expect("malformed resource response");

        assert_eq!(response.status(), StatusCode::BAD_GATEWAY);
        let error_payload = read_json_body(response).await;
        assert_eq!(
            error_payload.get("code").and_then(Value::as_str),
            Some("download_runtime_resource_response_read_failed")
        );
        assert!(
            error_payload
                .get("error")
                .and_then(Value::as_str)
                .is_some_and(|message| message.contains("identity-encoding fallback"))
        );

        let cache_meta_response = app
            .oneshot(
                Request::builder()
                    .uri(format!(
                        "/api/download-runtime/cache/meta?url={encoded_runtime_url}"
                    ))
                    .body(Body::empty())
                    .expect("malformed resource cache meta request"),
            )
            .await
            .expect("malformed resource cache meta response");

        assert_eq!(cache_meta_response.status(), StatusCode::OK);
        let cache_meta_payload = read_json_body(cache_meta_response).await;
        assert_eq!(
            cache_meta_payload.get("exists").and_then(Value::as_bool),
            Some(false)
        );

        upstream.abort();
    }

    #[tokio::test]
    async fn download_runtime_upsert_keeps_live_downloading_task() {
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
        let task_id = "task-live-keep";

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

        let mut stale_payload = build_download_runtime_task_payload(task_id, "paused");
        stale_payload["progress"] = json!(0);
        stale_payload["downloadedResources"] = json!(0);
        stale_payload["sizeBytes"] = json!(0);
        stale_payload["currentSizeBytes"] = json!(0);
        stale_payload["searchTitle"] = json!("Updated Search");
        stale_payload["updatedAt"] = json!(50);

        let stale_response = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/api/download-runtime/tasks")
                    .header(CONTENT_TYPE, "application/json")
                    .body(Body::from(stale_payload.to_string()))
                    .expect("download runtime stale upsert request"),
            )
            .await
            .expect("download runtime stale upsert response");

        assert_eq!(stale_response.status(), StatusCode::OK);
        let stale_snapshot = read_json_body(stale_response).await;
        let task = stale_snapshot
            .get("tasks")
            .and_then(|tasks| tasks.get(task_id))
            .expect("live task should remain");
        assert_eq!(
            task.get("status").and_then(Value::as_str),
            Some("downloading")
        );
        assert_eq!(task.get("progress").and_then(Value::as_u64), Some(12));
        assert_eq!(
            task.get("downloadedResources").and_then(Value::as_u64),
            Some(3)
        );
        assert_eq!(
            task.get("searchTitle").and_then(Value::as_str),
            Some("Updated Search")
        );
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
