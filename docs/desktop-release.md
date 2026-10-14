# The desktop release

`docker/` ships the hosted apps. This is the other half: what runs on the musician's machine and is in
no image. `.github/workflows/desktop.yml` builds it for the three desktops in two stages, and publishes
**two files per platform**:

| stage | job | what it publishes |
|---|---|---|
| 1 | `engines` | the **command-line engine**: `engine/st0-engine` and `engine/st0-supervisor` (C++, CMake) compiled and staged as one folder, archived — `.zip` on Windows, `.tar.gz` elsewhere |
| 2 | `desktop` | the **desktop app**, `apps/st0-standalone`, packaged around stage 1's binaries — the NSIS installer, the `.dmg`, the `.AppImage` |

The desktop job compiles nothing: it unpacks the engines job's archive for its platform and hands it
to the app's staging through `$STUDIO_PREBUILT_BIN` (`engine/scripts/docs/buildEngine.md`). So the
engine a user runs from the command line and the one inside the app are the same build, byte for byte.
One platform's failure costs that platform only. Each platform is one call of
`.github/workflows/desktop-platform.yml`, whose `desktop` job needs that call's `engine` job and no
other: a platform whose engine fails skips its own desktop build, and the other two carry on. GitHub
cannot make one matrix leg wait for the same leg of another matrix, which is why the two stages are a
reusable workflow called per platform rather than two matrices.

## Two channels, and what names a file

A push to `main` refreshes a prerelease on the moving tag `snapshot`; a `vX.Y.Z` tag makes a
release of its own. The snapshot release is deleted and recreated rather than edited, because a
GitHub release keeps the commit its tag points at however its assets are replaced — an edited one
would keep advertising the commit it was first cut from.

Each file is named for that channel — `st0-engine_v1.4.0_macos-arm64.tar.gz`,
`st0_snapshot-9f2c1ab_windows-x64.exe` — and **not** for a package version, which does not move with
each build. `engine/scripts/package-release.mjs` does the naming, for both kinds.

## Why the gate job, and not a `paths:` filter

A cold build of the engine is tens of minutes, three times over, and a macOS runner minute is the
dearest one there is. So a `main` push that touched only a doc must not start it.

`paths:` is the obvious tool and it is the wrong one here: GitHub applies it to **tag** pushes
too, and a tag push carries no commit list for it to match against — the release would silently
never run, on the one event that matters most. The `decide` job diffs the push instead and lets
tags through untested.

Its filter is `engine/`, `apps/` and `packages/` **whole**: the desktop app bundles st0's frontend and
backend and most of the shared tier, and the tier moves together. `commons` counts too: the Electron
shell under the app, `@frediverse/electron-shell`, lives there, and a change to it reaches this tree as
a bump of that one path. An `apps/`-only push does rebuild the engines; with their objects cached
that costs minutes, and it keeps one engine build per release.

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
cache, one per platform and capped at 2 GB. The presets read it from `STUDIO_COMPILER_LAUNCHER` into
`CMAKE_<LANG>_COMPILER_LAUNCHER`, empty on a developer's machine.

| choice | why |
|---|---|
| sccache, not ccache | one tool on all three; it caches MSVC |
| Ninja on Windows | the Visual Studio generator ignores a compiler launcher, so under it nothing would be cached |
| `/Z7` (`CMAKE_MSVC_DEBUG_INFORMATION_FORMAT=Embedded`) | `/Zi` writes every object into one shared `.pdb`, which a cached object cannot be replayed into |
| `_MBCS` defined under Ninja | the Visual Studio generator defines it on every target and Ninja does not; Faust's Windows code branches on it, and its other branch does not compile |
| `/MP` only under the Visual Studio generator | it does nothing under Ninja, and sccache does not cache a compile that carries it |
| the launcher in the presets, not CMake's own environment variable | that variable also reaches the nested CMake JUCE builds `juceaide` in, in Debug with `/Zi`, which sccache cannot cache; on MSVC that tool builds uncached (`engine/st0-engine/engine/patches/tracktion.cmake`) |
| `ilammy/msvc-dev-cmd` | Ninja calls `cl.exe` directly, so the job needs the PATH a developer prompt has |

Outside Windows the workflow sets `CMAKE_BUILD_PARALLEL_LEVEL` to every core: the build script keeps
two free for a developer's desktop, which on a 4-core runner is half of them. On Windows the script
sets no cap and ninja already uses them all. On Windows it takes Defender off the build instead —
the workspace, the cache and the compilers excluded, real-time scanning off — since it scans every
file `cl.exe` opens; the runner is discarded after the job, and a refusal leaves the build as it was.

**The dependencies' sources are kept too**, under `$STUDIO_FETCHCONTENT_DIR`, which both CMake projects
fetch into when it is set: cloning JUCE, Tracktion, Surge, Faust and the rest is three to five minutes
of every leg before a single compile. The cache holds sources only — what CMake builds inside the
folder is deleted before it is saved, as on OneDev — and its key is the exact hash of both
`CMakeLists.txt` and the fetch-time patch scripts, with no fallback to an older one: CMake re-runs a
patch step when its COMMAND changes, not its script, so a restored tree would silently miss a patch
added since. A changed dependency or patch costs one cold fetch.

The repository's caches share 10 GB, evicted least-recently-used: the sources take about a gigabyte
per platform, the compiled objects up to two, `node_modules` a few hundred megabytes. setup-node's npm
download cache is left off for that reason — `node_modules` is restored whole, so it was only ever
read when the lock changed.

`sccache --show-stats` closes each leg: the hit rate is what says whether the cache is working. The
cache step is not fatal: the action downloads sccache from github.com, which a runner sometimes cannot
reach, and the build then runs uncached — the launcher is set only when the step succeeded.

## The installer each platform gets

electron-builder makes them, from `apps/st0-standalone/electron-builder.cjs`: NSIS on Windows, a `.dmg`
on macOS, an `.AppImage` on Linux. It runs with `--publish never`: on a tagged CI run it would
otherwise try to publish to GitHub itself, and the release is the `publish` job's alone.

The `.dmg` is electron-builder's own target, which drives `hdiutil convert`. On the dev Mac that path
has failed with `EAGAIN` out of `CUDIFFileAccess::updateHeader`, intermittently and on trivial images
too; a red macOS desktop leg that names `hdiutil` is that, and `hdiutil create -srcfolder` is the path
that works around it.

## Nothing is signed

The macOS `.dmg` and engine archive are unsigned and unnotarised, and the Windows installer and
binaries unsigned, so they warn on first launch, macOS needs the right-click-Open path, and an engine
unpacked from a download needs its quarantine attribute cleared. This is not a gap in the workflow; it
is a certificate nobody has bought. ONNX Runtime, a third-party library loaded beside the supervisor,
is the sharp end of the same thing.

## The two limits worth knowing before reading a red run

**macOS is arm64 only.** An Intel build is one more entry in the matrix (`macos-13`, same
preset) and no other change; it is absent because nobody has asked for it, not because it is hard.

**Linux is the least walked of the three legs.** The apt list — JUCE's ALSA/JACK/X11 set — is
the part most likely to need a name added. Electron needs none of it to package: it carries its
own GTK at run time.

## Running one leg by hand

Exactly what CI runs, and the reason nothing in the workflow is written in YAML that could have
been a script:

```bash
STUDIO_ENGINE_PRESET=release-gcc STUDIO_SUPERVISOR_PRESET=release-gcc node engine/scripts/build-engine.mjs
node engine/scripts/package-release.mjs --kind engine --stamp local
npm run package --workspace st0-standalone
node engine/scripts/package-release.mjs --kind desktop --stamp local
```

`.github/workflows/st0.yml` stays as it is and compiles no C++: it is the gate every push runs
through, and it must be minutes rather than hours.

## On OneDev

`.onedev-buildspec.yml` carries a Linux leg and a Windows leg, both NIGHTLY: a `ScheduleTrigger` at
02:00 server time. OneDev makes a new build at every firing, even on a commit it has built before,
so each leg's first command skips the night when the branch took no commit in the last 24 hours —
a short green build rather than a red one, since a skipped night is not a failure, and a git that
cannot answer builds anyway rather than skipping silently. Either can still be run by hand, and a
hand-run on a day without commits skips the same way.

**`node_modules` is restored whole, not reinstalled** (`.github/actions/node/action.yml`): every
job takes it from a cache keyed on the runner's OS and the hash of `.nvmrc` and `package-lock.json`,
and runs `npm ci` only on a miss, which then saves it. setup-node's `cache: npm` alone keeps the
download cache, so each job would still unpack the whole tree. The key is exact, never a prefix: a
tree restored from an older lock would be wrong in ways `npm ci` never checks.

**On GitHub, `commons` is a checkout of its own**, at the commit `st0` pins (`git rev-parse
HEAD:commons`) and read with the `COMMONS_TOKEN` secret: `commons` is a private repository, a run's
built-in token reads only `st0`, and the token for one must not be the one `st0` is fetched with.
The secret is a fine-grained token with read access to `fredericlb/commons`'s contents; without it
the run falls back to the built-in token, which works only if `commons` is public.

**The Windows leg fetches `commons` itself**, as GitHub's does: the checkout takes no submodule, and
the build step's first act is `git submodule update --init commons`, authenticated with the same
`submodule-token` secret the checkout uses. `st0-library` is a plain folder of the repository, so the
checkout brings it; its paths are kept short because Windows refuses a path past 260 characters.

The Linux one runs in
a `node:22-bookworm` container and installs its toolchain on every run, and publishes what the
release does: the command-line engine's `.tar.gz`, then the desktop app's `.AppImage`. It keeps
a ccache, Electron's downloads and the dependency SOURCES between runs — the last through
`$STUDIO_FETCHCONTENT_DIR`, which both CMake projects fetch into when it is set — since the
third-party code is the bulk of the download and of the compile, and does not change from one night
to the next. That cache holds sources only: what CMake builds inside it depends on the preset, and
the job deletes it on its way out, failed or not. The Windows one runs on a
Windows agent through a **Remote Shell Executor**, so nothing is installed per run: Node, Git, CMake, Ninja
and the Visual Studio Build Tools are the agent's, under the account its service logs on as. A
container would buy isolation at the price of MSVC in a Windows container, which is heavier than
the machine it would run on. The dependency sources stay on that disk too, in `$STUDIO_FETCHCONTENT_DIR`
(`%LOCALAPPDATA%\st0-ci\fetch` unless the agent names another), rather than in an OneDev cache:
the machine already keeps them, so nothing crosses the network. `cmd` has no exit trap, so what the
last night built there is deleted before a run instead of after it.

The job names no executor and no agent, so neither has to be called anything. The executor's
**agent selector** picks by OS (an agent query on `Os`, checked on the Agents page first), and its
**job match** takes this job and nothing else: every other job in the file is a container job and
must never land on it. OneDev tries executors in the order they are listed and uses the first whose
job match accepts the job, so the Docker executor must not accept this one either — list the shell
executor first, or narrow the Docker one's match.

It overrides no preset, so the agent builds with the host default, `windows-msvc` (Visual Studio
2026, its own generator), exactly as the machine does by hand. The desktop app follows in the same
job, as on Linux.

**build android app** keeps the same cadence — nightly at 02:00, skipped on a day without commits —
and publishes a debug-signed APK (`engine/st0-engine/docs/android.md`). It is a native build of the
same weight, so it is paid for on the same schedule. Its SDK is pinned and cached, and its C++ goes
through its own ccache and its own sources cache — its own because it builds them for arm64.
