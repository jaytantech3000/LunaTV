#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;
use std::{
    collections::{BTreeMap, BTreeSet, hash_map::DefaultHasher},
    fs,
    hash::{Hash, Hasher},
    io::ErrorKind,
    net::TcpListener,
    path::{Path, PathBuf},
    process::{Child, Command, Stdio},
    sync::Mutex,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};

use anyhow::{Context, Result};
use base64::{Engine as _, engine::general_purpose::STANDARD as BASE64_STANDARD};
use futures::StreamExt;
use minisign_verify::{PublicKey, Signature};
use reqwest::{
    ClientBuilder, StatusCode,
    header::{ACCEPT, CONTENT_LENGTH, CONTENT_RANGE, HeaderMap, HeaderValue, RANGE},
};
use semver::Version;
#[cfg(target_os = "windows")]
use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};
use tauri::{
    AppHandle, Emitter, Manager, RunEvent, State,
    ipc::Channel,
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
};
use tauri_plugin_updater::{Update as DesktopUpdateHandle, UpdaterExt};
use tokio::{
    fs::{self as tokio_fs, OpenOptions as TokioOpenOptions},
    io::{AsyncReadExt, AsyncWriteExt},
    process::Command as TokioCommand,
    sync::{Mutex as AsyncMutex, watch},
};
use url::Url;

const LOCAL_SERVICE_PORT: u16 = 8787;
const LOCAL_SERVICE_HEALTH_PATH: &str = "/health";
const LOCAL_SERVICE_PROFILE_SYNC_STATUS_PATH: &str = "/api/profile-sync/status";
const LOCAL_SERVICE_BINARY_NAME: &str = "moontv-local-service";
const LOCAL_SERVICE_CONFIG_FILE_NAME: &str = "desktop.config.json";
const LOCAL_SERVICE_DB_FILE_NAME: &str = "moontv-desktop.sqlite3";
const ADMIN_PERSISTENCE_FILE_NAME: &str = "desktop-admin-state.json";
const DEFAULT_DESKTOP_OWNER_USERNAME: &str = "owner";
const LOCAL_SERVICE_STARTUP_TIMEOUT: Duration = Duration::from_secs(30);
const LOCAL_SERVICE_STARTUP_RETRY_INTERVAL: Duration = Duration::from_millis(250);
const LOCAL_SERVICE_HEALTH_CONNECT_TIMEOUT: Duration = Duration::from_millis(350);
const LOCAL_SERVICE_HEALTH_WRITE_TIMEOUT: Duration = Duration::from_millis(250);
const LOCAL_SERVICE_HEALTH_READ_TIMEOUT: Duration = Duration::from_millis(400);
#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x08000000;
const DESKTOP_UPDATE_DOWNLOAD_DIR_NAME: &str = "update-downloads";
const DESKTOP_UPDATER_USER_AGENT: &str =
    concat!(env!("CARGO_PKG_NAME"), "/", env!("CARGO_PKG_VERSION"));
const DESKTOP_UPDATER_NETWORK_TIMEOUT: Duration = Duration::from_secs(3);
const GITHUB_API_BASE_URL: &str = "https://api.github.com";
const DESKTOP_RELEASE_TAG_PREFIX: &str = "desktop-v";
const DESKTOP_RELEASE_MANIFEST_NAME: &str = "latest.json";
const MUSIC_TRAY_ID: &str = "music-tray";
const MUSIC_TRAY_EVENT_NAME: &str = "music-tray-command";
const MUSIC_TRAY_OPEN_ID: &str = "music-tray-open";
const MUSIC_TRAY_TOGGLE_PLAY_ID: &str = "music-tray-toggle-play";
const MUSIC_TRAY_PREVIOUS_ID: &str = "music-tray-previous";
const MUSIC_TRAY_NEXT_ID: &str = "music-tray-next";
const MUSIC_TRAY_QUIT_ID: &str = "music-tray-quit";
const MUSIC_TRAY_IDLE_TITLE: &str = "Luna Music";
const MUSIC_TRAY_IDLE_TOOLTIP: &str = "Luna Music is ready";

const DEFAULT_DESKTOP_CONFIG: &str = include_str!("../../config.example.json");
const PROFILE_SYNC_USER_DATA_DOMAINS: [&str; 5] = [
    "playrecords",
    "favorites",
    "follows",
    "searchhistory",
    "skipconfigs",
];

#[derive(Default)]
struct DesktopRuntimeState {
    service_process: Mutex<Option<ServiceProcess>>,
    service_start_lock: AsyncMutex<()>,
    last_start_failure: Mutex<Option<LocalServiceStartupFailure>>,
    active_update_download: Mutex<Option<ActiveDesktopUpdateDownload>>,
    paused_update_download: Mutex<Option<PausedDesktopUpdateDownload>>,
    downloaded_update: Mutex<Option<DownloadedDesktopUpdate>>,
}

struct ActiveDesktopUpdateDownload {
    target_version: String,
    command_tx: watch::Sender<DesktopUpdateDownloadCommand>,
}

#[derive(Clone)]
struct DownloadedDesktopUpdate {
    version: String,
    update: DesktopUpdateHandle,
    file_path: PathBuf,
}

#[derive(Clone)]
struct PausedDesktopUpdateDownload {
    version: String,
    download_url: Url,
    signature: String,
    file_path: PathBuf,
    total_bytes: Option<u64>,
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum DesktopUpdateDownloadCommand {
    Running,
    Pause,
    Cancel,
}

enum DesktopUpdateDownloadResult {
    Completed {
        file_path: PathBuf,
    },
    Paused {
        file_path: PathBuf,
        total_bytes: Option<u64>,
    },
    Canceled,
}

struct ServiceProcess {
    base_url: String,
    child: Child,
    config_path: PathBuf,
    data_dir: PathBuf,
    sqlite_path: PathBuf,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct LocalServiceStatus {
    running: bool,
    port: u16,
    base_url: String,
    config_path: String,
    data_dir: String,
    sqlite_path: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct DesktopAvailableUpdate {
    version: String,
    current_version: String,
    date: Option<String>,
    body: Option<String>,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(untagged)]
enum GithubReleaseIdentifier {
    String(String),
    Number(u64),
}

#[derive(Clone, Serialize, Deserialize)]
struct GithubReleaseAssetPayload {
    name: Option<String>,
    browser_download_url: Option<String>,
}

#[derive(Clone, Serialize, Deserialize)]
struct GithubReleasePayload {
    id: Option<GithubReleaseIdentifier>,
    tag_name: Option<String>,
    name: Option<String>,
    body: Option<String>,
    draft: Option<bool>,
    prerelease: Option<bool>,
    published_at: Option<String>,
    created_at: Option<String>,
    html_url: Option<String>,
    assets: Option<Vec<GithubReleaseAssetPayload>>,
}

#[derive(Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct DesktopReleaseHistoryItem {
    id: String,
    version: String,
    tag_name: String,
    name: String,
    notes: Option<String>,
    prerelease: bool,
    published_at: Option<String>,
    html_url: Option<String>,
    manifest_url: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct DesktopAuthStatus {
    username: String,
    password_required: bool,
    multi_user: bool,
    owner_password_configured: bool,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct DesktopAuthSession {
    username: String,
    role: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct MusicTrayCommandEventPayload {
    command: String,
}

#[derive(Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
enum DesktopMusicTrayPlayState {
    Idle,
    Playing,
    Paused,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DesktopMusicTrayStatePayload {
    title: Option<String>,
    artist_text: Option<String>,
    source: Option<String>,
    play_state: DesktopMusicTrayPlayState,
    queue_length: usize,
}

#[derive(Clone)]
struct LocalServiceStartupFailure {
    captured_at_ms: u64,
    message: String,
}

#[derive(Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
enum DiagnosticLevel {
    Ok,
    Warning,
    Error,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct LocalServiceDiagnosticFinding {
    level: DiagnosticLevel,
    title: String,
    detail: String,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct LocalServiceDiagnosticsReport {
    status: DiagnosticLevel,
    captured_at_ms: u64,
    summary: String,
    findings: Vec<LocalServiceDiagnosticFinding>,
    recommendations: Vec<String>,
    log_text: String,
}

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct LocalProfileSyncStatus {
    enabled: bool,
    reachable: bool,
    authenticated: bool,
    username: Option<String>,
    role: Option<String>,
    storage_type: Option<String>,
    profile_mode: Option<String>,
    error: Option<String>,
    error_kind: Option<String>,
    #[serde(default)]
    sync_domains: Vec<String>,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct LocalServiceDiagnosticsUploadResult {
    uploaded: bool,
    target: String,
    issue_url: Option<String>,
    issue_number: Option<u64>,
    message: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct LocalServiceDiagnosticsSaveResult {
    saved: bool,
    canceled: bool,
    path: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "event", content = "data")]
enum DesktopReleaseInstallEvent {
    #[serde(rename_all = "camelCase")]
    Started {
        content_length: Option<u64>,
        downloaded_length: Option<u64>,
    },
    #[serde(rename_all = "camelCase")]
    Progress {
        chunk_length: usize,
    },
    Finished,
    Installing,
}

const DESKTOP_UPDATE_DOWNLOAD_PAUSED: &str = "desktop update download paused";
const DESKTOP_UPDATE_DOWNLOAD_CANCELED: &str = "desktop update download canceled";

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct LocalServiceDiagnosticsUploadRequest {
    source_app: String,
    app_version: String,
    target_triple: String,
    platform: String,
    uploaded_at_ms: u64,
    report: LocalServiceDiagnosticsReport,
}

struct SidecarTrialResult {
    pid: Option<u32>,
    healthy: bool,
    timed_out: bool,
    spawn_error: Option<String>,
    health_check_detail: Option<String>,
    port_observation: Option<String>,
    exit_status: Option<i32>,
    stdout: String,
    stderr: String,
}

#[derive(Clone, Debug, Default, PartialEq, Eq)]
struct LocalServiceHealthCheck {
    healthy: bool,
    status_code: Option<u16>,
    error: Option<String>,
    version: Option<String>,
}

impl LocalServiceHealthCheck {
    fn failure_detail(&self) -> Option<String> {
        if self.healthy {
            return None;
        }

        if let Some(status_code) = self.status_code {
            return Some(format!("health endpoint returned HTTP {status_code}"));
        }

        self.error.clone()
    }
}

#[derive(Clone, Debug, Deserialize, Default, PartialEq, Eq)]
struct LocalServiceHealthPayload {
    version: Option<String>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PortOccupant {
    pid: u32,
    local_address: String,
    state: String,
    process_name: Option<String>,
}

struct PortInspection {
    bind_available: bool,
    occupants: Vec<PortOccupant>,
    debug_lines: Vec<String>,
}

#[derive(Debug, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct WindowsDiagnosticSnapshot {
    os: Option<WindowsOsSnapshot>,
    computer: Option<WindowsComputerSnapshot>,
    #[serde(default)]
    cpus: Vec<WindowsCpuSnapshot>,
    #[serde(default)]
    gpus: Vec<WindowsGpuSnapshot>,
    #[serde(default)]
    network: Vec<WindowsNetworkAdapterSnapshot>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct WindowsOsSnapshot {
    caption: Option<String>,
    version: Option<String>,
    build_number: Option<String>,
    architecture: Option<String>,
    computer_name: Option<String>,
    last_boot_up_time: Option<String>,
    free_physical_memory_kb: Option<u64>,
    total_visible_memory_kb: Option<u64>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct WindowsComputerSnapshot {
    manufacturer: Option<String>,
    model: Option<String>,
    system_type: Option<String>,
    total_physical_memory_bytes: Option<u64>,
    processors: Option<u32>,
    logical_processors: Option<u32>,
    hypervisor_present: Option<bool>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct WindowsCpuSnapshot {
    name: Option<String>,
    manufacturer: Option<String>,
    cores: Option<u32>,
    logical_processors: Option<u32>,
    max_clock_mhz: Option<u32>,
    processor_id: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct WindowsGpuSnapshot {
    name: Option<String>,
    driver_version: Option<String>,
    adapter_ram_bytes: Option<u64>,
    video_processor: Option<String>,
    status: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct WindowsNetworkAdapterSnapshot {
    name: Option<String>,
    description: Option<String>,
    service_name: Option<String>,
    manufacturer: Option<String>,
    adapter_type: Option<String>,
    mac_address: Option<String>,
    dhcp_enabled: Option<bool>,
    net_enabled: Option<bool>,
    speed_bits_per_second: Option<u64>,
    #[serde(default)]
    ipv4: Vec<String>,
    #[serde(default)]
    ipv6: Vec<String>,
    #[serde(default)]
    gateways: Vec<String>,
    #[serde(default)]
    dns_servers: Vec<String>,
    dns_domain: Option<String>,
}

#[derive(Debug, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct WindowsPortOccupantsPayload {
    #[serde(default)]
    occupants: Vec<PortOccupant>,
}

#[derive(Debug, Deserialize, Default)]
struct DesktopAppConfigDocument {
    #[serde(default)]
    auth: DesktopAuthConfig,
}

#[derive(Debug, Deserialize, Default)]
struct DesktopAuthConfig {
    username: Option<String>,
    password: Option<String>,
}

struct ResolvedDesktopAuthConfig {
    username: String,
    password: Option<String>,
    local_users: Vec<DesktopLocalAuthUser>,
}

#[derive(Debug)]
struct DesktopLocalAuthUser {
    username: String,
    role: String,
    password: Option<String>,
    banned: bool,
}

#[derive(Debug, Deserialize, Default)]
struct DesktopAdminPersistenceDocument {
    #[serde(default)]
    config: DesktopAdminConfigDocument,
    #[serde(rename = "userPasswords", default)]
    user_passwords: BTreeMap<String, String>,
}

#[derive(Debug, Deserialize, Default)]
struct DesktopAdminConfigDocument {
    #[serde(rename = "UserConfig", default)]
    user_config: DesktopUserConfigDocument,
}

#[derive(Debug, Deserialize, Default)]
struct DesktopUserConfigDocument {
    #[serde(rename = "Users", default)]
    users: Vec<DesktopUserConfigItem>,
}

#[derive(Debug, Deserialize)]
struct DesktopUserConfigItem {
    username: String,
    role: String,
    #[serde(default)]
    banned: bool,
}

#[tauri::command]
async fn start_local_service(
    app: AppHandle,
    state: State<'_, DesktopRuntimeState>,
) -> Result<LocalServiceStatus, String> {
    start_local_service_impl(&app, &state)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn stop_local_service(state: State<'_, DesktopRuntimeState>) -> Result<LocalServiceStatus, String> {
    stop_local_service_impl(&state).map_err(|error| error.to_string())
}

#[tauri::command]
async fn get_local_service_status(
    app: AppHandle,
    state: State<'_, DesktopRuntimeState>,
) -> Result<LocalServiceStatus, String> {
    get_local_service_status_impl(&app, &state)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
async fn run_local_service_diagnostics(
    app: AppHandle,
    state: State<'_, DesktopRuntimeState>,
) -> Result<LocalServiceDiagnosticsReport, String> {
    Ok(run_local_service_diagnostics_impl(&app, &state).await)
}

#[tauri::command]
async fn upload_local_service_diagnostics(
    app: AppHandle,
    remote_base_url: String,
    report: LocalServiceDiagnosticsReport,
) -> Result<LocalServiceDiagnosticsUploadResult, String> {
    upload_local_service_diagnostics_impl(&app, remote_base_url, report)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn save_local_service_diagnostics(
    default_filename: String,
    contents: String,
) -> Result<LocalServiceDiagnosticsSaveResult, String> {
    save_local_service_diagnostics_impl(default_filename, contents)
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn read_app_config(app: AppHandle) -> Result<serde_json::Value, String> {
    let paths = resolve_runtime_paths(&app).map_err(|error| error.to_string())?;
    ensure_desktop_config_file(&paths.config_path).map_err(|error| error.to_string())?;
    let contents = fs::read_to_string(&paths.config_path).map_err(|error| error.to_string())?;
    serde_json::from_str(&contents).map_err(|error| error.to_string())
}

#[tauri::command]
fn write_app_config(
    app: AppHandle,
    config: serde_json::Value,
) -> Result<serde_json::Value, String> {
    let paths = resolve_runtime_paths(&app).map_err(|error| error.to_string())?;
    if let Some(parent_dir) = paths.config_path.parent() {
        fs::create_dir_all(parent_dir).map_err(|error| error.to_string())?;
    }
    let contents = serde_json::to_string_pretty(&config).map_err(|error| error.to_string())?;
    fs::write(&paths.config_path, contents).map_err(|error| error.to_string())?;
    Ok(config)
}

#[tauri::command]
fn get_desktop_auth_status(app: AppHandle) -> Result<DesktopAuthStatus, String> {
    get_desktop_auth_status_impl(&app).map_err(|error| error.to_string())
}

#[tauri::command]
fn desktop_login(
    app: AppHandle,
    username: Option<String>,
    password: Option<String>,
) -> Result<DesktopAuthSession, String> {
    let auth_config = resolve_desktop_auth_config(&app).map_err(|error| error.to_string())?;
    let requested_username =
        normalize_optional_string(username).unwrap_or_else(|| auth_config.username.clone());
    let provided_password = password.unwrap_or_default();

    if requested_username == auth_config.username {
        if let Some(expected_password) = auth_config.password {
            if provided_password.trim() != expected_password {
                return Err("用户名或密码错误".to_string());
            }
        }

        return Ok(DesktopAuthSession {
            username: requested_username,
            role: "owner".to_string(),
        });
    }

    let target_user = auth_config
        .local_users
        .into_iter()
        .find(|user| user.username == requested_username)
        .ok_or_else(|| "用户名或密码错误".to_string())?;

    if target_user.banned {
        return Err("账号已被禁用".to_string());
    }

    let expected_password = target_user
        .password
        .ok_or_else(|| "该账号未配置密码".to_string())?;

    if provided_password.trim() != expected_password {
        return Err("用户名或密码错误".to_string());
    }

    Ok(DesktopAuthSession {
        username: target_user.username,
        role: target_user.role,
    })
}

#[tauri::command]
fn change_desktop_password(
    app: AppHandle,
    username: String,
    new_password: String,
) -> Result<DesktopAuthStatus, String> {
    change_desktop_password_impl(&app, username, new_password).map_err(|error| error.to_string())
}

#[tauri::command]
async fn install_desktop_release(
    app: AppHandle,
    state: State<'_, DesktopRuntimeState>,
    manifest_url: String,
    version: String,
    on_event: Channel<DesktopReleaseInstallEvent>,
) -> Result<(), String> {
    install_desktop_release_impl(&app, &state, manifest_url, version, on_event)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
async fn check_desktop_update(app: AppHandle) -> Result<Option<DesktopAvailableUpdate>, String> {
    check_desktop_update_impl(&app)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
async fn fetch_latest_remote_version(urls: Vec<String>) -> Result<Option<String>, String> {
    fetch_latest_remote_version_impl(urls)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
async fn fetch_desktop_release_history(
    repository: String,
) -> Result<Vec<DesktopReleaseHistoryItem>, String> {
    fetch_desktop_release_history_impl(repository)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
async fn download_desktop_release(
    app: AppHandle,
    state: State<'_, DesktopRuntimeState>,
    manifest_url: String,
    version: String,
    on_event: Channel<DesktopReleaseInstallEvent>,
) -> Result<(), String> {
    download_desktop_release_impl(&app, &state, manifest_url, version, on_event)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
async fn download_latest_desktop_update(
    app: AppHandle,
    state: State<'_, DesktopRuntimeState>,
    version: String,
    on_event: Channel<DesktopReleaseInstallEvent>,
) -> Result<(), String> {
    download_latest_desktop_update_impl(&app, &state, version, on_event)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn install_downloaded_desktop_update(
    app: AppHandle,
    state: State<'_, DesktopRuntimeState>,
    version: Option<String>,
) -> Result<(), String> {
    install_downloaded_desktop_update_impl(&app, &state, version).map_err(|error| error.to_string())
}

#[tauri::command]
fn pause_active_desktop_update_download(
    state: State<'_, DesktopRuntimeState>,
) -> Result<(), String> {
    request_active_update_download_command(&state, DesktopUpdateDownloadCommand::Pause)
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn cancel_active_desktop_update_download(
    state: State<'_, DesktopRuntimeState>,
) -> Result<(), String> {
    request_active_update_download_command(&state, DesktopUpdateDownloadCommand::Cancel)
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn clear_paused_desktop_update_download(
    state: State<'_, DesktopRuntimeState>,
) -> Result<(), String> {
    clear_paused_update_download(&state);
    Ok(())
}

#[tauri::command]
fn open_external_url(url: String) -> Result<(), String> {
    let url = normalize_required_string(url, "external URL cannot be empty")
        .map_err(|error| error.to_string())?;
    let parsed_url = Url::parse(&url).map_err(|error| error.to_string())?;

    if !matches!(parsed_url.scheme(), "http" | "https") {
        return Err("external URL must use http or https".into());
    }

    open_url_in_system_browser(parsed_url.as_str()).map_err(|error| error.to_string())
}

#[tauri::command]
fn update_music_tray_state(
    app: AppHandle,
    state: DesktopMusicTrayStatePayload,
) -> Result<(), String> {
    apply_music_tray_state(&app, &state).map_err(|error| error.to_string())
}

fn emit_music_tray_command(app: &AppHandle, command: &str) {
    if let Err(error) = app.emit(
        MUSIC_TRAY_EVENT_NAME,
        MusicTrayCommandEventPayload {
            command: command.to_string(),
        },
    ) {
        tracing::warn!("failed to emit music tray command {command}: {error}");
    }
}

fn focus_main_window(app: &AppHandle) -> Result<()> {
    let window = app
        .get_webview_window("main")
        .context("main window is unavailable")?;

    if window.is_minimized().unwrap_or(false) {
        let _ = window.unminimize();
    }

    let _ = window.show();
    let _ = window.set_focus();
    Ok(())
}

fn open_music_from_tray(app: &AppHandle) {
    if let Err(error) = focus_main_window(app) {
        tracing::warn!("failed to focus main window from music tray: {error}");
    }

    emit_music_tray_command(app, "open-music");
}

fn handle_music_tray_menu_event(app: &AppHandle, menu_id: &str) {
    match menu_id {
        MUSIC_TRAY_OPEN_ID => open_music_from_tray(app),
        MUSIC_TRAY_TOGGLE_PLAY_ID => emit_music_tray_command(app, "toggle-play"),
        MUSIC_TRAY_PREVIOUS_ID => emit_music_tray_command(app, "play-previous"),
        MUSIC_TRAY_NEXT_ID => emit_music_tray_command(app, "play-next"),
        MUSIC_TRAY_QUIT_ID => app.exit(0),
        _ => {}
    }
}

fn handle_music_tray_icon_event(app: &AppHandle, event: &TrayIconEvent) {
    let should_open_music = matches!(
        event,
        TrayIconEvent::Click {
            button: MouseButton::Left,
            button_state: MouseButtonState::Up,
            ..
        } | TrayIconEvent::DoubleClick {
            button: MouseButton::Left,
            ..
        }
    );

    if should_open_music {
        open_music_from_tray(app);
    }
}

fn resolve_music_tray_title(state: &DesktopMusicTrayStatePayload) -> Option<String> {
    let title = normalize_optional_trimmed_string(state.title.as_deref());

    if let Some(title) = title {
        let prefix = match state.play_state {
            DesktopMusicTrayPlayState::Idle => "Ready",
            DesktopMusicTrayPlayState::Playing => "Playing",
            DesktopMusicTrayPlayState::Paused => "Paused",
        };

        return Some(format!("{prefix}: {title}"));
    }

    Some(MUSIC_TRAY_IDLE_TITLE.to_string())
}

fn resolve_music_tray_tooltip(state: &DesktopMusicTrayStatePayload) -> String {
    let title = normalize_optional_trimmed_string(state.title.as_deref());

    if let Some(title) = title {
        let status = match state.play_state {
            DesktopMusicTrayPlayState::Idle => "Ready",
            DesktopMusicTrayPlayState::Playing => "Playing",
            DesktopMusicTrayPlayState::Paused => "Paused",
        };
        let artist_text = normalize_optional_trimmed_string(state.artist_text.as_deref())
            .unwrap_or_else(|| "Unknown artist".to_string());
        let queue_text = if state.queue_length > 0 {
            format!("{} in queue", state.queue_length)
        } else {
            "Queue empty".to_string()
        };
        let source_text = normalize_optional_trimmed_string(state.source.as_deref())
            .unwrap_or_else(|| "music".to_string());

        return format!("{status}: {title}\n{artist_text}\n{queue_text} · {source_text}");
    }

    MUSIC_TRAY_IDLE_TOOLTIP.to_string()
}

fn apply_music_tray_state(app: &AppHandle, state: &DesktopMusicTrayStatePayload) -> Result<()> {
    let tray = app
        .tray_by_id(MUSIC_TRAY_ID)
        .context("music tray is unavailable")?;
    let tooltip = resolve_music_tray_tooltip(state);
    let title = resolve_music_tray_title(state);

    let _ = tray.set_tooltip(Some(tooltip.as_str()));
    #[cfg(not(target_os = "windows"))]
    {
        let _ = tray.set_title(title.as_deref());
    }

    Ok(())
}

fn install_music_tray(app: &AppHandle) -> Result<()> {
    let open_item = MenuItem::with_id(app, MUSIC_TRAY_OPEN_ID, "Open Music", true, None::<&str>)?;
    let previous_item =
        MenuItem::with_id(app, MUSIC_TRAY_PREVIOUS_ID, "Previous", true, None::<&str>)?;
    let toggle_play_item =
        MenuItem::with_id(app, MUSIC_TRAY_TOGGLE_PLAY_ID, "Play / Pause", true, None::<&str>)?;
    let next_item = MenuItem::with_id(app, MUSIC_TRAY_NEXT_ID, "Next", true, None::<&str>)?;
    let quit_item = MenuItem::with_id(app, MUSIC_TRAY_QUIT_ID, "Quit", true, None::<&str>)?;
    let menu = Menu::with_items(
        app,
        &[
            &open_item,
            &PredefinedMenuItem::separator(app)?,
            &previous_item,
            &toggle_play_item,
            &next_item,
            &PredefinedMenuItem::separator(app)?,
            &quit_item,
        ],
    )?;

    let mut tray_builder = TrayIconBuilder::with_id(MUSIC_TRAY_ID)
        .menu(&menu)
        .show_menu_on_left_click(false)
        .tooltip(MUSIC_TRAY_IDLE_TOOLTIP)
        .on_menu_event(|app, event| {
            handle_music_tray_menu_event(app, event.id().as_ref());
        })
        .on_tray_icon_event(|tray, event| {
            handle_music_tray_icon_event(tray.app_handle(), &event);
        });

    if let Some(icon) = app.default_window_icon().cloned() {
        tray_builder = tray_builder.icon(icon);
    }

    #[cfg(not(target_os = "windows"))]
    {
        tray_builder = tray_builder.title(MUSIC_TRAY_IDLE_TITLE);
    }

    let _tray = tray_builder.build(app)?;
    Ok(())
}

fn normalize_compile_time_value(value: Option<&'static str>) -> Option<String> {
    value
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
}

fn compile_time_updater_pubkey() -> Option<String> {
    normalize_compile_time_value(option_env!("LUNATV_UPDATER_PUBKEY"))
}

pub fn run() {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "info,lunatv_desktop_shell=info".into()),
        )
        .with_target(false)
        .without_time()
        .init();

    let app = tauri::Builder::default()
        .manage(DesktopRuntimeState::default())
        .plugin(tauri_plugin_process::init())
        .setup(|app| {
            let mut updater_builder = tauri_plugin_updater::Builder::new();

            if let Some(pubkey) = compile_time_updater_pubkey() {
                updater_builder = updater_builder.pubkey(pubkey);
            }

            app.handle().plugin(updater_builder.build())?;
            install_music_tray(app.handle())?;
            spawn_local_service_start(app.handle().clone());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            start_local_service,
            stop_local_service,
            get_local_service_status,
            run_local_service_diagnostics,
            upload_local_service_diagnostics,
            save_local_service_diagnostics,
            read_app_config,
            write_app_config,
            get_desktop_auth_status,
            desktop_login,
            change_desktop_password,
            check_desktop_update,
            fetch_latest_remote_version,
            fetch_desktop_release_history,
            download_desktop_release,
            download_latest_desktop_update,
            install_downloaded_desktop_update,
            pause_active_desktop_update_download,
            cancel_active_desktop_update_download,
            clear_paused_desktop_update_download,
            open_external_url,
            update_music_tray_state,
            install_desktop_release,
        ])
        .build(tauri::generate_context!())
        .expect("failed to build LunaTV desktop shell");

    app.run(|app_handle, event| {
        if matches!(event, RunEvent::Exit { .. }) {
            let state = app_handle.state::<DesktopRuntimeState>();
            if let Err(error) = stop_local_service_impl(&state) {
                tracing::warn!("failed to stop local service during shutdown: {error}");
            }
        }
    });
}

fn spawn_local_service_start(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        let state = app.state::<DesktopRuntimeState>();

        if let Err(error) = start_local_service_impl(&app, &state).await {
            tracing::error!("failed to start local service in background: {error}");
        }
    });
}

async fn start_local_service_impl(
    app: &AppHandle,
    state: &DesktopRuntimeState,
) -> Result<LocalServiceStatus> {
    let result = start_local_service_impl_inner(app, state).await;

    match result {
        Ok(status) => {
            clear_local_service_start_failure(state);
            Ok(status)
        }
        Err(error) => {
            record_local_service_start_failure(state, error.to_string());
            Err(error)
        }
    }
}

async fn start_local_service_impl_inner(
    app: &AppHandle,
    state: &DesktopRuntimeState,
) -> Result<LocalServiceStatus> {
    let _start_guard = state.service_start_lock.lock().await;
    let paths = resolve_runtime_paths(app)?;
    let current_version = app.package_info().version.to_string();
    ensure_desktop_config_file(&paths.config_path)?;
    fs::create_dir_all(&paths.data_dir)
        .with_context(|| format!("failed to create {}", paths.data_dir.display()))?;

    let base_url = format!("http://127.0.0.1:{LOCAL_SERVICE_PORT}");

    let existing_process_status = {
        let guard = state
            .service_process
            .lock()
            .map_err(|_| anyhow::anyhow!("failed to lock desktop runtime state"))?;

        guard.as_ref().map(|process| LocalServiceStatus {
            running: true,
            port: LOCAL_SERVICE_PORT,
            base_url: process.base_url.clone(),
            config_path: process.config_path.display().to_string(),
            data_dir: process.data_dir.display().to_string(),
            sqlite_path: process.sqlite_path.display().to_string(),
        })
    };

    if let Some(status) = existing_process_status {
        if local_service_is_healthy(&status.base_url).await {
            return Ok(status);
        }

        let mut guard = state
            .service_process
            .lock()
            .map_err(|_| anyhow::anyhow!("failed to lock desktop runtime state"))?;
        if let Some(existing_process) = guard.as_mut() {
            terminate_child_process(&mut existing_process.child)?;
            *guard = None;
        }
    }

    let untracked_health = local_service_health_check(&base_url).await;
    if untracked_health.healthy {
        if should_reuse_untracked_local_service(&untracked_health, &current_version) {
            tracing::warn!(
                "detected a healthy local service on {base_url} without a tracked child process; reusing matching version {current_version}"
            );

            return Ok(build_status(
                true,
                &base_url,
                &paths.config_path,
                &paths.data_dir,
                &paths.sqlite_path,
            ));
        }

        tracing::warn!(
            "detected a healthy local service on {base_url} without a tracked child process, but its version {:?} does not match current app {}; attempting restart",
            untracked_health.version,
            current_version
        );

        if !terminate_untracked_local_service(LOCAL_SERVICE_PORT)? {
            let detected_version = untracked_health.version.as_deref().unwrap_or("unknown");
            return Err(anyhow::anyhow!(
                "detected an untracked local service on {base_url} with version {detected_version}; current app expects {current_version}. Please fully quit LunaTV and retry."
            ));
        }

        tokio::time::sleep(LOCAL_SERVICE_STARTUP_RETRY_INTERVAL).await;
    }

    let sidecar_paths = resolve_sidecar_binary_paths(app, &current_version)?;
    let mut startup_errors = Vec::new();

    for sidecar_path in sidecar_paths {
        let mut command = Command::new(&sidecar_path);
        command
            .arg("--port")
            .arg(LOCAL_SERVICE_PORT.to_string())
            .arg("--config-path")
            .arg(&paths.config_path)
            .arg("--data-dir")
            .arg(&paths.data_dir)
            .arg("--sqlite-path")
            .arg(&paths.sqlite_path)
            .current_dir(&paths.data_dir)
            .stdin(Stdio::null())
            .stdout(if cfg!(debug_assertions) {
                Stdio::inherit()
            } else {
                Stdio::null()
            })
            .stderr(if cfg!(debug_assertions) {
                Stdio::inherit()
            } else {
                Stdio::null()
            });
        if !cfg!(debug_assertions) {
            configure_background_command(&mut command);
        }

        let child = command.spawn().with_context(|| {
            format!(
                "failed to spawn local service at {}",
                sidecar_path.display()
            )
        });

        let mut child = match child {
            Ok(child) => child,
            Err(error) => {
                startup_errors.push(error.to_string());
                continue;
            }
        };

        if let Err(error) = wait_for_local_service(&base_url, &mut child).await {
            if let Err(termination_error) = terminate_child_process(&mut child) {
                tracing::warn!(
                    "failed to terminate local service after startup error: {termination_error}"
                );
            }
            startup_errors.push(format!("{}: {error}", sidecar_path.display()));
            continue;
        }

        let started_health = local_service_health_check(&base_url).await;
        if !should_reuse_untracked_local_service(&started_health, &current_version) {
            let detected_version = started_health.version.as_deref().unwrap_or("unknown");
            if let Err(termination_error) = terminate_child_process(&mut child) {
                tracing::warn!(
                    "failed to terminate mismatched local service after startup: {termination_error}"
                );
            }
            startup_errors.push(format!(
                "{}: started local service version {detected_version}, expected {current_version}",
                sidecar_path.display()
            ));
            tokio::time::sleep(LOCAL_SERVICE_STARTUP_RETRY_INTERVAL).await;
            continue;
        }

        let mut guard = state
            .service_process
            .lock()
            .map_err(|_| anyhow::anyhow!("failed to lock desktop runtime state"))?;
        *guard = Some(ServiceProcess {
            base_url: base_url.clone(),
            child,
            config_path: paths.config_path.clone(),
            data_dir: paths.data_dir.clone(),
            sqlite_path: paths.sqlite_path.clone(),
        });

        return Ok(build_status(
            true,
            &base_url,
            &paths.config_path,
            &paths.data_dir,
            &paths.sqlite_path,
        ));
    }

    Err(anyhow::anyhow!(
        "failed to start a local service sidecar matching desktop version {current_version}; attempts: {}",
        startup_errors.join(" | ")
    ))
}

fn stop_local_service_impl(state: &DesktopRuntimeState) -> Result<LocalServiceStatus> {
    let mut guard = state
        .service_process
        .lock()
        .map_err(|_| anyhow::anyhow!("failed to lock desktop runtime state"))?;

    if let Some(mut process) = guard.take() {
        terminate_child_process(&mut process.child)?;
        return Ok(build_status(
            false,
            &process.base_url,
            &process.config_path,
            &process.data_dir,
            &process.sqlite_path,
        ));
    }

    Ok(LocalServiceStatus {
        running: false,
        port: LOCAL_SERVICE_PORT,
        base_url: format!("http://127.0.0.1:{LOCAL_SERVICE_PORT}"),
        config_path: String::new(),
        data_dir: String::new(),
        sqlite_path: String::new(),
    })
}

async fn get_local_service_status_impl(
    app: &AppHandle,
    state: &DesktopRuntimeState,
) -> Result<LocalServiceStatus> {
    let paths = resolve_runtime_paths(app)?;
    let tracked_status = {
        let guard = state
            .service_process
            .lock()
            .map_err(|_| anyhow::anyhow!("failed to lock desktop runtime state"))?;

        guard.as_ref().map(|process| {
            build_status(
                true,
                &process.base_url,
                &process.config_path,
                &process.data_dir,
                &process.sqlite_path,
            )
        })
    };

    if let Some(status) = tracked_status {
        return Ok(status);
    }

    let base_url = format!("http://127.0.0.1:{LOCAL_SERVICE_PORT}");
    let running = local_service_is_healthy(&base_url).await;

    Ok(build_status(
        running,
        &base_url,
        &paths.config_path,
        &paths.data_dir,
        &paths.sqlite_path,
    ))
}

fn build_status(
    running: bool,
    base_url: &str,
    config_path: &Path,
    data_dir: &Path,
    sqlite_path: &Path,
) -> LocalServiceStatus {
    LocalServiceStatus {
        running,
        port: LOCAL_SERVICE_PORT,
        base_url: base_url.to_string(),
        config_path: config_path.display().to_string(),
        data_dir: data_dir.display().to_string(),
        sqlite_path: sqlite_path.display().to_string(),
    }
}

fn terminate_child_process(child: &mut Child) -> Result<()> {
    if let Err(error) = child.kill() {
        if error.kind() != std::io::ErrorKind::InvalidInput {
            return Err(error).context("failed to kill local service process");
        }
    }

    if let Err(error) = child.wait() {
        if error.kind() != std::io::ErrorKind::InvalidInput {
            return Err(error).context("failed to wait on local service process");
        }
    }

    Ok(())
}

async fn wait_for_local_service(base_url: &str, child: &mut Child) -> Result<()> {
    let deadline = Instant::now() + LOCAL_SERVICE_STARTUP_TIMEOUT;
    let mut last_health_check_detail = None;

    while Instant::now() < deadline {
        let health_check = local_service_health_check(base_url).await;
        if health_check.healthy {
            return Ok(());
        }
        last_health_check_detail = health_check.failure_detail();

        if let Some(status) = child
            .try_wait()
            .context("failed to poll local service child process")?
        {
            return Err(anyhow::anyhow!(
                "local service exited before becoming healthy with status {status}"
            ));
        }

        tokio::time::sleep(LOCAL_SERVICE_STARTUP_RETRY_INTERVAL).await;
    }

    let mut message =
        format!("local service did not become healthy at {base_url}{LOCAL_SERVICE_HEALTH_PATH}");
    if let Some(detail) = last_health_check_detail {
        message.push_str(&format!(
            "; last health check failure: {}",
            detail.replace('\n', " | ")
        ));
    }

    Err(anyhow::anyhow!(message))
}

async fn local_service_is_healthy(base_url: &str) -> bool {
    local_service_health_check(base_url).await.healthy
}

fn should_reuse_untracked_local_service(
    health_check: &LocalServiceHealthCheck,
    current_version: &str,
) -> bool {
    health_check.healthy && health_check.version.as_deref() == Some(current_version)
}

async fn local_service_health_check(base_url: &str) -> LocalServiceHealthCheck {
    let authority = base_url
        .trim()
        .trim_end_matches('/')
        .strip_prefix("http://")
        .map(str::to_string);

    let authority = match authority {
        Some(authority) if !authority.is_empty() => authority,
        _ => {
            return LocalServiceHealthCheck {
                healthy: false,
                status_code: None,
                error: Some(format!("unsupported local service base URL: {base_url}")),
                version: None,
            };
        }
    };

    let request = format!(
        "GET {LOCAL_SERVICE_HEALTH_PATH} HTTP/1.1\r\nHost: {authority}\r\nConnection: close\r\nAccept: application/json\r\n\r\n"
    );
    let result = async {
        let mut stream = tokio::time::timeout(
            LOCAL_SERVICE_HEALTH_CONNECT_TIMEOUT,
            tokio::net::TcpStream::connect(&authority),
        )
        .await
        .map_err(|_| {
            format!(
                "tcp connect timed out after {}ms",
                LOCAL_SERVICE_HEALTH_CONNECT_TIMEOUT.as_millis()
            )
        })?
        .map_err(|error| format!("tcp connect failed: {error}"))?;
        tokio::time::timeout(
            LOCAL_SERVICE_HEALTH_WRITE_TIMEOUT,
            stream.write_all(request.as_bytes()),
        )
        .await
        .map_err(|_| {
            format!(
                "health request write timed out after {}ms",
                LOCAL_SERVICE_HEALTH_WRITE_TIMEOUT.as_millis()
            )
        })?
        .map_err(|error| format!("failed to write health request: {error}"))?;

        let mut response_bytes = Vec::with_capacity(1024);

        loop {
            let mut buffer = [0_u8; 1024];
            let bytes_read =
                tokio::time::timeout(LOCAL_SERVICE_HEALTH_READ_TIMEOUT, stream.read(&mut buffer))
                    .await
                    .map_err(|_| {
                        format!(
                            "health response read timed out after {}ms",
                            LOCAL_SERVICE_HEALTH_READ_TIMEOUT.as_millis()
                        )
                    })?
                    .map_err(|error| format!("failed to read health response: {error}"))?;

            if bytes_read == 0 {
                break;
            }

            response_bytes.extend_from_slice(&buffer[..bytes_read]);

            if response_bytes.len() > 16 * 1024 {
                return Err("health response exceeded 16384 bytes".to_string());
            }
        }

        if response_bytes.is_empty() {
            return Err("health response closed before sending data".to_string());
        }

        let response_head = String::from_utf8_lossy(&response_bytes);
        let status_line = response_head
            .lines()
            .next()
            .map(str::trim)
            .unwrap_or_default();

        let status_code = status_line
            .split_whitespace()
            .nth(1)
            .ok_or_else(|| format!("invalid health response status line: {status_line}"))?
            .parse::<u16>()
            .map_err(|error| {
                format!("invalid health response status line: {status_line}; {error}")
            })?;

        let version = parse_local_service_health_payload_version(&response_bytes);

        Ok((status_code, version))
    }
    .await;

    match result {
        Ok((status_code, version)) => LocalServiceHealthCheck {
            healthy: status_code >= 200 && status_code < 300,
            status_code: Some(status_code),
            error: None,
            version,
        },
        Err(error) => LocalServiceHealthCheck {
            healthy: false,
            status_code: None,
            error: Some(error),
            version: None,
        },
    }
}

fn parse_local_service_health_payload_version(response_bytes: &[u8]) -> Option<String> {
    let body_start = response_bytes
        .windows(4)
        .position(|window| window == b"\r\n\r\n")
        .map(|index| index + 4)
        .or_else(|| {
            response_bytes
                .windows(2)
                .position(|window| window == b"\n\n")
                .map(|index| index + 2)
        })?;
    let body = response_bytes.get(body_start..)?;
    let payload = serde_json::from_slice::<LocalServiceHealthPayload>(body).ok()?;
    payload
        .version
        .and_then(|value| normalize_optional_string(Some(value)))
}

fn extract_profile_sync_api_base_url(config_value: &serde_json::Value) -> Option<String> {
    config_value
        .get("profile_sync")
        .and_then(serde_json::Value::as_object)
        .and_then(|profile_sync| profile_sync.get("api_base_url"))
        .and_then(serde_json::Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(|value| value.to_string())
}

async fn fetch_local_profile_sync_status(base_url: &str) -> Result<LocalProfileSyncStatus> {
    let endpoint = reqwest::Url::parse(&format!("{base_url}/"))
        .context("local service base URL is invalid")?
        .join(LOCAL_SERVICE_PROFILE_SYNC_STATUS_PATH.trim_start_matches('/'))
        .context("failed to resolve local profile sync status endpoint")?;
    let response = reqwest::Client::new()
        .get(endpoint.clone())
        .header(reqwest::header::ACCEPT, "application/json")
        .timeout(Duration::from_secs(3))
        .send()
        .await
        .with_context(|| format!("failed to request {endpoint}"))?;
    let status = response.status();
    let body_text = response
        .text()
        .await
        .context("failed to read local profile sync status response body")?;

    if !status.is_success() {
        anyhow::bail!(
            "{endpoint} returned {status}: {}",
            summarize_http_response_body(&body_text)
        );
    }

    serde_json::from_str(&body_text)
        .context("failed to parse local profile sync status response body")
}

fn append_profile_sync_status_log_lines(
    log_lines: &mut Vec<String>,
    profile_sync_status: &LocalProfileSyncStatus,
) {
    push_log_kv(
        log_lines,
        1,
        "Enabled",
        profile_sync_status.enabled.to_string(),
    );
    push_log_kv(
        log_lines,
        1,
        "Reachable",
        profile_sync_status.reachable.to_string(),
    );
    push_log_kv(
        log_lines,
        1,
        "Authenticated",
        profile_sync_status.authenticated.to_string(),
    );
    push_log_kv(
        log_lines,
        1,
        "Username",
        format_optional_text(profile_sync_status.username.as_deref()),
    );
    push_log_kv(
        log_lines,
        1,
        "Role",
        format_optional_text(profile_sync_status.role.as_deref()),
    );
    push_log_kv(
        log_lines,
        1,
        "StorageType",
        format_optional_text(profile_sync_status.storage_type.as_deref()),
    );
    push_log_kv(
        log_lines,
        1,
        "ProfileMode",
        format_optional_text(profile_sync_status.profile_mode.as_deref()),
    );
    push_log_kv(
        log_lines,
        1,
        "ErrorKind",
        format_optional_text(profile_sync_status.error_kind.as_deref()),
    );
    push_log_kv(
        log_lines,
        1,
        "Error",
        format_optional_text(profile_sync_status.error.as_deref()),
    );
    push_log_kv(
        log_lines,
        1,
        "SyncDomains",
        if profile_sync_status.sync_domains.is_empty() {
            PROFILE_SYNC_USER_DATA_DOMAINS.join(", ")
        } else {
            profile_sync_status.sync_domains.join(", ")
        },
    );
}

fn profile_sync_status_diagnostic_level(
    profile_sync_status: &LocalProfileSyncStatus,
) -> DiagnosticLevel {
    if !profile_sync_status.enabled {
        return DiagnosticLevel::Ok;
    }

    if !profile_sync_status.reachable || profile_sync_status.error_kind.is_some() {
        return DiagnosticLevel::Warning;
    }

    DiagnosticLevel::Ok
}

fn build_profile_sync_status_diagnostic_detail(
    profile_sync_status: &LocalProfileSyncStatus,
) -> String {
    let domains_text = format_profile_sync_domain_labels(&profile_sync_status.sync_domains);

    if !profile_sync_status.enabled {
        return format!(
            "未配置 profile_sync.api_base_url，当前保持纯本地 profile 模式。若后续启用远端同步，将同步：{domains_text}。"
        );
    }

    let mode_text = match profile_sync_status.profile_mode.as_deref() {
        Some("shared-multi-user") => "远端多用户",
        Some(_) => "远端单用户",
        None => "远端模式待定",
    };
    let storage_text = profile_sync_status
        .storage_type
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(|value| format!("，远端存储：{value}"))
        .unwrap_or_default();
    let account_text = profile_sync_status
        .username
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(|value| {
            let role = profile_sync_status
                .role
                .as_deref()
                .map(str::trim)
                .filter(|role| !role.is_empty())
                .unwrap_or("user");
            format!("，远端账号：{value} ({role})")
        })
        .unwrap_or_default();
    let state_text = if !profile_sync_status.reachable {
        "远端不可达".to_string()
    } else if profile_sync_status.error_kind.as_deref() == Some("unauthorized") {
        "远端可达，但当前登录态已失效".to_string()
    } else if profile_sync_status.authenticated {
        "远端可达，当前已登录".to_string()
    } else {
        "远端可达，当前未登录".to_string()
    };

    let mut details = vec![
        format!("同步域：{domains_text}。"),
        format!("当前状态：{state_text}，模式：{mode_text}{storage_text}{account_text}。"),
    ];

    if let Some(error_kind) = profile_sync_status
        .error_kind
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        details.push(format!("错误分类：{error_kind}。"));
    }

    if let Some(error) = profile_sync_status
        .error
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        details.push(format!("最近错误：{error}"));
    }

    details.join(" ")
}

fn collect_profile_sync_recommendations(
    error_kind: Option<&str>,
    recommendations: &mut BTreeSet<String>,
) {
    match error_kind {
        Some("invalid-base-url") => {
            recommendations.insert(
                "检查 profile_sync.api_base_url 是否是可访问的 http/https 完整地址。".to_string(),
            );
        }
        Some("unreachable") => {
            recommendations.insert(
                "确认当前网络和远端 Web 站点可达，必要时在浏览器中直接打开远端地址。".to_string(),
            );
        }
        Some("unauthorized") => {
            recommendations
                .insert("重新登录远端账号，确认 Web 端登录接口和会话仍有效。".to_string());
        }
        Some("protocol-incompatible") => {
            recommendations.insert(
                "升级桌面端或 Web 端，使 /api/server-config 等 profile sync 协议保持兼容。"
                    .to_string(),
            );
        }
        Some("upstream-failure") => {
            recommendations.insert(
                "检查远端 Web 后端日志，确认 /api/server-config 与账号接口能够稳定返回 2xx。"
                    .to_string(),
            );
        }
        _ => {}
    }
}

fn format_profile_sync_domain_labels(domains: &[String]) -> String {
    if domains.is_empty() {
        return format_default_profile_sync_domain_labels();
    }

    domains
        .iter()
        .map(|domain| profile_sync_domain_label(domain))
        .collect::<Vec<_>>()
        .join("、")
}

fn format_default_profile_sync_domain_labels() -> String {
    PROFILE_SYNC_USER_DATA_DOMAINS
        .iter()
        .map(|domain| profile_sync_domain_label(domain))
        .collect::<Vec<_>>()
        .join("、")
}

fn profile_sync_domain_label(domain: &str) -> String {
    match domain {
        "playrecords" => "播放记录".to_string(),
        "favorites" => "收藏".to_string(),
        "follows" => "追更".to_string(),
        "searchhistory" => "搜索历史".to_string(),
        "skipconfigs" => "跳过片头片尾".to_string(),
        _ => domain.to_string(),
    }
}

async fn run_local_service_diagnostics_impl(
    app: &AppHandle,
    state: &DesktopRuntimeState,
) -> LocalServiceDiagnosticsReport {
    let captured_at_ms = current_timestamp_ms();
    let mut findings = Vec::new();
    let mut recommendations = BTreeSet::new();
    let mut log_lines = vec![
        "LunaTV Desktop Local Service Diagnostics".to_string(),
        format!("CapturedAtMs: {captured_at_ms}"),
    ];
    append_app_context_log_lines(app, &mut log_lines);
    append_platform_diagnostic_snapshot_log_lines(&mut log_lines);

    let _start_guard = state.service_start_lock.lock().await;

    let paths = match resolve_runtime_paths(app) {
        Ok(paths) => {
            log_lines.push(format!("DataDir: {}", paths.data_dir.display()));
            log_lines.push(format!("ConfigPath: {}", paths.config_path.display()));
            log_lines.push(format!("SqlitePath: {}", paths.sqlite_path.display()));
            paths
        }
        Err(error) => {
            findings.push(LocalServiceDiagnosticFinding {
                level: DiagnosticLevel::Error,
                title: "运行目录解析失败".to_string(),
                detail: error.to_string(),
            });
            recommendations.insert("请确认桌面程序有权访问当前用户的数据目录。".to_string());
            return finalize_local_service_diagnostics_report(
                captured_at_ms,
                "桌面程序无法解析运行目录，尚未开始检查本地服务。".to_string(),
                findings,
                recommendations.into_iter().collect(),
                log_lines,
            );
        }
    };

    let base_url = format!("http://127.0.0.1:{LOCAL_SERVICE_PORT}");
    log_lines.push(format!("BaseUrl: {base_url}"));

    match state.service_process.lock() {
        Ok(guard) => {
            if let Some(process) = guard.as_ref() {
                findings.push(LocalServiceDiagnosticFinding {
                    level: DiagnosticLevel::Warning,
                    title: "桌面壳仍记录着本地服务子进程".to_string(),
                    detail: format!(
                        "桌面壳内部仍在追踪一个子进程，目标地址为 {}。如果健康检查失败，这通常说明子进程已失效或状态未同步。",
                        process.base_url
                    ),
                });
            } else {
                findings.push(LocalServiceDiagnosticFinding {
                    level: DiagnosticLevel::Ok,
                    title: "桌面壳当前未追踪本地服务子进程".to_string(),
                    detail: "当前没有已登记的本地服务子进程句柄。".to_string(),
                });
            }
        }
        Err(_) => {
            findings.push(LocalServiceDiagnosticFinding {
                level: DiagnosticLevel::Warning,
                title: "无法读取桌面壳内部进程状态".to_string(),
                detail: "桌面壳的进程状态锁不可用，本次报告无法确认是否存在遗留子进程。"
                    .to_string(),
            });
        }
    }

    let last_start_failure = snapshot_local_service_start_failure(state);
    if let Some(failure) = last_start_failure.as_ref() {
        findings.push(LocalServiceDiagnosticFinding {
            level: DiagnosticLevel::Warning,
            title: "记录到最近一次启动失败".to_string(),
            detail: format!(
                "CapturedAtMs={}，错误信息：{}",
                failure.captured_at_ms, failure.message
            ),
        });
        log_lines.push(format!(
            "LastStartFailure: {}",
            failure.message.replace('\n', " | ")
        ));
    }

    let service_health = local_service_health_check(&base_url).await;
    let service_healthy = service_health.healthy;
    let service_health_detail = service_health.failure_detail();
    if let Some(detail) = service_health_detail.as_ref() {
        log_lines.push(format!(
            "HealthCheckFailure: {}",
            detail.replace('\n', " | ")
        ));
    }
    findings.push(LocalServiceDiagnosticFinding {
        level: if service_healthy {
            DiagnosticLevel::Ok
        } else {
            DiagnosticLevel::Warning
        },
        title: "健康检查".to_string(),
        detail: if service_healthy {
            format!("{base_url}{LOCAL_SERVICE_HEALTH_PATH} 已返回成功。")
        } else if let Some(detail) = service_health_detail.as_ref() {
            format!("{base_url}{LOCAL_SERVICE_HEALTH_PATH} 当前没有返回成功：{detail}")
        } else {
            format!("{base_url}{LOCAL_SERVICE_HEALTH_PATH} 当前没有返回成功。")
        },
    });

    let sidecar_candidates = match local_service_sidecar_candidates(app) {
        Ok(candidates) => candidates,
        Err(error) => {
            findings.push(LocalServiceDiagnosticFinding {
                level: DiagnosticLevel::Error,
                title: "无法计算 sidecar 路径".to_string(),
                detail: error.to_string(),
            });
            recommendations.insert("请重新安装桌面版，确认安装目录结构完整。".to_string());
            return finalize_local_service_diagnostics_report(
                captured_at_ms,
                "无法计算本地服务可执行文件路径。".to_string(),
                findings,
                recommendations.into_iter().collect(),
                log_lines,
            );
        }
    };
    let sidecar_path = sidecar_candidates
        .iter()
        .find(|path| path.is_file())
        .cloned();
    log_lines.push("SidecarCandidates:".to_string());
    for candidate in &sidecar_candidates {
        let status = if candidate.is_file() {
            "found"
        } else {
            "missing"
        };
        log_lines.push(format!("  - [{status}] {}", candidate.display()));
    }
    if let Some(path) = sidecar_path.as_ref() {
        if let Some(metadata_summary) = describe_file_metadata(path) {
            log_lines.push(format!("SidecarMetadata: {metadata_summary}"));
        }
    }

    let sidecar_missing = sidecar_path.is_none();
    findings.push(LocalServiceDiagnosticFinding {
        level: if sidecar_missing {
            DiagnosticLevel::Error
        } else {
            DiagnosticLevel::Ok
        },
        title: "本地服务可执行文件".to_string(),
        detail: if let Some(path) = sidecar_path.as_ref() {
            format!("已找到 sidecar：{}", path.display())
        } else {
            "未找到可用的本地服务 sidecar，可执行文件可能缺失、被移动，或被安全软件隔离。"
                .to_string()
        },
    });

    let mut config_invalid = false;
    let mut config_value = None::<serde_json::Value>;
    match fs::read_to_string(&paths.config_path) {
        Ok(contents) => match serde_json::from_str::<serde_json::Value>(&contents) {
            Ok(value) => {
                config_value = Some(value);
                findings.push(LocalServiceDiagnosticFinding {
                    level: DiagnosticLevel::Ok,
                    title: "桌面配置文件".to_string(),
                    detail: "desktop.config.json 可读取且 JSON 格式有效。".to_string(),
                });
            }
            Err(error) => {
                config_invalid = true;
                findings.push(LocalServiceDiagnosticFinding {
                    level: DiagnosticLevel::Error,
                    title: "桌面配置文件".to_string(),
                    detail: format!("desktop.config.json 可读取，但 JSON 格式无效：{}", error),
                });
            }
        },
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            findings.push(LocalServiceDiagnosticFinding {
                level: DiagnosticLevel::Warning,
                title: "桌面配置文件".to_string(),
                detail: "desktop.config.json 当前不存在。启动服务时会尝试自动创建默认配置。"
                    .to_string(),
            });
        }
        Err(error) => {
            config_invalid = true;
            findings.push(LocalServiceDiagnosticFinding {
                level: DiagnosticLevel::Error,
                title: "桌面配置文件".to_string(),
                detail: format!("读取 desktop.config.json 失败：{error}"),
            });
        }
    }

    let configured_profile_sync_api_base_url = config_value
        .as_ref()
        .and_then(extract_profile_sync_api_base_url);
    log_lines.push("ProfileSync:".to_string());
    push_log_kv(
        &mut log_lines,
        1,
        "ConfiguredApiBaseUrl",
        configured_profile_sync_api_base_url
            .clone()
            .unwrap_or_else(|| "not configured".to_string()),
    );
    push_log_kv(
        &mut log_lines,
        1,
        "SyncDomains",
        PROFILE_SYNC_USER_DATA_DOMAINS.join(", "),
    );
    findings.push(LocalServiceDiagnosticFinding {
        level: DiagnosticLevel::Ok,
        title: "账号同步配置".to_string(),
        detail: if let Some(remote_base_url) = configured_profile_sync_api_base_url.as_deref() {
            format!(
                "已配置 profile_sync.api_base_url：{remote_base_url}。若启用账号同步，将同步：{}。",
                format_default_profile_sync_domain_labels()
            )
        } else {
            format!(
                "未配置 profile_sync.api_base_url，当前保持纯本地 profile 模式。若后续启用远端同步，将同步：{}。",
                format_default_profile_sync_domain_labels()
            )
        },
    });

    let mut data_dir_unwritable = false;
    if let Err(error) = fs::create_dir_all(&paths.data_dir) {
        data_dir_unwritable = true;
        findings.push(LocalServiceDiagnosticFinding {
            level: DiagnosticLevel::Error,
            title: "数据目录".to_string(),
            detail: format!(
                "无法创建或访问数据目录 {}：{error}",
                paths.data_dir.display()
            ),
        });
    } else {
        let probe_path = paths
            .data_dir
            .join(format!(".lunatv-diagnostic-write-{}.tmp", captured_at_ms));
        match fs::write(&probe_path, b"lunatv-diagnostic") {
            Ok(_) => {
                let _ = fs::remove_file(&probe_path);
                findings.push(LocalServiceDiagnosticFinding {
                    level: DiagnosticLevel::Ok,
                    title: "数据目录".to_string(),
                    detail: "数据目录可写。".to_string(),
                });
            }
            Err(error) => {
                data_dir_unwritable = true;
                findings.push(LocalServiceDiagnosticFinding {
                    level: DiagnosticLevel::Error,
                    title: "数据目录".to_string(),
                    detail: format!("数据目录不可写：{error}"),
                });
            }
        }
    }

    let mut sqlite_inaccessible = false;
    match fs::OpenOptions::new()
        .read(true)
        .write(true)
        .create(true)
        .truncate(false)
        .open(&paths.sqlite_path)
    {
        Ok(_) => findings.push(LocalServiceDiagnosticFinding {
            level: DiagnosticLevel::Ok,
            title: "SQLite 文件".to_string(),
            detail: format!("SQLite 文件可打开：{}", paths.sqlite_path.display()),
        }),
        Err(error) => {
            sqlite_inaccessible = true;
            findings.push(LocalServiceDiagnosticFinding {
                level: DiagnosticLevel::Error,
                title: "SQLite 文件".to_string(),
                detail: format!(
                    "无法打开 SQLite 文件 {}：{error}",
                    paths.sqlite_path.display()
                ),
            });
        }
    }

    let port_inspection = inspect_local_service_port(LOCAL_SERVICE_PORT);
    log_lines.push("PortInspection:".to_string());
    log_lines.push(format!(
        "  BindAvailable: {}",
        port_inspection.bind_available
    ));
    log_lines.extend(
        port_inspection
            .debug_lines
            .iter()
            .map(|line| format!("  {line}")),
    );

    let port_occupied = !service_healthy && !port_inspection.bind_available;
    findings.push(LocalServiceDiagnosticFinding {
        level: if port_occupied {
            DiagnosticLevel::Error
        } else {
            DiagnosticLevel::Ok
        },
        title: format!("端口 {LOCAL_SERVICE_PORT}"),
        detail: if port_occupied {
            describe_port_occupants(LOCAL_SERVICE_PORT, &port_inspection.occupants)
        } else {
            format!("127.0.0.1:{LOCAL_SERVICE_PORT} 当前可用于绑定。")
        },
    });

    if service_healthy {
        match fetch_local_profile_sync_status(&base_url).await {
            Ok(profile_sync_status) => {
                append_profile_sync_status_log_lines(&mut log_lines, &profile_sync_status);
                findings.push(LocalServiceDiagnosticFinding {
                    level: profile_sync_status_diagnostic_level(&profile_sync_status),
                    title: "账号同步状态".to_string(),
                    detail: build_profile_sync_status_diagnostic_detail(&profile_sync_status),
                });
                collect_profile_sync_recommendations(
                    profile_sync_status.error_kind.as_deref(),
                    &mut recommendations,
                );
            }
            Err(error) => {
                push_log_kv(
                    &mut log_lines,
                    1,
                    "StatusFetchError",
                    error.to_string().replace('\n', " | "),
                );
                findings.push(LocalServiceDiagnosticFinding {
                    level: DiagnosticLevel::Warning,
                    title: "账号同步状态".to_string(),
                    detail: format!(
                        "本地服务已通过健康检查，但读取 {LOCAL_SERVICE_PROFILE_SYNC_STATUS_PATH} 失败：{error}"
                    ),
                });
                recommendations.insert(
                    "如果账号同步状态持续读取失败，请确认本地服务和桌面前端版本保持一致。"
                        .to_string(),
                );
            }
        }
    } else if configured_profile_sync_api_base_url.is_some() {
        findings.push(LocalServiceDiagnosticFinding {
            level: DiagnosticLevel::Warning,
            title: "账号同步状态".to_string(),
            detail: "已配置 profile_sync.api_base_url，但本地服务当前未通过健康检查，本次无法确认远端可达性和登录状态。".to_string(),
        });
        recommendations.insert("先恢复本地服务，再重新执行排查以确认账号同步状态。".to_string());
    }

    let trial_result = if let Some(path) = sidecar_path.as_ref() {
        let result = run_local_service_trial(path, &paths).await;
        log_lines.push(format!("TrialSidecar: {}", path.display()));
        if let Some(pid) = result.pid {
            log_lines.push(format!("TrialChildPid: {pid}"));
        }
        if let Some(spawn_error) = result.spawn_error.as_ref() {
            log_lines.push(format!("TrialSpawnError: {spawn_error}"));
        }
        if let Some(detail) = result.health_check_detail.as_ref() {
            log_lines.push(format!(
                "TrialHealthCheckFailure: {}",
                detail.replace('\n', " | ")
            ));
        }
        if let Some(detail) = result.port_observation.as_ref() {
            log_lines.push(format!(
                "TrialPortObservation: {}",
                detail.replace('\n', " | ")
            ));
        }
        if !result.stdout.trim().is_empty() {
            log_lines.push("TrialStdout:".to_string());
            log_lines.extend(result.stdout.lines().map(|line| format!("  {line}")));
        }
        if !result.stderr.trim().is_empty() {
            log_lines.push("TrialStderr:".to_string());
            log_lines.extend(result.stderr.lines().map(|line| format!("  {line}")));
        }

        findings.push(build_sidecar_trial_finding(&result));
        Some(result)
    } else {
        None
    };

    let combined_error_text =
        collect_diagnostics_error_text(last_start_failure.as_ref(), trial_result.as_ref());

    let detected_bind_issue = text_contains_any(
        &combined_error_text,
        &[
            "failed to bind local service listener",
            "address already in use",
            "only one usage of each socket address",
        ],
    );
    let detected_sqlite_issue = text_contains_any(
        &combined_error_text,
        &[
            "failed to initialize desktop sqlite foundation",
            "failed to open",
            "failed to configure sqlite",
            "failed to commit sqlite migrations",
            "failed to apply sqlite migration",
        ],
    );
    let detected_runtime_dependency_issue = text_contains_any(
        &combined_error_text,
        &[
            "vcruntime",
            "msvcp",
            "api-ms-win",
            "code execution cannot proceed",
            "0xc0000135",
        ],
    );

    log_lines.push("FailureClassification:".to_string());
    log_lines.push(format!("  ServiceHealthy: {service_healthy}"));
    log_lines.push(format!("  SidecarMissing: {sidecar_missing}"));
    log_lines.push(format!("  PortOccupied: {port_occupied}"));
    log_lines.push(format!("  DetectedBindIssue: {detected_bind_issue}"));
    log_lines.push(format!("  ConfigInvalid: {config_invalid}"));
    log_lines.push(format!("  DataDirUnwritable: {data_dir_unwritable}"));
    log_lines.push(format!("  SqliteInaccessible: {sqlite_inaccessible}"));
    log_lines.push(format!("  DetectedSqliteIssue: {detected_sqlite_issue}"));
    log_lines.push(format!(
        "  RuntimeDependencyIssue: {detected_runtime_dependency_issue}"
    ));
    log_lines.push(format!("  TrialAttempted: {}", trial_result.is_some()));
    log_lines.push(format!(
        "  TrialHealthy: {}",
        trial_result.as_ref().is_some_and(|result| result.healthy)
    ));
    log_lines.push(format!(
        "  TrialTimedOut: {}",
        trial_result.as_ref().is_some_and(|result| result.timed_out)
    ));
    log_lines.push(format!(
        "  TrialSpawnError: {}",
        trial_result
            .as_ref()
            .is_some_and(|result| result.spawn_error.is_some())
    ));
    log_lines.push(format!(
        "  TrialExitStatus: {}",
        trial_result
            .as_ref()
            .and_then(|result| result.exit_status)
            .map(|status| status.to_string())
            .unwrap_or_else(|| "none".to_string())
    ));
    log_lines.push(format!(
        "  LastStartFailureRecorded: {}",
        last_start_failure.is_some()
    ));

    if sidecar_missing {
        recommendations.insert(
            "请重新安装桌面版，并确认安装目录中的本地服务 EXE 没有被安全软件隔离。".to_string(),
        );
    }
    if port_occupied || detected_bind_issue {
        recommendations
            .insert("请关闭占用 127.0.0.1:8787 的程序后重试，必要时重启电脑。".to_string());
    }
    if config_invalid {
        recommendations.insert(format!(
            "请修复或重置桌面配置文件：{}",
            paths.config_path.display()
        ));
    }
    if data_dir_unwritable || sqlite_inaccessible || detected_sqlite_issue {
        recommendations.insert(format!(
            "请检查 {} 的读写权限，并确认 SQLite 文件未损坏或未被其他程序锁住。",
            paths.data_dir.display()
        ));
    }
    if detected_runtime_dependency_issue {
        recommendations.insert(
            "诊断日志看起来像系统运行库或 DLL 依赖异常，请检查系统运行时环境以及安全软件隔离记录。"
                .to_string(),
        );
    }
    if trial_result.as_ref().is_some_and(|result| result.healthy) {
        recommendations.insert(
            "诊断试运行可以拉起本地服务，更像是后台自动启动或状态同步失败；关闭应用后重新打开再观察。"
                .to_string(),
        );
    }
    if recommendations.is_empty() {
        recommendations.insert("请导出排查日志并反馈给开发者继续定位。".to_string());
    }

    let summary = if service_healthy {
        "本地服务已经能够通过健康检查，更像是桌面状态没有及时刷新。".to_string()
    } else if sidecar_missing {
        "安装目录中没有找到本地服务 sidecar，可执行文件缺失或被隔离。".to_string()
    } else if port_occupied || detected_bind_issue {
        describe_primary_port_issue(LOCAL_SERVICE_PORT, &port_inspection.occupants)
    } else if config_invalid {
        "desktop.config.json 读取或解析失败，本地服务无法按当前配置启动。".to_string()
    } else if data_dir_unwritable {
        "桌面数据目录不可写，本地服务无法在当前用户目录下正常启动。".to_string()
    } else if sqlite_inaccessible || detected_sqlite_issue {
        "SQLite 初始化或访问失败，本地服务无法完成启动。".to_string()
    } else if detected_runtime_dependency_issue {
        "sidecar 启动日志显示系统运行时或 DLL 依赖异常。".to_string()
    } else if trial_result.as_ref().is_some_and(|result| result.healthy) {
        "诊断试运行可以成功拉起本地服务，问题更像是后台自动启动或状态同步没有完成。".to_string()
    } else if trial_result
        .as_ref()
        .is_some_and(|result| result.spawn_error.is_some())
    {
        "桌面程序尝试拉起本地服务进程时就失败了。".to_string()
    } else if trial_result.as_ref().is_some_and(|result| result.timed_out) {
        "本地服务进程没有立刻崩溃，但在限定时间内始终没有通过健康检查。".to_string()
    } else if let Some(failure) = last_start_failure.as_ref() {
        format!("最近一次本地服务启动失败：{}", failure.message)
    } else {
        "本地服务当前未能启动，但本次排查没有拿到唯一明确的根因，请导出日志继续分析。".to_string()
    };

    finalize_local_service_diagnostics_report(
        captured_at_ms,
        summary,
        findings,
        recommendations.into_iter().collect(),
        log_lines,
    )
}

async fn upload_local_service_diagnostics_impl(
    app: &AppHandle,
    remote_base_url: String,
    report: LocalServiceDiagnosticsReport,
) -> Result<LocalServiceDiagnosticsUploadResult> {
    let normalized_base_url =
        normalize_required_string(remote_base_url, "missing profile_sync.api_base_url")?;
    let base_url = reqwest::Url::parse(&normalized_base_url)
        .context("profile_sync.api_base_url is not a valid URL")?;
    let scheme = base_url.scheme();
    if scheme != "http" && scheme != "https" {
        anyhow::bail!("profile_sync.api_base_url must use http or https");
    }

    let endpoint = base_url
        .join("/api/desktop/diagnostics/upload")
        .context("failed to resolve remote diagnostics upload endpoint")?;
    let app_version = app.package_info().version.to_string();
    let payload = LocalServiceDiagnosticsUploadRequest {
        source_app: "lunatv-desktop".to_string(),
        app_version: app_version.clone(),
        target_triple: env!("LUNATV_TARGET_TRIPLE").to_string(),
        platform: format!("{}-{}", std::env::consts::OS, std::env::consts::ARCH),
        uploaded_at_ms: current_timestamp_ms(),
        report,
    };

    let response = reqwest::Client::new()
        .post(endpoint.clone())
        .header(reqwest::header::ACCEPT, "application/json")
        .header(
            reqwest::header::USER_AGENT,
            format!("LunaTV-Desktop/{app_version}"),
        )
        .timeout(Duration::from_secs(20))
        .json(&payload)
        .send()
        .await
        .with_context(|| format!("failed to POST diagnostics to {endpoint}"))?;

    let status = response.status();
    let body_text = response
        .text()
        .await
        .context("failed to read diagnostics upload response body")?;

    if status == reqwest::StatusCode::NOT_FOUND {
        return Ok(LocalServiceDiagnosticsUploadResult {
            uploaded: false,
            target: "remote-site".to_string(),
            issue_url: None,
            issue_number: None,
            message: "当前 Web 站点还没有部署桌面排查日志上传接口。".to_string(),
        });
    }

    if let Ok(payload) = serde_json::from_str::<LocalServiceDiagnosticsUploadResult>(&body_text) {
        return Ok(payload);
    }

    if !status.is_success() {
        anyhow::bail!(
            "automatic diagnostics upload failed ({status}): {}",
            summarize_http_response_body(&body_text)
        );
    }

    Err(anyhow::anyhow!(
        "diagnostics upload endpoint returned unexpected response"
    ))
}

fn finalize_local_service_diagnostics_report(
    captured_at_ms: u64,
    summary: String,
    findings: Vec<LocalServiceDiagnosticFinding>,
    recommendations: Vec<String>,
    log_lines: Vec<String>,
) -> LocalServiceDiagnosticsReport {
    let status = findings
        .iter()
        .fold(DiagnosticLevel::Ok, |current, finding| {
            max_diagnostic_level(current, finding.level)
        });
    let mut export_lines = vec![
        "LunaTV Desktop Local Service Diagnostics".to_string(),
        format!("CapturedAtMs: {captured_at_ms}"),
        format!("Status: {}", diagnostic_level_code(status)),
        format!("Summary: {summary}"),
        String::new(),
        "Findings:".to_string(),
    ];

    for finding in &findings {
        export_lines.push(format!(
            "- [{}] {}",
            diagnostic_level_code(finding.level),
            finding.title
        ));
        export_lines.extend(
            finding
                .detail
                .lines()
                .map(|line| format!("  {line}"))
                .collect::<Vec<_>>(),
        );
    }

    if !recommendations.is_empty() {
        export_lines.push(String::new());
        export_lines.push("Recommendations:".to_string());
        export_lines.extend(
            recommendations
                .iter()
                .map(|item| format!("- {item}"))
                .collect::<Vec<_>>(),
        );
    }

    if !log_lines.is_empty() {
        export_lines.push(String::new());
        export_lines.push("RawDiagnostics:".to_string());
        export_lines.extend(log_lines);
    }

    LocalServiceDiagnosticsReport {
        status,
        captured_at_ms,
        summary,
        findings,
        recommendations,
        log_text: export_lines.join("\n"),
    }
}

fn append_app_context_log_lines(app: &AppHandle, log_lines: &mut Vec<String>) {
    log_lines.push("AppContext:".to_string());
    push_log_kv(log_lines, 1, "Application", "LunaTV Desktop");
    push_log_kv(
        log_lines,
        1,
        "Version",
        app.package_info().version.to_string(),
    );
    push_log_kv(log_lines, 1, "TargetTriple", env!("LUNATV_TARGET_TRIPLE"));
    push_log_kv(
        log_lines,
        1,
        "Platform",
        format!("{}-{}", std::env::consts::OS, std::env::consts::ARCH),
    );
    push_log_kv(
        log_lines,
        1,
        "BuildProfile",
        if cfg!(debug_assertions) {
            "debug"
        } else {
            "release"
        },
    );

    match std::env::current_exe() {
        Ok(path) => push_log_kv(log_lines, 1, "CurrentExe", path.display().to_string()),
        Err(error) => push_log_kv(log_lines, 1, "CurrentExeError", error.to_string()),
    }

    match std::env::current_dir() {
        Ok(path) => push_log_kv(log_lines, 1, "CurrentDir", path.display().to_string()),
        Err(error) => push_log_kv(log_lines, 1, "CurrentDirError", error.to_string()),
    }
}

#[cfg(target_os = "windows")]
fn append_platform_diagnostic_snapshot_log_lines(log_lines: &mut Vec<String>) {
    match collect_windows_diagnostic_snapshot() {
        Ok(snapshot) => append_windows_diagnostic_snapshot_log_lines(log_lines, &snapshot),
        Err(error) => {
            log_lines.push("SystemProfileError:".to_string());
            log_lines.push(format!("  {error}"));
        }
    }
}

#[cfg(not(target_os = "windows"))]
fn append_platform_diagnostic_snapshot_log_lines(log_lines: &mut Vec<String>) {
    log_lines.push("SystemProfile:".to_string());
    push_log_kv(
        log_lines,
        1,
        "CollectionStatus",
        "platform-specific snapshot is only implemented on Windows",
    );
}

#[cfg(target_os = "windows")]
fn append_windows_diagnostic_snapshot_log_lines(
    log_lines: &mut Vec<String>,
    snapshot: &WindowsDiagnosticSnapshot,
) {
    log_lines.push("SystemProfile:".to_string());
    if let Some(os) = snapshot.os.as_ref() {
        push_log_kv(
            log_lines,
            1,
            "OS",
            format_optional_text(os.caption.as_deref()),
        );
        push_log_kv(
            log_lines,
            1,
            "Version",
            format_optional_text(os.version.as_deref()),
        );
        push_log_kv(
            log_lines,
            1,
            "BuildNumber",
            format_optional_text(os.build_number.as_deref()),
        );
        push_log_kv(
            log_lines,
            1,
            "Architecture",
            format_optional_text(os.architecture.as_deref()),
        );
        push_log_kv(
            log_lines,
            1,
            "ComputerName",
            format_optional_text(os.computer_name.as_deref()),
        );
        push_log_kv(
            log_lines,
            1,
            "LastBootUpTime",
            format_optional_text(os.last_boot_up_time.as_deref()),
        );
        push_log_kv(
            log_lines,
            1,
            "TotalVisibleMemory",
            os.total_visible_memory_kb
                .map(format_memory_kib)
                .unwrap_or_else(|| "unknown".to_string()),
        );
        push_log_kv(
            log_lines,
            1,
            "FreePhysicalMemory",
            os.free_physical_memory_kb
                .map(format_memory_kib)
                .unwrap_or_else(|| "unknown".to_string()),
        );
    } else {
        push_log_kv(log_lines, 1, "CollectionStatus", "OS snapshot unavailable");
    }

    log_lines.push("HardwareProfile:".to_string());
    if let Some(computer) = snapshot.computer.as_ref() {
        push_log_kv(
            log_lines,
            1,
            "Manufacturer",
            format_optional_text(computer.manufacturer.as_deref()),
        );
        push_log_kv(
            log_lines,
            1,
            "Model",
            format_optional_text(computer.model.as_deref()),
        );
        push_log_kv(
            log_lines,
            1,
            "SystemType",
            format_optional_text(computer.system_type.as_deref()),
        );
        push_log_kv(
            log_lines,
            1,
            "TotalPhysicalMemory",
            computer
                .total_physical_memory_bytes
                .map(format_byte_quantity)
                .unwrap_or_else(|| "unknown".to_string()),
        );
        push_log_kv(
            log_lines,
            1,
            "ProcessorPackages",
            computer
                .processors
                .map(|value| value.to_string())
                .unwrap_or_else(|| "unknown".to_string()),
        );
        push_log_kv(
            log_lines,
            1,
            "LogicalProcessors",
            computer
                .logical_processors
                .map(|value| value.to_string())
                .unwrap_or_else(|| "unknown".to_string()),
        );
        push_log_kv(
            log_lines,
            1,
            "HypervisorPresent",
            format_optional_bool(computer.hypervisor_present),
        );
    } else {
        push_log_kv(
            log_lines,
            1,
            "CollectionStatus",
            "computer snapshot unavailable",
        );
    }

    push_log_kv(log_lines, 1, "CPUCount", snapshot.cpus.len().to_string());
    for (index, cpu) in snapshot.cpus.iter().enumerate() {
        log_lines.push(format!("  - CPU {}", index + 1));
        push_log_kv(
            log_lines,
            2,
            "Name",
            format_optional_text(cpu.name.as_deref()),
        );
        push_log_kv(
            log_lines,
            2,
            "Manufacturer",
            format_optional_text(cpu.manufacturer.as_deref()),
        );
        push_log_kv(
            log_lines,
            2,
            "Cores",
            cpu.cores
                .map(|value| value.to_string())
                .unwrap_or_else(|| "unknown".to_string()),
        );
        push_log_kv(
            log_lines,
            2,
            "LogicalProcessors",
            cpu.logical_processors
                .map(|value| value.to_string())
                .unwrap_or_else(|| "unknown".to_string()),
        );
        push_log_kv(
            log_lines,
            2,
            "MaxClockMHz",
            cpu.max_clock_mhz
                .map(|value| value.to_string())
                .unwrap_or_else(|| "unknown".to_string()),
        );
        push_log_kv(
            log_lines,
            2,
            "ProcessorId",
            format_optional_text(cpu.processor_id.as_deref()),
        );
    }

    push_log_kv(log_lines, 1, "GPUCount", snapshot.gpus.len().to_string());
    for (index, gpu) in snapshot.gpus.iter().enumerate() {
        log_lines.push(format!("  - GPU {}", index + 1));
        push_log_kv(
            log_lines,
            2,
            "Name",
            format_optional_text(gpu.name.as_deref()),
        );
        push_log_kv(
            log_lines,
            2,
            "DriverVersion",
            format_optional_text(gpu.driver_version.as_deref()),
        );
        push_log_kv(
            log_lines,
            2,
            "AdapterRAM",
            gpu.adapter_ram_bytes
                .map(format_byte_quantity)
                .unwrap_or_else(|| "unknown".to_string()),
        );
        push_log_kv(
            log_lines,
            2,
            "VideoProcessor",
            format_optional_text(gpu.video_processor.as_deref()),
        );
        push_log_kv(
            log_lines,
            2,
            "Status",
            format_optional_text(gpu.status.as_deref()),
        );
    }

    log_lines.push("NetworkProfile:".to_string());
    push_log_kv(
        log_lines,
        1,
        "AdapterCount",
        snapshot.network.len().to_string(),
    );
    for (index, adapter) in snapshot.network.iter().enumerate() {
        log_lines.push(format!("  - Adapter {}", index + 1));
        push_log_kv(
            log_lines,
            2,
            "Name",
            format_optional_text(adapter.name.as_deref()),
        );
        push_log_kv(
            log_lines,
            2,
            "Description",
            format_optional_text(adapter.description.as_deref()),
        );
        push_log_kv(
            log_lines,
            2,
            "ServiceName",
            format_optional_text(adapter.service_name.as_deref()),
        );
        push_log_kv(
            log_lines,
            2,
            "Manufacturer",
            format_optional_text(adapter.manufacturer.as_deref()),
        );
        push_log_kv(
            log_lines,
            2,
            "AdapterType",
            format_optional_text(adapter.adapter_type.as_deref()),
        );
        push_log_kv(
            log_lines,
            2,
            "MACAddress",
            format_optional_text(adapter.mac_address.as_deref()),
        );
        push_log_kv(
            log_lines,
            2,
            "DHCPEnabled",
            format_optional_bool(adapter.dhcp_enabled),
        );
        push_log_kv(
            log_lines,
            2,
            "NetEnabled",
            format_optional_bool(adapter.net_enabled),
        );
        push_log_kv(
            log_lines,
            2,
            "Speed",
            adapter
                .speed_bits_per_second
                .map(format_bit_rate)
                .unwrap_or_else(|| "unknown".to_string()),
        );
        push_log_kv(log_lines, 2, "IPv4", format_string_list(&adapter.ipv4));
        push_log_kv(log_lines, 2, "IPv6", format_string_list(&adapter.ipv6));
        push_log_kv(
            log_lines,
            2,
            "Gateways",
            format_string_list(&adapter.gateways),
        );
        push_log_kv(
            log_lines,
            2,
            "DNSServers",
            format_string_list(&adapter.dns_servers),
        );
        push_log_kv(
            log_lines,
            2,
            "DNSDomain",
            format_optional_text(adapter.dns_domain.as_deref()),
        );
    }
}

#[cfg(target_os = "windows")]
fn collect_windows_diagnostic_snapshot() -> Result<WindowsDiagnosticSnapshot> {
    run_windows_powershell_json(
        r#"
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8

$os = Get-CimInstance Win32_OperatingSystem | Select-Object -First 1
$computer = Get-CimInstance Win32_ComputerSystem | Select-Object -First 1
$cpus = @(
    Get-CimInstance Win32_Processor | ForEach-Object {
        [pscustomobject]@{
            name = $_.Name
            manufacturer = $_.Manufacturer
            cores = if ($null -ne $_.NumberOfCores) { [uint32]$_.NumberOfCores } else { $null }
            logicalProcessors = if ($null -ne $_.NumberOfLogicalProcessors) { [uint32]$_.NumberOfLogicalProcessors } else { $null }
            maxClockMhz = if ($null -ne $_.MaxClockSpeed) { [uint32]$_.MaxClockSpeed } else { $null }
            processorId = $_.ProcessorId
        }
    }
)
$gpus = @(
    Get-CimInstance Win32_VideoController | ForEach-Object {
        [pscustomobject]@{
            name = $_.Name
            driverVersion = $_.DriverVersion
            adapterRamBytes = if ($null -ne $_.AdapterRAM) { [uint64]$_.AdapterRAM } else { $null }
            videoProcessor = $_.VideoProcessor
            status = $_.Status
        }
    }
)
$network = @(
    Get-CimInstance Win32_NetworkAdapterConfiguration -Filter 'IPEnabled = True' | ForEach-Object {
        $config = $_
        $adapter = Get-CimInstance Win32_NetworkAdapter -Filter "Index = $($config.Index)" | Select-Object -First 1
        $addresses = @($config.IPAddress | Where-Object { $_ })
        [pscustomobject]@{
            name = if ($adapter -and $adapter.NetConnectionID) { $adapter.NetConnectionID } elseif ($adapter) { $adapter.Name } else { $config.Description }
            description = $config.Description
            serviceName = if ($adapter) { $adapter.ServiceName } else { $null }
            manufacturer = if ($adapter) { $adapter.Manufacturer } else { $null }
            adapterType = if ($adapter) { $adapter.AdapterType } else { $null }
            macAddress = $config.MACAddress
            dhcpEnabled = if ($null -ne $config.DHCPEnabled) { [bool]$config.DHCPEnabled } else { $null }
            netEnabled = if ($adapter -and $null -ne $adapter.NetEnabled) { [bool]$adapter.NetEnabled } else { $null }
            speedBitsPerSecond = if ($adapter -and $null -ne $adapter.Speed) { [uint64]$adapter.Speed } else { $null }
            ipv4 = @($addresses | Where-Object { $_ -notmatch ':' })
            ipv6 = @($addresses | Where-Object { $_ -match ':' })
            gateways = @($config.DefaultIPGateway | Where-Object { $_ })
            dnsServers = @($config.DNSServerSearchOrder | Where-Object { $_ })
            dnsDomain = $config.DNSDomain
        }
    }
)

[pscustomobject]@{
    os = [pscustomobject]@{
        caption = $os.Caption
        version = $os.Version
        buildNumber = $os.BuildNumber
        architecture = $os.OSArchitecture
        computerName = $os.CSName
        lastBootUpTime = if ($os.LastBootUpTime) { (Get-Date $os.LastBootUpTime).ToString('o') } else { $null }
        freePhysicalMemoryKb = if ($null -ne $os.FreePhysicalMemory) { [uint64]$os.FreePhysicalMemory } else { $null }
        totalVisibleMemoryKb = if ($null -ne $os.TotalVisibleMemorySize) { [uint64]$os.TotalVisibleMemorySize } else { $null }
    }
    computer = [pscustomobject]@{
        manufacturer = $computer.Manufacturer
        model = $computer.Model
        systemType = $computer.SystemType
        totalPhysicalMemoryBytes = if ($null -ne $computer.TotalPhysicalMemory) { [uint64]$computer.TotalPhysicalMemory } else { $null }
        processors = if ($null -ne $computer.NumberOfProcessors) { [uint32]$computer.NumberOfProcessors } else { $null }
        logicalProcessors = if ($null -ne $computer.NumberOfLogicalProcessors) { [uint32]$computer.NumberOfLogicalProcessors } else { $null }
        hypervisorPresent = if ($null -ne $computer.HypervisorPresent) { [bool]$computer.HypervisorPresent } else { $null }
    }
    cpus = $cpus
    gpus = $gpus
    network = $network
} | ConvertTo-Json -Depth 6 -Compress
"#,
    )
}

#[cfg(target_os = "windows")]
fn run_windows_powershell_json<T: DeserializeOwned>(script: &str) -> Result<T> {
    let mut command = Command::new("powershell");
    command.args([
        "-NoProfile",
        "-NonInteractive",
        "-ExecutionPolicy",
        "Bypass",
        "-Command",
        script,
    ]);
    configure_background_command(&mut command);

    let output = command
        .output()
        .context("failed to start Windows PowerShell for diagnostics")?;
    let stdout = decode_utf8_command_output(output.stdout)
        .context("failed to decode Windows PowerShell stdout as UTF-8")?;
    let stderr = decode_utf8_command_output(output.stderr)
        .context("failed to decode Windows PowerShell stderr as UTF-8")?;

    if !output.status.success() {
        let details = if !stderr.trim().is_empty() {
            stderr.trim().to_string()
        } else if !stdout.trim().is_empty() {
            stdout.trim().to_string()
        } else {
            "no output".to_string()
        };
        anyhow::bail!(
            "Windows PowerShell exited with {:?}: {}",
            output.status.code(),
            details
        );
    }

    let payload = stdout.trim();
    if payload.is_empty() {
        anyhow::bail!("Windows PowerShell returned an empty JSON payload");
    }

    serde_json::from_str(payload)
        .with_context(|| "failed to parse Windows PowerShell JSON payload".to_string())
}

#[cfg(target_os = "windows")]
fn decode_utf8_command_output(bytes: Vec<u8>) -> Result<String> {
    let decoded = String::from_utf8(bytes).context("command output was not valid UTF-8")?;
    Ok(decoded.trim_start_matches('\u{feff}').replace('\r', ""))
}

fn push_log_kv(
    log_lines: &mut Vec<String>,
    indent_level: usize,
    key: &str,
    value: impl Into<String>,
) {
    log_lines.push(format!(
        "{}{}: {}",
        "  ".repeat(indent_level),
        key,
        value.into()
    ));
}

fn format_optional_text(value: Option<&str>) -> String {
    value
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
        .unwrap_or_else(|| "unknown".to_string())
}

fn format_optional_bool(value: Option<bool>) -> String {
    value
        .map(|value| value.to_string())
        .unwrap_or_else(|| "unknown".to_string())
}

fn format_string_list(values: &[String]) -> String {
    let items = values
        .iter()
        .map(|value| value.trim())
        .filter(|value| !value.is_empty())
        .collect::<Vec<_>>();
    if items.is_empty() {
        "none".to_string()
    } else {
        items.join(", ")
    }
}

fn format_memory_kib(value_kb: u64) -> String {
    format_byte_quantity(value_kb.saturating_mul(1024))
}

fn format_byte_quantity(bytes: u64) -> String {
    const KIB: f64 = 1024.0;
    const MIB: f64 = KIB * 1024.0;
    const GIB: f64 = MIB * 1024.0;
    const TIB: f64 = GIB * 1024.0;

    let bytes_f64 = bytes as f64;
    if bytes >= 1024_u64.pow(4) {
        format!("{:.2} TiB ({bytes} bytes)", bytes_f64 / TIB)
    } else if bytes >= 1024_u64.pow(3) {
        format!("{:.2} GiB ({bytes} bytes)", bytes_f64 / GIB)
    } else if bytes >= 1024_u64.pow(2) {
        format!("{:.2} MiB ({bytes} bytes)", bytes_f64 / MIB)
    } else if bytes >= 1024 {
        format!("{:.2} KiB ({bytes} bytes)", bytes_f64 / KIB)
    } else {
        format!("{bytes} bytes")
    }
}

fn format_bit_rate(bits_per_second: u64) -> String {
    const KBPS: f64 = 1_000.0;
    const MBPS: f64 = KBPS * 1_000.0;
    const GBPS: f64 = MBPS * 1_000.0;

    let bits_per_second_f64 = bits_per_second as f64;
    if bits_per_second >= 1_000_000_000 {
        format!(
            "{:.2} Gbps ({} bps)",
            bits_per_second_f64 / GBPS,
            bits_per_second
        )
    } else if bits_per_second >= 1_000_000 {
        format!(
            "{:.2} Mbps ({} bps)",
            bits_per_second_f64 / MBPS,
            bits_per_second
        )
    } else if bits_per_second >= 1_000 {
        format!(
            "{:.2} Kbps ({} bps)",
            bits_per_second_f64 / KBPS,
            bits_per_second
        )
    } else {
        format!("{bits_per_second} bps")
    }
}

fn max_diagnostic_level(left: DiagnosticLevel, right: DiagnosticLevel) -> DiagnosticLevel {
    match (left, right) {
        (DiagnosticLevel::Error, _) | (_, DiagnosticLevel::Error) => DiagnosticLevel::Error,
        (DiagnosticLevel::Warning, _) | (_, DiagnosticLevel::Warning) => DiagnosticLevel::Warning,
        _ => DiagnosticLevel::Ok,
    }
}

fn diagnostic_level_code(level: DiagnosticLevel) -> &'static str {
    match level {
        DiagnosticLevel::Ok => "OK",
        DiagnosticLevel::Warning => "WARN",
        DiagnosticLevel::Error => "ERROR",
    }
}

fn snapshot_local_service_start_failure(
    state: &DesktopRuntimeState,
) -> Option<LocalServiceStartupFailure> {
    state
        .last_start_failure
        .lock()
        .ok()
        .and_then(|guard| guard.clone())
}

fn record_local_service_start_failure(state: &DesktopRuntimeState, message: String) {
    if let Ok(mut guard) = state.last_start_failure.lock() {
        *guard = Some(LocalServiceStartupFailure {
            captured_at_ms: current_timestamp_ms(),
            message,
        });
    }
}

fn clear_local_service_start_failure(state: &DesktopRuntimeState) {
    if let Ok(mut guard) = state.last_start_failure.lock() {
        *guard = None;
    }
}

fn local_service_sidecar_candidates(app: &AppHandle) -> Result<Vec<PathBuf>> {
    if cfg!(debug_assertions) {
        return Ok(vec![
            project_root()
                .join("src-tauri")
                .join("binaries")
                .join(sidecar_binary_file_name()),
        ]);
    }

    sidecar_release_candidates(app)
}

fn inspect_local_service_port(port: u16) -> PortInspection {
    let bind_available = TcpListener::bind(("127.0.0.1", port))
        .map(|listener| {
            drop(listener);
            true
        })
        .unwrap_or(false);

    #[cfg(target_os = "windows")]
    let (occupants, debug_lines) = inspect_windows_port_occupants(port);
    #[cfg(not(target_os = "windows"))]
    let (occupants, debug_lines) = inspect_unix_port_occupants(port);

    PortInspection {
        bind_available,
        occupants,
        debug_lines,
    }
}

#[cfg(target_os = "windows")]
fn inspect_windows_port_occupants(port: u16) -> (Vec<PortOccupant>, Vec<String>) {
    let script = r#"
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8

$port = __PORT__
$listeners = @(
    Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue |
        Sort-Object LocalAddress, LocalPort, OwningProcess
)
$processTable = @{}
if ($listeners.Count -gt 0) {
    $pids = $listeners | Select-Object -ExpandProperty OwningProcess -Unique
    foreach ($processId in $pids) {
        $process = Get-CimInstance Win32_Process -Filter "ProcessId = $processId" -ErrorAction SilentlyContinue | Select-Object -First 1
        $processTable[[uint32]$processId] = if ($process) { $process.Name } else { $null }
    }
}

[pscustomobject]@{
    occupants = @(
        $listeners | ForEach-Object {
            [pscustomobject]@{
                pid = [uint32]$_.OwningProcess
                localAddress = "$($_.LocalAddress):$($_.LocalPort)"
                state = [string]$_.State
                processName = $processTable[[uint32]$_.OwningProcess]
            }
        }
    )
} | ConvertTo-Json -Depth 4 -Compress
"#
    .replace("__PORT__", &port.to_string());

    let mut debug_lines = vec![
        "Command: PowerShell Get-NetTCPConnection".to_string(),
        format!("TargetPort: {port}"),
    ];

    match run_windows_powershell_json::<WindowsPortOccupantsPayload>(&script) {
        Ok(payload) => {
            let mut occupants = payload.occupants;
            occupants.sort_by(|left, right| {
                left.local_address
                    .cmp(&right.local_address)
                    .then(left.pid.cmp(&right.pid))
                    .then(left.process_name.cmp(&right.process_name))
            });

            debug_lines.push(format!("MatchedListeners: {}", occupants.len()));
            if occupants.is_empty() {
                debug_lines.push("No LISTEN sockets matched the target port.".to_string());
            } else {
                for occupant in &occupants {
                    debug_lines.push(format!(
                        "- LocalAddress: {} | State: {} | PID: {} | ProcessName: {}",
                        occupant.local_address,
                        occupant.state,
                        occupant.pid,
                        occupant.process_name.as_deref().unwrap_or("unknown")
                    ));
                }
            }

            (occupants, debug_lines)
        }
        Err(error) => {
            debug_lines.push(format!("CommandError: {error}"));
            (Vec::new(), debug_lines)
        }
    }
}

#[cfg(not(target_os = "windows"))]
fn inspect_unix_port_occupants(port: u16) -> (Vec<PortOccupant>, Vec<String>) {
    let mut debug_lines = vec![
        "Command: lsof -nP -iTCP:<port> -sTCP:LISTEN -Fpctn".to_string(),
        format!("TargetPort: {port}"),
    ];

    let output = match Command::new("lsof")
        .args(["-nP", &format!("-iTCP:{port}"), "-sTCP:LISTEN", "-Fpctn"])
        .output()
    {
        Ok(output) => output,
        Err(error) => {
            debug_lines.push(format!("CommandError: {error}"));
            return (Vec::new(), debug_lines);
        }
    };

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        if !stderr.is_empty() {
            debug_lines.push(format!("CommandError: {stderr}"));
        }
        return (Vec::new(), debug_lines);
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let occupants = parse_unix_port_occupants(&stdout);
    debug_lines.push(format!("MatchedListeners: {}", occupants.len()));

    if occupants.is_empty() {
        debug_lines.push("No LISTEN sockets matched the target port.".to_string());
    } else {
        for occupant in &occupants {
            debug_lines.push(format!(
                "- LocalAddress: {} | State: {} | PID: {} | ProcessName: {}",
                occupant.local_address,
                occupant.state,
                occupant.pid,
                occupant.process_name.as_deref().unwrap_or("unknown")
            ));
        }
    }

    (occupants, debug_lines)
}

#[cfg(not(target_os = "windows"))]
fn parse_unix_port_occupants(output: &str) -> Vec<PortOccupant> {
    let mut occupants = Vec::new();
    let mut current_pid: Option<u32> = None;
    let mut current_process_name: Option<String> = None;
    let mut current_local_address: Option<String> = None;

    for line in output.lines() {
        if line.is_empty() {
            continue;
        }

        let (prefix, value) = line.split_at(1);
        match prefix {
            "p" => {
                if let Some(pid) = current_pid.take() {
                    occupants.push(PortOccupant {
                        pid,
                        local_address: current_local_address
                            .take()
                            .unwrap_or_else(|| "127.0.0.1:unknown".to_string()),
                        state: "LISTEN".to_string(),
                        process_name: current_process_name.take(),
                    });
                }

                current_process_name = None;
                current_local_address = None;
                current_pid = value.parse::<u32>().ok();
            }
            "c" => {
                current_process_name = normalize_optional_string(Some(value.to_string()));
            }
            "n" => {
                current_local_address = normalize_optional_string(Some(value.to_string()));
            }
            _ => {}
        }
    }

    if let Some(pid) = current_pid {
        occupants.push(PortOccupant {
            pid,
            local_address: current_local_address.unwrap_or_else(|| "127.0.0.1:unknown".to_string()),
            state: "LISTEN".to_string(),
            process_name: current_process_name,
        });
    }

    occupants.sort_by(|left, right| {
        left.local_address
            .cmp(&right.local_address)
            .then(left.pid.cmp(&right.pid))
            .then(left.process_name.cmp(&right.process_name))
    });

    occupants
}

fn describe_port_occupants(port: u16, occupants: &[PortOccupant]) -> String {
    if occupants.is_empty() {
        return format!("127.0.0.1:{port} 当前无法绑定，但没有拿到明确的监听进程信息。");
    }

    let details = occupants
        .iter()
        .map(|occupant| match occupant.process_name.as_deref() {
            Some(name) => format!("{name} (PID {})", occupant.pid),
            None => format!("PID {}", occupant.pid),
        })
        .collect::<Vec<_>>()
        .join("，");

    format!("127.0.0.1:{port} 当前已被占用：{details}")
}

fn describe_primary_port_issue(port: u16, occupants: &[PortOccupant]) -> String {
    if let Some(occupant) = occupants.first() {
        if let Some(name) = occupant.process_name.as_deref() {
            return format!(
                "127.0.0.1:{port} 已被 {name} (PID {}) 占用，本地服务无法绑定端口。",
                occupant.pid
            );
        }

        return format!(
            "127.0.0.1:{port} 已被 PID {} 占用，本地服务无法绑定端口。",
            occupant.pid
        );
    }

    format!("127.0.0.1:{port} 当前无法绑定，本地服务无法监听固定端口。")
}

fn terminate_untracked_local_service(port: u16) -> Result<bool> {
    let inspection = inspect_local_service_port(port);
    let candidate_pids = inspection
        .occupants
        .iter()
        .filter_map(|occupant| {
            if occupant
                .process_name
                .as_deref()
                .is_some_and(is_local_service_process_name)
            {
                Some(occupant.pid)
            } else {
                None
            }
        })
        .collect::<BTreeSet<_>>();

    if candidate_pids.is_empty() {
        tracing::warn!(
            "failed to resolve an untracked local service process on port {port}; inspection details: {}",
            inspection.debug_lines.join(" | ")
        );
        return Ok(false);
    }

    for pid in candidate_pids {
        terminate_process_by_pid(pid)?;
    }

    Ok(true)
}

fn is_local_service_process_name(process_name: &str) -> bool {
    matches!(
        process_name,
        "moontv-local-service" | "moontv-local-service.exe"
    )
}

#[cfg(target_os = "windows")]
fn terminate_process_by_pid(pid: u32) -> Result<()> {
    let status = Command::new("taskkill")
        .args(["/PID", &pid.to_string(), "/T", "/F"])
        .status()
        .with_context(|| format!("failed to invoke taskkill for PID {pid}"))?;

    if !status.success() {
        return Err(anyhow::anyhow!(
            "taskkill returned {status} while terminating PID {pid}"
        ));
    }

    Ok(())
}

#[cfg(not(target_os = "windows"))]
fn terminate_process_by_pid(pid: u32) -> Result<()> {
    let term_status = Command::new("kill")
        .args(["-TERM", &pid.to_string()])
        .status()
        .with_context(|| format!("failed to invoke kill -TERM for PID {pid}"))?;

    if term_status.success() {
        return Ok(());
    }

    let kill_status = Command::new("kill")
        .args(["-KILL", &pid.to_string()])
        .status()
        .with_context(|| format!("failed to invoke kill -KILL for PID {pid}"))?;

    if !kill_status.success() {
        return Err(anyhow::anyhow!(
            "kill returned non-zero status while terminating PID {pid}"
        ));
    }

    Ok(())
}

async fn run_local_service_trial(sidecar_path: &Path, paths: &RuntimePaths) -> SidecarTrialResult {
    let mut command = TokioCommand::new(sidecar_path);
    command
        .arg("--port")
        .arg(LOCAL_SERVICE_PORT.to_string())
        .arg("--config-path")
        .arg(&paths.config_path)
        .arg("--data-dir")
        .arg(&paths.data_dir)
        .arg("--sqlite-path")
        .arg(&paths.sqlite_path)
        .current_dir(&paths.data_dir)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    configure_background_tokio_command(&mut command);

    let mut child = match command.spawn() {
        Ok(child) => child,
        Err(error) => {
            return SidecarTrialResult {
                pid: None,
                healthy: false,
                timed_out: false,
                spawn_error: Some(error.to_string()),
                health_check_detail: None,
                port_observation: None,
                exit_status: None,
                stdout: String::new(),
                stderr: String::new(),
            };
        }
    };
    let child_pid = child.id();

    let base_url = format!("http://127.0.0.1:{LOCAL_SERVICE_PORT}");
    let deadline = Instant::now() + Duration::from_secs(8);
    let mut healthy = false;
    let mut timed_out = false;
    let mut last_health_check_detail = None;

    while Instant::now() < deadline {
        let health_check = local_service_health_check(&base_url).await;
        if health_check.healthy {
            healthy = true;
            last_health_check_detail = None;
            break;
        }
        last_health_check_detail = health_check.failure_detail();

        match child.try_wait() {
            Ok(Some(_)) => break,
            Ok(None) => {}
            Err(error) => {
                let _ = child.kill().await;
                let output = child.wait_with_output().await.ok();
                return SidecarTrialResult {
                    pid: child_pid,
                    healthy: false,
                    timed_out: false,
                    spawn_error: Some(format!(
                        "failed to poll diagnostic sidecar process: {error}"
                    )),
                    health_check_detail: last_health_check_detail,
                    port_observation: child_pid.and_then(observe_trial_sidecar_port),
                    exit_status: output.as_ref().and_then(|value| value.status.code()),
                    stdout: output
                        .as_ref()
                        .map(|value| String::from_utf8_lossy(&value.stdout).trim().to_string())
                        .unwrap_or_default(),
                    stderr: output
                        .as_ref()
                        .map(|value| String::from_utf8_lossy(&value.stderr).trim().to_string())
                        .unwrap_or_default(),
                };
            }
        }

        tokio::time::sleep(Duration::from_millis(250)).await;
    }

    let port_observation = if healthy {
        None
    } else {
        child_pid.and_then(observe_trial_sidecar_port)
    };

    if healthy || child.try_wait().ok().flatten().is_none() {
        if !healthy {
            timed_out = true;
        }
        let _ = child.kill().await;
    }

    let output = child.wait_with_output().await.ok();
    SidecarTrialResult {
        pid: child_pid,
        healthy,
        timed_out,
        spawn_error: None,
        health_check_detail: last_health_check_detail,
        port_observation,
        exit_status: output.as_ref().and_then(|value| value.status.code()),
        stdout: output
            .as_ref()
            .map(|value| String::from_utf8_lossy(&value.stdout).trim().to_string())
            .unwrap_or_default(),
        stderr: output
            .as_ref()
            .map(|value| String::from_utf8_lossy(&value.stderr).trim().to_string())
            .unwrap_or_default(),
    }
}

fn build_sidecar_trial_finding(result: &SidecarTrialResult) -> LocalServiceDiagnosticFinding {
    if let Some(error) = result.spawn_error.as_ref() {
        return LocalServiceDiagnosticFinding {
            level: DiagnosticLevel::Error,
            title: "试运行本地服务".to_string(),
            detail: format!("无法拉起 sidecar 进程：{error}"),
        };
    }

    if result.healthy {
        return LocalServiceDiagnosticFinding {
            level: DiagnosticLevel::Warning,
            title: "试运行本地服务".to_string(),
            detail: "诊断模式下 sidecar 可以通过健康检查，说明可执行文件和基本运行环境是可用的。"
                .to_string(),
        };
    }

    if result.timed_out {
        return LocalServiceDiagnosticFinding {
            level: DiagnosticLevel::Error,
            title: "试运行本地服务".to_string(),
            detail: format!(
                "sidecar 进程没有及时通过健康检查。{}",
                summarize_trial_output(result)
            ),
        };
    }

    LocalServiceDiagnosticFinding {
        level: DiagnosticLevel::Error,
        title: "试运行本地服务".to_string(),
        detail: format!(
            "sidecar 在健康检查通过前就退出了。{}",
            summarize_trial_output(result)
        ),
    }
}

fn summarize_trial_output(result: &SidecarTrialResult) -> String {
    let mut parts = Vec::new();

    if let Some(pid) = result.pid {
        parts.push(format!("PID：{pid}"));
    }

    if let Some(exit_status) = result.exit_status {
        parts.push(format!("退出码：{exit_status}"));
    }

    if let Some(detail) = result.health_check_detail.as_ref() {
        parts.push(format!("健康检查失败：{}", detail.replace('\n', " | ")));
    }

    if let Some(detail) = result.port_observation.as_ref() {
        parts.push(detail.clone());
    }

    let stderr_tail = tail_non_empty_lines(&result.stderr, 6);
    if !stderr_tail.is_empty() {
        parts.push(format!("stderr 摘要：{}", stderr_tail.replace('\n', " | ")));
    }

    let stdout_tail = tail_non_empty_lines(&result.stdout, 6);
    if !stdout_tail.is_empty() {
        parts.push(format!("stdout 摘要：{}", stdout_tail.replace('\n', " | ")));
    }

    if parts.is_empty() {
        "没有拿到额外输出。".to_string()
    } else {
        parts.join("；")
    }
}

fn collect_diagnostics_error_text(
    last_failure: Option<&LocalServiceStartupFailure>,
    trial_result: Option<&SidecarTrialResult>,
) -> String {
    let mut parts = Vec::new();

    if let Some(failure) = last_failure {
        parts.push(failure.message.clone());
    }

    if let Some(result) = trial_result {
        if let Some(spawn_error) = result.spawn_error.as_ref() {
            parts.push(spawn_error.clone());
        }
        if let Some(health_check_detail) = result.health_check_detail.as_ref() {
            parts.push(health_check_detail.clone());
        }
        if !result.stdout.is_empty() {
            parts.push(result.stdout.clone());
        }
        if !result.stderr.is_empty() {
            parts.push(result.stderr.clone());
        }
    }

    parts.join("\n")
}

fn tail_non_empty_lines(text: &str, max_lines: usize) -> String {
    text.lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .rev()
        .take(max_lines)
        .collect::<Vec<_>>()
        .into_iter()
        .rev()
        .collect::<Vec<_>>()
        .join("\n")
}

fn summarize_http_response_body(body_text: &str) -> String {
    let trimmed = body_text.trim();
    if trimmed.is_empty() {
        return "empty response body".to_string();
    }

    if let Ok(value) = serde_json::from_str::<serde_json::Value>(trimmed) {
        if let Some(message) = value.get("message").and_then(|item| item.as_str()) {
            let normalized = message.trim();
            if !normalized.is_empty() {
                return normalized.to_string();
            }
        }

        if let Some(message) = value.get("error").and_then(|item| item.as_str()) {
            let normalized = message.trim();
            if !normalized.is_empty() {
                return normalized.to_string();
            }
        }
    }

    tail_non_empty_lines(trimmed, 8).replace('\n', " | ")
}

fn text_contains_any(text: &str, patterns: &[&str]) -> bool {
    let normalized = text.to_ascii_lowercase();
    patterns
        .iter()
        .any(|pattern| normalized.contains(&pattern.to_ascii_lowercase()))
}

#[cfg(target_os = "windows")]
fn configure_background_command(command: &mut Command) {
    command.creation_flags(CREATE_NO_WINDOW);
}

#[cfg(not(target_os = "windows"))]
fn configure_background_command(_command: &mut Command) {}

#[cfg(target_os = "windows")]
fn configure_background_tokio_command(command: &mut TokioCommand) {
    command.creation_flags(CREATE_NO_WINDOW);
}

#[cfg(not(target_os = "windows"))]
fn configure_background_tokio_command(_command: &mut TokioCommand) {}

fn describe_file_metadata(path: &Path) -> Option<String> {
    let metadata = fs::metadata(path).ok()?;
    let mut parts = vec![
        format!("Path={}", path.display()),
        format!("SizeBytes={}", metadata.len()),
    ];
    if let Some(modified_at_ms) = metadata.modified().ok().and_then(system_time_to_unix_ms) {
        parts.push(format!("ModifiedAtMs={modified_at_ms}"));
    }
    Some(parts.join(" | "))
}

fn system_time_to_unix_ms(value: SystemTime) -> Option<u64> {
    value
        .duration_since(UNIX_EPOCH)
        .ok()
        .map(|duration| duration.as_millis() as u64)
}

#[cfg(target_os = "windows")]
fn observe_trial_sidecar_port(pid: u32) -> Option<String> {
    let inspection = inspect_local_service_port(LOCAL_SERVICE_PORT);
    let matching_occupants = inspection
        .occupants
        .iter()
        .filter(|occupant| occupant.pid == pid)
        .collect::<Vec<_>>();

    if !matching_occupants.is_empty() {
        let listening_addresses = matching_occupants
            .iter()
            .map(|occupant| occupant.local_address.as_str())
            .collect::<Vec<_>>()
            .join(", ");
        return Some(format!(
            "端口探测发现诊断 sidecar PID {pid} 正在监听 {listening_addresses}。"
        ));
    }

    if inspection.bind_available {
        return Some(format!(
            "端口探测没有发现诊断 sidecar PID {pid} 监听 127.0.0.1:{LOCAL_SERVICE_PORT}，并且该端口仍然可绑定。"
        ));
    }

    if let Some(occupant) = inspection.occupants.first() {
        let process_name = occupant.process_name.as_deref().unwrap_or("未知进程");
        return Some(format!(
            "端口探测没有发现诊断 sidecar PID {pid} 监听 127.0.0.1:{LOCAL_SERVICE_PORT}；当前监听者是 {process_name} (PID {})。",
            occupant.pid
        ));
    }

    Some(format!(
        "端口探测没有发现诊断 sidecar PID {pid} 监听 127.0.0.1:{LOCAL_SERVICE_PORT}。"
    ))
}

#[cfg(not(target_os = "windows"))]
fn observe_trial_sidecar_port(_pid: u32) -> Option<String> {
    None
}

fn current_timestamp_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or(Duration::from_secs(0))
        .as_millis() as u64
}

fn ensure_desktop_config_file(config_path: &Path) -> Result<()> {
    if config_path.exists() {
        return ensure_default_desktop_owner_auth(config_path);
    }

    if let Some(parent_dir) = config_path.parent() {
        fs::create_dir_all(parent_dir)
            .with_context(|| format!("failed to create {}", parent_dir.display()))?;
    }

    fs::write(config_path, DEFAULT_DESKTOP_CONFIG)
        .with_context(|| format!("failed to write {}", config_path.display()))?;

    ensure_default_desktop_owner_auth(config_path)
}

fn read_desktop_app_config_value(app: &AppHandle) -> Result<serde_json::Value> {
    let paths = resolve_runtime_paths(app)?;
    ensure_desktop_config_file(&paths.config_path)?;
    let contents = fs::read_to_string(&paths.config_path)
        .with_context(|| format!("failed to read {}", paths.config_path.display()))?;
    serde_json::from_str(&contents)
        .with_context(|| format!("failed to parse {}", paths.config_path.display()))
}

fn ensure_default_desktop_owner_auth(config_path: &Path) -> Result<()> {
    let contents = fs::read_to_string(config_path)
        .with_context(|| format!("failed to read {}", config_path.display()))?;
    let mut config_value = serde_json::from_str::<serde_json::Value>(&contents)
        .with_context(|| format!("failed to parse {}", config_path.display()))?;

    if ensure_default_desktop_owner_auth_value(&mut config_value) {
        let contents = serde_json::to_string_pretty(&config_value)
            .context("failed to serialize desktop config")?;
        fs::write(config_path, contents)
            .with_context(|| format!("failed to write {}", config_path.display()))?;
    }

    Ok(())
}

fn ensure_default_desktop_owner_auth_value(config_value: &mut serde_json::Value) -> bool {
    let mut changed = false;

    if !config_value.is_object() {
        *config_value = serde_json::Value::Object(serde_json::Map::new());
        changed = true;
    }

    let Some(root) = config_value.as_object_mut() else {
        return changed;
    };

    let auth_entry = root
        .entry("auth".to_string())
        .or_insert_with(|| serde_json::Value::Object(serde_json::Map::new()));
    if !auth_entry.is_object() {
        *auth_entry = serde_json::Value::Object(serde_json::Map::new());
        changed = true;
    }

    let Some(auth_object) = auth_entry.as_object_mut() else {
        return changed;
    };

    let configured_username = auth_object
        .get("username")
        .and_then(|value| value.as_str())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned);

    if configured_username.is_none() {
        auth_object.insert(
            "username".to_string(),
            serde_json::Value::String(DEFAULT_DESKTOP_OWNER_USERNAME.to_string()),
        );
        changed = true;
    }

    changed
}

fn get_desktop_auth_status_impl(app: &AppHandle) -> Result<DesktopAuthStatus> {
    let auth_config = resolve_desktop_auth_config(app)?;
    Ok(DesktopAuthStatus {
        username: auth_config.username,
        password_required: auth_config.password.is_some() || !auth_config.local_users.is_empty(),
        multi_user: !auth_config.local_users.is_empty(),
        owner_password_configured: auth_config.password.is_some(),
    })
}

fn change_desktop_password_impl(
    app: &AppHandle,
    username: String,
    new_password: String,
) -> Result<DesktopAuthStatus> {
    let target_username = normalize_required_string(username, "用户名不能为空")?;
    let normalized_password = normalize_required_string(new_password, "新密码不能为空")?;
    let auth_config = resolve_desktop_auth_config(app)?;

    if target_username == auth_config.username {
        let paths = resolve_runtime_paths(app)?;
        ensure_desktop_config_file(&paths.config_path)?;

        let mut config_value = read_desktop_app_config_value(app)?;
        set_desktop_owner_password_value(
            &mut config_value,
            auth_config.username.as_str(),
            normalized_password.as_str(),
        );
        write_json_value_file(&paths.config_path, &config_value)?;

        return get_desktop_auth_status_impl(app);
    }

    let user_exists = auth_config
        .local_users
        .iter()
        .any(|user| user.username == target_username);

    if !user_exists {
        anyhow::bail!("用户不存在");
    }

    let mut persistence_value = read_desktop_admin_persistence_value(app)?;
    set_desktop_local_user_password_value(
        &mut persistence_value,
        target_username.as_str(),
        normalized_password.as_str(),
    );
    write_desktop_admin_persistence_value(app, &persistence_value)?;

    get_desktop_auth_status_impl(app)
}

fn resolve_desktop_auth_config(app: &AppHandle) -> Result<ResolvedDesktopAuthConfig> {
    let config_value = read_desktop_app_config_value(app)?;
    let config_document =
        serde_json::from_value::<DesktopAppConfigDocument>(config_value).unwrap_or_default();
    let username = normalize_optional_string(config_document.auth.username)
        .unwrap_or_else(|| DEFAULT_DESKTOP_OWNER_USERNAME.to_string());
    let password = normalize_optional_string(config_document.auth.password);
    let persistence = read_desktop_admin_persistence_document(app).unwrap_or_default();
    let local_users = persistence
        .config
        .user_config
        .users
        .into_iter()
        .filter(|user| user.username != username)
        .map(|user| DesktopLocalAuthUser {
            password: persistence
                .user_passwords
                .get(&user.username)
                .cloned()
                .and_then(|password| normalize_optional_string(Some(password))),
            username: user.username,
            role: match user.role.as_str() {
                "owner" | "admin" => user.role,
                _ => "user".to_string(),
            },
            banned: user.banned,
        })
        .collect();

    Ok(ResolvedDesktopAuthConfig {
        username,
        password,
        local_users,
    })
}

fn read_desktop_admin_persistence_document(
    app: &AppHandle,
) -> Result<DesktopAdminPersistenceDocument> {
    let paths = resolve_runtime_paths(app)?;
    let path = paths.admin_persistence_path();

    if !path.exists() {
        return Ok(DesktopAdminPersistenceDocument::default());
    }

    let contents =
        fs::read_to_string(&path).with_context(|| format!("failed to read {}", path.display()))?;
    serde_json::from_str(&contents).with_context(|| format!("failed to parse {}", path.display()))
}

fn read_desktop_admin_persistence_value(app: &AppHandle) -> Result<serde_json::Value> {
    let paths = resolve_runtime_paths(app)?;
    let path = paths.admin_persistence_path();

    if !path.exists() {
        return Ok(serde_json::Value::Object(serde_json::Map::new()));
    }

    read_json_value_file(&path)
}

fn write_desktop_admin_persistence_value(
    app: &AppHandle,
    persistence_value: &serde_json::Value,
) -> Result<()> {
    let paths = resolve_runtime_paths(app)?;
    write_json_value_file(&paths.admin_persistence_path(), persistence_value)
}

fn read_json_value_file(path: &Path) -> Result<serde_json::Value> {
    let contents =
        fs::read_to_string(path).with_context(|| format!("failed to read {}", path.display()))?;
    serde_json::from_str(&contents).with_context(|| format!("failed to parse {}", path.display()))
}

fn write_json_value_file(path: &Path, value: &serde_json::Value) -> Result<()> {
    if let Some(parent_dir) = path.parent() {
        fs::create_dir_all(parent_dir)
            .with_context(|| format!("failed to create {}", parent_dir.display()))?;
    }

    let contents = serde_json::to_string_pretty(value)
        .with_context(|| format!("failed to serialize {}", path.display()))?;
    fs::write(path, contents).with_context(|| format!("failed to write {}", path.display()))
}

fn set_desktop_owner_password_value(
    config_value: &mut serde_json::Value,
    owner_username: &str,
    new_password: &str,
) {
    if !config_value.is_object() {
        *config_value = serde_json::Value::Object(serde_json::Map::new());
    }

    let root = config_value
        .as_object_mut()
        .expect("config root should be an object after normalization");
    let auth_entry = root
        .entry("auth".to_string())
        .or_insert_with(|| serde_json::Value::Object(serde_json::Map::new()));

    if !auth_entry.is_object() {
        *auth_entry = serde_json::Value::Object(serde_json::Map::new());
    }

    let auth_object = auth_entry
        .as_object_mut()
        .expect("auth entry should be an object after normalization");

    let current_username = auth_object
        .get("username")
        .and_then(|value| value.as_str())
        .map(str::trim)
        .filter(|value| !value.is_empty());
    if current_username.is_none() {
        auth_object.insert(
            "username".to_string(),
            serde_json::Value::String(owner_username.to_string()),
        );
    }

    auth_object.insert(
        "password".to_string(),
        serde_json::Value::String(new_password.to_string()),
    );
}

fn set_desktop_local_user_password_value(
    persistence_value: &mut serde_json::Value,
    username: &str,
    new_password: &str,
) {
    if !persistence_value.is_object() {
        *persistence_value = serde_json::Value::Object(serde_json::Map::new());
    }

    let root = persistence_value
        .as_object_mut()
        .expect("desktop admin persistence root should be an object after normalization");
    let passwords_entry = root
        .entry("userPasswords".to_string())
        .or_insert_with(|| serde_json::Value::Object(serde_json::Map::new()));

    if !passwords_entry.is_object() {
        *passwords_entry = serde_json::Value::Object(serde_json::Map::new());
    }

    let passwords_object = passwords_entry
        .as_object_mut()
        .expect("userPasswords should be an object after normalization");
    passwords_object.insert(
        username.to_string(),
        serde_json::Value::String(new_password.to_string()),
    );
}

fn normalize_optional_string(value: Option<String>) -> Option<String> {
    value.and_then(|text| {
        let normalized = text.trim().to_string();
        if normalized.is_empty() {
            None
        } else {
            Some(normalized)
        }
    })
}

fn normalize_required_string(value: String, error_message: &str) -> Result<String> {
    let normalized = value.trim().to_string();
    if normalized.is_empty() {
        anyhow::bail!("{}", error_message);
    }

    Ok(normalized)
}

fn open_url_in_system_browser(url: &str) -> Result<()> {
    #[cfg(target_os = "windows")]
    {
        let mut command = Command::new("explorer.exe");
        command
            .arg(url)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null());

        if !cfg!(debug_assertions) {
            command.creation_flags(CREATE_NO_WINDOW);
        }

        command
            .spawn()
            .with_context(|| format!("failed to open external URL {url}"))?;
        return Ok(());
    }

    #[cfg(target_os = "macos")]
    {
        Command::new("open")
            .arg(url)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .with_context(|| format!("failed to open external URL {url}"))?;
        return Ok(());
    }

    #[cfg(all(not(target_os = "windows"), not(target_os = "macos")))]
    {
        Command::new("xdg-open")
            .arg(url)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .with_context(|| format!("failed to open external URL {url}"))?;
        return Ok(());
    }
}

struct PreparedDesktopUpdateDownload {
    file_path: PathBuf,
    downloaded_bytes: u64,
    total_bytes: Option<u64>,
}

#[derive(Clone, Copy, Default)]
struct ParsedContentRange {
    start: Option<u64>,
    total: Option<u64>,
}

fn take_downloaded_update(state: &DesktopRuntimeState) -> Option<DownloadedDesktopUpdate> {
    let mut downloaded_update = state
        .downloaded_update
        .lock()
        .expect("downloaded update mutex poisoned");
    downloaded_update.take()
}

fn read_downloaded_update(state: &DesktopRuntimeState) -> Option<DownloadedDesktopUpdate> {
    let downloaded_update = state
        .downloaded_update
        .lock()
        .expect("downloaded update mutex poisoned");
    downloaded_update.clone()
}

fn clear_downloaded_update(state: &DesktopRuntimeState) {
    if let Some(downloaded_update) = take_downloaded_update(state) {
        remove_file_if_exists(&downloaded_update.file_path);
    }
}

fn store_downloaded_update(
    state: &DesktopRuntimeState,
    version: String,
    update: DesktopUpdateHandle,
    file_path: PathBuf,
) {
    let mut downloaded_update = state
        .downloaded_update
        .lock()
        .expect("downloaded update mutex poisoned");
    let next_file_path = file_path.clone();
    let previous = downloaded_update.replace(DownloadedDesktopUpdate {
        version,
        update,
        file_path,
    });
    drop(downloaded_update);

    if let Some(previous) = previous {
        if previous.file_path != next_file_path {
            remove_file_if_exists(&previous.file_path);
        }
    }
}

fn take_paused_update_download(state: &DesktopRuntimeState) -> Option<PausedDesktopUpdateDownload> {
    let mut paused_update_download = state
        .paused_update_download
        .lock()
        .expect("paused update download mutex poisoned");
    paused_update_download.take()
}

fn clear_paused_update_download(state: &DesktopRuntimeState) {
    if let Some(paused_update_download) = take_paused_update_download(state) {
        remove_file_if_exists(&paused_update_download.file_path);
    }
}

fn store_paused_update_download(
    state: &DesktopRuntimeState,
    paused_update_download: PausedDesktopUpdateDownload,
) {
    let mut paused_state = state
        .paused_update_download
        .lock()
        .expect("paused update download mutex poisoned");
    let next_file_path = paused_update_download.file_path.clone();
    let previous = paused_state.replace(paused_update_download);
    drop(paused_state);

    if let Some(previous) = previous {
        if previous.file_path != next_file_path {
            remove_file_if_exists(&previous.file_path);
        }
    }
}

fn take_matching_paused_update_download(
    state: &DesktopRuntimeState,
    version: &str,
    update: &DesktopUpdateHandle,
) -> Option<PausedDesktopUpdateDownload> {
    let paused_update_download = take_paused_update_download(state)?;

    if paused_update_download.version == version
        && paused_update_download.download_url == update.download_url
        && paused_update_download.signature == update.signature
    {
        Some(paused_update_download)
    } else {
        remove_file_if_exists(&paused_update_download.file_path);
        None
    }
}

fn begin_active_update_download(
    state: &DesktopRuntimeState,
    target_version: &str,
) -> Result<watch::Receiver<DesktopUpdateDownloadCommand>> {
    let mut active_download = state
        .active_update_download
        .lock()
        .expect("active update download mutex poisoned");

    if active_download.is_some() {
        anyhow::bail!("another desktop update download is already running");
    }

    let (command_tx, command_rx) = watch::channel(DesktopUpdateDownloadCommand::Running);
    *active_download = Some(ActiveDesktopUpdateDownload {
        target_version: target_version.to_string(),
        command_tx,
    });

    Ok(command_rx)
}

fn finish_active_update_download(state: &DesktopRuntimeState, target_version: &str) {
    let mut active_download = state
        .active_update_download
        .lock()
        .expect("active update download mutex poisoned");

    if active_download
        .as_ref()
        .map(|download| download.target_version == target_version)
        .unwrap_or(false)
    {
        *active_download = None;
    }
}

fn request_active_update_download_command(
    state: &DesktopRuntimeState,
    command: DesktopUpdateDownloadCommand,
) -> Result<()> {
    let active_download = state
        .active_update_download
        .lock()
        .expect("active update download mutex poisoned");
    let Some(active_download) = active_download.as_ref() else {
        anyhow::bail!("no active desktop update download");
    };

    active_download
        .command_tx
        .send(command)
        .map_err(|_| anyhow::anyhow!("failed to update desktop download state"))?;

    Ok(())
}

fn current_download_command(
    command_rx: &watch::Receiver<DesktopUpdateDownloadCommand>,
) -> DesktopUpdateDownloadCommand {
    *command_rx.borrow()
}

fn remove_file_if_exists(path: &Path) {
    match fs::remove_file(path) {
        Ok(_) => {}
        Err(error) if error.kind() == ErrorKind::NotFound => {}
        Err(error) => {
            tracing::warn!("failed to remove {}: {error}", path.display());
        }
    }
}

fn sanitize_download_file_fragment(value: &str) -> String {
    let mut sanitized = String::with_capacity(value.len());

    for character in value.chars() {
        if character.is_ascii_alphanumeric() {
            sanitized.push(character.to_ascii_lowercase());
        } else if matches!(character, '.' | '-' | '_') {
            sanitized.push('-');
        }
    }

    if sanitized.is_empty() {
        "update".to_string()
    } else {
        sanitized
    }
}

fn build_update_download_file_path(
    app: &AppHandle,
    version: &str,
    download_url: &Url,
) -> Result<PathBuf> {
    let runtime_paths = resolve_runtime_paths(app)?;
    let mut hasher = DefaultHasher::new();
    version.hash(&mut hasher);
    download_url.as_str().hash(&mut hasher);
    let fingerprint = hasher.finish();
    let file_name = format!(
        "desktop-update-{}-{fingerprint:016x}.part",
        sanitize_download_file_fragment(version)
    );

    Ok(runtime_paths
        .data_dir
        .join(DESKTOP_UPDATE_DOWNLOAD_DIR_NAME)
        .join(file_name))
}

fn tauri_config_updater_pubkey() -> Option<String> {
    let config_value: serde_json::Value =
        serde_json::from_str(include_str!("../tauri.conf.json")).ok()?;
    normalize_optional_string(
        config_value
            .get("plugins")
            .and_then(|value| value.get("updater"))
            .and_then(|value| value.get("pubkey"))
            .and_then(|value| value.as_str())
            .map(ToOwned::to_owned),
    )
}

fn configured_updater_pubkey() -> Option<String> {
    compile_time_updater_pubkey().or_else(tauri_config_updater_pubkey)
}

fn decode_updater_base64_string(value: &str) -> Result<String> {
    let decoded = BASE64_STANDARD
        .decode(value)
        .with_context(|| format!("failed to decode updater value: {value}"))?;

    std::str::from_utf8(&decoded)
        .map(ToOwned::to_owned)
        .with_context(|| format!("updater value is not valid UTF-8: {value}"))
}

fn verify_update_signature_bytes(bytes: &[u8], signature: &str) -> Result<()> {
    let pubkey = configured_updater_pubkey()
        .ok_or_else(|| anyhow::anyhow!("desktop updater public key is unavailable"))?;
    let pubkey_decoded = decode_updater_base64_string(&pubkey)?;
    let signature_decoded = decode_updater_base64_string(signature)?;
    let public_key = PublicKey::decode(&pubkey_decoded)
        .context("failed to decode desktop updater public key")?;
    let signature = Signature::decode(&signature_decoded)
        .context("failed to decode desktop updater signature")?;

    public_key
        .verify(bytes, &signature, true)
        .context("desktop updater signature verification failed")?;

    Ok(())
}

async fn verify_update_signature_file(file_path: &Path, signature: &str) -> Result<()> {
    let bytes = tokio_fs::read(file_path)
        .await
        .with_context(|| format!("failed to read {}", file_path.display()))?;

    verify_update_signature_bytes(&bytes, signature)
}

fn parse_content_range_header(value: &str) -> Option<ParsedContentRange> {
    let value = value.trim();
    let value = value.strip_prefix("bytes")?.trim();

    if let Some(total) = value.strip_prefix("*/") {
        return Some(ParsedContentRange {
            start: None,
            total: total.trim().parse().ok(),
        });
    }

    let (range_part, total_part) = value.split_once('/')?;
    let (start_part, _) = range_part.trim().split_once('-')?;
    Some(ParsedContentRange {
        start: start_part.trim().parse().ok(),
        total: total_part.trim().parse().ok(),
    })
}

fn parse_response_content_range(response: &reqwest::Response) -> Option<ParsedContentRange> {
    response
        .headers()
        .get(CONTENT_RANGE)
        .and_then(|value| value.to_str().ok())
        .and_then(parse_content_range_header)
}

fn parse_response_content_length(response: &reqwest::Response) -> Option<u64> {
    response
        .headers()
        .get(CONTENT_LENGTH)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.trim().parse().ok())
}

fn add_download_lengths(left: u64, right: u64) -> Result<u64> {
    left.checked_add(right)
        .ok_or_else(|| anyhow::anyhow!("desktop update size overflow"))
}

fn resolve_response_total_bytes(
    response: &reqwest::Response,
    downloaded_bytes: u64,
    previous_total_bytes: Option<u64>,
) -> Result<Option<u64>> {
    if response.status() == StatusCode::PARTIAL_CONTENT {
        if let Some(content_range) = parse_response_content_range(response) {
            if let Some(range_start) = content_range.start {
                if range_start != downloaded_bytes {
                    anyhow::bail!(
                        "desktop update resume offset mismatch: expected {downloaded_bytes}, got {range_start}"
                    );
                }
            }

            if let Some(total) = content_range.total {
                return Ok(Some(total));
            }
        }

        if let Some(content_length) = parse_response_content_length(response) {
            return Ok(Some(add_download_lengths(
                downloaded_bytes,
                content_length,
            )?));
        }

        return Ok(previous_total_bytes);
    }

    Ok(parse_response_content_length(response))
}

fn is_direct_github_update_url(url: &Url) -> bool {
    let Some(host) = url.host_str() else {
        return false;
    };

    matches!(
        host,
        "github.com"
            | "raw.githubusercontent.com"
            | "objects.githubusercontent.com"
            | "release-assets.githubusercontent.com"
    ) || host.ends_with(".githubusercontent.com")
}

fn should_use_direct_update_timeout(update: &DesktopUpdateHandle) -> bool {
    is_direct_github_update_url(&update.download_url)
}

fn build_update_download_client(update: &DesktopUpdateHandle) -> Result<reqwest::Client> {
    let mut client_builder = ClientBuilder::new().user_agent(DESKTOP_UPDATER_USER_AGENT);

    if should_use_direct_update_timeout(update) {
        client_builder = client_builder.connect_timeout(DESKTOP_UPDATER_NETWORK_TIMEOUT);
    }

    if let Some(timeout) = update.timeout {
        client_builder = client_builder.timeout(timeout);
    }

    if update.no_proxy {
        client_builder = client_builder.no_proxy();
    } else if let Some(proxy) = update.proxy.as_ref() {
        client_builder = client_builder.proxy(reqwest::Proxy::all(proxy.as_str())?);
    }

    client_builder
        .build()
        .context("failed to build desktop updater download client")
}

fn build_update_download_headers(
    update: &DesktopUpdateHandle,
    downloaded_bytes: u64,
) -> Result<HeaderMap> {
    let mut headers = update.headers.clone();

    if !headers.contains_key(ACCEPT) {
        headers.insert(ACCEPT, HeaderValue::from_static("application/octet-stream"));
    }

    if downloaded_bytes > 0 {
        headers.insert(
            RANGE,
            HeaderValue::from_str(&format!("bytes={downloaded_bytes}-"))
                .context("failed to build resumable update download range header")?,
        );
    }

    Ok(headers)
}

async fn read_partial_download_length(file_path: &Path) -> Result<u64> {
    match tokio_fs::metadata(file_path).await {
        Ok(metadata) => Ok(metadata.len()),
        Err(error) if error.kind() == ErrorKind::NotFound => Ok(0),
        Err(error) => {
            Err(error).with_context(|| format!("failed to inspect {}", file_path.display()))
        }
    }
}

async fn prepare_update_download(
    app: &AppHandle,
    state: &DesktopRuntimeState,
    version: &str,
    update: &DesktopUpdateHandle,
) -> Result<PreparedDesktopUpdateDownload> {
    if let Some(paused_update_download) =
        take_matching_paused_update_download(state, version, update)
    {
        let downloaded_bytes =
            read_partial_download_length(&paused_update_download.file_path).await?;

        if let Some(total_bytes) = paused_update_download.total_bytes {
            if downloaded_bytes > total_bytes {
                remove_file_if_exists(&paused_update_download.file_path);
                let file_path =
                    build_update_download_file_path(app, version, &update.download_url)?;
                return Ok(PreparedDesktopUpdateDownload {
                    file_path,
                    downloaded_bytes: 0,
                    total_bytes: None,
                });
            }
        }

        return Ok(PreparedDesktopUpdateDownload {
            file_path: paused_update_download.file_path,
            downloaded_bytes,
            total_bytes: paused_update_download.total_bytes,
        });
    }

    let file_path = build_update_download_file_path(app, version, &update.download_url)?;
    remove_file_if_exists(&file_path);

    Ok(PreparedDesktopUpdateDownload {
        file_path,
        downloaded_bytes: 0,
        total_bytes: None,
    })
}

async fn open_update_download_file(
    file_path: &Path,
    downloaded_bytes: u64,
) -> Result<tokio_fs::File> {
    if let Some(parent) = file_path.parent() {
        tokio_fs::create_dir_all(parent)
            .await
            .with_context(|| format!("failed to create {}", parent.display()))?;
    }

    let mut options = TokioOpenOptions::new();
    options.create(true).write(true);

    if downloaded_bytes > 0 {
        options.append(true);
    } else {
        options.truncate(true);
    }

    options
        .open(file_path)
        .await
        .with_context(|| format!("failed to open {}", file_path.display()))
}

async fn download_update_with_control_inner(
    update: &DesktopUpdateHandle,
    prepared_download: PreparedDesktopUpdateDownload,
    on_event: Channel<DesktopReleaseInstallEvent>,
    mut command_rx: watch::Receiver<DesktopUpdateDownloadCommand>,
) -> Result<DesktopUpdateDownloadResult> {
    if let Some(total_bytes) = prepared_download.total_bytes {
        if prepared_download.downloaded_bytes == total_bytes && total_bytes > 0 {
            verify_update_signature_file(&prepared_download.file_path, &update.signature).await?;
            let _ = on_event.send(DesktopReleaseInstallEvent::Started {
                content_length: Some(total_bytes),
                downloaded_length: Some(prepared_download.downloaded_bytes),
            });
            let _ = on_event.send(DesktopReleaseInstallEvent::Finished);
            return Ok(DesktopUpdateDownloadResult::Completed {
                file_path: prepared_download.file_path,
            });
        }
    }

    let client = build_update_download_client(update)?;
    let headers = build_update_download_headers(update, prepared_download.downloaded_bytes)?;
    let use_direct_timeout = should_use_direct_update_timeout(update);
    let request = client.get(update.download_url.clone()).headers(headers);
    let response = if use_direct_timeout {
        tokio::time::timeout(DESKTOP_UPDATER_NETWORK_TIMEOUT, request.send())
            .await
            .context("timed out while waiting for desktop update response")?
    } else {
        request.send().await
    }
    .context("failed to download desktop update")?;
    let status = response.status();

    if prepared_download.downloaded_bytes > 0 && status == StatusCode::RANGE_NOT_SATISFIABLE {
        let total_bytes = parse_response_content_range(&response)
            .and_then(|content_range| content_range.total)
            .or(prepared_download.total_bytes);

        if total_bytes == Some(prepared_download.downloaded_bytes) {
            verify_update_signature_file(&prepared_download.file_path, &update.signature).await?;
            let _ = on_event.send(DesktopReleaseInstallEvent::Started {
                content_length: total_bytes,
                downloaded_length: Some(prepared_download.downloaded_bytes),
            });
            let _ = on_event.send(DesktopReleaseInstallEvent::Finished);
            return Ok(DesktopUpdateDownloadResult::Completed {
                file_path: prepared_download.file_path,
            });
        }

        anyhow::bail!("desktop update server rejected resuming the partial download");
    }

    if prepared_download.downloaded_bytes > 0 && status == StatusCode::OK {
        anyhow::bail!("desktop update server does not support resumable downloads");
    }

    if !status.is_success() {
        anyhow::bail!("desktop update request failed with status: {status}");
    }

    let total_bytes = resolve_response_total_bytes(
        &response,
        prepared_download.downloaded_bytes,
        prepared_download.total_bytes,
    )?;
    let mut file = open_update_download_file(
        &prepared_download.file_path,
        prepared_download.downloaded_bytes,
    )
    .await?;
    let mut downloaded_bytes = prepared_download.downloaded_bytes;
    let mut stream = response.bytes_stream();
    let _ = on_event.send(DesktopReleaseInstallEvent::Started {
        content_length: total_bytes,
        downloaded_length: Some(downloaded_bytes),
    });

    loop {
        match current_download_command(&command_rx) {
            DesktopUpdateDownloadCommand::Running => {}
            DesktopUpdateDownloadCommand::Pause => {
                file.flush().await?;
                return Ok(DesktopUpdateDownloadResult::Paused {
                    file_path: prepared_download.file_path,
                    total_bytes,
                });
            }
            DesktopUpdateDownloadCommand::Cancel => {
                file.flush().await?;
                return Ok(DesktopUpdateDownloadResult::Canceled);
            }
        }

        tokio::select! {
            changed = command_rx.changed() => {
                if changed.is_err() {
                    file.flush().await?;
                    return Ok(DesktopUpdateDownloadResult::Canceled);
                }
            }
            next_chunk = async {
                if use_direct_timeout {
                    tokio::time::timeout(DESKTOP_UPDATER_NETWORK_TIMEOUT, stream.next())
                        .await
                        .context("timed out while waiting for desktop update data")
                } else {
                    Ok(stream.next().await)
                }
            } => {
                match next_chunk? {
                    Some(Ok(chunk)) => {
                        file.write_all(&chunk).await?;
                        downloaded_bytes = add_download_lengths(downloaded_bytes, chunk.len() as u64)?;
                        let _ = on_event.send(DesktopReleaseInstallEvent::Progress {
                            chunk_length: chunk.len(),
                        });
                    }
                    Some(Err(error)) => return Err(error).context("failed while streaming desktop update"),
                    None => break,
                }
            }
        }
    }

    file.flush().await?;
    verify_update_signature_file(&prepared_download.file_path, &update.signature).await?;
    let _ = on_event.send(DesktopReleaseInstallEvent::Finished);

    Ok(DesktopUpdateDownloadResult::Completed {
        file_path: prepared_download.file_path,
    })
}

async fn download_update_with_control(
    app: &AppHandle,
    state: &DesktopRuntimeState,
    version: &str,
    update: &DesktopUpdateHandle,
    on_event: Channel<DesktopReleaseInstallEvent>,
    command_rx: watch::Receiver<DesktopUpdateDownloadCommand>,
) -> Result<DesktopUpdateDownloadResult> {
    let prepared_download = prepare_update_download(app, state, version, update).await?;
    let cleanup_path = prepared_download.file_path.clone();
    let download_result =
        download_update_with_control_inner(update, prepared_download, on_event, command_rx).await;

    match download_result {
        Ok(DesktopUpdateDownloadResult::Canceled) => {
            remove_file_if_exists(&cleanup_path);
            Ok(DesktopUpdateDownloadResult::Canceled)
        }
        Ok(result) => Ok(result),
        Err(error) => {
            remove_file_if_exists(&cleanup_path);
            Err(error)
        }
    }
}

fn to_desktop_available_update(update: DesktopUpdateHandle) -> DesktopAvailableUpdate {
    DesktopAvailableUpdate {
        version: update.version,
        current_version: update.current_version,
        date: update.date.map(|date| date.to_string()),
        body: update.body,
    }
}

fn normalize_release_repository_slug(value: &str) -> Option<String> {
    let trimmed = value.trim();
    if trimmed.is_empty() || trimmed.chars().any(char::is_whitespace) {
        return None;
    }

    let mut parts = trimmed.split('/');
    let owner = parts.next()?;
    let repository = parts.next()?;
    if owner.is_empty() || repository.is_empty() || parts.next().is_some() {
        return None;
    }

    Some(trimmed.to_string())
}

fn append_cache_busting_query(url: &Url) -> Url {
    let mut url = url.clone();
    let timestamp = current_timestamp_ms().to_string();
    url.query_pairs_mut().append_pair("_t", &timestamp);
    url
}

fn build_release_history_api_url(repository: &str) -> String {
    format!("{GITHUB_API_BASE_URL}/repos/{repository}/releases?per_page=100")
}

fn normalize_optional_trimmed_string(value: Option<&str>) -> Option<String> {
    let normalized = value?.trim();
    if normalized.is_empty() {
        None
    } else {
        Some(normalized.to_string())
    }
}

fn extract_desktop_release_version(tag_name: Option<&str>) -> Option<String> {
    let normalized_tag = tag_name?.trim();
    let version = normalized_tag
        .strip_prefix(DESKTOP_RELEASE_TAG_PREFIX)?
        .trim();
    if version.is_empty() {
        return None;
    }

    Version::parse(version).ok()?;
    Some(version.to_string())
}

fn find_desktop_release_manifest_url(
    assets: Option<&[GithubReleaseAssetPayload]>,
) -> Option<String> {
    assets?.iter().find_map(|asset| {
        let name = asset.name.as_deref()?.trim();
        if name != DESKTOP_RELEASE_MANIFEST_NAME {
            return None;
        }

        normalize_optional_trimmed_string(asset.browser_download_url.as_deref())
    })
}

fn stringify_github_release_identifier(
    id: &Option<GithubReleaseIdentifier>,
    fallback: &str,
) -> String {
    match id {
        Some(GithubReleaseIdentifier::String(value)) => {
            let normalized = value.trim();
            if normalized.is_empty() {
                fallback.to_string()
            } else {
                normalized.to_string()
            }
        }
        Some(GithubReleaseIdentifier::Number(value)) => value.to_string(),
        None => fallback.to_string(),
    }
}

fn normalize_desktop_release_history(
    releases: Vec<GithubReleasePayload>,
) -> Vec<DesktopReleaseHistoryItem> {
    let mut items = releases
        .into_iter()
        .filter_map(|release| {
            if release.draft == Some(true) {
                return None;
            }

            let tag_name = normalize_optional_trimmed_string(release.tag_name.as_deref())?;
            let version = extract_desktop_release_version(Some(&tag_name))?;
            let manifest_url = find_desktop_release_manifest_url(release.assets.as_deref())?;

            Some(DesktopReleaseHistoryItem {
                id: stringify_github_release_identifier(&release.id, &tag_name),
                version,
                tag_name: tag_name.clone(),
                name: normalize_optional_trimmed_string(release.name.as_deref())
                    .unwrap_or_else(|| tag_name.clone()),
                notes: normalize_optional_trimmed_string(release.body.as_deref()),
                prerelease: release.prerelease == Some(true),
                published_at: normalize_optional_trimmed_string(release.published_at.as_deref())
                    .or_else(|| normalize_optional_trimmed_string(release.created_at.as_deref())),
                html_url: normalize_optional_trimmed_string(release.html_url.as_deref()),
                manifest_url,
            })
        })
        .collect::<Vec<_>>();

    items.sort_by(|left, right| {
        let version_order = Version::parse(&right.version)
            .ok()
            .zip(Version::parse(&left.version).ok())
            .map(|(right_version, left_version)| right_version.cmp(&left_version))
            .unwrap_or(std::cmp::Ordering::Equal);
        if version_order != std::cmp::Ordering::Equal {
            return version_order;
        }

        right
            .published_at
            .as_deref()
            .unwrap_or_default()
            .cmp(left.published_at.as_deref().unwrap_or_default())
    });

    items
}

#[derive(Deserialize)]
struct GithubApiErrorPayload {
    message: Option<String>,
}

fn read_github_api_error_message(body_text: &str) -> Option<String> {
    serde_json::from_str::<GithubApiErrorPayload>(body_text)
        .ok()
        .and_then(|payload| payload.message)
        .map(|message| message.trim().to_string())
        .filter(|message| !message.is_empty())
}

fn build_github_api_error_fallback(body_text: &str, status: StatusCode) -> String {
    let trimmed = body_text.trim();
    if trimmed.is_empty() {
        return format!("HTTP {status}");
    }

    let excerpt = trimmed.chars().take(500).collect::<String>();
    if excerpt.is_empty() {
        format!("HTTP {status}")
    } else {
        excerpt
    }
}

async fn fetch_latest_remote_version_impl(urls: Vec<String>) -> Result<Option<String>> {
    let client = reqwest::Client::builder()
        .timeout(DESKTOP_UPDATER_NETWORK_TIMEOUT)
        .build()
        .context("failed to build desktop version check client")?;

    for raw_url in urls {
        let normalized_url = raw_url.trim();
        if normalized_url.is_empty() {
            continue;
        }

        let parsed_url = match Url::parse(normalized_url) {
            Ok(url) => url,
            Err(error) => {
                tracing::warn!("ignored invalid desktop version URL {normalized_url}: {error}");
                continue;
            }
        };
        let request_url = append_cache_busting_query(&parsed_url);
        let response = match client
            .get(request_url.clone())
            .header(ACCEPT, "text/plain")
            .send()
            .await
        {
            Ok(response) => response,
            Err(error) => {
                tracing::warn!(
                    "failed to fetch remote version from {}: {error}",
                    parsed_url
                );
                continue;
            }
        };

        if !response.status().is_success() {
            tracing::warn!(
                "failed to fetch remote version from {}: HTTP {}",
                parsed_url,
                response.status()
            );
            continue;
        }

        let version = match response.text().await {
            Ok(body_text) => body_text.trim().to_string(),
            Err(error) => {
                tracing::warn!(
                    "failed to read remote version response from {}: {error}",
                    parsed_url
                );
                continue;
            }
        };

        if !version.is_empty() {
            return Ok(Some(version));
        }
    }

    Ok(None)
}

async fn fetch_desktop_release_history_impl(
    repository: String,
) -> Result<Vec<DesktopReleaseHistoryItem>> {
    let repository = normalize_release_repository_slug(&repository)
        .ok_or_else(|| anyhow::anyhow!("invalid desktop release repository configuration"))?;
    let client = reqwest::Client::builder()
        .timeout(DESKTOP_UPDATER_NETWORK_TIMEOUT)
        .build()
        .context("failed to build desktop release history client")?;
    let response = client
        .get(build_release_history_api_url(&repository))
        .header(ACCEPT, "application/vnd.github+json")
        .header(reqwest::header::USER_AGENT, DESKTOP_UPDATER_USER_AGENT)
        .send()
        .await
        .context("failed to fetch desktop release history")?;
    let status = response.status();
    let body_text = response
        .text()
        .await
        .context("failed to read desktop release history response")?;

    if !status.is_success() {
        anyhow::bail!(
            "GitHub API error {}: {}",
            status,
            read_github_api_error_message(&body_text)
                .unwrap_or_else(|| build_github_api_error_fallback(&body_text, status))
        );
    }

    let payload = serde_json::from_str::<Vec<GithubReleasePayload>>(&body_text)
        .context("unexpected desktop release payload")?;

    Ok(normalize_desktop_release_history(payload))
}

async fn load_latest_desktop_update(app: &AppHandle) -> Result<Option<DesktopUpdateHandle>> {
    let mut update = app
        .updater_builder()
        .timeout(DESKTOP_UPDATER_NETWORK_TIMEOUT)
        .build()?
        .check()
        .await?;

    if let Some(next_update) = update.as_mut() {
        next_update.timeout = None;
    }

    Ok(update)
}

async fn check_desktop_update_impl(app: &AppHandle) -> Result<Option<DesktopAvailableUpdate>> {
    Ok(load_latest_desktop_update(app)
        .await?
        .map(to_desktop_available_update))
}

async fn resolve_latest_desktop_update(
    app: &AppHandle,
    expected_version: &str,
) -> Result<DesktopUpdateHandle> {
    let update = load_latest_desktop_update(app)
        .await?
        .ok_or_else(|| anyhow::anyhow!("desktop update {expected_version} is unavailable"))?;

    if update.version != expected_version {
        anyhow::bail!(
            "latest desktop update resolved to unexpected version {}",
            update.version
        );
    }

    Ok(update)
}

async fn resolve_desktop_release_update(
    app: &AppHandle,
    manifest_url: Url,
    version: &str,
) -> Result<DesktopUpdateHandle> {
    let expected_version = version.to_string();
    let updater = app
        .updater_builder()
        .timeout(DESKTOP_UPDATER_NETWORK_TIMEOUT)
        .version_comparator(move |_current, release| {
            release.version.to_string() == expected_version
        })
        .endpoints(vec![manifest_url])?
        .build()?;
    let mut update = updater
        .check()
        .await?
        .ok_or_else(|| anyhow::anyhow!("desktop release {version} is unavailable"))?;

    if update.version != version {
        anyhow::bail!(
            "desktop release manifest resolved to unexpected version {}",
            update.version
        );
    }

    update.timeout = None;

    Ok(update)
}

async fn download_latest_desktop_update_impl(
    app: &AppHandle,
    state: &DesktopRuntimeState,
    version: String,
    on_event: Channel<DesktopReleaseInstallEvent>,
) -> Result<()> {
    let version = normalize_required_string(version, "desktop update version cannot be empty")?;
    let update = resolve_latest_desktop_update(app, &version).await?;
    let command_rx = begin_active_update_download(state, &version)?;
    clear_downloaded_update(state);

    let download_result =
        download_update_with_control(app, state, &version, &update, on_event, command_rx).await;
    finish_active_update_download(state, &version);

    match download_result? {
        DesktopUpdateDownloadResult::Completed { file_path } => {
            store_downloaded_update(state, version, update, file_path);
            Ok(())
        }
        DesktopUpdateDownloadResult::Paused {
            file_path,
            total_bytes,
        } => {
            store_paused_update_download(
                state,
                PausedDesktopUpdateDownload {
                    version,
                    download_url: update.download_url.clone(),
                    signature: update.signature.clone(),
                    file_path,
                    total_bytes,
                },
            );
            anyhow::bail!(DESKTOP_UPDATE_DOWNLOAD_PAUSED);
        }
        DesktopUpdateDownloadResult::Canceled => {
            clear_paused_update_download(state);
            anyhow::bail!(DESKTOP_UPDATE_DOWNLOAD_CANCELED);
        }
    }
}

async fn download_desktop_release_impl(
    app: &AppHandle,
    state: &DesktopRuntimeState,
    manifest_url: String,
    version: String,
    on_event: Channel<DesktopReleaseInstallEvent>,
) -> Result<()> {
    let manifest_url =
        normalize_required_string(manifest_url, "desktop release manifest URL cannot be empty")?;
    let version = normalize_required_string(version, "desktop release version cannot be empty")?;
    let manifest_url =
        Url::parse(&manifest_url).context("desktop release manifest URL is invalid")?;
    let update = resolve_desktop_release_update(app, manifest_url, &version).await?;
    let command_rx = begin_active_update_download(state, &version)?;
    clear_downloaded_update(state);

    let download_result =
        download_update_with_control(app, state, &version, &update, on_event, command_rx).await;
    finish_active_update_download(state, &version);

    match download_result? {
        DesktopUpdateDownloadResult::Completed { file_path } => {
            store_downloaded_update(state, version, update, file_path);
            Ok(())
        }
        DesktopUpdateDownloadResult::Paused {
            file_path,
            total_bytes,
        } => {
            store_paused_update_download(
                state,
                PausedDesktopUpdateDownload {
                    version,
                    download_url: update.download_url.clone(),
                    signature: update.signature.clone(),
                    file_path,
                    total_bytes,
                },
            );
            anyhow::bail!(DESKTOP_UPDATE_DOWNLOAD_PAUSED);
        }
        DesktopUpdateDownloadResult::Canceled => {
            clear_paused_update_download(state);
            anyhow::bail!(DESKTOP_UPDATE_DOWNLOAD_CANCELED);
        }
    }
}

fn read_downloaded_update_bytes(file_path: &Path) -> Result<Vec<u8>> {
    fs::read(file_path).with_context(|| format!("failed to read {}", file_path.display()))
}

fn install_downloaded_desktop_update_impl(
    app: &AppHandle,
    state: &DesktopRuntimeState,
    version: Option<String>,
) -> Result<()> {
    let expected_version = normalize_optional_string(version);
    let Some(downloaded_update) = read_downloaded_update(state) else {
        anyhow::bail!("downloaded desktop update is unavailable");
    };

    if let Some(expected_version) = expected_version {
        if downloaded_update.version != expected_version {
            anyhow::bail!(
                "downloaded desktop update version {} does not match {}",
                downloaded_update.version,
                expected_version
            );
        }
    }

    let bytes = read_downloaded_update_bytes(&downloaded_update.file_path)?;
    verify_update_signature_bytes(&bytes, &downloaded_update.update.signature)?;
    downloaded_update.update.install(&bytes)?;
    clear_downloaded_update(state);
    app.request_restart();
    Ok(())
}

async fn install_desktop_release_impl(
    app: &AppHandle,
    state: &DesktopRuntimeState,
    manifest_url: String,
    version: String,
    on_event: Channel<DesktopReleaseInstallEvent>,
) -> Result<()> {
    let manifest_url =
        normalize_required_string(manifest_url, "desktop release manifest URL cannot be empty")?;
    let version = normalize_required_string(version, "desktop release version cannot be empty")?;
    let manifest_url =
        Url::parse(&manifest_url).context("desktop release manifest URL is invalid")?;
    let update = resolve_desktop_release_update(app, manifest_url, &version).await?;

    let command_rx = begin_active_update_download(state, &version)?;
    clear_downloaded_update(state);

    let download_result =
        download_update_with_control(app, state, &version, &update, on_event.clone(), command_rx)
            .await;
    finish_active_update_download(state, &version);

    match download_result? {
        DesktopUpdateDownloadResult::Completed { file_path } => {
            let bytes = read_downloaded_update_bytes(&file_path)?;
            verify_update_signature_bytes(&bytes, &update.signature)?;
            let _ = on_event.send(DesktopReleaseInstallEvent::Installing);
            update.install(&bytes)?;
            remove_file_if_exists(&file_path);
            app.request_restart();
            Ok(())
        }
        DesktopUpdateDownloadResult::Paused {
            file_path,
            total_bytes,
        } => {
            store_paused_update_download(
                state,
                PausedDesktopUpdateDownload {
                    version,
                    download_url: update.download_url.clone(),
                    signature: update.signature.clone(),
                    file_path,
                    total_bytes,
                },
            );
            anyhow::bail!(DESKTOP_UPDATE_DOWNLOAD_PAUSED);
        }
        DesktopUpdateDownloadResult::Canceled => {
            clear_paused_update_download(state);
            anyhow::bail!(DESKTOP_UPDATE_DOWNLOAD_CANCELED);
        }
    }
}

fn save_local_service_diagnostics_impl(
    default_filename: String,
    contents: String,
) -> Result<LocalServiceDiagnosticsSaveResult> {
    let default_filename = normalize_required_string(
        default_filename,
        "diagnostics export filename cannot be empty",
    )?;

    let Some(path) = rfd::FileDialog::new()
        .set_title("导出排查日志")
        .set_file_name(&default_filename)
        .add_filter("Text", &["txt"])
        .save_file()
    else {
        return Ok(LocalServiceDiagnosticsSaveResult {
            saved: false,
            canceled: true,
            path: None,
        });
    };

    let path = ensure_file_extension(path, "txt");

    if let Some(parent_dir) = path.parent() {
        fs::create_dir_all(parent_dir)
            .with_context(|| format!("failed to create {}", parent_dir.display()))?;
    }

    fs::write(&path, contents.as_bytes())
        .with_context(|| format!("failed to write {}", path.display()))?;

    Ok(LocalServiceDiagnosticsSaveResult {
        saved: true,
        canceled: false,
        path: Some(path.display().to_string()),
    })
}

fn ensure_file_extension(mut path: PathBuf, extension: &str) -> PathBuf {
    let has_extension = path
        .extension()
        .and_then(|value| value.to_str())
        .map(|value| !value.trim().is_empty())
        .unwrap_or(false);

    if !has_extension {
        path.set_extension(extension);
    }

    path
}

fn sidecar_binary_file_name() -> String {
    let extension = if cfg!(target_os = "windows") {
        ".exe"
    } else {
        ""
    };

    format!(
        "{LOCAL_SERVICE_BINARY_NAME}-{}{}",
        env!("LUNATV_TARGET_TRIPLE"),
        extension
    )
}

fn sidecar_runtime_file_name() -> String {
    let extension = if cfg!(target_os = "windows") {
        ".exe"
    } else {
        ""
    };

    format!("{LOCAL_SERVICE_BINARY_NAME}{extension}")
}

fn sidecar_release_candidates(app: &AppHandle) -> Result<Vec<PathBuf>> {
    let current_exe =
        std::env::current_exe().context("failed to resolve current executable path")?;
    let executable_dir = current_exe
        .parent()
        .context("failed to resolve executable directory")?;
    let bundled_sidecar_name = sidecar_runtime_file_name();
    let dev_sidecar_name = sidecar_binary_file_name();
    let mut candidates = vec![
        executable_dir.join(&bundled_sidecar_name),
        executable_dir.join(&dev_sidecar_name),
    ];

    if let Ok(resource_dir) = app.path().resource_dir() {
        candidates.push(resource_dir.join("binaries").join(&dev_sidecar_name));
        candidates.push(resource_dir.join("binaries").join(&bundled_sidecar_name));
        candidates.push(resource_dir.join(&bundled_sidecar_name));
        candidates.push(resource_dir.join(&dev_sidecar_name));
    }

    candidates.dedup();
    Ok(candidates)
}

fn project_root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .expect("src-tauri should live under the repository root")
        .to_path_buf()
}

fn resolve_runtime_paths(app: &AppHandle) -> Result<RuntimePaths> {
    let data_dir = app
        .path()
        .app_data_dir()
        .context("failed to resolve app data directory")?;

    Ok(RuntimePaths {
        config_path: data_dir.join(LOCAL_SERVICE_CONFIG_FILE_NAME),
        sqlite_path: data_dir.join(LOCAL_SERVICE_DB_FILE_NAME),
        data_dir,
    })
}

struct RuntimePaths {
    config_path: PathBuf,
    data_dir: PathBuf,
    sqlite_path: PathBuf,
}

impl RuntimePaths {
    fn admin_persistence_path(&self) -> PathBuf {
        self.data_dir.join(ADMIN_PERSISTENCE_FILE_NAME)
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
struct SidecarBinaryVersionProbe {
    path: PathBuf,
    version: Option<String>,
    error: Option<String>,
}

fn parse_sidecar_binary_version_output(stdout: &[u8], stderr: &[u8]) -> Option<String> {
    let stdout_text = String::from_utf8_lossy(stdout);
    let stderr_text = String::from_utf8_lossy(stderr);

    [stdout_text.as_ref(), stderr_text.as_ref()]
        .into_iter()
        .flat_map(|text| text.lines())
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .find_map(|line| {
            line.split_whitespace()
                .rev()
                .find(|token| Version::parse(token).is_ok())
                .map(str::to_string)
        })
}

fn probe_sidecar_binary_version(path: &Path) -> SidecarBinaryVersionProbe {
    let mut command = Command::new(path);
    command
        .arg("--version")
        .current_dir(
            path.parent()
                .filter(|parent| !parent.as_os_str().is_empty())
                .unwrap_or_else(|| Path::new(".")),
        )
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    configure_background_command(&mut command);

    match command.output() {
        Ok(output) => {
            let version = parse_sidecar_binary_version_output(&output.stdout, &output.stderr);
            let error = if output.status.success() {
                if version.is_none() {
                    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
                    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
                    Some(format!(
                        "sidecar version probe returned no semver output (stdout: {:?}, stderr: {:?})",
                        stdout, stderr
                    ))
                } else {
                    None
                }
            } else {
                Some(format!(
                    "sidecar version probe exited with status {}",
                    output
                        .status
                        .code()
                        .map(|code| code.to_string())
                        .unwrap_or_else(|| "unknown".to_string())
                ))
            };

            SidecarBinaryVersionProbe {
                path: path.to_path_buf(),
                version,
                error,
            }
        }
        Err(error) => SidecarBinaryVersionProbe {
            path: path.to_path_buf(),
            version: None,
            error: Some(format!("failed to execute sidecar version probe: {error}")),
        },
    }
}

fn select_preferred_sidecar_candidates(
    probes: Vec<SidecarBinaryVersionProbe>,
    current_version: &str,
) -> Result<Vec<PathBuf>> {
    let mut matching_paths = Vec::new();
    let mut unknown_paths = Vec::new();
    let mut mismatched_details = Vec::new();

    for probe in probes {
        match probe.version.as_deref() {
            Some(version) if version == current_version => {
                matching_paths.push(probe.path);
            }
            Some(version) => {
                mismatched_details.push(format!("{} => {}", probe.path.display(), version));
            }
            None => {
                unknown_paths.push(probe.path);
            }
        }
    }

    if !matching_paths.is_empty() {
        matching_paths.extend(unknown_paths);
        return Ok(matching_paths);
    }

    if !unknown_paths.is_empty() {
        return Ok(unknown_paths);
    }

    let checked = if mismatched_details.is_empty() {
        "no readable sidecar candidates".to_string()
    } else {
        mismatched_details.join(", ")
    };

    Err(anyhow::anyhow!(
        "failed to locate a bundled local service sidecar matching desktop version {current_version}; checked: {checked}"
    ))
}

fn resolve_sidecar_binary_paths(app: &AppHandle, current_version: &str) -> Result<Vec<PathBuf>> {
    let candidates = local_service_sidecar_candidates(app)?;
    let available_candidates = candidates
        .into_iter()
        .filter(|path| path.is_file())
        .collect::<Vec<_>>();

    if available_candidates.is_empty() {
        return Err(anyhow::anyhow!(
            "failed to locate bundled local service sidecar; checked: {}",
            local_service_sidecar_candidates(app)
                .ok()
                .unwrap_or_default()
                .into_iter()
                .map(|path| path.display().to_string())
                .collect::<Vec<_>>()
                .join(", ")
        ));
    }

    let probes = available_candidates
        .iter()
        .map(|path| probe_sidecar_binary_version(path))
        .collect::<Vec<_>>();

    select_preferred_sidecar_candidates(probes, current_version)
}

#[cfg(test)]
mod tests {
    use super::{
        DEFAULT_DESKTOP_OWNER_USERNAME, DesktopMusicTrayPlayState, DesktopMusicTrayStatePayload,
        GithubReleaseAssetPayload, GithubReleasePayload, LOCAL_SERVICE_HEALTH_READ_TIMEOUT,
        LocalProfileSyncStatus, LocalServiceHealthCheck, LocalServiceStartupFailure,
        PortOccupant, SidecarBinaryVersionProbe, SidecarTrialResult, append_cache_busting_query,
        build_profile_sync_status_diagnostic_detail, collect_diagnostics_error_text,
        describe_primary_port_issue, ensure_default_desktop_owner_auth_value,
        extract_desktop_release_version, extract_profile_sync_api_base_url,
        find_desktop_release_manifest_url, local_service_health_check,
        normalize_desktop_release_history, normalize_release_repository_slug,
        resolve_music_tray_title, resolve_music_tray_tooltip, select_preferred_sidecar_candidates,
        set_desktop_local_user_password_value, set_desktop_owner_password_value,
        should_reuse_untracked_local_service, summarize_trial_output,
    };
    use std::path::PathBuf;
    use std::time::Duration;
    use tokio::{
        io::{AsyncReadExt, AsyncWriteExt},
        net::TcpListener,
    };
    use url::Url;

    #[test]
    fn resolves_playing_music_tray_copy_from_active_track() {
        let state = DesktopMusicTrayStatePayload {
            title: Some("Playable Track".to_string()),
            artist_text: Some("Artist A / Artist B".to_string()),
            source: Some("netease".to_string()),
            play_state: DesktopMusicTrayPlayState::Playing,
            queue_length: 2,
        };

        assert_eq!(
            resolve_music_tray_title(&state),
            Some("Playing: Playable Track".to_string())
        );
        assert_eq!(
            resolve_music_tray_tooltip(&state),
            "Playing: Playable Track\nArtist A / Artist B\n2 in queue · netease"
        );
    }

    #[test]
    fn falls_back_to_idle_music_tray_copy_without_track() {
        let state = DesktopMusicTrayStatePayload {
            title: None,
            artist_text: None,
            source: None,
            play_state: DesktopMusicTrayPlayState::Idle,
            queue_length: 0,
        };

        assert_eq!(
            resolve_music_tray_title(&state),
            Some("Luna Music".to_string())
        );
        assert_eq!(resolve_music_tray_tooltip(&state), "Luna Music is ready");
    }

    #[test]
    fn injects_default_owner_username_without_forcing_password() {
        let mut config_value = serde_json::json!({});

        let changed = ensure_default_desktop_owner_auth_value(&mut config_value);

        assert!(changed);
        assert_eq!(
            config_value["auth"]["username"],
            serde_json::Value::String(DEFAULT_DESKTOP_OWNER_USERNAME.to_string())
        );
        assert!(config_value["auth"].get("password").is_none());
    }

    #[test]
    fn keeps_empty_owner_password_for_first_login() {
        let mut config_value = serde_json::json!({
            "auth": {
                "username": DEFAULT_DESKTOP_OWNER_USERNAME,
                "password": ""
            }
        });

        let changed = ensure_default_desktop_owner_auth_value(&mut config_value);

        assert!(!changed);
        assert_eq!(
            config_value["auth"]["password"],
            serde_json::Value::String(String::new())
        );
    }

    #[test]
    fn keeps_custom_username_without_forcing_owner_password() {
        let mut config_value = serde_json::json!({
            "auth": {
                "username": "alice",
                "password": ""
            }
        });

        let changed = ensure_default_desktop_owner_auth_value(&mut config_value);

        assert!(!changed);
        assert_eq!(
            config_value["auth"]["password"],
            serde_json::Value::String(String::new())
        );
    }

    #[test]
    fn updates_owner_password_without_dropping_other_config_fields() {
        let mut config_value = serde_json::json!({
            "auth": {
                "username": "owner",
                "password": ""
            },
            "profile_sync": {
                "api_base_url": "http://127.0.0.1:8787"
            }
        });

        set_desktop_owner_password_value(&mut config_value, "owner", "new-pass");

        assert_eq!(
            config_value["auth"]["password"],
            serde_json::Value::String("new-pass".to_string())
        );
        assert_eq!(
            config_value["profile_sync"]["api_base_url"],
            serde_json::Value::String("http://127.0.0.1:8787".to_string())
        );
    }

    #[test]
    fn extracts_profile_sync_base_url_from_desktop_config() {
        let config_value = serde_json::json!({
            "profile_sync": {
                "api_base_url": " https://sync.example.com/base "
            }
        });

        let extracted = extract_profile_sync_api_base_url(&config_value);

        assert_eq!(extracted, Some("https://sync.example.com/base".to_string()));
    }

    #[test]
    fn normalizes_release_repository_slug_when_owner_and_repo_are_present() {
        assert_eq!(
            normalize_release_repository_slug(" jaytantech3000/LunaTV "),
            Some("jaytantech3000/LunaTV".to_string())
        );
        assert_eq!(normalize_release_repository_slug("jaytantech3000"), None);
        assert_eq!(
            normalize_release_repository_slug("jaytantech3000 / LunaTV"),
            None
        );
    }

    #[test]
    fn appends_cache_busting_query_without_dropping_existing_params() {
        let url = Url::parse("https://example.com/VERSION.txt?branch=desktop").unwrap();

        let request_url = append_cache_busting_query(&url);
        let query_pairs = request_url.query_pairs().collect::<Vec<_>>();

        assert!(
            query_pairs
                .iter()
                .any(|(key, value)| key == "branch" && value == "desktop")
        );
        assert!(
            query_pairs
                .iter()
                .any(|(key, value)| key == "_t" && !value.is_empty())
        );
    }

    #[test]
    fn extracts_desktop_release_versions_from_tags() {
        assert_eq!(
            extract_desktop_release_version(Some("desktop-v200.0.0")),
            Some("200.0.0".to_string())
        );
        assert_eq!(
            extract_desktop_release_version(Some("desktop-v200.0.0-beta.16")),
            Some("200.0.0-beta.16".to_string())
        );
        assert_eq!(extract_desktop_release_version(Some("v200.0.0")), None);
        assert_eq!(
            extract_desktop_release_version(Some("desktop-vnot-a-version")),
            None
        );
    }

    #[test]
    fn finds_desktop_release_manifest_asset_url() {
        assert_eq!(
            find_desktop_release_manifest_url(Some(&[GithubReleaseAssetPayload {
                name: Some("latest.json".to_string()),
                browser_download_url: Some("https://example.com/latest.json".to_string()),
            }])),
            Some("https://example.com/latest.json".to_string())
        );
        assert_eq!(
            find_desktop_release_manifest_url(Some(&[GithubReleaseAssetPayload {
                name: Some("LunaTV.Desktop_200.0.0_x64-setup.exe".to_string()),
                browser_download_url: Some("https://example.com/setup.exe".to_string()),
            }])),
            None
        );
    }

    #[test]
    fn normalizes_desktop_release_history_items_and_sorts_by_semver() {
        let releases = normalize_desktop_release_history(vec![
            GithubReleasePayload {
                id: None,
                tag_name: Some("desktop-v200.0.0-beta.15".to_string()),
                name: Some("Beta 15".to_string()),
                body: None,
                draft: None,
                prerelease: Some(true),
                published_at: Some("2026-06-19T04:01:04Z".to_string()),
                created_at: None,
                html_url: Some("https://example.com/beta-15".to_string()),
                assets: Some(vec![GithubReleaseAssetPayload {
                    name: Some("latest.json".to_string()),
                    browser_download_url: Some(
                        "https://example.com/beta-15/latest.json".to_string(),
                    ),
                }]),
            },
            GithubReleasePayload {
                id: None,
                tag_name: Some("desktop-v200.0.0".to_string()),
                name: Some("Stable".to_string()),
                body: None,
                draft: None,
                prerelease: Some(false),
                published_at: Some("2026-06-20T04:01:04Z".to_string()),
                created_at: None,
                html_url: Some("https://example.com/stable".to_string()),
                assets: Some(vec![GithubReleaseAssetPayload {
                    name: Some("latest.json".to_string()),
                    browser_download_url: Some(
                        "https://example.com/stable/latest.json".to_string(),
                    ),
                }]),
            },
            GithubReleasePayload {
                id: None,
                tag_name: Some("local-service-nova-2026-06-17.3".to_string()),
                name: Some("Ignore me".to_string()),
                body: None,
                draft: None,
                prerelease: Some(true),
                published_at: Some("2026-06-17T04:01:04Z".to_string()),
                created_at: None,
                html_url: None,
                assets: Some(vec![GithubReleaseAssetPayload {
                    name: Some("latest.json".to_string()),
                    browser_download_url: Some(
                        "https://example.com/local-service/latest.json".to_string(),
                    ),
                }]),
            },
            GithubReleasePayload {
                id: None,
                tag_name: Some("desktop-v200.0.0-beta.16".to_string()),
                name: Some("Beta 16".to_string()),
                body: None,
                draft: None,
                prerelease: Some(true),
                published_at: Some("2026-06-19T05:01:04Z".to_string()),
                created_at: None,
                html_url: Some("https://example.com/beta-16".to_string()),
                assets: Some(vec![GithubReleaseAssetPayload {
                    name: Some("latest.json".to_string()),
                    browser_download_url: Some(
                        "https://example.com/beta-16/latest.json".to_string(),
                    ),
                }]),
            },
            GithubReleasePayload {
                id: None,
                tag_name: Some("desktop-v200.0.1".to_string()),
                name: Some("Missing manifest".to_string()),
                body: None,
                draft: None,
                prerelease: Some(false),
                published_at: Some("2026-06-21T04:01:04Z".to_string()),
                created_at: None,
                html_url: None,
                assets: Some(vec![]),
            },
        ]);

        assert_eq!(releases.len(), 3);
        assert_eq!(
            releases
                .iter()
                .map(|item| item.version.as_str())
                .collect::<Vec<_>>(),
            vec!["200.0.0", "200.0.0-beta.16", "200.0.0-beta.15"]
        );
    }

    #[test]
    fn updates_local_user_password_map_without_dropping_other_persistence_fields() {
        let mut persistence_value = serde_json::json!({
            "config": {
                "UserConfig": {
                    "Users": [
                        {
                            "username": "alice",
                            "role": "user",
                            "banned": false
                        }
                    ]
                }
            },
            "userPasswords": {
                "alice": "old-pass"
            }
        });

        set_desktop_local_user_password_value(&mut persistence_value, "alice", "new-pass");

        assert_eq!(
            persistence_value["userPasswords"]["alice"],
            serde_json::Value::String("new-pass".to_string())
        );
        assert_eq!(
            persistence_value["config"]["UserConfig"]["Users"][0]["username"],
            serde_json::Value::String("alice".to_string())
        );
    }

    #[test]
    fn summarizes_sidecar_trial_output_with_exit_code_and_stderr() {
        let result = SidecarTrialResult {
            pid: Some(42),
            healthy: false,
            timed_out: false,
            spawn_error: None,
            health_check_detail: Some("proxy connect timeout".to_string()),
            port_observation: Some(
                "端口探测发现诊断 sidecar PID 42 正在监听 127.0.0.1:8787。".to_string(),
            ),
            exit_status: Some(1),
            stdout: String::new(),
            stderr: "line one\nline two\nfailed to bind local service listener".to_string(),
        };

        let summary = summarize_trial_output(&result);

        assert!(summary.contains("退出码：1"));
        assert!(summary.contains("PID：42"));
        assert!(summary.contains("proxy connect timeout"));
        assert!(summary.contains("端口探测发现诊断 sidecar PID 42"));
        assert!(summary.contains("failed to bind local service listener"));
    }

    #[test]
    fn primary_port_issue_mentions_process_name_when_available() {
        let occupants = vec![PortOccupant {
            pid: 9527,
            local_address: "127.0.0.1:8787".to_string(),
            state: "LISTENING".to_string(),
            process_name: Some("example.exe".to_string()),
        }];

        let detail = describe_primary_port_issue(8787, &occupants);

        assert!(detail.contains("example.exe"));
        assert!(detail.contains("9527"));
    }

    #[test]
    fn collects_last_failure_and_trial_text_for_diagnostics() {
        let failure = LocalServiceStartupFailure {
            captured_at_ms: 1,
            message: "spawn failed".to_string(),
        };
        let result = SidecarTrialResult {
            pid: None,
            healthy: false,
            timed_out: true,
            spawn_error: None,
            health_check_detail: Some("request error".to_string()),
            port_observation: None,
            exit_status: None,
            stdout: "stdout".to_string(),
            stderr: "stderr".to_string(),
        };

        let text = collect_diagnostics_error_text(Some(&failure), Some(&result));

        assert!(text.contains("spawn failed"));
        assert!(text.contains("request error"));
        assert!(text.contains("stdout"));
        assert!(text.contains("stderr"));
    }

    #[test]
    fn untracked_local_service_requires_matching_version_to_be_reused() {
        let current_version = "200.0.1-beta.16";

        assert!(should_reuse_untracked_local_service(
            &LocalServiceHealthCheck {
                healthy: true,
                status_code: Some(200),
                error: None,
                version: Some(current_version.to_string()),
            },
            current_version,
        ));
        assert!(!should_reuse_untracked_local_service(
            &LocalServiceHealthCheck {
                healthy: true,
                status_code: Some(200),
                error: None,
                version: Some("200.0.1-beta.15".to_string()),
            },
            current_version,
        ));
        assert!(!should_reuse_untracked_local_service(
            &LocalServiceHealthCheck {
                healthy: true,
                status_code: Some(200),
                error: None,
                version: None,
            },
            current_version,
        ));
    }

    #[test]
    fn prefers_matching_sidecar_candidate_before_unknown_and_stale_ones() {
        let preferred = select_preferred_sidecar_candidates(
            vec![
                SidecarBinaryVersionProbe {
                    path: PathBuf::from("/tmp/stale-sidecar.exe"),
                    version: Some("200.0.1-beta.14".to_string()),
                    error: None,
                },
                SidecarBinaryVersionProbe {
                    path: PathBuf::from("/tmp/current-sidecar.exe"),
                    version: Some("200.0.1-beta.17".to_string()),
                    error: None,
                },
                SidecarBinaryVersionProbe {
                    path: PathBuf::from("/tmp/unknown-sidecar.exe"),
                    version: None,
                    error: Some("version probe timed out".to_string()),
                },
            ],
            "200.0.1-beta.17",
        )
        .expect("preferred candidates");

        assert_eq!(
            preferred,
            vec![
                PathBuf::from("/tmp/current-sidecar.exe"),
                PathBuf::from("/tmp/unknown-sidecar.exe"),
            ]
        );
    }

    #[test]
    fn rejects_sidecar_candidates_when_all_detected_versions_are_stale() {
        let error = select_preferred_sidecar_candidates(
            vec![
                SidecarBinaryVersionProbe {
                    path: PathBuf::from("/tmp/stale-a.exe"),
                    version: Some("200.0.1-beta.14".to_string()),
                    error: None,
                },
                SidecarBinaryVersionProbe {
                    path: PathBuf::from("/tmp/stale-b.exe"),
                    version: Some("200.0.1-beta.15".to_string()),
                    error: None,
                },
            ],
            "200.0.1-beta.17",
        )
        .expect_err("all stale sidecars should be rejected");

        assert!(error.to_string().contains("200.0.1-beta.17"));
        assert!(error.to_string().contains("stale-a.exe"));
        assert!(error.to_string().contains("200.0.1-beta.14"));
        assert!(error.to_string().contains("stale-b.exe"));
        assert!(error.to_string().contains("200.0.1-beta.15"));
    }

    #[test]
    fn profile_sync_diagnostic_detail_mentions_domains_and_error_kind() {
        let status = LocalProfileSyncStatus {
            enabled: true,
            reachable: false,
            authenticated: false,
            username: Some("kid".to_string()),
            role: Some("user".to_string()),
            storage_type: Some("redis".to_string()),
            profile_mode: Some("shared-multi-user".to_string()),
            error: Some("远端账号同步后端不可达".to_string()),
            error_kind: Some("unreachable".to_string()),
            sync_domains: vec![
                "playrecords".to_string(),
                "favorites".to_string(),
                "follows".to_string(),
            ],
        };

        let detail = build_profile_sync_status_diagnostic_detail(&status);

        assert!(detail.contains("播放记录"));
        assert!(detail.contains("收藏"));
        assert!(detail.contains("追更"));
        assert!(detail.contains("unreachable"));
        assert!(detail.contains("远端账号同步后端不可达"));
    }

    #[tokio::test(flavor = "current_thread")]
    async fn local_service_health_check_reads_loopback_http_response() {
        let listener = TcpListener::bind("127.0.0.1:0")
            .await
            .expect("bind test health listener");
        let address = listener.local_addr().expect("test listener address");
        let base_url = format!("http://{address}");
        let response_body = r#"{"status":"ok","version":"200.0.1-beta.16"}"#;
        let expected_content_length = response_body.len();

        tokio::spawn(async move {
            let (mut stream, _) = listener.accept().await.expect("accept test request");
            let mut buffer = [0_u8; 1024];
            let _ = stream.read(&mut buffer).await;
            let response = format!(
                "HTTP/1.1 200 OK\r\ncontent-type: application/json\r\ncontent-length: {expected_content_length}\r\nconnection: close\r\n\r\n{response_body}"
            );
            stream
                .write_all(response.as_bytes())
                .await
                .expect("write test response");
        });

        let result = local_service_health_check(&base_url).await;
        assert!(result.healthy);
        assert_eq!(result.status_code, Some(200));
        assert!(result.error.is_none());
        assert_eq!(result.version.as_deref(), Some("200.0.1-beta.16"));
    }

    #[tokio::test(flavor = "current_thread")]
    async fn local_service_health_check_reports_read_timeouts_after_connect() {
        let listener = TcpListener::bind("127.0.0.1:0")
            .await
            .expect("bind stalled health listener");
        let address = listener.local_addr().expect("listener address");

        tokio::spawn(async move {
            let (mut stream, _) = listener.accept().await.expect("accept stalled request");
            let mut buffer = [0_u8; 1024];
            let _ = stream.read(&mut buffer).await;
            tokio::time::sleep(LOCAL_SERVICE_HEALTH_READ_TIMEOUT + Duration::from_millis(100))
                .await;
        });

        let result = local_service_health_check(&format!("http://{address}")).await;
        assert!(!result.healthy);
        assert!(result.status_code.is_none());
        assert!(
            result
                .error
                .as_deref()
                .is_some_and(|message| message.contains("health response read timed out"))
        );
    }

    #[tokio::test(flavor = "current_thread")]
    async fn local_service_health_check_reports_tcp_connect_failures() {
        let listener = TcpListener::bind("127.0.0.1:0")
            .await
            .expect("bind disposable listener");
        let address = listener.local_addr().expect("listener address");
        drop(listener);

        let result = local_service_health_check(&format!("http://{address}")).await;
        assert!(!result.healthy);
        assert!(result.status_code.is_none());
        assert!(
            result
                .error
                .as_deref()
                .is_some_and(|message| message.contains("tcp connect failed"))
        );
    }
}
