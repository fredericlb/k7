# Releases and publishing

Four things leave this repository besides the hosted images: the **command-line engine** archive
and the **Android APK**, built by the `release` workflow; the **tray** installers, built by the `tray`
workflow; and four **npm packages** consumed by another repository.

## What a release contains

| File | Built from | Platforms |
|---|---|---|
| `k7-runtime_<stamp>_<platform>-<arch>.tar.gz` (`.zip` on Windows) | `engine/scripts/build-engine.mjs` + `engine/scripts/package-release.mjs --kind engine` | `windows-x64`, `macos-arm64`, `linux-x64` |
| `k7-android_<stamp>_arm64.apk` | `./gradlew assembleRelease` in `engine/k7-android` | Android arm64 |
| `k7-tray_<stamp>_<platform>-<arch>.<exe/dmg/AppImage/deb>`, and the updater's `latest.json` | `npm run build --workspace k7-tray` + `package-release.mjs --kind tray` | `windows-x64`, `macos-arm64`, `linux-x64`; in releases of their own |

### The stamp

Release files are named by a stamp, not by a package version:

| Build | Stamp |
|---|---|
| A `vX.Y.Z` tag | The tag, e.g. `v1.2.0` |
| A push to `main` | `snapshot-<short commit>` |
| A local build | `dev`, unless `--stamp` or `$STUDIO_RELEASE_STAMP` is given |

`package-release.mjs` replaces any character outside `A-Za-z0-9._-` in the stamp with `-`.

### Channels

| Channel | When | GitHub release |
|---|---|---|
| Snapshot | Every push to `main` that touches what the workflow builds from ([CI](./07-ci.md)) | The `snapshot` release (and the tray's `tray-snapshot`) is deleted and recreated as a pre-release pointing at the new commit, titled `snapshot <stamp>`. |
| Release | A tag matching `v*.*.*`, equal to `v` + the root `package.json` version | A release named after the tag (the tray's `tray-vX.Y.Z`), with generated notes. |

The tray keeps its own GitHub releases so that neither workflow ever recreates the other's. Both
workflows also upload to `k7.rocks/app_downloads` (the tray under `/app_downloads/tray`), the page
people download from and the feed the tray updates from (`docs/app-downloads.md`).

To cut a release, set the version (the root `package.json`'s, copied into every private workspace)
in a commit on `main`, then tag that commit with the same version. CI refuses a tag that differs
from the root version, and publishes nothing until `k7.yml` has passed on the tagged commit:

```bash
node scripts/check-version.mjs --set 1.2.0
git commit -am "release 1.2.0"
git tag v1.2.0
git push origin main v1.2.0
```

A manual dispatch of the `desktop` or `tray` workflow on another branch builds everything and
uploads the artifacts to the run without publishing a release.

OneDev can build the Windows engine archive and the APK, by hand, and gathers them as the files of
its `release` build (see [CI](./07-ci.md)). The other files come from GitHub only.

The APK is signed with the release key held in CI secrets. The tray's installers are not
code-signed (the macOS app is ad-hoc signed and not notarised, so it warns on first launch), but
every tray update is signed with the updater key (`TAURI_SIGNING_PRIVATE_KEY` in CI secrets, its
public half in the repository variable `K7_UPDATER_PUBKEY`), and a build without it ships with no
updater rather than one that trusts anything.

## The command-line engine

`npm run engine:build` (`engine/scripts/build-engine.mjs`):

1. builds the engine with `engine/k7-runtime/scripts/build.mjs <preset>` (preset from the platform, or
   `$STUDIO_ENGINE_PRESET`);
2. builds the supervisor (`engine/scripts/supervisorBuild.mjs`, preset overridable with
   `$STUDIO_SUPERVISOR_PRESET`);
3. stages both into `dist/k7-runtime/` with `stageEngine` from `@studio/supervisor-host`, which copies
   the newest build of each together with what they load at run time;
4. copies `engine/k7-supervisor/engine.example.json` there as `engine.json`.

It prints the command to run the result: `dist/k7-runtime/k7-supervisor --config dist/k7-runtime/engine.json`.
`package-release.mjs --kind engine` then archives that folder into `dist/release/`, as `.tar.gz`
outside Windows (to keep the executable bits) and as `.zip` on Windows, using the system `tar.exe`.

Environment variables the build reads:

| Variable | Effect |
|---|---|
| `STUDIO_ENGINE_PRESET`, `STUDIO_SUPERVISOR_PRESET` | CMake preset names. |
| `STUDIO_FETCHCONTENT_DIR` | Where CMake keeps downloaded dependency sources (Tracktion, JUCE, Faust and others), so CI can cache them. |
| `STUDIO_COMPILER_LAUNCHER` | Compiler launcher read by the presets (`sccache` or `ccache` in CI). |
| `CMAKE_BUILD_PARALLEL_LEVEL` | Compiler parallelism; the build scripts default to cores minus two. |

## The tray

`npm run stage --workspace k7-tray` (`apps/k7-tray/scripts/stage.mjs`) fills
`apps/k7-tray/src-tauri/resources/`: k7's backend and file service bundled as plain JavaScript by
`apps/k7/backend/scripts/bundle.mjs` (the same bundle the phone runs, including the frontend, the
demos and the `k7-core` library), the engine binaries via `stageEngine`, and a pinned, checksummed
Node 24. `npm run build --workspace k7-tray` then runs `tauri build`: an NSIS installer on Windows,
a `dmg` and the updater's `.app.tar.gz` on macOS, an AppImage and a `.deb` on Linux.

`stageEngine` takes the binaries from `$STUDIO_PREBUILT_BIN` when it is set, instead of from the
local build folders. CI uses this to package the tray around the engine archive built by the
previous job, without compiling anything. `package-release.mjs --kind tray` copies each installer
to `dist/release/` under its release name and writes that platform's fragment of the updater's
`latest.json`, which `engine/scripts/tray-manifest.mjs` merges in the publish job.

[The tray and the phone apps](./86-desktop-and-android.md) covers the apps themselves.

## The Android APK

Gradle builds everything: the engine as `libk7runtime.so` in the `android-arm64` preset, the
supervisor, and the Capacitor page from the `engine/k7-android/web` workspace (which is why CI runs
`npm ci` at the root first). The versions it needs are pinned in `engine/k7-android/app/build.gradle.kts`:
compile SDK 36 and NDK 29.0.14206865, on JDK 21. CI signs the release APK with the key held in its
secrets, because Android refuses to update an app signed by a different key; a tag without that key
fails, a snapshot without it ships no APK.

```bash
npm ci
cd engine/k7-android && ./gradlew assembleDebug
# app/build/outputs/apk/debug/app-debug.apk
```

## Publishing npm packages

Four packages are consumed by another repository by version, still as raw TypeScript:

| Package | Version | `files` |
|---|---|---|
| `@studio/web-protocol` | `0.1.1` | `*.ts` except tests, `docs` |
| `@studio/engine-protocol` | `0.1.1` | `*.ts` except tests, `docs` |
| `@studio/engine-browser` | `0.1.1` | `src` except tests, `docs` |
| `@studio/project-shell` | `0.1.1` | `src` except tests, `docs` |

They are the only packages without `"private": true` that carry `"publishConfig": { "access":
"restricted" }`. Their `exports` point at `.ts` files exactly as inside the repository, so a consumer
needs a TypeScript-aware bundler or loader. No script or workflow in this repository publishes them:
publishing is a manual `npm publish` from the package folder, after bumping its `version`.

Rules that follow from this:

- A change to one of these four packages can break the external consumer; bump the version when
  publishing a change to their exports.
- Their runtime `dependencies` are only each other (`web-protocol` and `engine-browser` depend on
  `engine-protocol`, `engine-browser` and `project-shell` on `web-protocol`). `project-shell` lists
  the private `@studio/graph-model` and `@studio/song-schema` only as **optional** peer
  dependencies, for the subpaths that need them; keep any new dependency on a private package
  optional in the same way, or the consumer cannot install the package.
- `@studio/rehearsal-server` also lacks `"private": true` but has no `publishConfig` and is not
  published.
