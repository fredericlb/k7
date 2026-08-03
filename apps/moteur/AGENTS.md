# AGENTS.md — moteur

A **headless audio server** in C++. Receives a compiled `ProjectDoc` JSON, diffs it
against the current state, applies the minimal change to a Tracktion Engine edit, plays
audio, and pushes transport/meter state back over WebSocket. **Never parses song files.**

It is deliberately its own app rather than part of lanes: it serves every audio app in
the repo. lanes drives it today; mediatek's module previews and platines will drive the
same binary over the same protocol, and it cannot tell them apart — it only ever sees a
compiled `ProjectDoc`.

This workspace declares **no `build` or `test` script**, so `turbo run build` can never
try to compile C++. Use the `build:*` / `test:*` scripts below.

## Architecture

The engine is split into two layers:

```
engine/                 library — the audio host (JUCE/Tracktion state lives here)
  ProjectDoc.{h,cpp}      data model mirroring the JSON on the wire
  ProjectDiff.{h,cpp}     diff() incoming doc vs current, apply() minimal change
  EngineHost.{h,cpp}      lifecycle spine — the ONLY public header (JUCE-free)
  EngineHostImpl.h         PImpl state (all JUCE state in one place)
  EditBuilder.{h,cpp}     graph build: populateEdit + track/clip/plugin/aux helpers
  PluginParams.{h,cpp}     plugin parameters as text
  PluginScan.{h,cpp}       discovery + cache
  AudioInputs.{h,cpp}      live-input device mapping
  AudioDevices.cpp          device enumerate/select + --list-audio-devices CLI
  OfflineRender.cpp         --render (offline bounce)
  ParamDump.cpp             --dump-params / --dump-params-ext
  PluginEditor.cpp          native plugin editor windows + PluginEditorController
  Recording.cpp             arming, takes, transport record listener
  NormalizeClips.cpp        clip normalisation
  Waveform.cpp              waveform peak data

server/
  main.cpp               WebSocket server (IXWebSocket) wiring JSON → EngineHost
```

## Key concepts

### ProjectDoc and ProjectDiff

`ProjectDoc` is the plain data model the song layer sends (tracks, clips, MIDI notes,
plugins, sends). It must mirror `@studio/song`'s `ProjectDoc` (TypeScript) and the
JSON on the wire (`@studio/engine-protocol`).

`ProjectDiff` does the smart work: `diff()` the incoming doc against the current one and
`apply()` the minimal change. `keyOf(...)` identity and `needsFullRebuild()` decide
incremental-vs-rebuild. A full rebuild is the safe fallback for plugin add/remove/param
changes. Getting identity wrong means a changed plugin/param silently keeps the old one.

### EngineHost

`EngineHost.h` is the **only public header** and is JUCE-free (forward-decls only), so
`server/main.cpp` compiles against it without seeing JUCE. `EngineHost.cpp` is the
lifecycle spine: ctor/dtor, project apply/reset, transport, metering, and the
server-support loop (post/onState/run/quit). All JUCE state stays in `struct
EngineHost::Impl` (`EngineHostImpl.h`).

### Threading

The audio thread must not block or allocate. Marshal work to the message thread with
`EngineHost::post(...)`. See `docs/design.md` for the full threading model.

### External plugins

Created via the plugin cache (`scanInstalledPlugins` → find by name+format →
`createNewPlugin(ExternalPlugin::xmlTypeName, desc)`), not the built-in factory. A
missing plugin must warn, not crash. Plugin scanning is a separate CLI path (`lanes
engine scan`).

### .vstpreset

Uses JUCE's `VST3PluginFormat::setStateFromVSTPresetFile` and the `ExtensionsVisitor`
VST3 client to write the Steinberg container. Text params fully reproduce a plugin's
state where possible; `.vstpreset` is the fallback for plugins that need opaque state.

## Building

**macOS** — `npm run build:mac --workspace moteur`. Drives the `macos-clang`
preset (Ninja + AppleClang, RelWithDebInfo, native arm64). Needs `brew install cmake
ninja`. Sanity check: `./build/macos-clang/studio-moteur --list-audio-devices`.

**Windows** — `npm run build:win --workspace moteur`. Needs the MSVC toolchain. The .exe is
often locked while the engine is running — stop it before rebuilding.

**Linux** — a preset from `CMakePresets.json` (`dev-gcc`, `dev-clang`, `asan`,
`release-gcc`). First configure fetches JUCE + Tracktion (~hundreds of MB). Needs CMake
≥ 3.24, C++20, and the JUCE Linux dev deps.

Build gotchas:
- The macOS deployment target must be re-asserted **after** Tracktion's
  `FetchContent_MakeAvailable` forces 10.13.
- Tracktion pins JUCE as an SSH submodule — the top-level `CMakeLists.txt` rewrites to
  HTTPS via `GIT_CONFIG_*` env vars.
- The ASIO SDK is fetched at configure time and is REQUIRED on Windows.
- Presets pin `"targets": ["studio-moteur"]` — don't switch to all-targets.
- `<windows.h>` must precede `<shellapi.h>` with `NOMINMAX` + `WIN32_LEAN_AND_MEAN`.

## Tests

**The test targets are not built by an ordinary build, and that hid a broken one.** The
presets pin `"targets": ["studio-moteur"]`, so `lanes_engine_tests` /
`lanes_midigraph_tests` / `lanes_dspgraph_tests` are only built when named. One of them had
referenced a `TrackDoc::volume` that was removed when a track's level became a mixer module,
and nothing reported it for as long as that took. Build them explicitly after touching the
data layer:

```
cmake --build build/<preset> --target lanes_engine_tests --config RelWithDebInfo
ctest --test-dir build/<preset> -C RelWithDebInfo -R 'lanes_' --output-on-failure
```

`npm run test:mac --workspace moteur`. Covers the **JUCE-free data layer
only** — `tests/ProjectDiff_test.cpp` exercises `diff()`/`needsFullRebuild()` (rename
not re-add, param drag stays incremental, plugin swap forces rebuild, removals before
adds, …). Tiny hand-rolled harness (`tests/test_harness.h`, `CHECK`/`RUN`). Anything
needing a live `te::Edit` is covered by CLI smoke-runs instead.

## Verify

Build it, run it, exercise it. The test binary is the cheapest unit proof; CLI
smoke-runs (`--list-audio-devices`, `--dump-params`, `--render`) are the integration
proof. A wire change in `@studio/engine-protocol` must also update the C++
serialization — verified by running the engine, not by TypeScript.

## The audio device is opened ONCE, explicitly — never by a constructor

`te::Engine`'s constructor restores whatever audio device Tracktion last persisted in
its **own** `%APPDATA%/Lanes/Settings.xml`, unless the `EngineBehaviour` says not to.
Both engines here say not to (`ServerBehaviour`, `HeadlessBehaviour`). Do not undo that,
and do not construct a `te::Engine` anywhere without one.

Why it matters, measured the hard way:

* **An ASIO driver is single-client.** A remembered device gets reopened by *every*
  process that constructs an engine — a render, a freeze, a param dump — so any of them
  running beside the live engine collides with it. The driver then stays wedged, and
  from that point on every engine start blocks **forever, with no output at all**, which
  reads as "the tray hangs" and sends you hunting anywhere but here.
* **It was a second source of truth.** `~/.lanes/preferences.yaml` holds the device
  the user chose; `Settings.xml` held a copy Tracktion wrote by itself and replayed
  first. The hidden one won, before any lanes code ran.

So: offline tools open no device (`makeOfflineEngine`), the server opens one from
`openAudioDevice()` after the port is bound, and `Settings.xml` is inert state nobody
reads. The check that this still holds: put a `deviceType="ASIO"` `Settings.xml` in
place, start the engine, and see the port bind in milliseconds.

A related trap this cost an evening: when a render hangs, it is silent — no line is
printed, and the process burns no CPU. "It prints nothing" is not "it is slow"; it is a
wait. Test the two apart before theorising, and never call an explanation confirmed on a
correlation alone (a wedged driver stays wedged after its second client is gone, so
"it still hangs with nothing else running" does NOT clear device contention).

## An offline render enumerates no hardware — MIDI included

`makeOfflineEngine` does two things, and the second one is not obvious. After building a
headless engine it also initialises Tracktion's `HostedAudioDeviceInterface` with
`useMidiDevices = false`, for one side effect: `DeviceManager::usesHardwareMidiDevices()`
turns false, so the MIDI rescan timer stops enumerating the machine's ports.

That timer only fires while something pumps the message loop — and the render pumps it
once, deliberately, so `SamplerPlugin` can finish building its sounds. The pump runs the
timer, the timer calls `juce::MidiInput::getAvailableDevices()`, and that is an **RPC into
`midisrv.exe`**. When the Windows MIDI service is wedged the call never returns, in any
process on the machine. Measured stack, from a render that had produced no output for
three minutes at zero CPU:

    midiInGetNumDevs -> NdrClientCall3 -> NtAlpcSendWaitReceivePort   (waiting, forever)
      juce::Win32MidiService::getAvailableDevices
      tracktion::DeviceManager::MIDIDeviceList::scanHardwareDevices
      juce::Timer::TimerThread::callTimers
      juce::MessageManager::runDispatchLoopUntil            <- the sampler pump
      lanes::buildRenderEdit

Order matters: the hosted interface must exist **before** anything pumps, or the timer
has already fired and you are already waiting.

To confirm the machine rather than the code, from any shell:

    powershell -c "Add-Type -MemberDefinition '[DllImport(\"winmm.dll\")] public static extern uint midiInGetNumDevs();' -Name W -Namespace P -PassThru | % { $_::midiInGetNumDevs() }"

If that hangs, `midisrv.exe` is stuck and every MIDI-enumerating app on the box is too;
restarting the process clears it. The render no longer cares either way.

### Debugging a hang with no debugger

`watchdogStack()` in `OfflineRender.cpp` prints the stuck thread's symbolised stack after
N seconds and exits 3. It is gated on `LANES_RENDER_TRACE`, needs the RelWithDebInfo
PDBs, and is how the stack above was obtained — there is no cdb or WinDbg on these
machines, and `Wait, LpcReply` from `Get-Process` is as far as PowerShell gets you.
The same env var turns on `trace()`, the coarse progress log; start there, then reach for
the watchdog when you need to know *what* is waiting rather than *where*.
