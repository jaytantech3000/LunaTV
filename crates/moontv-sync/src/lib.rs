use reqwest::{
    Client, Method, StatusCode, Url,
    header::{ACCEPT, CONTENT_TYPE},
};
use serde::{Deserialize, Serialize};
use thiserror::Error;

pub const PROFILE_SYNC_USER_DATA_DOMAINS: [&str; 5] = [
    "playrecords",
    "favorites",
    "follows",
    "searchhistory",
    "skipconfigs",
];

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum ProfileSyncErrorKind {
    NotConfigured,
    InvalidBaseUrl,
    Unreachable,
    Unauthorized,
    ProtocolIncompatible,
    UpstreamFailure,
}

impl ProfileSyncErrorKind {
    pub fn http_status(self) -> StatusCode {
        match self {
            Self::NotConfigured => StatusCode::NOT_IMPLEMENTED,
            Self::InvalidBaseUrl => StatusCode::BAD_REQUEST,
            Self::Unreachable
            | Self::Unauthorized
            | Self::ProtocolIncompatible
            | Self::UpstreamFailure => StatusCode::BAD_GATEWAY,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Error)]
#[error("{message}")]
pub struct ProfileSyncError {
    pub kind: ProfileSyncErrorKind,
    pub message: String,
}

impl ProfileSyncError {
    pub fn new(kind: ProfileSyncErrorKind, message: impl Into<String>) -> Self {
        Self {
            kind,
            message: message.into(),
        }
    }

    pub fn http_status(&self) -> StatusCode {
        self.kind.http_status()
    }
}

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ProfileSyncSession {
    pub username: String,
    pub role: String,
}

#[derive(Debug, Serialize, Clone, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ProfileSyncStatusResponse {
    pub enabled: bool,
    pub reachable: bool,
    pub authenticated: bool,
    pub username: Option<String>,
    pub role: Option<String>,
    pub storage_type: Option<String>,
    pub profile_mode: Option<String>,
    pub error: Option<String>,
    pub error_kind: Option<ProfileSyncErrorKind>,
    pub sync_domains: Vec<String>,
}

#[derive(Debug, Deserialize, Clone, PartialEq, Eq)]
#[serde(rename_all = "PascalCase")]
pub struct RemoteServerConfigResponse {
    pub storage_type: Option<String>,
    pub profile_mode: Option<String>,
}

#[derive(Debug, Deserialize, Clone, PartialEq, Eq)]
pub struct RemoteLoginResponse {
    pub ok: Option<bool>,
    pub username: Option<String>,
    pub role: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ProfileSyncForwardRequest {
    pub method: Method,
    pub request_path: String,
    pub accept: Option<String>,
    pub content_type: Option<String>,
    pub body: Vec<u8>,
}

impl ProfileSyncForwardRequest {
    pub fn new(method: Method, request_path: impl Into<String>) -> Self {
        Self {
            method,
            request_path: request_path.into(),
            accept: None,
            content_type: None,
            body: Vec::new(),
        }
    }

    pub fn get(request_path: impl Into<String>) -> Self {
        Self::new(Method::GET, request_path)
    }

    pub fn with_accept(mut self, accept: Option<String>) -> Self {
        self.accept = accept;
        self
    }

    pub fn with_content_type(mut self, content_type: Option<String>) -> Self {
        self.content_type = content_type;
        self
    }

    pub fn with_body(mut self, body: Vec<u8>) -> Self {
        self.body = body;
        self
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ProfileSyncForwardResponse {
    pub status: StatusCode,
    pub content_type: Option<String>,
    pub body: Vec<u8>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ProfileSyncSessionMutation {
    Keep,
    Clear,
    Set(ProfileSyncSession),
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ProfileSyncForwardOutcome {
    pub response: ProfileSyncForwardResponse,
    pub session_mutation: ProfileSyncSessionMutation,
}

#[derive(Debug, Clone)]
pub struct ProfileSyncClient {
    client: Client,
}

impl ProfileSyncClient {
    pub fn new(client: Client) -> Self {
        Self { client }
    }

    pub async fn send(
        &self,
        remote_base_url: Option<&str>,
        request: ProfileSyncForwardRequest,
    ) -> Result<reqwest::Response, ProfileSyncError> {
        let remote_base_url = remote_base_url.ok_or_else(|| {
            ProfileSyncError::new(ProfileSyncErrorKind::NotConfigured, "未配置账号同步后端")
        })?;
        let target_url = build_profile_sync_target_url(remote_base_url, &request.request_path)?;
        let mut upstream_request = self.client.request(request.method, target_url);

        if let Some(content_type) = request.content_type.as_deref() {
            upstream_request = upstream_request.header(CONTENT_TYPE, content_type);
        }

        if let Some(accept) = request.accept.as_deref() {
            upstream_request = upstream_request.header(ACCEPT, accept);
        }

        if !request.body.is_empty() {
            upstream_request = upstream_request.body(request.body);
        }

        upstream_request.send().await.map_err(|error| {
            ProfileSyncError::new(ProfileSyncErrorKind::Unreachable, error.to_string())
        })
    }

    pub async fn forward(
        &self,
        remote_base_url: Option<&str>,
        request: ProfileSyncForwardRequest,
    ) -> Result<ProfileSyncForwardResponse, ProfileSyncError> {
        let response = self.send(remote_base_url, request).await?;
        read_forward_response(response).await
    }

    pub async fn forward_login(
        &self,
        remote_base_url: Option<&str>,
        request: ProfileSyncForwardRequest,
    ) -> Result<ProfileSyncForwardOutcome, ProfileSyncError> {
        let response = self.forward(remote_base_url, request).await?;
        let session_mutation = session_mutation_from_login_response(&response);

        Ok(ProfileSyncForwardOutcome {
            response,
            session_mutation,
        })
    }

    pub async fn forward_logout(
        &self,
        remote_base_url: Option<&str>,
        request: ProfileSyncForwardRequest,
    ) -> Result<ProfileSyncForwardOutcome, ProfileSyncError> {
        let response = self.forward(remote_base_url, request).await?;

        Ok(ProfileSyncForwardOutcome {
            response,
            session_mutation: ProfileSyncSessionMutation::Clear,
        })
    }

    pub async fn forward_passthrough(
        &self,
        remote_base_url: Option<&str>,
        request: ProfileSyncForwardRequest,
    ) -> Result<ProfileSyncForwardOutcome, ProfileSyncError> {
        let response = self.forward(remote_base_url, request).await?;
        let session_mutation = if response.status == StatusCode::UNAUTHORIZED {
            ProfileSyncSessionMutation::Clear
        } else {
            ProfileSyncSessionMutation::Keep
        };

        Ok(ProfileSyncForwardOutcome {
            response,
            session_mutation,
        })
    }

    pub async fn fetch_server_config(
        &self,
        remote_base_url: &str,
    ) -> Result<RemoteServerConfigResponse, ProfileSyncError> {
        let response = self
            .send(
                Some(remote_base_url),
                ProfileSyncForwardRequest::get("/api/server-config"),
            )
            .await?;
        let status = response.status();

        if status == StatusCode::UNAUTHORIZED {
            return Err(ProfileSyncError::new(
                ProfileSyncErrorKind::Unauthorized,
                "远端账号同步后端返回 401",
            ));
        }

        if !status.is_success() {
            return Err(ProfileSyncError::new(
                ProfileSyncErrorKind::UpstreamFailure,
                format!("远端账号同步后端返回 {}", status.as_u16()),
            ));
        }

        response.json().await.map_err(|error| {
            ProfileSyncError::new(
                ProfileSyncErrorKind::ProtocolIncompatible,
                error.to_string(),
            )
        })
    }

    pub async fn build_status_response(
        &self,
        remote_base_url: Option<&str>,
        session: Option<&ProfileSyncSession>,
    ) -> ProfileSyncStatusResponse {
        let enabled = remote_base_url.is_some();
        let username = session.map(|item| item.username.clone());
        let role = session.map(|item| item.role.clone());

        let Some(remote_base_url) = remote_base_url else {
            return ProfileSyncStatusResponse {
                enabled: false,
                reachable: false,
                authenticated: false,
                username: None,
                role: None,
                storage_type: None,
                profile_mode: None,
                error: None,
                error_kind: None,
                sync_domains: profile_sync_user_data_domains(),
            };
        };

        match self.fetch_server_config(remote_base_url).await {
            Ok(server_config) => ProfileSyncStatusResponse {
                enabled,
                reachable: true,
                authenticated: session.is_some(),
                username,
                role,
                storage_type: server_config.storage_type,
                profile_mode: server_config.profile_mode,
                error: None,
                error_kind: None,
                sync_domains: profile_sync_user_data_domains(),
            },
            Err(error) => ProfileSyncStatusResponse {
                enabled,
                reachable: matches!(
                    error.kind,
                    ProfileSyncErrorKind::Unauthorized
                        | ProfileSyncErrorKind::ProtocolIncompatible
                        | ProfileSyncErrorKind::UpstreamFailure
                ),
                authenticated: session.is_some()
                    && !matches!(error.kind, ProfileSyncErrorKind::Unauthorized),
                username,
                role,
                storage_type: None,
                profile_mode: None,
                error: Some(error.message),
                error_kind: Some(error.kind),
                sync_domains: profile_sync_user_data_domains(),
            },
        }
    }
}

async fn read_forward_response(
    response: reqwest::Response,
) -> Result<ProfileSyncForwardResponse, ProfileSyncError> {
    let status = response.status();
    let content_type = response
        .headers()
        .get(CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .map(str::to_string);
    let body = response.bytes().await.map_err(|error| {
        ProfileSyncError::new(ProfileSyncErrorKind::UpstreamFailure, error.to_string())
    })?;

    Ok(ProfileSyncForwardResponse {
        status,
        content_type,
        body: body.to_vec(),
    })
}

fn session_mutation_from_login_response(
    response: &ProfileSyncForwardResponse,
) -> ProfileSyncSessionMutation {
    if let Some(session) = session_from_login_response(response.status, &response.body) {
        return ProfileSyncSessionMutation::Set(session);
    }

    if response.status == StatusCode::UNAUTHORIZED {
        return ProfileSyncSessionMutation::Clear;
    }

    ProfileSyncSessionMutation::Keep
}

fn profile_sync_user_data_domains() -> Vec<String> {
    PROFILE_SYNC_USER_DATA_DOMAINS
        .iter()
        .map(|value| (*value).to_string())
        .collect()
}

pub fn build_profile_sync_target_url(
    remote_base_url: &str,
    request_path: &str,
) -> Result<Url, ProfileSyncError> {
    let base_url = format!("{}/", remote_base_url.trim_end_matches('/'));
    let base = Url::parse(&base_url).map_err(|error| {
        ProfileSyncError::new(
            ProfileSyncErrorKind::InvalidBaseUrl,
            format!("无效的账号同步地址: {error}"),
        )
    })?;
    base.join(request_path.trim_start_matches('/'))
        .map_err(|error| {
            ProfileSyncError::new(
                ProfileSyncErrorKind::InvalidBaseUrl,
                format!("无法解析账号同步目标地址: {error}"),
            )
        })
}

pub fn session_from_login_response(status: StatusCode, body: &[u8]) -> Option<ProfileSyncSession> {
    if !status.is_success() {
        return None;
    }

    let login_response = serde_json::from_slice::<RemoteLoginResponse>(body).ok()?;
    if !login_response.ok.unwrap_or(true) {
        return None;
    }

    let username = normalize_optional_string(login_response.username)?;
    let role = normalize_optional_string(login_response.role).unwrap_or_else(|| "user".to_string());

    Some(ProfileSyncSession { username, role })
}

fn normalize_optional_string(value: Option<String>) -> Option<String> {
    value.and_then(|item| {
        let trimmed = item.trim();
        if trimmed.is_empty() {
            None
        } else {
            Some(trimmed.to_string())
        }
    })
}

#[cfg(test)]
mod tests {
    use axum::{
        Json, Router,
        body::to_bytes,
        extract::Request,
        http::{HeaderMap, StatusCode, header::CONTENT_TYPE},
        response::IntoResponse,
        routing::{get, post},
    };
    use serde_json::{Value, json};
    use tokio::net::TcpListener;

    use super::{
        PROFILE_SYNC_USER_DATA_DOMAINS, ProfileSyncClient, ProfileSyncError, ProfileSyncErrorKind,
        ProfileSyncForwardRequest, ProfileSyncSession, ProfileSyncSessionMutation,
        build_profile_sync_target_url, session_from_login_response,
    };

    #[test]
    fn build_target_url_preserves_query_and_trims_slashes() {
        let target = build_profile_sync_target_url(
            "https://example.com/base/",
            "/api/playrecords?hello=world",
        )
        .expect("build target url");

        assert_eq!(
            target.as_str(),
            "https://example.com/base/api/playrecords?hello=world"
        );
    }

    #[test]
    fn profile_sync_error_http_status_matches_error_kind() {
        let cases = [
            (ProfileSyncErrorKind::NotConfigured, StatusCode::NOT_IMPLEMENTED),
            (ProfileSyncErrorKind::InvalidBaseUrl, StatusCode::BAD_REQUEST),
            (ProfileSyncErrorKind::Unreachable, StatusCode::BAD_GATEWAY),
            (ProfileSyncErrorKind::Unauthorized, StatusCode::BAD_GATEWAY),
            (
                ProfileSyncErrorKind::ProtocolIncompatible,
                StatusCode::BAD_GATEWAY,
            ),
            (ProfileSyncErrorKind::UpstreamFailure, StatusCode::BAD_GATEWAY),
        ];

        for (kind, expected_status) in cases {
            let error = ProfileSyncError::new(kind, "demo");
            assert_eq!(kind.http_status(), expected_status);
            assert_eq!(error.http_status(), expected_status);
        }
    }

    #[test]
    fn session_from_login_response_extracts_remote_session() {
        let session = session_from_login_response(
            StatusCode::OK,
            br#"{"ok":true,"username":" desktop-user ","role":" owner "}"#,
        )
        .expect("session from login response");

        assert_eq!(
            session,
            ProfileSyncSession {
                username: "desktop-user".to_string(),
                role: "owner".to_string(),
            }
        );
    }

    #[tokio::test]
    async fn profile_sync_client_forwards_headers_body_and_query() {
        let upstream = spawn_mock_server(Router::new().route(
            "/api/playrecords",
            post(|headers: HeaderMap, request: Request| async move {
                let body = to_bytes(request.into_body(), usize::MAX)
                    .await
                    .expect("request body");
                Json(json!({
                    "contentType": headers.get(CONTENT_TYPE).and_then(|value| value.to_str().ok()),
                    "accept": headers.get("accept").and_then(|value| value.to_str().ok()),
                    "body": String::from_utf8(body.to_vec()).expect("utf8 body"),
                }))
            }),
        ))
        .await;
        let client = ProfileSyncClient::new(reqwest::Client::new());

        let response = client
            .send(
                Some(&upstream.base_url()),
                ProfileSyncForwardRequest::new(
                    reqwest::Method::POST,
                    "/api/playrecords?source=demo",
                )
                .with_accept(Some("application/json".to_string()))
                .with_content_type(Some("application/json".to_string()))
                .with_body(br#"{"key":"demo+1"}"#.to_vec()),
            )
            .await
            .expect("send sync request");

        assert_eq!(response.status(), StatusCode::OK);
        let payload = response.json::<Value>().await.expect("forward payload");
        assert_eq!(
            payload.get("contentType").and_then(Value::as_str),
            Some("application/json")
        );
        assert_eq!(
            payload.get("accept").and_then(Value::as_str),
            Some("application/json")
        );
        assert_eq!(
            payload.get("body").and_then(Value::as_str),
            Some(r#"{"key":"demo+1"}"#)
        );

        upstream.abort();
    }

    #[tokio::test]
    async fn forward_login_extracts_session_mutation() {
        let upstream = spawn_mock_server(Router::new().route(
            "/api/login",
            post(|| async move {
                Json(json!({
                    "ok": true,
                    "username": "desktop-user",
                    "role": "owner"
                }))
            }),
        ))
        .await;
        let client = ProfileSyncClient::new(reqwest::Client::new());

        let outcome = client
            .forward_login(
                Some(&upstream.base_url()),
                ProfileSyncForwardRequest::new(reqwest::Method::POST, "/api/login"),
            )
            .await
            .expect("forward login response");

        assert_eq!(outcome.response.status, StatusCode::OK);
        assert_eq!(
            outcome.session_mutation,
            ProfileSyncSessionMutation::Set(ProfileSyncSession {
                username: "desktop-user".to_string(),
                role: "owner".to_string(),
            })
        );

        upstream.abort();
    }

    #[tokio::test]
    async fn forward_passthrough_clears_session_on_unauthorized() {
        let upstream = spawn_mock_server(Router::new().route(
            "/api/playrecords",
            get(|| async move { StatusCode::UNAUTHORIZED.into_response() }),
        ))
        .await;
        let client = ProfileSyncClient::new(reqwest::Client::new());

        let outcome = client
            .forward_passthrough(
                Some(&upstream.base_url()),
                ProfileSyncForwardRequest::get("/api/playrecords"),
            )
            .await
            .expect("forward passthrough response");

        assert_eq!(outcome.response.status, StatusCode::UNAUTHORIZED);
        assert_eq!(outcome.session_mutation, ProfileSyncSessionMutation::Clear);

        upstream.abort();
    }

    #[tokio::test]
    async fn build_status_response_reports_remote_probe_success() {
        let upstream = spawn_mock_server(Router::new().route(
            "/api/server-config",
            get(|| async move {
                Json(json!({
                    "StorageType": "database",
                    "ProfileMode": "shared-multi-user"
                }))
            }),
        ))
        .await;
        let client = ProfileSyncClient::new(reqwest::Client::new());
        let session = ProfileSyncSession {
            username: "demo".to_string(),
            role: "user".to_string(),
        };

        let payload = client
            .build_status_response(Some(&upstream.base_url()), Some(&session))
            .await;

        assert!(payload.enabled);
        assert!(payload.reachable);
        assert!(payload.authenticated);
        assert_eq!(payload.storage_type.as_deref(), Some("database"));
        assert_eq!(payload.profile_mode.as_deref(), Some("shared-multi-user"));
        assert_eq!(payload.username.as_deref(), Some("demo"));
        assert_eq!(payload.role.as_deref(), Some("user"));
        assert_eq!(payload.error, None);
        assert_eq!(payload.error_kind, None);
        assert_eq!(
            payload.sync_domains,
            PROFILE_SYNC_USER_DATA_DOMAINS
                .iter()
                .map(|value| (*value).to_string())
                .collect::<Vec<_>>()
        );

        upstream.abort();
    }

    #[tokio::test]
    async fn build_status_response_classifies_invalid_base_url() {
        let client = ProfileSyncClient::new(reqwest::Client::new());

        let payload = client.build_status_response(Some("not a url"), None).await;

        assert!(payload.enabled);
        assert!(!payload.reachable);
        assert!(!payload.authenticated);
        assert_eq!(
            payload.error_kind,
            Some(ProfileSyncErrorKind::InvalidBaseUrl)
        );
        assert!(
            payload
                .error
                .as_deref()
                .is_some_and(|value| value.contains("无效的账号同步地址"))
        );
    }

    #[tokio::test]
    async fn fetch_server_config_reports_unauthorized_as_reachable_error() {
        let upstream = spawn_mock_server(Router::new().route(
            "/api/server-config",
            get(|| async move { StatusCode::UNAUTHORIZED.into_response() }),
        ))
        .await;
        let client = ProfileSyncClient::new(reqwest::Client::new());

        let error = client
            .fetch_server_config(&upstream.base_url())
            .await
            .expect_err("unauthorized fetch should fail");

        assert_eq!(error.kind, ProfileSyncErrorKind::Unauthorized);

        let payload = client
            .build_status_response(Some(&upstream.base_url()), None)
            .await;
        assert!(payload.reachable);
        assert!(!payload.authenticated);
        assert_eq!(payload.error_kind, Some(ProfileSyncErrorKind::Unauthorized));
        assert!(
            payload
                .error
                .as_deref()
                .is_some_and(|value| value.contains("401"))
        );

        upstream.abort();
    }

    #[tokio::test]
    async fn build_status_response_reports_protocol_incompatible_as_reachable_error() {
        let upstream = spawn_mock_server(Router::new().route(
            "/api/server-config",
            get(|| async move { (StatusCode::OK, "not-json").into_response() }),
        ))
        .await;
        let client = ProfileSyncClient::new(reqwest::Client::new());

        let payload = client
            .build_status_response(Some(&upstream.base_url()), None)
            .await;

        assert!(payload.enabled);
        assert!(payload.reachable);
        assert!(!payload.authenticated);
        assert_eq!(
            payload.error_kind,
            Some(ProfileSyncErrorKind::ProtocolIncompatible)
        );
        assert!(payload.error.as_deref().is_some_and(|value| !value.is_empty()));

        upstream.abort();
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
}
