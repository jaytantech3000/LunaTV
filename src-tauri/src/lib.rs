#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;
use std::{
    collections::BTreeMap,
    fs,
    path::{Path, PathBuf},
    process::{Child, Command, Stdio},
    sync::Mutex,
    time::{Duration, Instant},
};

use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, RunEvent, State};
use tokio::sync::Mutex as AsyncMutex;

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
        .setup(|app| {
            spawn_local_service_start(app.handle().clone());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            start_local_service,
            stop_local_service,
            get_local_service_status,
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
    if cfg!(debug_assertions) {
        return Ok(project_root()
            .join("src-tauri")
            .join("binaries")
            .join(sidecar_binary_file_name()));
    }

    sidecar_release_candidates(app)?
        .into_iter()
        .find(|path| path.is_file())
        .ok_or_else(|| {
            anyhow::anyhow!(
                "failed to locate bundled local service sidecar; checked: {}",
                sidecar_release_candidates(app)
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
        DEFAULT_DESKTOP_OWNER_USERNAME, ensure_default_desktop_owner_auth_value,
        set_desktop_local_user_password_value, set_desktop_owner_password_value,
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
}
