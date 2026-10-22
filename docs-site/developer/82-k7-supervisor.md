# The supervisor (`engine/k7-supervisor`)

The supervisor is the engine machine's resident program, in C++20. It owns the state folder, starts or adopts the engine and relaunches it when it dies, keeps the engine listed at every studio by heartbeat, holds one tunnel per studio, answers the jobs a server sends through those tunnels, answers WebRTC offers, and takes commands from the app that runs it. Its file formats and fingerprint match the TypeScript helpers in `packages/engine-client`, so both sides read one state folder.

## Source layout

All sources are in `engine/k7-supervisor/src/`, compiled into a `k7_supervisor_core` library that the executable, the tests and the tunnel harness link.

| File | Role |
|---|---|
| `main.cpp` | Argument parsing, the four run modes, signal handling, the stdin reader thread |
| `Supervisor.cpp` | The state machine: one `Impl` touched only on the loop thread |
| `Loop.cpp` | The event loop: `post`, `after`, `every`, and `work` (run a blocking call on a worker, deliver its result back on the loop) |
| `HostProtocol.cpp` | NDJSON frames to and from the host app |
| `Settings.cpp` | `engine-host.json` or the `--config` file, lenient per field |
| `Paths.cpp` | The state folder layout |
| `Identity.cpp` | `engine-id.json` (mode 0600): the engine's id, its token, and the tunnel secret only the supervisor sends (to registries, never to the engine or a browser). An identity missing a secret gains one. |
| `HostLock.cpp` | One supervisor per state folder (`engine-host.pid`, refreshed every 2 s) |
| `EngineProcess.cpp` | Finding, spawning, adopting and stopping the engine |
| `EngineQueries.cpp` | The supervisor's own WebSocket to the engine (devices, plugins, sessions, pairing) |
| `AudioPolicy.cpp` | Which interface the engine should be on (pure, tested) |
| `Instruments.cpp` | The pinned list of sampled instruments, download, hash check, unpack |
| `Registry.cpp`, `Http.cpp`, `Url.cpp` | Heartbeat, deregister, probe; the URL rules shared with `packages/web-protocol/services.ts` |
| `Addresses.cpp` | The heartbeat's presence: host name, LAN IPv4s, machine fingerprint |
| `Performance.cpp` | The machine rating carried by the heartbeat |
| `TunnelAgent.cpp`, `TunnelFrames.cpp`, `TunnelFiles.cpp`, `PathMap.cpp` | The tunnel agent (twin of `packages/engine-tunnel/agent.ts`) |
| `MachineJobs.cpp` | The jobs a server can ask of the machine |
| `Separation.cpp`, `SeparationAudio.cpp`, `OnnxSession.cpp` | Stem separation: ffmpeg decode, HT-Demucs on ONNX Runtime, 24-bit WAV out |
| `Rtc.cpp`, `RtcFrames.cpp` | The WebRTC answerer (libdatachannel) and its fragment format |
| `Tls.cpp`, `TrustRoots.cpp` | mbedTLS setup and the OS trust store (+ `STUDIO_EXTRA_CA_CERTS`) |
| `Crash.cpp`, `Log.cpp` | Crash handler and the merged log |

Dependencies are fetched by `engine/k7-supervisor/CMakeLists.txt`: nlohmann/json, mbedTLS 3.6, miniz, IXWebSocket (patched to use mbedTLS by `engine/k7-supervisor/cmake/patch_ixwebsocket.cmake`), libdatachannel, and a prebuilt ONNX Runtime per platform (DirectML on Windows).

## Run modes

| Invocation | Mode |
|---|---|
| `k7-supervisor` | **Hosted**: driven by an app over NDJSON on stdio. Stdin closing is the app going away and shuts the supervisor down. |
| `k7-supervisor --config <file>` | **Command-line engine**: settings from the file (never written back), no frames on stdout, the log echoed to stderr and truncated at start, runs until SIGINT/SIGTERM/SIGHUP. |
| `k7-supervisor --probe <address>` | Asks `<address>`'s registry hello and exits 0 if it is a k7 registry |
| `k7-supervisor --separate <mix> <model> <outDir> [providers]` | Runs one separation locally and prints progress |

On Windows, `main()` initialises Winsock before any socket, puts stdio in binary mode, and marks the std handles non-inheritable so a spawned engine does not keep the app's pipe open. It also joins a kill-on-close job so the engine dies with the supervisor.

## The host protocol

Stdout carries frames and nothing else, one JSON object per line. Its single definition is the JSON Schema `packages/supervisor-host/schema/hostProtocol.schema.json`: the TypeScript types are generated from it, the C++ writer in `engine/k7-supervisor/src/HostProtocol.cpp` is held to its fixtures, and the Android and iPhone apps read the same frames in `SupervisorHost.kt` and `SupervisorHost.swift`.

**Supervisor → app:**

| Frame | When |
|---|---|
| `{"t":"state", …}` | The whole snapshot, emitted only when its serialised bytes changed, so an idle app hears nothing |
| `{"t":"result","id":N,"ok":bool,"message"?}` | The answer to command `N` |
| `{"t":"engine","action":"start","id","token","port","host"}` / `{"t":"engine","action":"stop"}` | Android only: the engine lives in the app's process, so the supervisor asks the app to start or stop it |

The snapshot (`Snapshot` in `HostProtocol.h`) carries: `status` (`stopped`/`running`/`error`), `error`, `ownsEngine`, `userStopped`, `engineId`, `enginePort`, `registryUrl` (joined for display), `lastHeartbeatOk`, `sessions`, `pluginCount`, `plugins`, `audioDevices`, `audioPriority`, `editPlugins`, `instances` (one row per studio family, `removable` unless it came from the environment), `instanceCheck`, `rootPath`, `mergedLogPath`, `downloads`, `instruments`, `pairRequests`, `pairedDevices`, plus `*Sig` signatures used for change detection.

**App → supervisor:** `{"t":"cmd","id":N,"cmd":"…","arg":"…"}`, always one string argument.

| Command | Argument | Effect |
|---|---|---|
| `engine.start` | | Spawn or adopt the engine |
| `engine.stop` | | Stop an owned engine (never a foreign one) and deregister at once |
| `engine.restart` | | Stop then start |
| `weburi.add` | an address | Probe the registry, then add and persist it, then heartbeat |
| `weburi.remove` | a studio URL | Drop that family from the persisted list and deregister from it |
| `registry.deregister` | | Deregister from every studio now |
| `audio.priority` | names joined by U+001F | Save the whole ranking, then switch if needed |
| `lan.open` | `1` or `0` | Save whether a device on this network drives the engine unpaired, then tell the engine |
| `plugins.rescan` | | Ask the engine to rescan; the count is cleared to show a spinner |
| `plugin.showUI` | `<session>␟<id>` or `<id>` | Open a plugin's native window |
| `session.drop` | session id | Drop a session in the engine |
| `pair.approve`, `pair.deny`, `pair.revoke` | request or device id | Pairing verbs, forwarded to the engine |
| `instruments.download`, `instruments.remove` | instrument name | Keep or drop an instrument |
| `shutdown` | | Same as stdin closing |

U+001F (`kUnitSep`) joins multi-part arguments because no device name contains it.

## Settings

`<state>/engine-host.json` in hosted mode, the `--config` file otherwise. `settingsFrom()` validates each field on its own so one bad key never loses the others, and migrates old spellings (`registryUrl`, `audioDevice` + `audioFallback`):

| Field | Meaning |
|---|---|
| `registryUrls` | Studios, each reduced to its family's registry URL. Empty falls back to `$STUDIO_REGISTRY_URL` (comma-separated). |
| `port` | The first engine port tried, default 8765; `--port` on the command line fixes it instead |
| `audioPriority` | Interface names, best first |
| `onnxProviders` | Separation providers, lowercased |
| `instruments` | Absent until a first boot settles it to whatever is already installed; an array is a choice |

`configEnvironment()` maps the config-only keys `machineName`, `extraCaCerts`, `renderKey` and `instruments: ["all"]` to `STUDIO_MACHINE_NAME`, `STUDIO_EXTRA_CA_CERTS`, `STUDIO_RENDER_KEY` and `STUDIO_INSTRUMENTS=all` before anything reads them. The user-facing reference is in the user guide's command-line engine page.

## The state folder

`Paths.cpp` and `packages/engine-client/src/paths.ts` must spell every name the same way; a wrong path reads as an empty file rather than throwing.

| Path under `$STUDIO_HOME` (default `~/.k7`) | Owner |
|---|---|
| `engine-id.json` | `{id, token, createdAt}` |
| `engine.pid`, `engine-host.pid` | Engine and supervisor pids |
| `engine-host.json` | Hosted settings |
| `exts.json` | Plugin scan cache (the engine writes it) |
| `.studio.log` | The merged log: `HH:MM:SS [tag] text` |
| `.studio-engine.log` | The engine's log when it runs without a supervisor |
| `instruments/<name>/` | Instruments, each with a `.k7-archive` marker holding the archive hash, written last |
| `remote/<host_port>/` | One server's files as this machine holds them |
| `workspace/` | Named by the snapshot's `rootPath` |

## Lifecycle and paces

`Supervisor::start()` takes the host lock (throwing if another supervisor holds it), loads settings and identity, resolves registries, settles instruments, publishes the first snapshot, then measures performance on a worker. When the measurement is back it starts the engine, sends a first heartbeat, installs the loops, and queues instrument downloads.

| Loop | Every |
|---|---|
| Heartbeat (and tunnel sync) | 5 s |
| Crash watch | 2 s; relaunch backoff 1 s doubling to 30 s |
| Audio devices | 10 s |
| Openable plugin windows | 3 s |
| Sessions | 2 s |
| Pairing requests and devices | 1 s |
| Plugin catalogue | 2 s until a scan lands, then 60 s |
| Host lock refresh | 2 s |
| Purge of kept undo audio older than 30 days | 1 h |

**Engine start** (`engine/k7-supervisor/src/EngineProcess.cpp`): if the pidfile names a live process and the port answers, adopt it; if the port does not answer, the pidfile is stale. The pidfile records the engine's port (`port=`), so a surviving engine is asked where it was started. Otherwise the ports from `port` on (ten, or only that one under `--port`) are tried in turn: an engine answering on one with no pidfile is adopted, its pid asked of `lsof` on Unix and of the TCP table on Windows; a port another program holds is skipped, the log naming it; the first port that binds gets a fresh engine. Otherwise spawn the binary found by `findBinary()`: `$STUDIO_ENGINE`, then `k7-runtime` beside the supervisor, then the newest build under `engine/k7-runtime/build/*/` in the checkout (Debug ranked last). The engine gets `STUDIO_ENGINE_HOST=0.0.0.0`, the id and token, and `STUDIO_ENGINE_ALLOWED_ORIGINS` built from the registries' origins at that moment (a registry added later counts from the next start); its output goes to the merged log under `[engine]`. Stop kills the whole process tree. Shutdown deregisters first, bounded to 1.5 s so a hung registry cannot hang Quit, then stops the engine even if it was adopted.

**Audio policy** (`engine/k7-supervisor/src/AudioPolicy.cpp`): the first ranked interface that is present wins; no default, no fallback beyond the list. A switch that did not take is not retried until the device set's signature changes.

**Heartbeat** (`engine/k7-supervisor/src/Registry.cpp`): `POST <registry>/api/registry/heartbeat` to every registry in parallel, with `{id, token, tunnelSecret, hostname, machineFingerprint, port, addresses: {loopback, lanIps, port}, performance, libraryLevel, protocol, build, safeMode}`. Deregistering sends the secret too, since a bound id cannot be unlisted by its token alone. At most one heartbeat in flight. Each registry's failures are logged once per new reason and then once a minute. LAN IPs exclude loopback, link-local and virtual interfaces (Docker, WSL, VPNs, Tailscale and similar). The fingerprint is `sha256(host|sorted MACs)`, the same as the TypeScript supervisor computed.

## Tunnels, jobs and WebRTC

`syncTunnels()` keeps exactly one `TunnelAgent` per resolved registry. Each agent dials `<registry>/api/engine-tunnel?id=<id>` with the engine token and the tunnel secret in headers (and `STUDIO_RENDER_KEY` when set), redials with backoff, opens a real socket to the local engine for each `engine` channel, and answers `jobs` channels itself. Its cache folder is `remote/<cacheKey>`.

Jobs registered by `machineJobs()` in `engine/k7-supervisor/src/MachineJobs.cpp`:

| Request `type` | Replies | Does |
|---|---|---|
| `local` | `local` | Confirms a médiathèque song is on this disk (the channel downloaded it first) |
| `prefetch` | `prefetched {count}` | Counts the set list's songs the channel brought down |
| `send-up` | `sent {file}` | Re-stamps a kept file so the channel uploads it back (undo audio) |
| `log` | `log {raw}` | A slice of the merged log, by offset or tail |
| `onnx-providers` | `onnx-providers {providers}` | Reads, or with `set` writes, the separation providers through the loop |
| `separate` | `separating …`, then `separated {job}` | Runs or joins a separation |
| `render` | `rendering`, then `rendered {file}` or `{mix, stems}` | Pipes the doc to `k7-runtime --render -`, reads the manifest, copies the results out |

A job handler runs on its own thread and may throw; the agent turns that into an error reply. Every path a job reads must be inside this machine's copies of the server's folders (`<state>/remote/…`, checked by spelling and again after resolving links); anything else is refused before the job says whether the file exists. Render and separation scratch folders are created fresh, owner-only, under the temp directory. Paths in requests arrive already local, and paths in replies are mapped back to the server's, which is what makes the tunnel upload the named files before the server reads the reply.

`rtc-offer` frames are answered by `rtc::answerOffer()`, which opens a libdatachannel peer with no ICE servers (host candidates only, 2 s gathering) and pipes the data channel to the engine, cut into the fragments defined in `RtcFrames.cpp`.

## Android differences

Under `__ANDROID__`, `EngineProcess.cpp` does not spawn: it emits an `engine` frame asking the app to start the engine in-process and waits up to 20 s for the port, and the pidfile names the parent (the app). Stop is an `{"t":"engine","action":"stop"}` frame, never a kill. `STUDIO_MACHINE_NAME` comes from the app because Android's host name is `localhost` everywhere.

## Tests

```sh
cd engine/k7-supervisor
cmake --build --preset <preset> --target k7_supervisor_tests
./build/<preset>/k7_supervisor_tests
```

This compiles C++ and fetches dependencies on a first configure; on the Windows dev machine leave builds to Tilt.

`k7_supervisor_tests` covers URLs, settings, the host protocol, audio policy, performance scoring, machine jobs, RTC frames, separation audio, the host lock, the registry, TLS and instruments, with no device and no network. `tunnel_harness` is the agent alone, used by `packages/engine-tunnel`'s suites to hold the native agent to the same tests as the TypeScript one.
