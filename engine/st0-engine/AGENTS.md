# AGENTS.md — moteur

A **headless audio server** in C++. Receives a compiled `ProjectDoc` JSON, diffs it
against the current state, applies the minimal change to a Tracktion Engine edit, plays
audio, and pushes transport/meter state back over WebSocket. **Never parses song files.**

It is deliberately its own app rather than part of st0: it serves every audio app in
the repo. Three drive it — st0, the médiathèque's module previews and the DJ desk —
over the same protocol, on the same binary, and it cannot tell them apart: it only ever sees
a compiled `ProjectDoc`. They stay out of each other's way by naming a **session**; see
`docs/protocol.md` and `packages/engine-protocol/docs/sessions.md`.

This workspace declares **no `build` script**, so `npm run build --workspaces --if-present`
can never try to compile C++. Use the `build:*` / `test:*` scripts below.

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
  SendPlan.h               which bus every send lands on, decided once for the builder AND the diff — JUCE-free
  Biquad.h                 juce::IIRFilter's arithmetic without its lock, for the audio thread alone
  RecordSource.{h,cpp}     a platter's record MAPPED, or decoded once into the record cache and mapped (docs/turntable.md)
  PluginParams.{h,cpp}     plugin parameters as text
  PluginScan.{h,cpp}       discovery + cache
  AudioInputs.{h,cpp}      live-input device mapping
  AudioDevices.cpp          device enumerate/select + --list-audio-devices CLI, and the reopen of a
                            device whose callback stopped
  CallbackWatchdog.h        WHEN that reopen happens, and when it gives up: JUCE-free and header-only,
                            so tests/ has it in a FAST binary (docs/audioDevice.md)
  OfflineRender.cpp         --render (offline bounce) + watchdogStack()
  ParamDump.cpp             --dump-params / --dump-params-ext / --dump-builtin-params
  PluginEditor.cpp          native plugin editor windows + PluginEditorController
  Recording.cpp             arming, takes, transport record listener
  Recorder.cpp              the RECORDER node: free-running capture, its takes, and the state it
                            reports — transport-independent, unlike the file above (docs/recorder.md)
  FilePeak.cpp              one file's true peak (--peak), what a cold module is measured with
  Waveform.cpp              waveform peak data
  Warnings.{h,cpp}          the warning channel the UI shows
  MultiEditTest.cpp         N-sessions-on-one-device measurement (docs/multiEdit.md)

  built-in plugins — created by the built-in factory, not the plugin cache:
  MixerPlugin.{h,cpp}       a track's level; what a track volume BECAME
  TurntablePlugin.{h,cpp}   a deck that OWNS its record and reads it at a driven rate, reverse included
                            — what a clip on a timeline cannot be scratched into (docs/turntable.md)
  TurntableLoop.h           …and its LOOP: two edges, and the position a roll hands back. JUCE-free and
                            header-only, so tests/ has it in the FAST binary — the plugin around it
                            is covered by scripts/turntable.ts instead
  QuickMasterPlugin.{h,cpp} a master bus in one module: 3-band compressor, spreader, limiter
                            (docs/quickMaster.md) — what st0's `mastering` surface is a picture of
  NamPlugin.{h,cpp}         Neural Amp Modeler (docs/namPlugin.md)
  DspGraph.{h,cpp}          the DSP graph model @studio/dsp emits
  GraphDspPlugin.{h,cpp}     that graph as an audio plugin
  MidiGraphPlugin.{h,cpp}    the MIDI-side counterpart
  ArpeggiatorPlugin.{h,cpp} a chord held down, played one note at a time — the one note effect that
                            no graph can be, since it INVENTS notes rather than editing them
  Arpeggiator.h             …and its clock and walk: JUCE-free and header-only, so tests/ has it in
                            the FAST binary, like TurntableLoop.h (docs/arpeggiator.md)
  FaustPlugin.{h,cpp}       the same seam for a module written in Faust: it COMPILES the source
                            with the Faust interpreter and runs it (docs/faust.md)
  PatternPlugin.{h,cpp}     a strudel lane, played HERE: its source evaluated in QuickJS, its notes and
                            its sample one-shots locked to the transport (docs/patternPlugin.md)
  PatternSchedule.h         …and the notes between its worker and the audio thread, by epoch. JUCE-free
                            and header-only, so tests/ has it in the FAST binary
  SampleBanks.h             a sound name → the WAV it plays, by the Dirt layout. JUCE-free, FAST binary
  StrudelHost.{h,cpp}       the QuickJS runtime and the embedded bundle (strudel/strudel.bundle.js,
                            generated and committed). Its own JUCE-free library, `studio_strudel`
  AirWindowsList.h          generated effect list (docs/airWindowsList.md)
  eurorack/                 eight modules from Mutable Instruments' MIT firmware (docs/eurorack.md):
    EurorackPlugin.{h,cpp}    the Tracktion side they share — params, the MIDI cut, the sidechain pair
    RateBridge.{h,cpp}        host rate and blocks ↔ a core's FIXED rate and block, with Tracktion's
                              own libsamplerate; a processor's latency is measured, then reported
    EurorackList.h            the eight, once: PluginScan.cpp expands it into the catalogue AND the
                              registrations, as AirWindowsList.h does
    VoiceAllocator.h, Adsr.h  voices and envelopes: JUCE-free and header-only, FAST binary
    cores/                    one per module, JUCE-free with a pimpl: stmlib #defines NULL and CLIP,
                              so a firmware header never shares a TU with JUCE. `studio_eurorack`
    patches/eurorack.cmake    the upstream bug fixed at fetch time (Clouds' silent stretch mode)
    patches/stmlib.cmake      …and stmlib's: utils/dsp.h's GCC-only __attribute__, which MSVC rejects
  patches/faust.cmake       Faust's poly-dsp.h prints on the audio thread at every voice steal; silenced at fetch time
  patches/tracktion.cmake   Tracktion's SamplerPlugin re-decoded every rack sound on any edit, twice, once under the audio lock
    <Name>Plugin.{h,cpp}      named mu-<module>: MacroOscillator2 = mu-plaits, MacroOscillator =
                              mu-braids, Resonator = mu-rings, ModalSynthesizer = mu-elements,
                              TidalModulator = mu-tides (Tides 2), DrumVoices = mu-peaks,
                              TextureSynthesizer = mu-clouds, MetaModulator = mu-warps

  taps — pull state out of the running graph without owning it:
  BroadcastTap.h + BroadcastTapPlugin.{h,cpp}   master audio over the wire (docs/broadcast.md)
  RecorderTap.h + RecorderPlugin.{h,cpp}        a NODE's capture — the same shape, except that an
                                                overrun is COUNTED rather than forgiven, since a
                                                take that is silently short is a take you trust
                                                (docs/recorder.md); RecorderNode.h is one node's state
  WaveformTap.h + WaveformTapPlugin.{h,cpp}     peak data while playing
  InputTuner.{h,cpp}                            pitch detection on inputs (docs/inputTuner.md)

server/
  main.cpp               the executable: the CLI's one-shot modes, else serve()
  Serve.{h,cpp}          WebSocket server (IXWebSocket): the socket's lifecycle, the state frame, shutdown
  ServeContext.h         what every handler shares — the host, the two broadcast verbs, who listens and drives
  ServeProject.cpp       the messages about ONE project: document, transport, auditions, recording
  ServePlugins.cpp       …about plugins: the catalogue and its scan, instances, windows, presets, watches
  ServeMachine.cpp       …about the machine: the audio stream, sessions, the interface, identity
  AudioSender.{h,cpp}    the audio broadcast's own thread and wire frame (docs/broadcast.md)
  Outbox.h               every JSON push, sent from ONE writer thread so the message thread never waits on a peer
  DocJson.{h,cpp}        the ProjectDoc off the wire, shared by the server and the CLI
  android/EngineJni.cpp  the Android app's entry into serve() (docs/android.md)

scripts/               Node harnesses that drive a running engine, not build steps
  two-sessions.ts        two sessions on one engine stay separate
  track-delta.ts         `tracks` amends the document a session holds, and refuses the rest
  list-sessions.ts       an engine's sessions, and drop-session, over the control socket
  broadcast-sessions.mjs per-session streaming
  gen-strudel-bundle.mjs bundle @studio/song-strudel's engineEntry.ts into engine/strudel/strudel.bundle.js,
                         the script PatternPlugin runs. A GENERATOR, output committed: run it after
                         touching events.ts or engineEntry.ts. `npm run gen:strudel-bundle --workspace st0-engine`.
  gen-builtin-params.mjs ask a real instance of every built-in what its parameters are, and write
                         packages/song-schema/src/builtinParams.generated.ts. A GENERATOR, like the one
                         above: run it after bumping Tracktion or adding a built-in, and commit
                         its output. `npm run gen:builtin-params --workspace st0-engine`. docs/builtinParams.md.
  warp-points.ts         a clip's INTERIOR warp points move the sound — rendered and measured,
                         since this is timing no TypeScript test can see (docs/warp.md)
  pad-effects.ts         a sequencer pad's `repeat` and `skip` reach the sound — same kind of
                         proof, counting hits per pass (@studio/song docs/padEffects.md)
  quick-master.ts        what QuickMasterPlugin claims about a SOUND, rendered and measured:
                         the ceiling really is a ceiling, width 0 really is mono, and the
                         three bands really sum back flat. The only coverage that plugin has —
                         it needs a live te::Edit, which the four C++ suites build none of
                         (docs/quickMaster.md)
  send-one.ts            compile a project folder and push it at a running engine, once. The
                         smallest repro of "the file service sent a document", for when the
                         browser is not the thing under test
  listen-headless.mjs    a headless listener
  measure-broadcast.mjs  the numbers behind docs/broadcast.md
  render-once.ts         one offline render
  turntable.ts           does the PLATTER follow a hand? A constant tone is an exact tachometer under a
                         varispeed, which is why its source is not the clip bench's (docs/turntable.md)
  turntable-latency.ts   …and does it follow SOON? Steps the rate at a known moment; the answer's SHAPE —
                         a spread of one block — is what says the engine adds nothing to it
  turntable-loop.ts      …and does it LOOP, and does a roll hand the record back? The source's AMPLITUDE
                         ramps with time, so the level READS the position: a loop turns the ramp into a
                         sawtooth and a roll's release is a step. `--key` runs it through the stretcher,
                         the path where read-ahead and heard are different numbers (docs/turntable.md)
  keylock.ts             …and does KEY hold the PITCH while the tempo moves? A tone has no tempo and a
                         stretcher would leave it alone, so the source is a tone CHOPPED into bursts:
                         the carrier is the pitch, the interval is the tempo (docs/turntable.md)
  platterBench.ts        what those three share — the wav, the one-platter document, the broadcast
                         frames and the FFT. Not a bench: a second copy of an FFT is a second place
                         for a windowing bug to hide
  nam-rate.ts            does a NAM model sound as trained on an engine at ANOTHER rate? Offline: one
                         sawtooth through one model at its own rate and at another, and the harmonic
                         profiles compared — the only coverage the plugin's resampling has (docs/namPlugin.md)
  nam-ir.ts              does a NAM module's cabinet IR reach the SOUND, and is it the IR named? The change
                         at each harmonic against the IR's own response there (docs/namPlugin.md)
  eurorack-stop.ts       does a Mutable Instruments module let go of a held note on a stop and on a
                         panic? The level a second after each, against the level while it plays —
                         the only coverage `EurorackPlugin::midiPanic` has (docs/panic.md)
  cue-bus.ts             the two facts a CUE bus rests on, neither visible to a unit test: how many
                         destinations a source may have and still be heard only through them, and
                         whether `outputChannels` really takes a track off the mixdown (docs/cueOutput.md)
```

Long-form rationale is in `docs/`: `design.md` (pipeline + threading), `engineHost.md`,
`protocol.md` (the wire), `sessions.md` (this side: who may create one, what the registry's
lock protects, when a session is reaped) with its TypeScript half in
`packages/engine-protocol/docs/sessions.md`, `multiEdit.md`, `broadcast.md`, `cliModes.md`,
`audit-stabilite.md` (the standing audit of this engine's own stability and speed — read it
before touching the audio callback, `applyFull`, or the build flags),
`builtinParams.md`, `namPlugin.md`,
`quickMaster.md` (why that one is compiled rather than a `jsdsp` graph, the allpass the three-way
split needs, and what its ceiling really guarantees),
`faust.md` (the interpreter factory, the polyphonic seam, and the one question left open),
`patternPlugin.md` (why the engine plays pattern lanes, why QuickJS, how a file's events are shared
between its lanes, samples, the epoch rule, the offline-render path, and what is not yet proven),
`dspGraph.md` (the graph model `@studio/dsp` emits, and the three places the audio thread is kept
from allocating — read it before adding a node kind),
`sidechain.md` (a module's second input),
`warp.md` (a clip's stretch map: which half is auto-tempo and which is the warp map, and why loop
points cannot carry the points in between — read it before touching `applyClipWarp`),
`clipIdentity.md` (a clip is named by its PLACEMENT id, never its material — read it before
inserting or removing a clip, since a fourth site that spells the rule again will get it wrong),
`projectDiff.md` (what goes into a plugin's identity, what re-inserts a clip, and the two cases that
force a full rebuild — every rule there exists because leaving it out produced an EMPTY diff),
`meterClients.md` (level measurers and their clients: reading one CLEARS it, output meters die with
the Edit and input ones do not, and why `inputClients` is keyed by device name),
`audioDevice.md` (which interface is opened, who remembers the choice, and what an
interface change does to the live inputs),
`cueOutput.md` (a track routed OFF the mixer's sum onto a second pair — why an absent pair must be
silent rather than folded back, and why a mixdown had to learn to exclude it),
`eurorack.md` (the eight firmware modules: which ones and why not the rest, the fixed block every
core needs, the resampler and the latency it reports, and each module's choices),
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
`server/` compiles against it without seeing JUCE. `EngineHost.cpp` is the
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
own `scan` subcommand (`st0-engine scan`, `scan --force` to start over), which writes
`<state>/exts.json`.

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
downstream believes them. A dump that goes through `setStateInformation` reports `complete: true`
on defaults it never replaced, and the translator drops the musician's preset on that word.

And expect `complete: false` from the big commercial instruments once a preset really loads.
Their patch is not in their automatable parameters — an Arturia Wurli V2 reports the same 50
values loaded from a preset as untouched, Mini V3 the same 77, checked against the JUCE
`AudioProcessorParameter`s and not just Tracktion's cache. That is the flag working: keep the
`.vstpreset`.

## Building

**macOS** — `npm run build:mac --workspace st0-engine`. Drives the `macos-clang`
preset (Ninja + AppleClang, RelWithDebInfo, native arm64). Needs `brew install cmake
ninja`. Sanity check: `./build/macos-clang/st0-engine --list-audio-devices`.

**Windows** — `npm run build:win --workspace st0-engine`. Needs the MSVC toolchain. The .exe is
often locked while the engine is running — stop it before rebuilding.

> **This engine COMPILES on the dev machine, and quickly. Do not claim otherwise — check.**
>
> Never decline an engine change on the grounds that the C++ is out of reach — "needs MSVC",
> "the build is long" — and hand back a plan. The MSVC BuildTools are installed; `cl.exe` is
> not on `PATH`, which is **normal** — CMake finds it through the toolchain, so its absence
> proves nothing. `build/windows-msvc` is already configured with JUCE and Tracktion fetched,
> so an incremental build is about a second:
>
> ```
> cmake --build --preset windows-msvc
> ```
>
> Run the whole verification loop on every engine change: that build, then the FOUR test suites
> (see Tests below — every one of them must be NAMED to be built), then a CLI smoke run. What is
> genuinely NOT possible here is *listening*: a render can be measured, never judged. Say that
> limit, and stop there — not one step earlier.

**Linux** — a preset from `CMakePresets.json` (`dev-gcc`, `dev-clang`, `asan`,
`release-gcc`). First configure fetches JUCE + Tracktion (~hundreds of MB). Needs CMake
≥ 3.24, C++20, and the JUCE Linux dev deps.

**Android** — `npm run build:android --workspace st0-engine` with `ANDROID_NDK_HOME` set to an NDK
r28+, or let the app build it: `./gradlew assembleDebug` in `engine/st0-android`, which passes the
SDK's own NDK — it builds the supervisor's `android-arm64` preset too. The engine's makes
`libst0engine.so`, a library the app loads, with no `main()`, no VST3/LADSPA and no tests. What differs there and why: [docs/android.md](docs/android.md).

### A half-rebuilt engine now REFUSES to start — it used to crash on the first project

An interrupted Windows build — the dev watcher restarting mid-compile, a PDB collision (the
`C1041` that `/FS` below exists to prevent) — can leave `studio_engine.dir/RelWithDebInfo` with **some** objects
compiled against the new `ProjectDoc.h` and some against the old one. It still links: the struct is
a layout, not a symbol, so nothing in the toolchain objects to a mismatch.

What it does is add a field's worth of offset to everything after it. `tracks` is the LAST member of
`ProjectDoc`, so *any* field inserted above it moves it, and a stale translation unit reads
`doc.tracks` off the end of the struct: a garbage `std::vector`, and an access violation the moment
something walks it — typically `keyOf`, on the first project the engine is handed. The tray then
sits in a two-second `engine is gone — relaunching` loop and no project can ever be played. Nothing
in the log names the engine as the culprit; `installCrashHandler` (below) is what does.

**`main()` now checks this before anything else.** `modelLayoutHere()` in `ProjectDoc.h` is a
number built out of the model's `sizeof`s; `modelLayoutInDiff()` and `modelLayoutInBuilder()` are
that same inline function compiled into `ProjectDiff.cpp` and `EditBuilder.cpp`, so a **stale
object answers with the layout it was built against**. Disagreement means half a rebuild, and the
engine says so and exits 4 instead of dying later in `keyOf`:

```
[fatal] this engine is HALF REBUILT: ProjectDoc has a different layout in different objects
        (server=… diff=… builder=…).
```

Two readers rather than one, because the seam is not only lib-versus-server: `ProjectDiff.obj`
stale beside a fresh `EditBuilder.obj` is the same disease and a single stamp would miss it. It is
not exhaustive — a TU that reads no document is not asked — but it covers the two that walk
`doc.tracks`, which is where the corruption lands.

The cost of missing it is what earns the check: a two-second `engine is gone — relaunching` loop
with a `bad_alloc` stack that names `keyOf`, three wrong diagnoses in a row (a project file, then
the file service's link, then system memory), and an evening. The build was interrupted by
triggering a second one while the first held `EditBuilder.cpp` open — an `EPERM` on a write is
the tell, and it is worth stopping for.

To confirm by hand, compare object mtimes against the header — and note that "it rebuilt when I
touched the header" only proves the tlogs are healthy *now*:

```powershell
$h = (Get-Item engine/ProjectDoc.h).LastWriteTime
Get-ChildItem build/windows-msvc/engine/studio_engine.dir/RelWithDebInfo -Filter *.obj |
  Where-Object LastWriteTime -lt $h
```

The cure is to delete the objects for **our own** sources — not JUCE's or Tracktion's, which include
none of our headers and cost minutes — and rebuild:

```powershell
$srcs = (Get-ChildItem engine -Filter *.cpp).BaseName
Get-ChildItem build/windows-msvc/engine/studio_engine.dir/RelWithDebInfo -Filter *.obj |
  Where-Object { $srcs -contains $_.BaseName } | Remove-Item
```

### On MSVC a project's files compile in PARALLEL — `/MP`, set in `CMakeLists.txt`

The presets build with the **Visual Studio generator**, not the Ninja the other platforms inherit,
and MSBuild runs `cl.exe` once per file. Nothing noticed while the only target anyone built was
`st0-engine`, whose own TUs are few. The test suites are where it bit: `studio_midigraph_tests`
and `studio_dspgraph_tests` each link Tracktion themselves — with their own defines, so they can
share nothing with `studio_engine` — and JUCE's CMake compiles its modules INTO each target that
links them. That is **30 translation units and 565 MB of objects per binary**, twice, for two
executables that run in 0.02 s. Serially, on one core of twelve.

Measured here, one target cold, same machine:

| | `studio_dspgraph_tests`, from no objects |
|---|---|
| before | **201 s** |
| with `/MP` | **70 s** |

The floor is the longest single TU, and no flag moves it: JUCE and Tracktion modules are unity
builds, so there are only 30 chunks and they are wildly uneven. 68 of those 70 seconds are the
compile phase — link and MSBuild overhead are noise.

**`/FS` is set beside it, and is not optional.** Several `cl.exe` now write one `.pdb`, and
without it they collide as `C1041` — which does not fail cleanly: it leaves the object directory
half-written, which is the exact input to the half-rebuild disease above.

A word on what NOT to add: `--parallel` / `/m` is the OTHER axis, MSBuild building several
*projects* at once. Composed with `/MP` on a 12-core box that is 144 compiler processes, and the
bottleneck here is one project's 30 files rather than several projects. `/MP` alone saturates it.

Build gotchas:
- The macOS deployment target must be re-asserted **after** Tracktion's
  `FetchContent_MakeAvailable` forces 10.13.
- Tracktion pins JUCE as an SSH submodule — the top-level `CMakeLists.txt` rewrites to
  HTTPS via `GIT_CONFIG_*` env vars.
- The ASIO SDK is fetched at configure time and is REQUIRED on Windows.
- Presets pin `"targets": ["st0-engine"]` — don't switch to all-targets.
- `<windows.h>` must precede `<shellapi.h>` with `NOMINMAX` + `WIN32_LEAN_AND_MEAN`.

## Tests

**The test targets are not built by an ordinary build, so a suite that stopped compiling stays
invisible.** The presets pin `"targets": ["st0-engine"]`, so `studio_engine_tests` /
`studio_session_tests` / `studio_midigraph_tests` / `studio_dspgraph_tests` /
`studio_recorder_tests` / `studio_pattern_tests` / `studio_samplebanks_tests` / `studio_strudel_tests` /
`studio_eurorack_tests` are only built when
named — rename a field of the data layer and the suite still referencing it reports nothing until
someone names it. Build them explicitly after
touching the data layer — **all of them**, or `ctest` reports the missing one as "Not Run", which
reads as a failure:

```
cmake --build build/<preset> --config RelWithDebInfo --target \
      studio_engine_tests studio_session_tests studio_midigraph_tests \
      studio_dspgraph_tests studio_recorder_tests studio_pattern_tests studio_samplebanks_tests \
      studio_strudel_tests studio_eurorack_tests
ctest --test-dir build/<preset> -C RelWithDebInfo -R 'studio_' --output-on-failure
```

`npm run test:mac --workspace st0-engine`. Covers the **JUCE-free data layer
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

Why it matters:

* **An ASIO driver is single-client.** A remembered device gets reopened by *every*
  process that constructs an engine — a render, a freeze, a param dump — so any of them
  running beside the live engine collides with it. The driver then stays wedged, and
  from that point on every engine start blocks **forever, with no output at all**, which
  reads as "the tray hangs" and sends you hunting anywhere but here.
* **It is a second source of truth.** `<state>/preferences.yaml` holds the device the
  user chose; left to itself Tracktion writes its own copy into `Settings.xml` and replays
  that one first, so the hidden choice wins before any st0 code runs.

So: offline tools open no device (`makeOfflineEngine`), the server opens one from
`openAudioDevice()` after the port is bound, and `Settings.xml` is inert state nobody
reads. The check that this still holds: put a `deviceType="ASIO"` `Settings.xml` in
place, start the engine, and see the port bind in milliseconds.

A related trap: when a render hangs, it is silent — no line is
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
process on the machine. A render stuck this way prints nothing and burns no CPU; its stack:

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
restarting the process clears it. The render itself is immune either way.

### Debugging a CRASH with no debugger

`installCrashHandler()` in `OfflineRender.cpp`, called first thing in `main`, prints the faulting
thread's symbolised stack — with file and line — on an access violation, then lets the process die
normally. Always on: a crash is rare and the handler costs nothing until one happens.

Without it a crash leaves only a fault offset in the Windows event log
(`Get-WinEvent -FilterHashtable @{LogName='Application'; ProviderName='Application Error'}`), and
there is no cdb or WinDbg here to turn that into a name. Note the engine dies *silently* from the
supervisor's point of view — the tray only reports `engine is gone — relaunching`, on a loop, which
reads as a supervisor fault rather than an engine one. The stack is what tells the two apart.

### Debugging a hang with no debugger

`watchdogStack()` in `OfflineRender.cpp` prints the stuck thread's symbolised stack after
N seconds and exits 3. It is gated on `STUDIO_RENDER_TRACE`, needs the RelWithDebInfo
PDBs, and is what produces a stack like the one above — there is no cdb or WinDbg on these
machines, and `Wait, LpcReply` from `Get-Process` is as far as PowerShell gets you.
The same env var turns on `trace()`, the coarse progress log; start there, then reach for
the watchdog when you need to know *what* is waiting rather than *where*.

A hang that reaches `runJob loop` and stops there is neither of the two traps above: it is the
render loop waiting on a **proxy** for a source that is not a wav, and it is in
`docs/cliModes.md`. The trace line tells them apart before any stack does — the MIDI trap stops
at `populateEdit done`, this one at `runJob loop` — and unlike either of those it burns about a
tenth of a core rather than nothing at all.
