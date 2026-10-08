# The desktop release

`docker/` ships the four web apps. This is the other half: the two native pieces that run on
the musician's machine and are in no image — `engine/st0-engine` (C++, CMake) and
`engine/st0-tray` (Rust, Tauri). `.github/workflows/desktop.yml` builds them for the three
desktops and publishes **one archive per platform**.

| platform | what is in the archive |
|---|---|
| `windows-x64` | the NSIS installer, and `st0-engine.exe` on its own |
| `macos-arm64` | the `.dmg`, and `st0-engine` on its own |
| `linux-x64` | the `.deb`, the `.AppImage`, and `st0-engine` on its own |

The standalone engine travels beside the installer in every one of them. The bundle already
carries its own copy — this second one is for a machine that wants the engine and no tray.

## Two channels, and what names an archive

A push to `master` refreshes a prerelease on the moving tag `snapshot`; a `vX.Y.Z` tag makes a
release of its own. The snapshot release is deleted and recreated rather than edited, because a
GitHub release keeps the commit its tag points at however its assets are replaced — an edited one
would keep advertising the commit it was first cut from.

The archive is named for that channel — `st0-desktop_v1.4.0_macos-arm64.zip`,
`st0-desktop_snapshot-9f2c1ab_linux-x64.tar.gz` — and **not** for
`engine/st0-tray/src-tauri/tauri.conf.json`'s version, which has not moved in the life of the
app. Two builds named from it would be indistinguishable in a downloads folder.

## Why the gate job, and not a `paths:` filter

A cold configure of the engine fetches JUCE, Tracktion, Faust, Eigen and NAM and then compiles
them: tens of minutes, three times over, and a macOS runner minute is the dearest one there is.
So a master push that touched only `apps/` or a doc must not start it.

`paths:` is the obvious tool and it is the wrong one here: GitHub applies it to **tag** pushes
too, and a tag push carries no commit list for it to match against — the release would silently
never run, on the one event that matters most. The `decide` job diffs the push instead and lets
tags through untested.

Its filter is `packages/` **whole**, not a list of audio packages: the supervisor and the file
service are esbuilt out of most of that tier, so almost anything in it changes a shipped byte.

## The presets a runner can actually use

`STUDIO_ENGINE_PRESET` overrides the host's default preset in
`engine/st0-tray/scripts/build-engine.mjs`, and Windows is why it exists. The dev machine builds
with `windows-msvc`, whose generator is Visual Studio 18 2026; the runner image carries Visual
Studio 2022, and a generator cannot be overridden on the command line once a preset is chosen.
`windows-msvc-2022` in `engine/st0-engine/CMakePresets.json` inherits from `windows-msvc` and
changes the generator alone, so the two stay in step.

macOS and Linux take their host default (`macos-clang`, `release-gcc`) and name it anyway, so
the matrix says out loud what each leg builds.

## The bundle each platform asks for

`tauri.conf.json` asks for `app`, which is the macOS wrapper and exists nowhere else. Windows
overrides to `nsis` and Linux to `deb` + `appimage`, through a config file rather than a flag —
`--config` takes a path, and a path is quoting-proof on every shell.

macOS keeps `app` and gets its `.dmg` from `build-engine.mjs`'s own `hdiutil` call; the reason
Tauri's dmg target is not used is in `engine/st0-tray/scripts/docs/buildEngine.md`.

`.zip` on Windows and macOS, `.tar.gz` on Linux — a `.deb` and an `.AppImage` are only useful
with their executable bit, and tar is what carries one. `engine/st0-tray/scripts/package-release.mjs`
also drops the `.app` from the macOS archive when a `.dmg` was produced: the dmg already contains
it, and shipping both doubles the download for nothing. When the dmg step fails the `.app` is what
the archive holds instead, so a flaky `hdiutil` costs a nicety rather than a release.

## Nothing is signed

The macOS `.dmg` is unsigned and unnotarised and the Windows installer is unsigned, so both warn
on first launch and macOS needs the right-click-Open path. This is not a gap in the workflow; it
is a certificate nobody has bought. The ONNX Runtime note in
`engine/st0-tray/scripts/docs/buildEngine.md` is the sharp end of the same thing.

## The two limits worth knowing before reading a red run

**macOS is arm64 only.** An Intel build is one more entry in the matrix (`macos-13`, same
preset) and no other change; it is absent because nobody has asked for it, not because it is hard.

**Linux is the least walked of the three legs.** The apt list — Tauri's GTK and
appindicator set, and JUCE's ALSA/JACK/X11 set — is the part most likely to need a name added.
`NO_STRIP=true` is set for the same family of reason: `linuxdeploy` cannot strip inside its own
AppImage staging tree on the runner image.

## Running one leg by hand

Exactly what CI runs, and the reason nothing in the workflow is written in YAML that could have
been a script:

```bash
STUDIO_ENGINE_PRESET=release-gcc node engine/st0-tray/scripts/build-engine.mjs
node engine/st0-tray/scripts/package-release.mjs --stamp local
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

**The Windows leg checks out `commons` alone**, as GitHub's does. OneDev's `withSubmodules` takes
every submodule, recursively, and `st0-library`'s amp-model paths run past Windows' 260-character
limit, so that checkout fails before anything builds; nothing the build runs reads the library. The
checkout therefore takes none, and the build step's first act is `git submodule update --init
commons`, authenticated with the same `submodule-token` secret the checkout uses.

The Linux one runs in
a `node:22-bookworm` container and installs its toolchain on every run, and publishes the same
`.tar.gz` as the release — the tray's `.deb` and `.AppImage`, and the headless `st0-engine`. It keeps
a ccache, the tray's Rust `target/` and the dependency SOURCES between runs — the last through
`$STUDIO_FETCHCONTENT_DIR`, which both CMake projects fetch into when it is set — since the
third-party code is the bulk of the download and of the compile, and does not change from one night
to the next. That cache holds sources only: what CMake builds inside it depends on the preset, and
the job deletes it on its way out, failed or not. The Windows one runs on a
Windows agent through a **Remote Shell Executor**, so nothing is installed per run: Node, Git, Rust (rustup), CMake, Ninja
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
2026), exactly as the machine does by hand. `windows-msvc-2022` is for GitHub's runner only: on an
agent without VS 2022 its generator is "could not find any instance of Visual Studio".

**build android app** keeps the same cadence — nightly at 02:00, skipped on a day without commits —
and publishes a debug-signed APK (`engine/st0-engine/docs/android.md`). It is a native build of the
same weight, so it is paid for on the same schedule. Its SDK is pinned and cached, and its C++ goes
through its own ccache and its own sources cache — its own because it builds them for arm64.
