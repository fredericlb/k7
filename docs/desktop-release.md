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

**Linux is the newest of the three legs and the least walked.** The engine has always built
there; the tray had no packaged target before this workflow, so the apt list — Tauri's GTK and
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

`.onedev-buildspec.yml` carries a Linux leg and a Windows leg, both manual. The Linux one runs in
a `node:22-bookworm` container and installs its toolchain on every run. The Windows one runs on a
Windows agent through a **Remote Shell Executor** — named `windows`, which is what the job's
`jobExecutor` asks for — so nothing is installed per run: Node, Git, Rust (rustup), CMake, Ninja
and the Visual Studio Build Tools are the agent's, under the account its service logs on as. A
container would buy isolation at the price of MSVC in a Windows container, which is heavier than
the machine it would run on.

The preset follows the Visual Studio the agent has, for the reason the section above gives:
`windows-msvc-2022` for 2022, `windows-msvc` for 2026. Every other job in the file is a container
job and must never land on that executor, so its job match names this job and nothing else.
