# AGENTS.md — moteur

A **headless audio server** in C++. Receives a compiled `ProjectDoc` JSON, diffs it
against the current state, applies the minimal change to a Tracktion Engine edit, plays
audio, and pushes transport/meter state back over WebSocket. **Never parses song files.**

It is deliberately its own app rather than part of st0: it serves every audio app in
the repo. Three drive it today — st0, the médiathèque's module previews and m9's decks —
over the same protocol, on the same binary, and it cannot tell them apart: it only ever sees
a compiled `ProjectDoc`. They stay out of each other's way by naming a **session**; see
`docs/protocol.md` and `packages/engine-protocol/docs/sessions.md`.

This workspace declares **no `build` or `test` script**, so `turbo run build` can never
try to compile C++. Use the `build:*` / `test:*` scripts below.

It does declare `dev`, and that one is not a build: it is `scripts/dev-native.mjs`, the
repo dev session's native task — watch the sources, rebuild, restart. It restarts the
**tray** too, because the tray is what holds the running engine open and no relink can
happen until it lets go. See [docs/dev.md](../../docs/dev.md).

## Architecture

The engine is split into two layers:

```
engine/                 library — the audio host (JUCE/Tracktion state lives here)
  ProjectDoc.{h,cpp}      data model mirroring the JSON on the wire
  ProjectDiff.{h,cpp}     diff() incoming doc vs current, apply() minimal change
  EngineHost.{h,cpp}      lifecycle spine — the ONLY public header (JUCE-free)
  EngineHostImpl.h         PImpl state (all JUCE state in one place)
  EngineTypes.h            small shared value types
  EditBuilder.{h,cpp}     graph build: populateEdit + track/clip/plugin/aux helpers
  PluginParams.{h,cpp}     plugin parameters as text
  PluginScan.{h,cpp}       discovery + cache
  AudioInputs.{h,cpp}      live-input device mapping
  AudioDevices.cpp          device enumerate/select + --list-audio-devices CLI
  OfflineRender.cpp         --render (offline bounce) + watchdogStack()
  ParamDump.cpp             --dump-params / --dump-params-ext / --dump-builtin-params
  PluginEditor.cpp          native plugin editor windows + PluginEditorController
  Recording.cpp             arming, takes, transport record listener
  FilePeak.cpp              one file's true peak (--peak), what a cold module is measured with
  Waveform.cpp              waveform peak data
  Warnings.{h,cpp}          the warning channel the UI shows
  MultiEditTest.cpp         N-sessions-on-one-device measurement (docs/multiEdit.md)

  built-in plugins — created by the built-in factory, not the plugin cache:
  MixerPlugin.{h,cpp}       a track's level; what a track volume BECAME
  NamPlugin.{h,cpp}         Neural Amp Modeler (docs/namPlugin.md)
  DspGraph.{h,cpp}          the DSP graph model @studio/dsp emits
  GraphDspPlugin.{h,cpp}     that graph as an audio plugin
  MidiGraphPlugin.{h,cpp}    the MIDI-side counterpart
  FaustPlugin.{h,cpp}       the same seam for a module written in Faust — A STUB: it receives the
                            source and passes audio through (docs/faust.md)
  AirWindowsList.h          generated effect list (docs/airWindowsList.md)

  taps — pull state out of the running graph without owning it:
  BroadcastTap.h + BroadcastTapPlugin.{h,cpp}   master audio over the wire (docs/broadcast.md)
  WaveformTap.h + WaveformTapPlugin.{h,cpp}     peak data while playing
  InputTuner.{h,cpp}                            pitch detection on inputs (docs/inputTuner.md)

server/
  main.cpp               WebSocket server (IXWebSocket) wiring JSON → EngineHost

scripts/               Node harnesses that drive a running engine, not build steps
  two-sessions.ts        two sessions on one engine stay separate
  track-delta.ts         `tracks` amends the document a session holds, and refuses the rest
  list-sessions.ts       what the supervisor sees, and drop-session
  broadcast-sessions.mjs per-session streaming
  gen-builtin-params.mjs ask a real instance of every built-in what its parameters are, and write
                         packages/song/src/builtinParams.generated.ts. The one script here that is a
                         GENERATOR: run it after bumping Tracktion or adding a built-in, and commit
                         its output. `npm run gen:builtin-params --workspace moteur`. docs/builtinParams.md.
  listen-headless.mjs    a headless listener
  measure-broadcast.mjs  the numbers behind docs/broadcast.md
  render-once.ts         one offline render
```

Long-form rationale is in `docs/`: `design.md` (pipeline + threading), `engineHost.md`,
`protocol.md` (the wire), `sessions.md` (this side: who may create one, what the registry's
lock protects, when a session is reaped) with its TypeScript half in
`packages/engine-protocol/docs/sessions.md`, `multiEdit.md`, `broadcast.md`, `cliModes.md`,
`audit-stabilite.md` (the standing audit of this engine's own stability and speed — read it
before touching the audio callback, `applyFull`, or the build flags),
`builtinParams.md`, `namPlugin.md`, `faust.md` (what `FaustPlugin` does NOT do yet, and the
three ways to fill it in — read it before assuming a Faust module makes a sound),
`sidechain.md` (a module's second input),
`audioDevice.md` (which interface is opened, who remembers the choice, and what an
interface change does to the live inputs),
`inputTuner.md`, `airWindowsList.md` and `airwindows-inventaire.md`.

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
missing plugin must warn, not crash. Plugin scanning is a separate CLI path — the engine's
own `scan` subcommand (`studio-moteur scan`, `scan --force` to start over), which writes
`~/.studio/exts.json`.

**Add the description to `knownPluginList` before you create it**, on whichever engine is
about to. `createNewPlugin` keeps none of what you hand it: `initialiseFully` looks the plugin
up again in `PluginManager::knownPluginList` and instantiates *nothing* when that search comes
back empty. Our scan writes `exts.json` and never touches Tracktion's list, and no plugin list
is persisted in `Settings.xml` — so on a fresh engine it is empty, and the omission fails every
external plugin at once. It is a one-liner, and it does not announce itself: Tracktion's
`getLoadError()` answers "there is no instance" with `ERROR! - This plugin couldn't be loaded!`,
which reads as a licence or a bad install and sends you to the plugin vendor. `EditBuilder` and
`ParamDump` both do it; a third creation site must too.

**A CLI must drain the message queue before it returns.** `~ExternalPlugin` frees no plugin: it
hands the instance to Tracktion's `AsyncPluginDeleter`, which parks it and starts a 100 ms
`juce::Timer`, one instance freed per fire. The server and the tray run a message loop, so that
timer fires. A CLI runs none — so the instances are still alive when JUCE's `DeletedAtShutdown`
tears the deleter down and it drains them itself, mid-shutdown, and the process dies of a SIGSEGV
*after* printing a correct answer. Intermittent, load-dependent, and worse than a plain failure:
`execFileSync` raises on the exit code, so the caller throws away a dump it already has. One
`runDispatchLoopUntil` before returning is the whole fix — `ParamDump.cpp` and
`OfflineRender.cpp`'s `drainMessageQueue` both do it.

Note what that is *not*. **Creating** a plugin needs no pump here:
`VST3PluginFormat::requiresUnblockedMessageThreadDuringCreation` returns false in this JUCE, so
`ExternalPlugin::requiresAsyncInstantiation` is false and the instance is built synchronously on
the calling thread — LADSPA the same, and AudioUnit is the only format that ever answers yes.
An empty `--dump-params-ext` is the `knownPluginList` omission above, never an async one. The
pump-during-creation theory reads convincingly and is wrong — check what
`requiresAsyncInstantiation` actually returns for the format in hand before designing around it.

### .vstpreset

Uses JUCE's `VST3PluginFormat::setStateFromVSTPresetFile` and the `ExtensionsVisitor`
VST3 client to write the Steinberg container. Text params fully reproduce a plugin's
state where possible; `.vstpreset` is the fallback for plugins that need opaque state.

**Read one through `EditBuilder::loadVstPreset`, never `setStateInformation`.** A `.vstpreset`
is a Steinberg *container* — header, class id, chunk offsets — and `setStateInformation` wants
JUCE's own VST3 state format, so handed the raw file it takes none of it and returns `void`.
There is nothing to test and no error to print: the plugin keeps its defaults and every caller
downstream believes them. `--dump-params-ext` did that, and reported `complete: true` on the
defaults it never replaced, which told the translator to drop the musician's preset.

And expect `complete: false` from the big commercial instruments once a preset really loads.
Their patch is not in their automatable parameters — an Arturia Wurli V2 reports the same 50
values loaded from a preset as untouched, Mini V3 the same 77, checked against the JUCE
`AudioProcessorParameter`s and not just Tracktion's cache. That is the flag working: keep the
`.vstpreset`.

## Building

**macOS** — `npm run build:mac --workspace moteur`. Drives the `macos-clang`
preset (Ninja + AppleClang, RelWithDebInfo, native arm64). Needs `brew install cmake
ninja`. Sanity check: `./build/macos-clang/studio-moteur --list-audio-devices`.

**Windows** — `npm run build:win --workspace moteur`. Needs the MSVC toolchain. The .exe is
often locked while the engine is running — stop it before rebuilding.

> **This engine COMPILES on the dev machine, and quickly. Do not claim otherwise — check.**
>
> The mistake has been made more than once: an agent assumes the C++ is out of reach ("needs
> MSVC", "the build is long"), declines the task, and hands back a plan instead of a change.
> Every part of that assumption is wrong here. The MSVC BuildTools are installed; `cl.exe` is
> not on `PATH`, which is **normal** — CMake finds it through the toolchain, so its absence
> proves nothing. `build/windows-msvc` is already configured with JUCE and Tracktion fetched,
> so an incremental build is about a second:
>
> ```
> cmake --build --preset windows-msvc
> ```
>
> There is a real verification loop, and it should be run on every engine change: that build,
> then the FOUR test suites (see Tests below — every one of them must be NAMED to be built, and
> `studio_session_tests` is the one this line used to forget), then a
> CLI smoke run. What is genuinely NOT possible here is *listening*: a render can be measured,
> never judged. Say that limit, and stop there — not one step earlier.

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
presets pin `"targets": ["studio-moteur"]`, so `studio_engine_tests` / `studio_session_tests` /
`studio_midigraph_tests` / `studio_dspgraph_tests` are only built when named. One of them had
referenced a `TrackDoc::volume` that was removed when a track's level became a mixer module,
and nothing reported it for as long as that took. Build them explicitly after touching the
data layer — **all four**, or `ctest` reports the missing one as "Not Run", which reads as a
failure:

```
cmake --build build/<preset> --config RelWithDebInfo --target \
      studio_engine_tests studio_session_tests studio_midigraph_tests studio_dspgraph_tests
ctest --test-dir build/<preset> -C RelWithDebInfo -R 'studio_' --output-on-failure
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
its **own** `%APPDATA%/Studio/Settings.xml`, unless the `EngineBehaviour` says not to.
Both engines here say not to (`ServerBehaviour`, `HeadlessBehaviour`). Do not undo that,
and do not construct a `te::Engine` anywhere without one.

Why it matters, measured the hard way:

* **An ASIO driver is single-client.** A remembered device gets reopened by *every*
  process that constructs an engine — a render, a freeze, a param dump — so any of them
  running beside the live engine collides with it. The driver then stays wedged, and
  from that point on every engine start blocks **forever, with no output at all**, which
  reads as "the tray hangs" and sends you hunting anywhere but here.
* **It was a second source of truth.** `~/.studio/preferences.yaml` holds the device
  the user chose; `Settings.xml` held a copy Tracktion wrote by itself and replayed
  first. The hidden one won, before any st0 code ran.

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
      studio::buildRenderEdit

Order matters: the hosted interface must exist **before** anything pumps, or the timer
has already fired and you are already waiting.

To confirm the machine rather than the code, from any shell:

    powershell -c "Add-Type -MemberDefinition '[DllImport(\"winmm.dll\")] public static extern uint midiInGetNumDevs();' -Name W -Namespace P -PassThru | % { $_::midiInGetNumDevs() }"

If that hangs, `midisrv.exe` is stuck and every MIDI-enumerating app on the box is too;
restarting the process clears it. The render no longer cares either way.

### Debugging a hang with no debugger

`watchdogStack()` in `OfflineRender.cpp` prints the stuck thread's symbolised stack after
N seconds and exits 3. It is gated on `STUDIO_RENDER_TRACE`, needs the RelWithDebInfo
PDBs, and is how the stack above was obtained — there is no cdb or WinDbg on these
machines, and `Wait, LpcReply` from `Get-Process` is as far as PowerShell gets you.
The same env var turns on `trace()`, the coarse progress log; start there, then reach for
the watchdog when you need to know *what* is waiting rather than *where*.
