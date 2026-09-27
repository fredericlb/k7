# st0-supervisor — the engine machine's supervisor

One native program on the musician's machine, between the tray and the engine. It starts, adopts
and watches `st0-engine`; keeps it listed at the studios it is connected to; holds the tunnel a
server reaches the machine through; and does the work a server asks of the machine — a stem cut,
a set list brought down, a file handed to the player, the log. The tray spawns it and draws what
it reports ([hostProtocol.md](hostProtocol.md)); the paces and the rules it follows are in
[supervisorPolicy.md](supervisorPolicy.md).

## A process of its own, not a part of the engine

A plugin that crashes takes the engine process down, and the supervisor is what brings it back —
while the tunnel and the studio listing stay up. A stem cut burns every core for minutes and
downloads write to the disk; beside the audio callback they would be heard. So the engine plays
audio and nothing else, and everything that can fail slowly or loudly lives here.

It is its own CMake project, not a target of st0-engine's: building it must never mean building
Tracktion, JUCE and Faust.

## One wire, two implementations, one set of tests

The server's half of the tunnel is TypeScript (`packages/engine-tunnel/hub.ts`), and this program
speaks the machine's half in C++: `TunnelFrames`, `TunnelFiles`, `PathMap` and `TunnelAgent` are
the twins of `frames.ts`, `agentFiles.ts`, `pathMap.ts` and `agent.ts`. Two spellings of a wire
drift apart silently, so they are held to ONE suite: `packages/engine-tunnel`'s tunnel, jobs and
WebRTC tests run against every agent `testAgents.ts` finds — the TypeScript reference, and this
program's `tunnel_harness` when it is built. CI builds it and runs them.

`agent.ts` stays as that reference and as the stand-in machine the server's own tests run their
jobs on. It runs in production nowhere.

## The libraries, and why each

| | what for | why this one |
|---|---|---|
| nlohmann/json | every frame and file | the engine's own, same tag |
| mbedTLS 3.6 (LTS) | the tunnel, HTTPS to the registries, DTLS for WebRTC | one static TLS stack on all three platforms, no system library to match |
| IXWebSocket | the engine socket, the tunnel, HTTP | the engine's own; its HTTP client rides the same TLS |
| libdatachannel | the WebRTC path to a browser | what node-datachannel wraps, so the browser meets the same peer |
| ONNX Runtime | stem separation | the runtime the model was exported for; prebuilt, hash-pinned |

All are fetched and pinned by `CMakeLists.txt`; none is found on the system. mbedTLS carries one
user config line, `MBEDTLS_SSL_DTLS_SRTP`, because libdatachannel configures DTLS-SRTP profiles
even with media off.

## Trust comes from the OS

mbedTLS knows no certificates, so `TrustRoots.cpp` hands it the OS's: the Keychain's anchors and
every certificate an admin or the user gave trust settings to on macOS, the ROOT stores of the
user and the machine on Windows, the distribution's bundle on Linux, and `$STUDIO_EXTRA_CA_CERTS`
on top. A studio behind a private CA works because that CA is in the OS store, and nowhere else.

## One thread owns the state

`Loop` is the program's event loop: timers and posted tasks run on one thread, so the supervisor's
state needs no lock. Anything that blocks — an HTTP call, spawning the engine, measuring the disk —
runs in `Loop::work` and posts its result back. A task that blocked the loop would freeze every
timer, including the one that keeps the host lock fresh.

The tunnel never blocks a socket's own thread: a frame that must wait for a download waits on its
channel's queue (`SerialQueue`), one per direction, which also keeps frames in order. A job runs on
a thread of its own. What a job changes in the settings goes through the loop, the settings'
single writer — a job writing the file beside the loop's own copy would be undone by the next save
of that copy.

## ONNX Runtime is loaded, never linked

The library is looked for at the first separation — beside the executable, in the tray's
`resources/onnxruntime`, or at `$STUDIO_ONNXRUNTIME_DIR` — and loaded then. Linked, a machine
missing it could not start the supervisor at all, engine and tunnel included, over one feature;
loaded, only the separate job says what is missing. The build copies it beside every executable it
makes, and `build-engine.mjs` stages it into the tray's resources.

Windows takes the DirectML package, whose last release is 1.24; macOS arm64 and Linux take 1.30,
and macOS 1.30 needs macOS 14. A platform ONNX Runtime ships no binary for builds without
separation. CoreML is offered and cannot compile HT-Demucs; the job falls back to the CPU and says
why (stem-separation's [stemSplit.md](../../../packages/stem-separation/docs/stemSplit.md) is the
page on providers and on the model).

## Two diagnostics

`st0-supervisor --probe <address>` asks a studio's registry the hello a connect would, and prints
why it did not answer — a refused certificate and a missing host read differently.
`st0-supervisor --separate <mix> <model> <outDir> [providers]` runs one stem separation on this
machine and prints its progress. Neither touches the state directory.

## What `.studio.log` says, and when

The merged log is where a machine's trouble is read after the fact, so what fails says so there —
not only on the tray's light, which is gone when the tray is:

- **At start:** the engine id and the whole presence a heartbeat will carry (hostname, addresses),
  then the performance figures with the rating. When a registry refuses a heartbeat, the reason
  names a field of those two lines.
- **`[registry]`, per registry:** `listed at …` on the first accepted heartbeat; the FIRST failure,
  with the registry's own answer (`HTTP 400 {"error":"heartbeat refused — …"}`, or `no answer
  (…)`); again whenever the reason changes; a reminder once a minute while it keeps failing; and
  `accepted again after N failure(s)` when it recovers. A registry added, removed or refused on add,
  and a deregister that did not land. No registry configured at all is said once.
- **`[host]`:** an engine that did not start, and why.
- **`[tunnel]`:** why a tunnel failed or closed (the socket's error, or the close code), once per
  distinct reason rather than on every redial; a job the machine refused or that threw.

A heartbeat cannot fail silently any more, which is how the Windows machine came to be listed and
then unselectable with nothing in its log: the registry refused every heartbeat, and nothing here
read the answer. Two things were fixed with it. The JSON is dumped with `error_handler_t::replace`,
so a byte that is not UTF-8 costs one character rather than throwing the whole heartbeat away; and
on Windows the hostname is `GetComputerNameExW`'s, converted to UTF-8, since `gethostname` answers
in the ANSI code page and `PC-FRÉDÉRIC` there is not UTF-8. The registry's half is
`packages/engine-registry/docs/heartbeat.md`.

## The performance rating moved

The single-core figure of the rating is the same biquad over the same budget, compiled rather than
JIT-compiled, so it reads several times higher on the same machine and the rating with it. The
reference in `packages/web-protocol/performance.ts` was measured under a JIT; ratings are
comparable between machines running this supervisor, not with ones from before it.
