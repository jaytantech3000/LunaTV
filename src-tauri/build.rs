fn main() {
    let target = std::env::var("TARGET").expect("TARGET should be set by Cargo");
    println!("cargo:rustc-env=LUNATV_TARGET_TRIPLE={target}");
    tauri_build::build();
}
