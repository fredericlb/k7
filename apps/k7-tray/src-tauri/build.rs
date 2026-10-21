fn main() {
    // The release stamp (`vX.Y.Z` or `snapshot-<commit>`) names this build and picks its update channel; a
    // build nobody stamped is `dev`, which never asks for updates (docs/tray.md).
    println!("cargo:rerun-if-env-changed=STUDIO_RELEASE_STAMP");
    let given = std::env::var("STUDIO_RELEASE_STAMP").unwrap_or_default();
    let stamp = if is_stamp(&given) { given } else { "dev".to_string() };
    println!("cargo:rustc-env=K7_RELEASE={stamp}");
    // The updater's public key, from CI: without it the build has no updater, rather than one that trusts nothing.
    println!("cargo:rerun-if-env-changed=K7_UPDATER_PUBKEY");
    println!(
        "cargo:rustc-env=K7_UPDATER_PUBKEY={}",
        std::env::var("K7_UPDATER_PUBKEY").unwrap_or_default()
    );
    // Where the trayicon dump test writes its previews (test-only; see its comment).
    println!(
        "cargo:rustc-env=STUDIO_ICON_DUMP_DIR={}",
        std::env::var("STUDIO_ICON_DUMP_DIR").unwrap_or_else(|_| std::env::temp_dir()
            .join("studio-icons")
            .to_string_lossy()
            .into_owned())
    );
    tauri_build::build();
}

/// The two shapes CI makes, and nothing else: `vX.Y.Z`, or `snapshot-` and 7 to 40 hex digits.
fn is_stamp(s: &str) -> bool {
    if let Some(v) = s.strip_prefix('v') {
        let parts: Vec<&str> = v.split('.').collect();
        return parts.len() == 3 && parts.iter().all(|p| !p.is_empty() && p.bytes().all(|b| b.is_ascii_digit()));
    }
    s.strip_prefix("snapshot-")
        .is_some_and(|h| (7..=40).contains(&h.len()) && h.bytes().all(|b| b.is_ascii_hexdigit() && !b.is_ascii_uppercase()))
}
