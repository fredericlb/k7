fn main() {
    // The build number (YYYYMMDD.HHMM) is stamped by the build script, not computed at
    // runtime — it identifies WHEN this binary was produced. `rerun-if-env-changed`
    // makes cargo re-stamp when it differs; a plain `cargo run`/`cargo check` with no
    // value set reports "dev".
    println!("cargo:rerun-if-env-changed=STUDIO_BUILD");
    // Where the trayicon dump test writes its previews (test-only; see its comment).
    println!("cargo:rustc-env=STUDIO_ICON_DUMP_DIR={}", std::env::var("STUDIO_ICON_DUMP_DIR").unwrap_or_else(|_| std::env::temp_dir().join("studio-icons").to_string_lossy().into_owned()));
    let build = std::env::var("STUDIO_BUILD").unwrap_or_else(|_| "dev".to_string());
    println!("cargo:rustc-env=STUDIO_BUILD={build}");
    tauri_build::build();
}
