# App downloads and updates

Every build `desktop.yml` publishes — the APK and the command-line engine — and every tray
`tray.yml` publishes is also published on k7 itself, at **`https://k7.rocks/app_downloads`**: one
page anyone can open, no login, and the feeds the tray and the Android app update themselves from.
The GitHub releases stay; the page is the address to give people, and the one the installed apps read.

## Two stores

`desktop.yml`'s builds sit at the root (`app_downloads/<channel>/…`, `app_downloads/<channel>.json`),
the tray's under `tray/` (`app_downloads/tray/<channel>/…`). The page lists both.

| choice | why |
|---|---|
| a store per workflow, not the tray's files in `desktop.yml`'s build | a publish replaces its stamp's whole folder, and the two workflows publish the same stamp apart: sharing one, each would drop the other's files |
| the APK and the engine archives at the root | installed Android apps read `<channel>.json` there |

## Two channels

A build is named by its release stamp ([versioning.md](versioning.md)), and the stamp says its
channel: `vX.Y.Z` is **`release`**, `snapshot-<commit>` is **`snapshot`**. The page shows both, the
release first. An installed app follows its own channel and never crosses to the other.

| choice | why |
|---|---|
| a channel per stamp kind, not one feed | a snapshot's version (`0.1.0-snapshot-9f2c1ab`) is a prerelease of the release it was cut from: on one feed, a release would pull every snapshot install onto it and leave it there |
| on the snapshot channel, any other build is newer | snapshot versions sort by commit hash, not by date; the channel only ever holds `main`'s latest build, so "another commit" is "later" |
| `current` and `previous` kept per channel, nothing else | an app that read its feed just before a publish still finds its file; older builds are on GitHub |
| on the root domain, `/app_downloads` is the one address besides the coming-soon page | the app itself is at `app.k7.rocks`, which answers the same path; `k7.rocks` is a front page, not the app ([apps/k7/backend/docs/site.md](../apps/k7/backend/docs/site.md)) |

## Publishing

`desktop.yml`'s `publish` job, after the GitHub release, sends every file of `dist/` to
`https://app.k7.rocks/api/app-releases/<stamp>/<file>` (one `PUT` each, raw body) and then `POST`s
`/api/app-releases/<stamp>/publish`, which switches the channel to that build at once.
`tray.yml`'s does the same under `/api/app-releases/tray/`, with the updater's `latest.json` among
its files.

Both need `Authorization: Bearer <APP_RELEASE_TOKEN>`, a value only the repository's
`APP_RELEASE_TOKEN` secret and the server's `APP_RELEASE_TOKEN` (`docker/.env`) know. Unset on the
server, every upload answers 401; unset in the repository, the step warns and skips, and the page
keeps its last build. To set it up, generate one value (`openssl rand -hex 32`) and put it in both.

A file is at most `APP_RELEASE_MAX_MB` (2048); its name is letters, digits, `.`, `_` and `-`, which
is why `engine/scripts/package-release.mjs` names every release file for its stamp — `latest.json`
must name the very file the server holds. The builds live under `STUDIO_APP_RELEASES_DIR`,
`/data/app-releases` in the image (the `data` volume), one folder per channel, and the tray's
channels in `tray/` beside them. The routes are `apps/k7/backend/src/appReleases/`; the backend the
tray or a phone runs does not mount them.

## The tray

The tray reads `app_downloads/tray/<channel>/latest.json` with tauri-plugin-updater
([apps/k7-tray/docs/tray.md](../apps/k7-tray/docs/tray.md)).

| choice | why |
|---|---|
| every update signed, the private key in CI secrets (`TAURI_SIGNING_PRIVATE_KEY`) | the upload token alone would let whoever holds it ship code every tray runs; the public key is built into the tray from the repository variable `K7_UPDATER_PUBKEY` |
| a build without the public key has no updater | rather than one that trusts anything |
| the channel from the release stamp, `dev` asks nothing | a developer's build is not on any feed |
| Windows, macOS and the AppImage update themselves; a `.deb` is told | the updater installs those three; a `.deb` belongs to apt, so Download opens the page |

## The Android app

The Android app (`engine/k7-android/app/src/main/kotlin/se/frediver/k7/Updates.kt`) reads the root
store's `<channel>.json`: it downloads a newer APK on an unmetered network and offers it, and the
person installs it — Android always asks the first time, and lets later updates through once k7
installed itself (Android 12+). The token is the only guard on what reaches that feed; the signature
check is the second: an APK not signed with the release key never installs
([engine/k7-runtime/docs/android.md](../engine/k7-runtime/docs/android.md)). The iPhone app ships
through Xcode.
