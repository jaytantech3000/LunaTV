#![cfg_attr(
    all(target_os = "windows", not(debug_assertions)),
    windows_subsystem = "windows"
)]

use anyhow::Result;
use clap::Parser;

#[tokio::main]
async fn main() -> Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "info,moontv_local_service=info".into()),
        )
        .with_target(false)
        .without_time()
        .init();

    let cli = moontv_local_service::Cli::parse();
    moontv_local_service::run(cli).await
}
