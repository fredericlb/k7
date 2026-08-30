# Releasing the desktop app

`.github/workflows/desktop-release.yml` builds `apps/st0-desktop` for Linux, Windows and
macOS and publishes the three artifacts. This page is the choices behind it; what the build
DOES is `apps/st0-desktop/scripts/docs/buildEngine.md`.

It is the only workflow that compiles `engine/moteur`. `.github/workflows/st0.yml` runs on
every push and deliberately does not: JUCE, Tracktion, Faust and Eigen are fetched and built
from source, which is tens of minutes per platform and buys a push nothing.

## Two channels, one pipeline

| channel | trigger | tag | assets |
|---|---|---|---|
| snapshot | every commit on `master` | `snapshot`, moved | `studio-capot-snapshot-<platform>.<ext>` |
| release | a `vX.Y.Z` tag | that tag | `studio-capot-<version>-<platform>.<ext>` |

A manual run on any other branch builds the three artifacts and attaches them to the run
WITHOUT publishing: the `snapshot` release names master, and a branch that quietly took it
over would be a download claiming to be something it is not.

A snapshot is **deleted and recreated**, tag included, rather than having its assets
overwritten. Two reasons, and both are about what a downloader gets: the tag has to follow
`master` or the release page names a commit that is not what you are downloading, and an asset
left over from a previous commit — a platform whose build failed, a target since removed —
would sit beside the new ones with nothing to say it is older. A snapshot that mixes two
commits is worse than no snapshot.

The **asset names carry no version in the snapshot channel**, so the URL of "the current
Linux build" never moves; a release names its version, because there several exist at once.

The version is computed **once**, in the `stamp` job, and stamped into
`apps/st0-desktop/package.json` on each runner: electron-builder reads it from there, and it
is what names every artifact. A snapshot is `0.0.0-snapshot.<sha>` — a real semver, which
electron-builder requires, and one that sorts below every released version.

Only `v[0-9]+.[0-9]+.[0-9]+` triggers a release. A `v1.2` or a `v1.2.3-rc1` builds nothing:
the tag maps one-to-one onto the version electron-builder is given, and a mapping with
exceptions is one nobody remembers at the moment they cut a tag.

## Three runners, and no cross-compilation

There is no matrix entry that could be merged into another. The engine is native code against
the platform's audio API (WASAPI/ASIO, CoreAudio, ALSA), and `stage.mjs` vendors a Node build
and prunes onnxruntime's bindings **for the host it runs on**. A cross-built artifact would
carry the wrong half of both.

macOS is **arm64 only** — that is what `macos-latest` is. An Intel artifact is a second runner,
a second vendored Node and a second onnxruntime binding, and nothing asks for one yet.

Windows uses the `windows-msvc-2022` preset rather than `windows-msvc`. The two differ in one
line: the runner image carries Visual Studio 2022, and `windows-msvc` selects the VS 18 2026
generator. It is a preset and not a flag because a generator cannot be overridden on the
command line once a preset is chosen; it inherits `windows-msvc` so nothing else can drift.

`fail-fast` is off. One platform failing is one artifact missing, not a reason to throw away
the two that built.

## Nothing is signed

No certificate exists in this repo, so the macOS app is unsigned and unnotarised and the
Windows installer is unsigned. `CSC_IDENTITY_AUTO_DISCOVERY: "false"` is set explicitly for
the same reason `identity: null` sits in `apps/st0-desktop/electron-builder.yml`:
electron-builder signs by default when a Developer ID is discoverable, and a PARTIAL signature
— app signed, vendored node and `st0-engine` not — produces a build that launches, shows a
window and never starts an engine.

What this costs the person downloading is a Gatekeeper prompt on macOS and a SmartScreen
warning on Windows.

## The caches

Two, and they are keyed on different things because they go stale for different reasons.

**The engine build tree** is keyed on the CMake inputs alone, so it is written once and then
only restored. Our own `.cpp` files still recompile — git gives them fresh timestamps — while
the fetched third parties do not. It is a large entry and the three platforms share one
repository budget, so eviction is expected; a miss is a cold build, which is the price of the
cache not being there rather than a failure.

**The vendored runtimes** — Electron's download and the Node `stage.mjs` fetches — are keyed
on what pins them, the desktop app's `package.json` and `stage.mjs` itself. Both are verified
where they are used: `stage.mjs` checks the Node archive against the release's own
`SHASUMS256.txt`, and a cached archive that fails is deleted rather than refused.

## What the runner has to be told

Linux needs JUCE's development packages installed — ALSA, X11, freetype, fontconfig, curl,
webkit2gtk — plus `ninja-build` for the preset's generator and `fakeroot` for the `.deb`
target. Every one of them is a configure or link error, so the list only grows when the
engine's own dependencies do.

macOS gets `ninja` from Homebrew; `cmake` is already in the image.

Every step runs under **bash**, on Windows too. `wsl.md` says why PowerShell is not used
against this repo's text, and a per-platform shell would mean a step that works on two
platforms failing on the third for reasons that have nothing to do with the build.
