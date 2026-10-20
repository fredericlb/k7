# The C++ engine (`engine/k7-runtime`)

The engine is a headless C++20 program built on Tracktion Engine (and so on JUCE). It receives a compiled `ProjectDoc` over a WebSocket, turns it into a live Tracktion `Edit`, plays it on the audio device, and pushes transport, meters and other state back about twenty times a second. It never reads a song file.

Read [Engine architecture](./80-engine-architecture.md) first for where it sits. **Do not build it casually:** a cold build fetches Tracktion, JUCE, Faust, sfizz, Surge and more, and takes tens of minutes. See [Building and shipping engines](./87-engine-build-and-shipping.md).

## Source layout

| Path | What lives there |
|---|---|
| `engine/k7-runtime/server/main.cpp` | The executable: one-shot CLI modes, else `serve()`. Includes no JUCE header. |
| `engine/k7-runtime/server/Serve.cpp` | The WebSocket server: socket lifecycle, trust screening, dispatch to the handler table. No JUCE header. |
| `engine/k7-runtime/server/ServeProject.cpp` | Handlers acting on one project: `project`, `tracks`, `flush`, `transport`, `preview`, `note-preview`, `midi-live`, `arm`, `recorder`, `record-enable` |
| `engine/k7-runtime/server/ServePlugins.cpp` | Plugin handlers: catalogue, params, presets, native UI, waveform taps |
| `engine/k7-runtime/server/ServeMachine.cpp` | Machine handlers: `whoami`, sessions, audio devices, input levels, broadcast, instrument status |
| `engine/k7-runtime/server/ServePairing.cpp`, `engine/k7-runtime/server/Pairing.cpp` | LAN pairing: who is trusted, pending requests, `paired-devices.json` |
| `engine/k7-runtime/server/DocJson.cpp` | JSON ↔ `ProjectDoc`, with the wire's bounds |
| `engine/k7-runtime/server/Outbox.h` | One writer thread for every JSON push |
| `engine/k7-runtime/server/AudioSender.cpp` | The audio broadcast's sender thread |
| `engine/k7-runtime/server/android/EngineJni.cpp` | The Android library's two JNI entry points |
| `engine/k7-runtime/engine/` | The `studio_engine` static library: everything that touches Tracktion/JUCE |
| `engine/k7-runtime/engine/eurorack/` | Ports of Mutable Instruments modules as built-in plugins, in a JUCE-free library |
| `engine/k7-runtime/engine/surge/` | Surge XT as a built-in synth (desktop only) |
| `engine/k7-runtime/engine/strudel/` | The committed Strudel bundle and the CMake script that embeds it |
| `engine/k7-runtime/engine/patches/` | Patch scripts applied to fetched dependencies |
| `engine/k7-runtime/tests/` | Fast, JUCE-free unit tests |
| `engine/k7-runtime/scripts/` | The build and test runners, code generators, and TypeScript probes that drive a running engine |

The boundary that matters: **public headers of `studio_engine` include no JUCE.** `EngineHost.h` forward-declares Tracktion types and exposes plain structs (`PluginInfo`, `AudioDeviceInfo`). The server compiles against that API only, and all JUCE threading sits behind `EngineHost::post()`. Tracktion is linked `PRIVATE`.

## Run modes

`main.cpp` checks its arguments in order and falls through to the server:

| Invocation | What it does |
|---|---|
| `k7-runtime [port]` | Serve on `port` (default 8765) until asked to quit |
| `k7-runtime scan [--force]` | Update the plugin cache and print a summary; binds no port |
| `k7-runtime --scan-plugin <format> <id>` | Child mode: load one plugin in isolation (what the scan spawns per plugin) |
| `k7-runtime --render <doc.json\|-> --out <dir> [--stems] [--base <dir>]` | Bounce a `ProjectDoc` (bare or under `{ "doc": … }`, from a file or stdin) to WAV; prints a manifest `{"mix": …, "stems": [{"name", "file"}]}` as its last line |
| `k7-runtime --decode <file>` | Decoded frames on stdout, for waveform and peak analysis |
| `k7-runtime --list-audio-devices` | Devices as JSON between `STUDIO_DEVICES_BEGIN`/`END` sentinels |
| `k7-runtime --dump-params <type>` | One built-in's parameters, sentinel-fenced |
| `k7-runtime --dump-params-ext <format> <id> <statefile>` | An external plugin's parameters, restored from a preset |
| `k7-runtime --dump-builtin-params` | Every built-in's full parameter list |
| `k7-runtime --dump-surge-layout` | Surge XT's parameters and slot names |
| `k7-runtime --multi-edit-test …` | A throwaway probe of several documents on one device |

Before any of these, `main()` compares the `ProjectDoc` layout as seen by three translation units and exits with code **4** if they differ. This catches a half-rebuilt tree, which links fine and then crashes on the first project.

### Environment

| Variable | Read by | Meaning |
|---|---|---|
| `STUDIO_ENGINE_ID`, `STUDIO_ENGINE_TOKEN` | `serve()` | Identity echoed on `whoami`. Empty without a supervisor, and an empty id matches no selection. |
| `STUDIO_ENGINE_HOST` | `serve()` | Bind address. Default `127.0.0.1`; the supervisor sets `0.0.0.0` for LAN browsers. |
| `STUDIO_AUDIO_TO_BROWSER` | `serve()` | `1` tells every driving page to play the master broadcast (the server engine's null sink). |
| `STUDIO_HOME` | state paths | The state folder (default `~/.k7`): plugin cache, pairing, load guard markers, instruments. |
| `STUDIO_FAUST_LIBS` | Faust | Where `stdfaust.lib` and friends are resolved at run time. |
| `STUDIO_RENDER_TRACE` | offline render | Prints render progress. |
| `STUDIO_ENGINE_ROOTS` | path roots | Extra read/write roots, split on the platform's path-list separator |
| `STUDIO_ENGINE_ALLOWED_ORIGINS` | `serve()` | Comma-separated page origins allowed beside the built-in ones; the supervisor sets it from its registries' origins |

### Path roots

A document off the wire names files: samples, models, IRs, presets, take destinations. `engine/k7-runtime/engine/PathRoots.h` confines them. `serve()` calls `setPathRoots(defaultPathRoots(stateDir))` before the first document is read: writes are allowed under the state folder and `$STUDIO_ENGINE_ROOTS`; reads under those plus the temp directory. Paths are checked after resolving symlinks, and UNC paths (`\\host\share`, `//host/share`, `\\?\…`) are always refused so a document cannot make the engine dial a network share. Pattern sound names must be plain child names (`safeSoundName`). With no roots set, as in the one-shot CLI modes, everything but UNC passes. Code that opens a document-named file calls `readAllowed()` or `writeAllowed()`; `engine/k7-runtime/tests/PathRoots_test.cpp` covers the rules. DocJson also bounds the wire's numbers before they reach the model.

## Inside `serve()`

1. Load guards are enabled first: anything the previous engine died loading is struck now.
2. `EngineHost` is constructed. This builds the Tracktion engine but opens **no** audio device; opening one is posted as the first message-thread task so the port binds first (a refused connection would read as an absent engine).
3. The IXWebSocket server binds with a 10 s ping interval and a 5 s send timeout. A peer that stops reading is closed rather than allowed to block a send.
4. The handler table is assembled from the three `add*Handlers` functions.
5. `EngineHost::run()` blocks on the message loop. On Android, the JNI entry calls `serve()` on a thread whose `Looper` becomes JUCE's message loop, which is why `serve()` blocks rather than returning a handle.

Threads: IXWebSocket runs a callback thread per connection; every engine mutation is posted to the message thread with `host.post`; every JSON push goes through `Outbox`'s single writer thread so the message thread never waits on a peer; binary audio goes through `AudioSender`'s thread, the only one allowed to move a broadcast ring's read cursor.

A socket's handshake first passes `screenOrigin`: a browser `Origin` that is not loopback, `https://k7.rocks` or a subdomain, or listed in `STUDIO_ENGINE_ALLOWED_ORIGINS` is closed with 1008 and logged; a handshake with no `Origin` (a native client) passes. Every incoming message then passes `screenFrameSize` (a socket that is neither loopback nor paired may send at most 16 KiB per frame) and `screenMessage` (pairing, see [83](./83-engine-protocol.md#pairing)). Read-only probe queries (`whoami`, `list-audio-devices`, `list-plugins`, `list-edit-plugins`, `list-sessions`, `io-levels`, `instrument-status`) do not produce a `[client] connected` log line, so polling does not bury the log.

## Sessions

One engine plays several projects at once, one per **session**, keyed by the message's `session` field (absent means `""`). Each session owns its own Tracktion `Edit`, plugins, meters, taps and recorders, in `SessionRegistry<T>` (`engine/k7-runtime/engine/SessionRegistry.h`), a map behind a lock that covers the map and never a session's contents. Limits: 64 sessions (`EngineHost::kMaxSessions`), and a session id of at most 256 bytes. Naming an unknown session creates it, except from a probe query, which only creates one when it says `"role": "driver"`. The first message on a socket binds it to that session for state pushes, except the verbs that name another session on purpose (`drop-session`, `show-native-plugin-ui`, `show-native-plugin-ui-of`). The session id rules are in `packages/engine-protocol/sessions.ts`.

## Applying a project: the diff

`project` posts `EngineHost::apply(session, doc)` to the message thread, wrapped in `busy: true` / `busy: false` broadcasts. `apply` compares the incoming doc with the session's current one using `ProjectDiff` (`engine/k7-runtime/engine/ProjectDiff.h`) and returns the ordered change list, which is broadcast as `applied` and logged (first 12 lines).

The diff depends on **stable identity**: tracks, clips and plugins match by `id`, so a rename is "same id, new name". Removals come before additions and tracks before their contents. Change kinds:

| Applied in place | Forces a full rebuild |
|---|---|
| `TempoChanged`, `TimeSignatureChanged`, `MasterVolumeChanged` | `MasterChainChanged` |
| `TrackAdded`, `TrackRemoved`, `TrackRenamed`, `TrackParamsChanged`, `TrackInputChanged`, `TrackOutputChanged` | `SampleRateChanged` (the device reopens) |
| `ClipAdded`, `ClipRemoved`, `ClipMoved` | `TracksReordered` (lanes are found by index) |
| `PluginAdded`, `PluginRemoved`, `PluginParamChanged`, `PluginEnabledChanged`, `PluginReloaded`, `PatternChanged`, `AutomationChanged` | `SendsRewired` |
| `SendLevelChanged` | |

Applying in place is what keeps a reverb tail ringing and a held note held while you edit. `needsFullRebuild()` decides; a full rebuild goes through `EditBuilder` (`engine/k7-runtime/engine/EditBuilder.cpp`), which also builds the offline render's edit. Sends are planned once for the whole song in `SendPlan.h`, shared by the builder and the diff.

To add a field to `ProjectDoc`: add it to `engine/k7-runtime/engine/ProjectDoc.h`, parse it in `engine/k7-runtime/server/DocJson.cpp`, compare it in `engine/k7-runtime/engine/ProjectDiff.cpp` (choosing in place or rebuild), apply it in `EngineHost`/`EditBuilder`, mirror it in `packages/engine-protocol/project.ts`, and produce it in the compiler (`packages/song`). Add a case to `engine/k7-runtime/tests/ProjectDiff_test.cpp`.

## Hosted plugins

**Third-party:** VST3 and LADSPA, from each format's default search locations, on every platform except Android. Discovery runs out of process (`--scan-plugin` per plugin), so a crashing plugin cannot take the scan down; results are cached in `<state>/exts.json`, which the TypeScript side reads for `@engine/…` modules. A rescan is incremental.

**Built-in** (`engine/k7-runtime/engine/*Plugin.cpp`, registered by `xmlTypeName`):

| Group | Plugins |
|---|---|
| Instruments | SFZ Player (sfizz), Surge XT (desktop only), Faust, the eurorack ports in `engine/k7-runtime/engine/eurorack/` (`mu-plaits`, `mu-braids`, `mu-rings`, `mu-elements`, `mu-clouds`, `mu-warps`, `mu-peaks`, `mu-tides`) |
| DSP | Neural Amp Modeler (NAM core, plus RTNeural models), DSP Graph (the JavaScript DSP interpreter), MIDI Graph, Arpeggiator, Pattern (Strudel) |
| Mixing | Mixer, Master gain, Quick Master, Mix Split / Mix Blend |
| Taps and decks | Waveform Tap, Broadcast Tap, Recorder, Turntable |
| Tracktion's own | the 186 AirWindows effects, compiled in |

What each one does for a user belongs to the chains section; this side owns their DSP. NAM's architectures register through file-scope statics, which is why NAM is an `OBJECT` library linked `PUBLIC`: in a static library the linker would drop them and every model would fail to load with no build error.

Time-stretching uses Tracktion's SoundTouch backend (`TRACKTION_ENABLE_TIMESTRETCH_SOUNDTOUCH`).

### Load guards and the callback watchdog

`LoadGuard` writes a marker under `<state>/loading/` while a plugin or model file loads. A marker left behind by a dead engine is a strike in `<state>/quarantine.json`; two strikes quarantine the file, which is then refused until its size or modification time changes. `CallbackWatchdog` notices an open device that stopped calling back and reopens it, giving up after repeated failures.

## The Strudel bundle

Pattern lanes are Strudel code. The engine runs them itself in QuickJS: `PatternPlugin` heads the lane's chain, a worker queries the pattern ahead into `PatternSchedule`'s ring and loads samples, and the audio thread only reads the ring. `StrudelHost` owns one QuickJS runtime and must never be called from the audio thread.

The JavaScript comes from `packages/song-strudel/src/engineEntry.ts`, bundled by `engine/k7-runtime/scripts/gen-strudel-bundle.mjs` (esbuild, IIFE, ES2020, minified) into `engine/k7-runtime/engine/strudel/strudel.bundle.js`. The bundle is **committed**, so building the engine needs no Node; CMake turns it into a byte array at build time. Regenerate it after changing `song-strudel` or bumping `@strudel/*`:

```sh
npm run gen:strudel-bundle --workspace k7-runtime
```

Other generators in the same workspace: `gen:builtin-params` (writes `packages/song-schema/src/builtinParams.generated.json` from `--dump-builtin-params`) and `gen:surge-panel`.

## Tests

`engine/k7-runtime/tests/CMakeLists.txt` builds small binaries that compile the JUCE-free sources directly, so they build in seconds and need no audio device: `studio_engine_tests` (the diff), `studio_docjson_tests`, `studio_pairing_tests`, `studio_session_tests`, and suites for the turntable loop, warp markers, recorder tap, arpeggiator, dither, acceleration limiter, note clock, watchdog, MIDI graph, DSP graph, Faust, pattern schedule, sample banks, Strudel host, eurorack and amp models.

```sh
npm test --workspace k7-runtime        # builds the studio_* targets in the platform's preset, runs them
npm run test:all --workspace k7-runtime
```

`engine/k7-runtime/scripts/run-tests.mjs` never configures a preset (configuring fetches everything). An unconfigured tree **skips** loudly with the command to fix it. Set `STUDIO_MOTEUR_PRESET` to choose the preset.

The TypeScript probes in `engine/k7-runtime/scripts/` (`send-one.ts`, `render-once.ts`, `load-probe.ts`, `two-sessions.ts`, `turntable-latency.ts` and others) drive a **running** engine or the render path from `npx tsx`; they are measuring tools, not tests.
