# k7-supervisor — the engine machine's supervisor

One native program on the musician's machine, between whoever runs it and the engine. It starts,
adopts and watches `k7-runtime`; keeps it listed at the studios it is connected to; holds the tunnel
a server reaches the machine through; and does the work a server asks of the machine — a stem cut,
a set list brought down, a file handed to the player, the log. The paces and the rules it follows
are in [supervisorPolicy.md](supervisorPolicy.md).

## Two ways to run it

| | run by | settings | stdout | stops when |
|---|---|---|---|---|
| **under an app** | the desktop app (`apps/k7-standalone`, through `@studio/supervisor-host`) or the phone (`engine/k7-android`) | `<state>/engine-host.json`, changed by the app's commands and saved | the app's protocol ([hostProtocol.md](hostProtocol.md)) | stdin closes — the app went away |
| **the command-line engine** | `k7-supervisor --config <file>`, a terminal, a service, the server's container | the file, read once and never written | nothing | SIGINT or SIGTERM |

The config file has the settings' schema (`registryUrls`, `port`, `audioPriority`, `onnxProviders`,
`instruments`), plus the three keys that otherwise come from the environment — `machineName`,
`extraCaCerts`, `renderKey` — and `"instruments": ["all"]` for `$STUDIO_INSTRUMENTS=all`. A key the
file names wins over the environment; one it leaves out falls back to it, so `{}` is a valid config.
`engine.example.json` beside this folder is the one the release archive carries.

The file is never written back because it is the user's: a hand-edited file rewritten by the program
loses its order and its blank keys, and a choice the supervisor makes on its own — the instruments a
first boot settles — lasts the run. With no app to own the session, the supervisor truncates the
merged log when it starts and echoes every line to stderr, which under an app would print each
line twice.

## A process of its own, not a part of the engine

A plugin that crashes takes the engine process down, and the supervisor is what brings it back —
while the tunnel and the studio listing stay up. A stem cut burns every core for minutes and
downloads write to the disk; beside the audio callback they would be heard. So the engine plays
audio and nothing else, and everything that can fail slowly or loudly lives here.

It is its own CMake project, not a target of k7-runtime's: building it must never mean building
Tracktion, JUCE and Faust.

## An app learns we died from our stdout, so no child may hold it

An app watches one thing to know we are gone: our stdout closing. That EOF is what it reaps on,
logs, and relaunches us from — there is no second signal. A supervisor whose death goes unnoticed
leaves a machine whose engine still runs and whose studios no longer list it, since nothing is left
to heartbeat and a registry entry outlives its last heartbeat by `REGISTRY_TTL_MS`.

`process::spawn` passes `bInheritHandles = TRUE`, which gives a child every inheritable handle we
hold rather than only the pipes meant for it, and our own stdio — the app's pipe — arrives
inheritable. The engine outlives us by design, so a copy of that pipe inside it blocks the app's
read forever, through a crash and through a rebuild alike. On Windows the three std handles have
`HANDLE_FLAG_INHERIT` cleared before anything is spawned; a child is given its pipes through
`STARTUPINFO` and needs nothing of ours. The pipes `spawn` creates are themselves inheritable while
it runs, so two overlapping spawns can still cross handles — a bounded cost, since of our children
only the engine outlives us.

On POSIX every pipe is close-on-exec from its creation (`cloexecPipe`: `pipe2(O_CLOEXEC)`, or on macOS,
which has no `pipe2`, `fcntl` on both ends at once), and a child gets its ends by `dup2`, which clears
the flag on the copy alone. A pipe made on one thread is then never inherited by a child spawned on
another, where its write end would hold off the EOF the first spawn waits for.

## An engine is adopted by its PORT, and a probe that cannot ask says nothing

Whether the engine is up is asked of its port (`isServing`), and the answer has three values, not
two: up, down, or *could not ask* — `socket()` itself failed, which is what running out of file
descriptors looks like. Read as "down", that third answer cost a machine a whole night: the pidfile
named the live engine, the probe could not open a socket, the supervisor dropped the pidfile as
stale, and every engine it started after that died on the port the first one still held, every two
seconds, while the browser's transport kept being reset. So *could not ask* keeps the pidfile and
retries, and a start that finds the port already answered with no pidfile naming its owner adopts
that owner (its pid asked of `lsof`) rather than spawning an engine that can only fail to bind.

What ran the descriptors out was the heartbeat: one started every five seconds whether or not the
last had come back, so a network gone dead — a sleeping laptop, a DNS lookup the request timeout
does not bound — stacked them, each holding its sockets and pipes, until the 256 a process gets
were spent. A heartbeat still in flight now makes the next tick skip.

## One wire, two implementations, one set of tests

The server's half of the tunnel is TypeScript (`packages/engine-tunnel/hub.ts`), and this program
speaks the machine's half in C++: `TunnelFrames`, `TunnelFiles`, `PathMap` and `TunnelAgent` are
the twins of `frames.ts`, `agentFiles.ts`, `pathMap.ts` and `agent.ts`. Two spellings of a wire
drift apart silently, so they are held to ONE suite: `packages/engine-tunnel`'s tunnel, jobs and
WebRTC tests run against every agent `testAgents.ts` finds — the TypeScript reference, and this
program's `tunnel_harness` when it is built. CI builds it and runs them.

`agent.ts` stays as that reference and as the stand-in machine the server's own tests run their
jobs on. It runs in production nowhere.

## A server reaches this disk only under its roots

A server names files by its own paths, and the map turns them into this machine's — a download
lands there, an upload is read from there. So a server that could spell its way out of a root
could write any file on the machine with bytes it chose, or read any file back up.

Each direction is held element by element, never as a string prefix (`PathMap.cpp`'s `joinUnder`
and `relativeUnder`, cases in `tests/PathMap_test.cpp`):

- **down**: the server's path below its root is split on `/`, and a segment is refused when it is
  empty, only dots and spaces (`.`, `..`, and `.. `, which Windows trims to `..`), or holds a `/`,
  `\`, `:`, NUL or control character — on Windows a `\` would be a separator and `C:\` or `\x` would
  replace the whole path — or is a Windows device name (`CON`, `PRN`, `AUX`, `NUL`, `COM0`–`9`,
  `LPT0`–`9`, the console names, any case, with or without an extension), which Windows opens as the
  device rather than as a file. A server file with such a name is the same refusal on every machine,
  a Mac's included. The joined path must then still lie under the root once lexically normalised;
- **up**: a local path maps only when every element below the root passes the same rule, so
  `<root>/./../..` maps to nothing rather than to the server.

The jobs that WRITE — `render`'s `out` or `outDir` and every stem in its manifest, `separate`'s
`outDir` — and `send-up`, which stamps a file so the channel uploads it, accept only a path the map
places in a root the server marked writable (`JobContext::writable`), and are refused with an error
reply otherwise.

The jobs that READ a path the server names — `local`, `prefetch`, `separate`'s `source` and `model` —
accept only one under this machine's copies of the servers' roots, `<state>/remote`, by spelling and
again once links are resolved. `local` refuses in the words it uses for an absent file and `prefetch`
does not count it, so neither tells a server whether some other path exists on this disk. `separate`
hands its source to ffmpeg and ffprobe as `file:<path>` under `-protocol_whitelist file`: a name can
then neither be read as an option nor reach a network protocol, a playlist's included.

`render` works in a folder of its own under the temp directory, created by the job itself with a
random name and owner-only (`freshScratch`): a name that can be predicted is a folder another user
of the machine can make first, or point elsewhere with a link.

The engine opens its socket to web pages only from the studios it should serve: the supervisor
starts it with `STUDIO_ENGINE_ALLOWED_ORIGINS` set to the origins of the studios this machine is
listed at (`engine::allowedOrigins`), the rest of that rule being the engine's
([pairing.md](../../k7-runtime/docs/pairing.md)).

## The libraries, and why each

| | what for | why this one |
|---|---|---|
| nlohmann/json | every frame and file | the engine's own, same tag |
| mbedTLS 3.6 (LTS) | the tunnel, HTTPS to the registries, DTLS for WebRTC | one static TLS stack on all three platforms, no system library to match |
| IXWebSocket | the engine socket, the tunnel, HTTP | the engine's own; its HTTP client rides the same TLS |
| libdatachannel | the WebRTC path to a browser | what node-datachannel wraps, so the browser meets the same peer |
| ONNX Runtime | stem separation | the runtime the model was exported for; prebuilt, hash-pinned |

All are fetched and pinned by `CMakeLists.txt`; none is found on the system. mbedTLS carries a
user config: `MBEDTLS_SSL_DTLS_SRTP`, because libdatachannel configures DTLS-SRTP profiles
even with media off, and threading, for the next section.

## TLS from several threads

mbedTLS's PSA layer keeps ONE random generator for the whole process, and every TLS handshake draws
from it. Handshakes run on several threads at once — a heartbeat to each studio in parallel, a
tunnel per studio redialling, the WebRTC path — so the seeding and the draws BOTH have to be
guarded. Unguarded, the generator is corrupted under exactly the load a studio being down
produces: handshakes begin failing for a reason the far end cannot explain
(`SSL - The handshake negotiation failed`, `SSL - Internal error`), and the process faults inside
the DRBG. `src/Tls.cpp` owns the setup and `main.cpp` runs it once, before any socket:

- `psa_crypto_init()` while there is still one thread, so no two sockets seed together.
- `MBEDTLS_THREADING_C`, which is what makes `mbedtls_mutex_lock` a lock instead of an empty macro.
  This is not a tuning knob: with the macro empty, concurrent draws segfault.
- the mutexes behind it — `MBEDTLS_THREADING_PTHREAD` where pthreads exist, and on Windows
  `MBEDTLS_THREADING_ALT` with the four callbacks in `Tls.cpp`, since mbedTLS ships no Windows
  backend of its own. `cmake/threading_alt.h` supplies the type as a pointer, so no mbedTLS
  translation unit has to include windows.h and collide with the winsock headers.

There is no `mbedtls_threading_free_alt` counterpart, for the reason `main.cpp` gives: we leave by
`_Exit`.

## A TLS write left pending is retried at its own length

IXWebSocket is built with a patch (`cmake/patch_ixwebsocket.cmake`, run by FetchContent). When the
socket is full, `mbedtls_ssl_write` encrypts one record, keeps it pending and answers `WANT_WRITE`;
the next call only flushes that record, and reports as written the length it is asked THEN, up to
one record. IXWebSocket retries with its whole send buffer, which other threads have grown
meanwhile, so it erases bytes that never left: the stream loses a slice silently and the hub reads
garbage as frames. That is a slow uplink under a large upload — a freeze's render going up — and it
shows here as the tunnel closed `1002` or `1011 Internal error` in the same second the upload starts,
the hub answering a corrupt frame by cutting the socket. On loopback the socket never fills, which
is why the tunnel suite does not see it. The patch asks again at the length the record began with;
it refuses to apply, loudly, to an IXWebSocket that no longer reads as it expects.

## Closing a socket leaves the crypto standing

The same patch removes `mbedtls_psa_crypto_free()` from `SocketMbedTLS::close`. PSA's state — the
key slots, the random generator — is ONE for the process, set up once by `tls::init` in `main`, and
every TLS socket draws from it: the tunnel, each heartbeat, each job. IXWebSocket frees it whenever
any one socket closes, so the next socket re-initialises it while the others are still inside it.
With heartbeats to several registries on threads of their own, that is a use-after-free under
load: the heap corrupts and macOS's allocator traps the process (`EXC_BREAKPOINT` in
`psa_initialize_key_slots` or `getaddrinfo`), every few minutes once a wake from sleep lets a
backlog of heartbeats out together. `tests/Tls_test.cpp` closes one socket and asks the generator
for bytes. The state is never freed: the process leaves by `_Exit`.

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

A signal reaches the loop through a flag: the handler only stores to a lock-free atomic, and a timer
on the loop reads it every 100 ms. Posting from the handler would take the queue's mutex, which a
signal may interrupt while the loop holds it.

The tunnel never blocks a socket's own thread: a frame that must wait for a download waits on its
channel's queue (`SerialQueue`), one per direction, which also keeps frames in order. A job runs on
a thread of its own. What a job changes in the settings goes through the loop, the settings'
single writer — a job writing the file beside the loop's own copy would be undone by the next save
of that copy.

## ONNX Runtime is loaded, never linked

The library is looked for at the first separation — at `$STUDIO_ONNXRUNTIME_DIR`, then beside the
executable or in a `resources/onnxruntime` near it — and loaded then. Linked, a machine
missing it could not start the supervisor at all, engine and tunnel included, over one feature;
loaded, only the separate job says what is missing. The build copies it beside every executable it
makes, and the staging (`engine/scripts/docs/buildEngine.md`) keeps it there.

Windows takes the DirectML package, whose last release is 1.24; macOS arm64 and Linux take 1.30,
and macOS 1.30 needs macOS 14. A platform ONNX Runtime ships no binary for builds without
separation. CoreML is offered and cannot compile HT-Demucs; the job falls back to the CPU and says
why (stem-separation's [stemSplit.md](../../../packages/stem-separation/docs/stemSplit.md) is the
page on providers and on the model).

## A crash says why

An app restarts a supervisor that died, so what a crash leaves is all there is to read. `Crash.cpp`
logs `fatal: … — uncaught exception: <what>` in `.studio.log` and, on Windows, writes
`crash-supervisor-<pid>.dmp` beside it. An exception nobody caught on one of the tunnel's or the
jobs' threads ends in `abort()`, whose exit code on Windows is `0xC0000409` and nothing else; the
dump is taken from SIGABRT because MSVC's `abort()` fails fast past any exception filter, and
`set_terminate` is per thread there, so only the signal covers every thread. Open the dump in Visual
Studio or WinDbg beside the build's `.pdb` to read the stack.

## Two diagnostics

`k7-supervisor --probe <address>` asks a studio's registry the hello a connect would, and prints
why it did not answer — a refused certificate and a missing host read differently.
`k7-supervisor --separate <mix> <model> <outDir> [providers]` runs one stem separation on this
machine and prints its progress. Neither touches the state directory.

## What `.studio.log` says, and when

The merged log is where a machine's trouble is read after the fact, so what fails says so there —
not only on an app's status light, which is gone when the app is:

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

A heartbeat cannot fail silently: a registry refusing every heartbeat, unread, is an engine listed
and then unselectable with nothing in its log. Two things keep a heartbeat from being refused for
nothing. The JSON is dumped with `error_handler_t::replace`,
so a byte that is not UTF-8 costs one character rather than throwing the whole heartbeat away; and
on Windows the hostname is `GetComputerNameExW`'s, converted to UTF-8, since `gethostname` answers
in the ANSI code page and `PC-FRÉDÉRIC` there is not UTF-8. The registry's half is
`packages/engine-registry/docs/heartbeat.md`.

## The performance rating is compiled

The single-core figure of the rating is a biquad over a fixed budget, compiled rather than
JIT-compiled, so it reads several times higher than a JIT-measured one on the same machine. The
reference in `packages/web-protocol/performance.ts` was measured under a JIT; ratings are
comparable between machines running this supervisor, not with a figure measured another way.
