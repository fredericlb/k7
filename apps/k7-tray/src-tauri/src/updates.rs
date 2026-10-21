// updates.rs — keeps the tray current from k7.rocks/app_downloads/tray/<channel>/latest.json with tauri-plugin-updater:
// a tagged build follows `release` and takes a higher tag, a snapshot follows `snapshot` and takes any other build,
// and a `dev` build asks nothing. Every update's signature is checked against the key CI built in. See docs/tray.md.

use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Runtime};
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons};
use tauri_plugin_updater::UpdaterExt;

use crate::{backend, logbus, pidkill, tray};

const RELEASE: &str = env!("K7_RELEASE");
const PUBKEY: &str = env!("K7_UPDATER_PUBKEY");
/// Where tray.yml publishes; `K7_DOWNLOADS_URL` points a build at another page.
const DOWNLOADS: &str = "https://k7.rocks/app_downloads";
/// How often an automatic check runs at most.
const EVERY: Duration = Duration::from_secs(6 * 3600);

fn channel() -> Option<&'static str> {
    if RELEASE.starts_with('v') {
        Some("release")
    } else if RELEASE.starts_with("snapshot-") {
        Some("snapshot")
    } else {
        None
    }
}

fn downloads() -> String {
    std::env::var("K7_DOWNLOADS_URL").unwrap_or_else(|_| DOWNLOADS.to_string())
}

/// Whether this build can update at all: a CI stamp, and the key to check what it downloads.
pub fn available() -> bool {
    !PUBKEY.is_empty() && channel().is_some()
}

/// The updater plugin, with the key built in, or none for a build that has no key.
pub fn plugin<R: Runtime>() -> Option<tauri::plugin::TauriPlugin<R, tauri_plugin_updater::Config>> {
    available().then(|| tauri_plugin_updater::Builder::new().pubkey(PUBKEY).build())
}

/// Whether a channel's build is newer than this one: a higher tag, or for a snapshot any other commit.
pub fn newer(channel: &str, current: &semver::Version, remote: &semver::Version) -> bool {
    if channel == "snapshot" {
        remote != current
    } else {
        remote > current
    }
}

/// What the check keeps between runs: when it last asked, whether it is off, the build it last told of.
#[derive(Default, serde::Deserialize, serde::Serialize)]
struct Kept {
    #[serde(default)]
    last: u64,
    #[serde(default)]
    off: bool,
    #[serde(default)]
    told: String,
}

fn kept_file(app: &AppHandle) -> std::path::PathBuf {
    crate::paths::backend_root(app).join("updates.json")
}

fn load(app: &AppHandle) -> Kept {
    std::fs::read_to_string(kept_file(app))
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

fn save(app: &AppHandle, k: &Kept) {
    if let Ok(s) = serde_json::to_string_pretty(k) {
        let _ = std::fs::write(kept_file(app), s);
    }
}

fn now() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0)
}

pub fn auto_enabled(app: &AppHandle) -> bool {
    available() && !load(app).off && std::env::var("K7_NO_UPDATE_CHECK").is_err()
}

pub fn set_auto(app: &AppHandle, on: bool) {
    let mut k = load(app);
    k.off = !on;
    save(app, &k);
}

/// A few seconds after start, then hourly whether the interval has passed; silent offline.
pub fn start(app: &AppHandle) {
    let app = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(Duration::from_secs(5));
        loop {
            let last = load(&app).last;
            if auto_enabled(&app) && now().saturating_sub(last) >= EVERY.as_secs() {
                run(&app, false);
            }
            std::thread::sleep(Duration::from_secs(3600));
        }
    });
}

/// One check, on a thread of its own; `manual` also says when there is nothing newer or k7.rocks did not answer.
pub fn check(app: &AppHandle, manual: bool) {
    let app = app.clone();
    std::thread::spawn(move || run(&app, manual));
}

fn say(app: &AppHandle, text: &str) {
    app.dialog().message(text).title("k7 tray").blocking_show();
}

fn ask(app: &AppHandle, text: &str, yes: &str) -> bool {
    app.dialog()
        .message(text)
        .title("k7 tray")
        .buttons(MessageDialogButtons::OkCancelCustom(yes.into(), "Later".into()))
        .blocking_show()
}

/// Whether this install can replace itself: Windows' installer, the macOS bundle, an AppImage — not a .deb, apt's.
fn self_updating() -> bool {
    cfg!(any(target_os = "windows", target_os = "macos")) || std::env::var("APPIMAGE").is_ok()
}

fn run(app: &AppHandle, manual: bool) {
    let Some(ch) = channel().filter(|_| available()) else {
        if manual {
            say(app, &format!("This build ({RELEASE}) is not a release, so there is nothing to compare it with."));
        }
        return;
    };
    let found = tauri::async_runtime::block_on(async {
        let url = format!("{}/tray/{ch}/latest.json", downloads()).parse().map_err(|e| format!("{e}"))?;
        app.updater_builder()
            .endpoints(vec![url])
            .map_err(|e| e.to_string())?
            .version_comparator(move |current, remote| newer(ch, &current, &remote.version))
            .build()
            .map_err(|e| e.to_string())?
            .check()
            .await
            .map_err(|e| e.to_string())
    });
    let update = match found {
        Ok(u) => {
            let mut k = load(app);
            k.last = now();
            save(app, &k);
            u
        }
        Err(e) => {
            logbus::line("update", &format!("check failed: {e}"));
            if manual {
                say(app, "Could not reach k7.rocks to check for a newer k7 tray.");
            }
            return;
        }
    };
    let Some(update) = update else {
        if manual {
            say(app, &format!("k7 tray {} is the latest.", label(RELEASE)));
        }
        return;
    };
    // An automatic check tells of a build once; the menu's check always does.
    let mut k = load(app);
    if !manual && k.told == update.version {
        return;
    }
    k.told = update.version.clone();
    save(app, &k);
    logbus::line("update", &format!("k7 tray {} is available", update.version));
    if !self_updating() {
        if ask(app, &format!("k7 tray {} is available. The download page opens in your browser.", update.version), "Download") {
            tray::open_path(&downloads());
        }
        return;
    }
    if !ask(app, &format!("k7 tray {} is available. Install it now? k7 restarts once it is done.", update.version), "Install and Restart") {
        return;
    }
    let bytes = tauri::async_runtime::block_on(update.download(|_, _| {}, || {}));
    let bytes = match bytes {
        Ok(b) => b,
        Err(e) => {
            logbus::line("update", &format!("download failed: {e}"));
            if ask(app, "The update could not be downloaded. Open the download page?", "Download") {
                tray::open_path(&downloads());
            }
            return;
        }
    };
    // Stopped first, gracefully: the installer replaces binaries the engine and the backend are running.
    backend::stop(app);
    pidkill::backstop();
    if let Err(e) = update.install(bytes) {
        logbus::line("update", &format!("install failed: {e}"));
        say(app, "The update could not be installed; k7 restarts as it was.");
    }
    app.restart();
}

/// `v0.2.0` reads `0.2.0`; a snapshot reads as its stamp.
fn label(stamp: &str) -> &str {
    stamp.strip_prefix('v').unwrap_or(stamp)
}

#[cfg(test)]
mod tests {
    use super::newer;
    use semver::Version;

    fn v(s: &str) -> Version {
        Version::parse(s).unwrap()
    }

    #[test]
    fn a_release_takes_a_higher_tag_only() {
        assert!(newer("release", &v("0.1.0"), &v("0.2.0")));
        assert!(!newer("release", &v("0.2.0"), &v("0.2.0")));
        assert!(!newer("release", &v("0.3.0"), &v("0.2.0")));
    }

    #[test]
    fn a_snapshot_takes_any_other_commit() {
        assert!(newer("snapshot", &v("0.1.0-snapshot-aaaaaaa"), &v("0.1.0-snapshot-0000000")));
        assert!(!newer("snapshot", &v("0.1.0-snapshot-aaaaaaa"), &v("0.1.0-snapshot-aaaaaaa")));
    }
}
