#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;
use std::{
    collections::{BTreeMap, BTreeSet},
    fs,
    net::TcpListener,
    path::{Path, PathBuf},
    process::{Child, Command, Stdio},
    sync::Mutex,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};

use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, RunEvent, State};
use tokio::{process::Command as TokioCommand, sync::Mutex as AsyncMutex};

const LOCAL_SERVICE_PORT: u16 = 8787;
const LOCAL_SERVICE_HEALTH_PATH: &str = "/health";
const LOCAL_SERVICE_BINARY_NAME: &str = "moontv-local-service";
const LOCAL_SERVICE_CONFIG_FILE_NAME: &str = "desktop.config.json";
const LOCAL_SERVICE_DB_FILE_NAME: &str = "moontv-desktop.sqlite3";
const ADMIN_PERSISTENCE_FILE_NAME: &str = "desktop-admin-state.json";
const DEFAULT_DESKTOP_OWNER_USERNAME: &str = "owner";
const LOCAL_SERVICE_STARTUP_TIMEOUT: Duration = Duration::from_secs(30);
const LOCAL_SERVICE_STARTUP_RETRY_INTERVAL: Duration = Duration::from_millis(250);
#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x08000000;

const DEFAULT_DESKTOP_CONFIG: &str = include_str!("../../config.example.json");

#[derive(Default)]
struct DesktopRuntimeState {
    service_process: Mutex<Option<ServiceProcess>>,
    service_start_lock: AsyncMutex<()>,
    last_start_failure: Mutex<Option<LocalServiceStartupFailure>>,
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

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct LocalServiceDiagnosticsUploadResult {
    uploaded: bool,
    target: String,
    issue_url: Option<String>,
    issue_number: Option<u64>,
    message: String,
}

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
    healthy: bool,
    timed_out: bool,
    spawn_error: Option<String>,
    exit_status: Option<i32>,
    stdout: String,
    stderr: String,
}

#[derive(Clone)]
struct PortOccupant {
    pid: u32,
    process_name: Option<String>,
}

struct PortInspection {
    bind_available: bool,
    occupants: Vec<PortOccupant>,
    raw_output: Option<String>,
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
            spawn_local_service_start(app.handle().clone());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            start_local_service,
            stop_local_service,
            get_local_service_status,
            run_local_service_diagnostics,
            upload_local_service_diagnostics,
            read_app_config,
            write_app_config,
            get_desktop_auth_status,
            desktop_login,
            change_desktop_password,
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

    if local_service_is_healthy(&base_url).await {
        tracing::warn!(
            "detected a healthy local service on {base_url} without a tracked child process"
        );

        return Ok(build_status(
            true,
            &base_url,
            &paths.config_path,
            &paths.data_dir,
            &paths.sqlite_path,
        ));
    }

    let sidecar_path = resolve_sidecar_binary_path(app)?;

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

    #[cfg(target_os = "windows")]
    if !cfg!(debug_assertions) {
        command.creation_flags(CREATE_NO_WINDOW);
    }

    let child = command.spawn().with_context(|| {
        format!(
            "failed to spawn local service at {}",
            sidecar_path.display()
        )
    })?;

    let mut child = child;
    if let Err(error) = wait_for_local_service(&base_url, &mut child).await {
        if let Err(termination_error) = terminate_child_process(&mut child) {
            tracing::warn!(
                "failed to terminate local service after startup error: {termination_error}"
            );
        }

        return Err(error);
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

    Ok(build_status(
        true,
        &base_url,
        &paths.config_path,
        &paths.data_dir,
        &paths.sqlite_path,
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

    while Instant::now() < deadline {
        if local_service_is_healthy(base_url).await {
            return Ok(());
        }

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

    Err(anyhow::anyhow!(
        "local service did not become healthy at {base_url}{LOCAL_SERVICE_HEALTH_PATH}"
    ))
}

async fn local_service_is_healthy(base_url: &str) -> bool {
    let health_url = format!("{base_url}{LOCAL_SERVICE_HEALTH_PATH}");

    reqwest::Client::new()
        .get(health_url)
        .timeout(Duration::from_secs(1))
        .send()
        .await
        .map(|response| response.status().is_success())
        .unwrap_or(false)
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

    let service_healthy = local_service_is_healthy(&base_url).await;
    findings.push(LocalServiceDiagnosticFinding {
        level: if service_healthy {
            DiagnosticLevel::Ok
        } else {
            DiagnosticLevel::Warning
        },
        title: "健康检查".to_string(),
        detail: if service_healthy {
            format!("{base_url}{LOCAL_SERVICE_HEALTH_PATH} 已返回成功。")
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
    match fs::read_to_string(&paths.config_path) {
        Ok(contents) => match serde_json::from_str::<serde_json::Value>(&contents) {
            Ok(_) => findings.push(LocalServiceDiagnosticFinding {
                level: DiagnosticLevel::Ok,
                title: "桌面配置文件".to_string(),
                detail: "desktop.config.json 可读取且 JSON 格式有效。".to_string(),
            }),
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
    if let Some(raw_output) = port_inspection.raw_output.as_ref() {
        log_lines.push("PortInspectionOutput:".to_string());
        log_lines.extend(raw_output.lines().map(|line| format!("  {line}")));
    }

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

    let trial_result = if let Some(path) = sidecar_path.as_ref() {
        let result = run_local_service_trial(path, &paths).await;
        log_lines.push(format!("TrialSidecar: {}", path.display()));
        if let Some(spawn_error) = result.spawn_error.as_ref() {
            log_lines.push(format!("TrialSpawnError: {spawn_error}"));
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
    let (occupants, raw_output) = inspect_windows_port_occupants(port);
    #[cfg(not(target_os = "windows"))]
    let (occupants, raw_output) = (Vec::new(), None);

    PortInspection {
        bind_available,
        occupants,
        raw_output,
    }
}

#[cfg(target_os = "windows")]
fn inspect_windows_port_occupants(port: u16) -> (Vec<PortOccupant>, Option<String>) {
    let mut command = Command::new("netstat");
    command.args(["-ano", "-p", "tcp"]);
    configure_background_command(&mut command);

    match command.output() {
        Ok(output) => {
            let stdout = String::from_utf8_lossy(&output.stdout).replace('\r', "");
            let stderr = String::from_utf8_lossy(&output.stderr).replace('\r', "");
            let raw_output = if stderr.trim().is_empty() {
                stdout.clone()
            } else {
                format!("{stdout}\n{stderr}")
            };
            let target_suffix = format!(":{port}");
            let mut occupant_lines = Vec::new();
            let mut pids = BTreeSet::new();

            for line in stdout.lines() {
                let columns = line.split_whitespace().collect::<Vec<_>>();
                if columns.len() < 5 {
                    continue;
                }

                let local_address = columns[1];
                let state = columns[3];
                let pid_text = columns[4];
                if !local_address.ends_with(&target_suffix) || state != "LISTENING" {
                    continue;
                }

                let Ok(pid) = pid_text.parse::<u32>() else {
                    continue;
                };

                pids.insert(pid);
                occupant_lines.push((pid, line.trim().to_string()));
            }

            let occupant_names = pids
                .into_iter()
                .map(|pid| (pid, inspect_windows_process_name(pid)))
                .collect::<BTreeMap<_, _>>();
            let occupants = occupant_lines
                .into_iter()
                .map(|(pid, _raw_line)| PortOccupant {
                    pid,
                    process_name: occupant_names.get(&pid).cloned().flatten(),
                })
                .collect();

            (occupants, Some(raw_output))
        }
        Err(error) => (
            Vec::new(),
            Some(format!("failed to run netstat -ano -p tcp: {error}")),
        ),
    }
}

#[cfg(target_os = "windows")]
fn inspect_windows_process_name(pid: u32) -> Option<String> {
    let mut command = Command::new("tasklist");
    command.args(["/FI", &format!("PID eq {pid}"), "/FO", "CSV", "/NH"]);
    configure_background_command(&mut command);

    let output = command.output().ok()?;
    let stdout = String::from_utf8_lossy(&output.stdout).replace('\r', "");
    let first_line = stdout
        .lines()
        .map(str::trim)
        .find(|line| !line.is_empty() && !line.starts_with("INFO:"))?;

    if let Some(value) = first_line.strip_prefix('"') {
        return value
            .split("\",\"")
            .next()
            .map(|token| token.trim_matches('"').to_string());
    }

    first_line
        .split(',')
        .next()
        .map(|token| token.trim_matches('"').to_string())
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
                healthy: false,
                timed_out: false,
                spawn_error: Some(error.to_string()),
                exit_status: None,
                stdout: String::new(),
                stderr: String::new(),
            };
        }
    };

    let base_url = format!("http://127.0.0.1:{LOCAL_SERVICE_PORT}");
    let deadline = Instant::now() + Duration::from_secs(8);
    let mut healthy = false;
    let mut timed_out = false;

    while Instant::now() < deadline {
        if local_service_is_healthy(&base_url).await {
            healthy = true;
            break;
        }

        match child.try_wait() {
            Ok(Some(_)) => break,
            Ok(None) => {}
            Err(error) => {
                let _ = child.kill().await;
                let output = child.wait_with_output().await.ok();
                return SidecarTrialResult {
                    healthy: false,
                    timed_out: false,
                    spawn_error: Some(format!(
                        "failed to poll diagnostic sidecar process: {error}"
                    )),
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

    if healthy || child.try_wait().ok().flatten().is_none() {
        if !healthy {
            timed_out = true;
        }
        let _ = child.kill().await;
    }

    let output = child.wait_with_output().await.ok();
    SidecarTrialResult {
        healthy,
        timed_out,
        spawn_error: None,
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

    if let Some(exit_status) = result.exit_status {
        parts.push(format!("退出码：{exit_status}"));
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

fn resolve_sidecar_binary_path(app: &AppHandle) -> Result<PathBuf> {
    local_service_sidecar_candidates(app)?
        .into_iter()
        .find(|path| path.is_file())
        .ok_or_else(|| {
            anyhow::anyhow!(
                "failed to locate bundled local service sidecar; checked: {}",
                local_service_sidecar_candidates(app)
                    .ok()
                    .unwrap_or_default()
                    .into_iter()
                    .map(|path| path.display().to_string())
                    .collect::<Vec<_>>()
                    .join(", ")
            )
        })
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

#[cfg(test)]
mod tests {
    use super::{
        DEFAULT_DESKTOP_OWNER_USERNAME, LocalServiceStartupFailure, PortOccupant,
        SidecarTrialResult, collect_diagnostics_error_text, describe_primary_port_issue,
        ensure_default_desktop_owner_auth_value, set_desktop_local_user_password_value,
        set_desktop_owner_password_value, summarize_trial_output,
    };

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
            healthy: false,
            timed_out: false,
            spawn_error: None,
            exit_status: Some(1),
            stdout: String::new(),
            stderr: "line one\nline two\nfailed to bind local service listener".to_string(),
        };

        let summary = summarize_trial_output(&result);

        assert!(summary.contains("退出码：1"));
        assert!(summary.contains("failed to bind local service listener"));
    }

    #[test]
    fn primary_port_issue_mentions_process_name_when_available() {
        let occupants = vec![PortOccupant {
            pid: 9527,
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
            healthy: false,
            timed_out: true,
            spawn_error: None,
            exit_status: None,
            stdout: "stdout".to_string(),
            stderr: "stderr".to_string(),
        };

        let text = collect_diagnostics_error_text(Some(&failure), Some(&result));

        assert!(text.contains("spawn failed"));
        assert!(text.contains("stdout"));
        assert!(text.contains("stderr"));
    }
}
