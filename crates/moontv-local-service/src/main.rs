use clap::Parser;
use moontv_local_service::{LocalServiceOptions, run_local_service};
use std::{env, path::PathBuf};
use tracing_subscriber::{EnvFilter, fmt};

#[derive(Debug, Parser)]
#[command(name = "lunatv-server")]
struct Args {
    #[arg(long, default_value = "127.0.0.1")]
    host: String,
    #[arg(long, default_value_t = 8787)]
    port: u16,
    #[arg(long)]
    config_path: Option<PathBuf>,
    #[arg(long)]
    data_dir: Option<PathBuf>,
    #[arg(long)]
    sqlite_path: Option<PathBuf>,
}

#[tokio::main]
async fn main() {
    init_tracing();

    let args = Args::parse();
    let options = build_options(args);

    if let Err(error) = run_local_service(options).await {
        eprintln!("{error}");
        std::process::exit(1);
    }
}

fn build_options(args: Args) -> LocalServiceOptions {
    let current_dir = env::current_dir().unwrap_or_else(|_| PathBuf::from("."));
    let config_path = args
        .config_path
        .unwrap_or_else(|| current_dir.join("config.example.json"));
    let data_dir = args
        .data_dir
        .unwrap_or_else(|| current_dir.join(".lunatv-desktop"));
    let sqlite_path = args
        .sqlite_path
        .unwrap_or_else(|| data_dir.join("moontv-desktop.sqlite3"));

    LocalServiceOptions {
        allow_private_hosts: false,
        config_path,
        data_dir,
        host: args.host,
        port: args.port,
        sqlite_path,
    }
}

fn init_tracing() {
    let filter = EnvFilter::try_from_default_env()
        .unwrap_or_else(|_| EnvFilter::new("moontv_local_service=info"));

    fmt()
        .with_env_filter(filter)
        .with_target(false)
        .compact()
        .init();
}
