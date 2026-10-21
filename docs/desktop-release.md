# The engine and tray release

`docker/` ships the hosted apps. This is the other half: what runs on the musician's machine and is in
no image. **GitHub builds it**, the repository being public, so its Actions minutes cover three
desktop platforms on every push. Two workflows share the work, on the same triggers and the same
release stamps:

| workflow | what it publishes |
|---|---|
| `.github/workflows/desktop.yml` | the **command-line engine** — `engine/k7-runtime` and `engine/k7-supervisor` (C++, CMake) compiled and staged as one folder, archived (`.zip` on Windows, `.tar.gz` elsewhere) — and the phone's APK |
| `.github/workflows/tray.yml` | **the tray**, `apps/k7-tray`, packaged around the same engine: the NSIS installer, the `.dmg` and the `.app.tar.gz` the updater takes, the `.AppImage` and the `.deb` |

Each platform's engine is one call of the reusable `.github/workflows/engine-platform.yml`, from
`desktop.yml` directly and from `tray-platform.yml`, which then packages the tray around that
archive through `$STUDIO_PREBUILT_BIN` (`engine/scripts/docs/buildEngine.md`). So the engine a user
runs from the command line and the one under the tray are the same sources and the same presets.
One platform's failure costs that platform only: GitHub cannot make one matrix leg wait for the same
leg of another, so each platform's tray is one call that depends on its own engine job and no other.
`.onedev-buildspec.yml` draws the engine and the APK for OneDev, with no trigger: its jobs run by hand.

| choice | why |
|---|---|
| the tray in a workflow of its own, not a job of `desktop.yml` | a red tray must not hold back the engine snapshot and the APK, nor a red APK the tray |
| its own GitHub releases, `tray-snapshot` and `tray-vX.Y.Z` | the snapshot release is deleted and recreated on each publish; two workflows sharing it would delete each other's files |
| its own store on `k7.rocks/app_downloads/tray`, with the updater's `latest.json` | the feed the tray updates from ([app-downloads.md](app-downloads.md)) |
| the engine compiled again, not taken from `desktop.yml`'s run | a workflow cannot wait on another's artifacts without coupling the two runs; both share the compiler cache (`engine-<label>`), so the second build is mostly cache hits |
| no end-to-end run before the installer | the tray has no page of its own to drive; its unit tests run in `k7.yml`, and the page it serves is the hosted build's |

## Two channels, and what names a file

A push to `main` makes a snapshot; a `vX.Y.Z` tag makes a release of its own. On GitHub the snapshot is a prerelease on the moving tag
`snapshot` (`tray-snapshot` for the tray), deleted and recreated rather than edited, because a GitHub release keeps the commit its tag
points at however its assets are replaced — an edited one would keep advertising the commit it was
first cut from.

Each file is named for that channel — `k7-runtime_v1.4.0_macos-arm64.tar.gz`,
`k7-tray_snapshot-9f2c1ab_windows-x64.exe` — and **not** for a package version, which does not move with
each build. `engine/scripts/package-release.mjs` does the naming, for both kinds (`--kind engine|tray`).

Every published build is also put on **`https://k7.rocks/app_downloads`**, the page people download
from and the feed the tray and the phone update themselves from, one channel each
([app-downloads.md](app-downloads.md)). That is why the tray's `latest.json` is written from the
renamed files: it must name the files the page serves.

## Why the gate job, and not a `paths:` filter

A cold build of the engine is tens of minutes, three times over, and a macOS runner minute is the
dearest one there is. So a `main` push that touched only a doc must not start it.

`paths:` is the obvious tool and it is the wrong one here: GitHub applies it to **tag** pushes
too, and a tag push carries no commit list for it to match against — the release would silently
never run, on the one event that matters most. The `decide` job diffs the push instead and lets
every tag through.

`desktop.yml`'s filter is `engine/`, `apps/` and `packages/` **whole**, and `commons`: the APK bundles
k7's frontend and backend and most of the shared tier, and the tier moves together. An `apps/`-only
push does rebuild the engines; with their objects cached that costs minutes, and it keeps one engine
build per release. `tray.yml`'s filter is narrower, `engine/`, `apps/k7-tray/` and what the tray
itself depends on: its workflow names the paths.

## Nothing is published untested

The `publish` job needs `tested`, which waits for `k7.yml`'s push run on the same commit and the same
ref — the `main` push for a snapshot, the tag push for a release — and fails if that run is red or
never appears (`.github/actions/k7-passed`). A missing run counts as a failure, not as a pass: the
hazard is a release cut from a commit no test ever saw. `tested` runs beside the builds rather than
before them, since the tests take minutes and a native build tens of them. `k7.yml` carries no path
filter for the same reason, and on `main` and tags it cancels no run, since every commit's result is
read by a publish.

## The presets a runner can actually use

`STUDIO_ENGINE_PRESET` and `STUDIO_SUPERVISOR_PRESET` override the host's default preset in
`engine/scripts/build-engine.mjs`. Every leg names its preset, so the matrix says out loud what each
one builds: `macos-clang` and `release-gcc`, the host defaults, and on Windows `windows-msvc-ninja` —
the dev machine's compiler, Visual Studio 2026, which `windows-latest` carries
(`windows-2025-vs2026`), under Ninja rather than the Visual Studio generator the dev machine uses.

## Every leg keeps its compiled objects between runs

The engine is about 1,070 translation units — JUCE, Tracktion, Surge, Faust, sfizz — and a runner
starts with none of them: 11 minutes on macOS, over 20 on Linux, over 30 on Windows, for a push that
changed one file. `sccache`, through `hendrikmuhs/ccache-action`, keeps the objects in the Actions
cache, one per platform and capped at 1 GB, above the 0.7 GB the largest leg fills. The presets read it from `STUDIO_COMPILER_LAUNCHER` into
`CMAKE_<LANG>_COMPILER_LAUNCHER`, empty on a developer's machine.

| choice | why |
|---|---|
| sccache, not ccache | one tool on all three; it caches MSVC |
| Ninja on Windows | the Visual Studio generator ignores a compiler launcher, so under it nothing would be cached |
| `/Z7` (`CMAKE_MSVC_DEBUG_INFORMATION_FORMAT=Embedded`) | `/Zi` writes every object into one shared `.pdb`, which a cached object cannot be replayed into |
| `_MBCS` defined under Ninja | the Visual Studio generator defines it on every target and Ninja does not; Faust's Windows code branches on it, and its other branch does not compile |
| `/MP` only under the Visual Studio generator | it does nothing under Ninja, and sccache does not cache a compile that carries it |
| the launcher in the presets, not CMake's own environment variable | that variable also reaches the nested CMake JUCE builds `juceaide` in, in Debug with `/Zi`, which sccache cannot cache; on MSVC that tool builds uncached (`engine/k7-runtime/engine/patches/tracktion.cmake`) |
| `ilammy/msvc-dev-cmd` | Ninja calls `cl.exe` directly, so the job needs the PATH a developer prompt has |

Outside Windows the workflow sets `CMAKE_BUILD_PARALLEL_LEVEL` to every core: the build script keeps
two free for a developer's desktop, which on a 4-core runner is half of them. On Windows the script
sets no cap and ninja already uses them all. On Windows it takes Defender off the build instead —
the workspace, the cache and the compilers excluded, real-time scanning off — since it scans every
file `cl.exe` opens; the runner is discarded after the job, and a refusal leaves the build as it was.

**The dependencies' sources are kept too, on the Windows leg and the APK**, under
`$STUDIO_FETCHCONTENT_DIR`, which both CMake projects fetch into when it is set: JUCE, Tracktion,
Surge, Faust and the rest all arrive before a single compile. The cache holds sources only — what
CMake builds inside the folder is deleted before it is saved, as on OneDev, and so are the archives
FetchContent downloaded, whose stamps stay so a restored tree is not fetched again — and
its key is the exact hash of both `CMakeLists.txt` and the fetch-time patch scripts, with no fallback
to an older one, so a changed dependency or patch costs one cold fetch rather than a tree half of one
and half of the other. A restored tree would take a changed patch anyway — each patch command carries
its script's checksum (`engine/k7-runtime/docs/build.md`) — which is what OneDev's fixed-name caches
rely on.

Only those two, because of the budget. The repository's caches share 10 GB, evicted
least-recently-used. A platform's sources are about 1.3 GB on disk and 0.5 GB in the cache, since every
dependency arrives without its git history, which is most of a clone's size
(`engine/k7-runtime/docs/build.md`). Windows and the APK are the legs a release waits on; macOS and
Linux finish well before them, so their download delays nothing, and the room their sources would
take is better left to the compiled objects (up to 0.7 GB a platform), `node_modules` and Gradle's
caches. Their sources still go to the same folder, whose path is in every compile command, so their
compiled objects keep hitting. setup-node's npm download cache is left off for the same reason —
`node_modules` is restored whole, so it was only ever read when the lock changed.

`sccache --show-stats` closes each leg: the hit rate is what says whether the cache is working. The
cache step is not fatal: the action downloads sccache from github.com, which a runner sometimes cannot
reach, and the build then runs uncached — the launcher is set only when the step succeeded.

## Only main writes a cache, and only its newest generation stays

**A branch, a pull request or a tag restores main's caches and saves none.** Every cache step is a
restore, with a save that runs on `refs/heads/main` alone — `actions/cache/restore` and
`actions/cache/save`, and the compiler cache's own `save` input. A run reads the caches of its own ref
and of the default branch, so a branch's entry would serve that branch only while it counts against
the same 10 GB and pushes main's out; a tag's entry would serve no later run at all. Gradle's
downloads go through `actions/cache` for the same reason: `setup-java`'s `cache: gradle` saves from
every ref, with no way to say otherwise.

**No entry is ever overwritten**, so the old ones are deleted on purpose. The compiler cache saves
under a new timestamped key on every run, and the exact-key caches (sources, `node_modules`, Gradle)
under a new hash whenever their inputs move; nothing reads an older generation again, and left alone
it stays until eviction, which takes the least recently used entry, often one still needed.
`.github/workflows/caches.k7x` runs after every `desktop` and `k7` run, and daily: it keeps the newest
entry per ref and family — the key without its trailing timestamp or hash — and deletes the rest.
`gh cache list --sort size_in_bytes` shows what the 10 GB holds.

## The phone, beside the engines

The `android` job builds `engine/k7-android`'s **release** APK, signed with the project's release key,
and the release carries it as `k7-android_<stamp>_arm64.apk`. It is a job of its own rather than a fourth platform of the two
stages: the phone's engine is an arm64 LIBRARY that Gradle compiles inside the app's build
(`engine/k7-runtime/docs/android.md`), so there is no command-line archive for it to share. It runs as
OneDev's `android` job does — the image's Android SDK, the platform, build tools and NDK that
`app/build.gradle.kts` names, JDK 21 — with its own compiler and sources caches, since the same sources
compile to arm64 there. A red APK holds `desktop.yml`'s release back.

### The iPhone, in a workflow of its own

`.github/workflows/ios.yml` builds `engine/k7-ios` for a device on `macos-26`, on a `main` push that touches
what the app is made of, on a `vX.Y.Z` tag, or by hand. It runs `engine/k7-ios/scripts/stage.mjs` — the engine and the supervisor
from their `ios-arm64` presets, under the same compiler cache scheme as the desktop legs (`engine-ios-arm64`) — then
Xcode, and uploads `k7-ios_<stamp>_arm64-unsigned.ipa` as an artifact, after checking that the three frameworks
inside are arm64 device binaries (`engine/k7-runtime/docs/ios.md`). On a tag, its `publish` job then waits for the
release `desktop.yml` makes and attaches the `.ipa` to it, with its line added to `SHA256SUMS`.

| choice | why |
|---|---|
| a workflow of its own, not a job of `desktop.yml` | an iOS build that fails must not hold back the engine snapshot, which a job feeding `publish` would |
| unsigned; attached to a VERSION's release, never to the snapshot | no Apple team is committed yet, so the app installs nowhere until its developer signs it. A version carries it for whoever does; the snapshot, replaced on every push, keeps to the downloads a musician can run |
| the release waited for, not made | `desktop.yml` owns the release and makes it only after `k7.yml` passed and the engines built; attaching after it keeps one owner, and an iOS failure still leaves the release as it was |
| a diff in `decide`, not a `paths:` filter | GitHub applies `paths:` to tag pushes too, where it matches nothing — a version would never get its `.ipa`, as `desktop.yml` already notes |
| `macos-26`, not `macos-latest` | the project file and its Swift are written for the Xcode 26 line, and a moving label would change the toolchain under them |
| no dependency-source cache | the desktop legs keep one on the slow leg alone, within the 10 GB; this leg fetches its archives like the macOS one |

### The release key

A published APK is never a debug build: a debuggable app lets `adb shell run-as` read everything it
stores, and a debug key kept in a build cache is a key anyone who can write that cache can sign an
update with. So the job runs `assembleRelease`, whose build type is not debuggable, and
`app/build.gradle.kts` signs it only from four environment variables — `K7_ANDROID_KEYSTORE_FILE`,
`K7_ANDROID_KEYSTORE_PASSWORD`, `K7_ANDROID_KEY_ALIAS`, `K7_ANDROID_KEY_PASSWORD`. Without them
the build leaves an unsigned `app-release-unsigned.apk`, which nothing publishes. The job then checks
the APK with `apksigner verify` and refuses one `aapt2` reports as debuggable.

R8 stays off for the release build: Capacitor's bridge and the JNI entry points are reached by
reflection, and no keep rules cover them.

The key is the app's identity for as long as it ships: Android refuses an update signed by another,
so a lost key means every user uninstalls, and a leaked one means anyone can ship an update. An APK
signed with any other key — a developer's debug build — needs the installed app removed first.

**Without the secrets**, a tag fails in `decide`, before any build, since a release without its APK
is incomplete; a snapshot (a `main` push, a dispatch) builds and publishes the engine archives and no APK,
with a warning on the run. A fork has no secrets, so its snapshots carry no APK.

Create the key once, on a trusted machine, and keep the `.jks` and its passwords offline as well:

```bash
keytool -genkeypair -v -keystore k7-release.jks -storetype PKCS12 \
  -alias k7 -keyalg RSA -keysize 4096 -validity 10000 \
  -dname "CN=k7, O=frediverse"
base64 -w0 k7-release.jks > k7-release.jks.b64   # macOS: base64 -i k7-release.jks -o k7-release.jks.b64
```

PKCS12 holds one password for the store and the key, so the two password secrets are the same value.

| GitHub repository secret | OneDev job secret | value |
|---|---|---|
| `ANDROID_KEYSTORE_B64` | `android-keystore-b64` | the content of `k7-release.jks.b64` |
| `ANDROID_KEYSTORE_PASSWORD` | `android-keystore-password` | the store password |
| `ANDROID_KEY_ALIAS` | `android-key-alias` | `k7`, the `-alias` above |
| `ANDROID_KEY_PASSWORD` | `android-key-password` | the key password |

On OneDev, restrict the four to the branch releases are built from, `main`, so a build of any other
branch cannot read them.

## Checksums

Every release carries `SHA256SUMS`, one line per file — the engine archives and the APK in
`desktop.yml`'s, the tray's installers in `tray.yml`'s — written by the publish job (GitHub) or the `release` job (OneDev) over exactly the files it
publishes. `sha256sum -c SHA256SUMS` in the download folder checks them. It proves a download matches
what CI published, not who published it: nothing is signed with a key of ours, since keyless signing
would only bind the files to this repository's CI identity and no client checks it.

## What a workflow may do

`desktop.yml`, `tray.yml` and `k7.yml` grant `contents: read` at the top; the publish job alone gets
`contents: write`. The reusable `tray-platform.yml` and `engine-platform.yml` receive `COMMONS_TOKEN` by name, never
`secrets: inherit`, since their jobs run third-party actions. Every action is pinned to a full commit
SHA with its version in a comment: a tag can be moved under a run, a commit cannot. A bump is a new
SHA, resolved with `gh api repos/<owner>/<repo>/commits/<tag> -q .sha`.

The release stamp — the tag, or `snapshot-<commit>` — reaches commands through the environment and is
checked in `decide` against `vX.Y.Z` or `snapshot-<hex>`: a tag name is chosen by whoever pushes it,
and anything else stops the run. A tag must also be `v` + the root package.json's version, which
every artefact ships under ([versioning.md](versioning.md)). The tray job hands it to the build as
`$STUDIO_RELEASE_STAMP`: it is the release the tray ships, which the page shows in About, and it picks
the tray's update channel (`apps/k7-tray/docs/tray.md`). The engine job hands the same stamp to the
engine's and the supervisor's CMake, which compile it into one file each as the `build` both state
(`packages/engine-protocol/docs/version.md`).

## The installer each platform gets

`tauri build` makes them, from `apps/k7-tray/src-tauri/tauri.conf.json`: NSIS on Windows, a `.dmg`
and an `.app.tar.gz` on macOS, an `.AppImage` and a `.deb` on Linux. With the updater key present it
also signs the files the updater installs; without it the build has no updater
([app-downloads.md](app-downloads.md)).

## The tray is not signed by a certificate

The macOS app is signed ad-hoc (`signingIdentity: "-"`) — with no certificate, which is all that keeps
it from being reported "damaged" — and unnotarised; the engine archive is unsigned beyond the linker's
own ad-hoc signature; the Windows installer and binaries are unsigned. So they warn on first launch.
This is not a gap in the workflow; it is a certificate nobody has bought. ONNX Runtime, a third-party
library loaded beside the supervisor, is the sharp end of the same thing. The updater's signature is
another matter: it proves an update came from CI, not who the publisher is to the OS.

**What a user does to open them.** On macOS 15 and later, right-click > Open does not let an
unnotarised app through. Open the tray once, dismiss the refusal, then System Settings > Privacy &
Security, where an "Open Anyway" button appears for about an hour; confirm with the account's
password. The same from a terminal, after copying the app to Applications:

```bash
xattr -dr com.apple.quarantine /Applications/k7-tray.app
```

An engine archive unpacked from a download needs the same command on its folder. On Windows,
SmartScreen's "Windows protected your PC" has a More info link, then Run anyway.

**What signing would take.** On macOS, an Apple Developer Program membership, a Developer ID
Application certificate in the build's keychain (a `.p12` and its password as secrets), every
binary in the bundle signed with the hardened runtime — node, the supervisor, the engine and ONNX
Runtime included, or Gatekeeper kills the unsigned children — and the app notarised (an App Store
Connect API key or an app-specific password) and stapled; Tauri does it once `signingIdentity` names
that certificate and its notarisation variables are set. On Windows, an Authenticode certificate,
whose key the CAs now issue only on a hardware token or in a cloud HSM — so CI signs through a
signing service (Azure Trusted Signing, a CA's cloud signer) called from Tauri's `signCommand`.

## The two limits worth knowing before reading a red run

**macOS is arm64 only.** An Intel build is one more entry in the matrix (`macos-13`, same
preset) and no other change; it is absent because nobody has asked for it, not because it is hard.

**Linux is the least walked of the three legs.** The apt list — JUCE's ALSA/JACK/X11 set — is
the part most likely to need a name added; the tray's leg adds what Tauri links against
(WebKitGTK, the app indicator), which Tauri needs even with no window open.

## Running one leg by hand

Exactly what CI runs, and the reason nothing in the workflow is written in YAML that could have
been a script:

```bash
STUDIO_ENGINE_PRESET=release-gcc STUDIO_SUPERVISOR_PRESET=release-gcc node engine/scripts/build-engine.mjs
node engine/scripts/package-release.mjs --kind engine --stamp local
npm run stage --workspace k7-tray
npm run build --workspace k7-tray
node engine/scripts/package-release.mjs --kind tray --stamp local
```

`.github/workflows/k7.yml` stays as it is and compiles no C++: it is the gate every push runs
through, and it must be minutes rather than hours.

## On OneDev

`.onedev-buildspec.yml` names jobs by what they make — `engine windows`, `android` —
and builds no Linux leg and no tray: those are GitHub's alone, and OneDev's container runs would only duplicate it. No job carries a trigger: **`release`**, run by hand, is
the one to start. Its dependencies run the rest, and it gathers every file into its own build: that build's artifacts are the release. The file names
are GitHub's — the tag, or `snapshot-<commit>`. The engine job and the APK wait for `lint and test`: a release
should not ship what the tests refuse, and the APK shares its machine, where a C++ compile beside it times
its slower tests out.

**The APK runs in a container** and installs its toolchain on every run. It keeps a ccache, Gradle's
cache and the dependency SOURCES between runs in OneDev caches — the last through
`$STUDIO_FETCHCONTENT_DIR`, which both CMake projects fetch into when it is set. That cache
holds sources only: what CMake builds inside it depends on the preset, and the job deletes it on its
way out, failed or not. Its release key comes from the four `android-*` job secrets above, read
through quoted heredocs into a folder the job deletes on exit. OneDev runs on an instance with no
forks, so the job has no unsigned path: without the secrets it fails, on a snapshot as on a tag.

**The Windows jobs run on a Windows agent through a Remote Shell Executor**, so nothing is installed
per run: Node, Git, CMake, Ninja and the Visual Studio Build Tools are the agent's, under the account
its service logs on as. A container would buy isolation at the price of MSVC in a Windows container,
which is heavier than the machine it would run on. The dependency sources stay on that disk, in
`$STUDIO_FETCHCONTENT_DIR` (`%LOCALAPPDATA%\k7-ci\fetch` unless the agent names another): the machine
already keeps them, so nothing crosses the network. `cmd` has no exit trap, so what the last run built
there is deleted before a run instead of after it. They fetch `commons` themselves — the checkout takes
no submodule — with the same `submodule-token` secret the checkout uses, handed to git through
`GIT_CONFIG_COUNT`/`GIT_CONFIG_KEY_0`/`GIT_CONFIG_VALUE_0` rather than `-c`, which would put the
token in the process's command line, readable by anything listing the agent's processes. They override no preset, so
the agent builds with the host default, `windows-msvc` (Visual Studio 2026, its own generator), exactly
as the machine does by hand, and with no compiler cache: that generator ignores a launcher.

A job on a shell executor names no executor and no agent, so neither has to be called anything. The
executor's **agent selector** picks by OS (an agent query on `Os`, checked on the Agents page first),
and its **job match** takes that platform's jobs and nothing else: every other job in the file is a
container job and must never land on it. OneDev tries executors in the order they are listed and uses
the first whose job match accepts the job, so the Docker executor must not accept these either — list
the shell executors first, or narrow the Docker one's match.

## On GitHub

**`node_modules` is restored whole, not reinstalled** (`.github/actions/node/action.yml`): every
job takes it from a cache keyed on the runner's OS and the hash of `.nvmrc` and `package-lock.json`,
and runs `npm ci` only on a miss, which then saves it. The key is exact, never a prefix: a tree
restored from an older lock would be wrong in ways `npm ci` never checks.

**`commons` is a checkout of its own**, at the commit `st0` pins (`git rev-parse HEAD:commons`) and
read with the `COMMONS_TOKEN` secret: `commons` is a private repository, a run's built-in token reads
only `st0` (the repository's name on GitHub), and the token for one must not be the one `st0` is fetched with. The secret is a
fine-grained token with read access to `fredericlb/commons`'s contents; without it the run falls back
to the built-in token, which works only if `commons` is public. `k7-core` is a plain folder of the
repository, so the checkout brings it; its paths are kept short because Windows refuses a path past
260 characters.
