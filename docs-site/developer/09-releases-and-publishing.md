# Releases and publishing

Three things leave this repository besides the hosted images: the **command-line engine** archive,
the **desktop app** installer and the **Android APK**, all built by the desktop release, and four
**npm packages** consumed by another repository.

## What a release contains

| File | Built from | Platforms |
|---|---|---|
| `k7-runtime_<stamp>_<platform>-<arch>.tar.gz` (`.zip` on Windows) | `engine/scripts/build-engine.mjs` + `engine/scripts/package-release.mjs --kind engine` | `windows-x64`, `macos-arm64`, `linux-x64` |
| `k7_<stamp>_<platform>-<arch>.<dmg/exe/AppImage>` | `npm run package --workspace k7-standalone` + `package-release.mjs --kind desktop` | Same three |
| `k7-android_<stamp>_arm64.apk` | `./gradlew assembleDebug` in `engine/k7-android` | Android arm64 |

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
| Snapshot | Every push to `main` that touches `engine/`, `apps/`, `packages/`, `commons`, `package-lock.json` or the desktop workflows | The `snapshot` release is deleted and recreated as a pre-release pointing at the new commit, titled `snapshot <stamp>`. |
| Release | A tag matching `v*.*.*` | A release named after the tag, with generated notes. |

To cut a release, push a tag:

```bash
git tag v1.2.0
git push origin v1.2.0
```

A manual dispatch of the `desktop` workflow on another branch builds everything and uploads the
artifacts to the run without publishing a release.

OneDev builds the Windows engine archive, the Windows installer and the APK on the same triggers and
gathers them as the files of its `release` build (see [CI](./07-ci.md)). The Linux and macOS files
come from GitHub only.

Nothing is signed. The macOS app sets `identity: null` in `apps/k7-standalone/electron-builder.cjs`
and is not notarised; the Windows NSIS installer is unsigned; the APK is debug-signed. Both desktop
installers warn on first launch.

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

## The desktop app

`npm run package --workspace k7-standalone`:

1. builds the Electron main bundle (`apps/k7-standalone/scripts/build-main.mjs`);
2. stages `apps/k7-standalone/staging/` (`apps/k7-standalone/scripts/stage.mjs`): the frontend built
   with Vite, k7's backend and file service bundled as plain JavaScript by
   `apps/k7/backend/scripts/bundle.mjs` (the same bundle the phone runs, including the frontend, the
   demos and the `k7-core` library), and the engine binaries via `stageEngine`;
3. runs `electron-builder` with `apps/k7-standalone/electron-builder.cjs`: a `dmg` on macOS, an `nsis`
   installer on Windows, an `AppImage` on Linux, app ID `org.parapluie.k7.standalone`.

`stageEngine` takes the binaries from `$STUDIO_PREBUILT_BIN` when it is set, instead of from the
local build folders. CI uses this to package the desktop app around the engine archive built by the
previous job, without compiling anything. `package-release.mjs --kind desktop` copies each installer
from `apps/k7-standalone/out/` to `dist/release/` under its release name.

The desktop and Android sections of this guide cover the apps themselves.

## The Android APK

Gradle builds everything: the engine as `libk7runtime.so` in the `android-arm64` preset, the
supervisor, and the Capacitor page from the `engine/k7-android/web` workspace (which is why CI runs
`npm ci` at the root first). The versions it needs are pinned in `engine/k7-android/app/build.gradle.kts`:
compile SDK 36 and NDK 29.0.14206865, on JDK 21. CI caches the debug keystore, because Android
refuses to update an app signed by a different key.

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
