use std::{
    fs,
    path::{Path, PathBuf},
    process::{Child, Command, Stdio},
    sync::Mutex,
    time::Duration,
};

use anyhow::{Context, Result};
use serde::Serialize;
use tauri::{AppHandle, Manager, RunEvent, State};

const LOCAL_SERVICE_PORT: u16 = 8787;
const LOCAL_SERVICE_HEALTH_PATH: &str = "/health";
const LOCAL_SERVICE_BINARY_NAME: &str = "moontv-local-service";
const LOCAL_SERVICE_CONFIG_FILE_NAME: &str = "desktop.config.json";
const LOCAL_SERVICE_DB_FILE_NAME: &str = "moontv-desktop.sqlite3";

const DEFAULT_DESKTOP_CONFIG: &str = include_str!("../../config.example.json");

#[derive(Default)]
struct DesktopRuntimeState {
    service_process: Mutex<Option<ServiceProcess>>,
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
fn get_local_service_status(
    app: AppHandle,
    state: State<'_, DesktopRuntimeState>,
) -> Result<LocalServiceStatus, String> {
    get_local_service_status_impl(&app, &state).map_err(|error| error.to_string())
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
            let state = app.state::<DesktopRuntimeState>();
            tauri::async_runtime::block_on(start_local_service_impl(app.handle(), &state))
                .map(|_| ())
                .map_err(|error| -> Box<dyn std::error::Error> {
                    Box::new(std::io::Error::other(error.to_string()))
                })
        })
        .invoke_handler(tauri::generate_handler![
            start_local_service,
            stop_local_service,
            get_local_service_status,
            read_app_config,
            write_app_config,
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

async fn start_local_service_impl(
    app: &AppHandle,
    state: &DesktopRuntimeState,
) -> Result<LocalServiceStatus> {
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

    let child = command.spawn().with_context(|| {
        format!(
            "failed to spawn local service at {}",
            sidecar_path.display()
        )
    })?;

    wait_for_local_service(&base_url).await?;

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

fn get_local_service_status_impl(
    app: &AppHandle,
    state: &DesktopRuntimeState,
) -> Result<LocalServiceStatus> {
    let paths = resolve_runtime_paths(app)?;
    let guard = state
        .service_process
        .lock()
        .map_err(|_| anyhow::anyhow!("failed to lock desktop runtime state"))?;

    if let Some(process) = guard.as_ref() {
        return Ok(build_status(
            true,
            &process.base_url,
            &process.config_path,
            &process.data_dir,
            &process.sqlite_path,
        ));
    }

    Ok(build_status(
        false,
        &format!("http://127.0.0.1:{LOCAL_SERVICE_PORT}"),
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

async fn wait_for_local_service(base_url: &str) -> Result<()> {
    for _ in 0..40 {
        if local_service_is_healthy(base_url).await {
            return Ok(());
        }

        tokio::time::sleep(Duration::from_millis(250)).await;
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
        return Ok(());
    }

    if let Some(parent_dir) = config_path.parent() {
        fs::create_dir_all(parent_dir)
            .with_context(|| format!("failed to create {}", parent_dir.display()))?;
    }

    fs::write(config_path, DEFAULT_DESKTOP_CONFIG)
        .with_context(|| format!("failed to write {}", config_path.display()))
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
