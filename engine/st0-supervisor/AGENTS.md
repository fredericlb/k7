# AGENTS.md — st0-supervisor

The engine machine's supervisor, in C++, run two ways: spawned by an app (the desktop app, the phone)
and driven over NDJSON on stdio, or on its own as the command-line engine, `st0-supervisor --config
<file>`. Either way it starts or adopts `st0-engine`, keeps it listed at the studios it is connected
to, holds the tunnel a server reaches the machine through, and runs the jobs the server hands it. Why
it is shaped this way, and the two modes: [docs/supervisor.md](docs/supervisor.md). The wire to an app:
[docs/hostProtocol.md](docs/hostProtocol.md). Its paces and rules:
[docs/supervisorPolicy.md](docs/supervisorPolicy.md). The sampled instruments it downloads:
[docs/instruments.md](docs/instruments.md).

## Build and test

```
cmake --preset macos-clang        # windows-msvc, dev-gcc, release-gcc, android-arm64 (docs: st0-engine/docs/android.md)…
cmake --build --preset macos-clang
build/macos-clang/st0_supervisor_tests
```

The first configure fetches mbedTLS, IXWebSocket, libdatachannel and ONNX Runtime; after that a
build is seconds. `npm run dev` rebuilds it on save and restarts it (`scripts/dev-native.mjs`).

The unit tests need no device, no network and no engine. The tunnel is tested by
`packages/engine-tunnel`'s suites, which pick up the built `tunnel_harness` and run every case
against it: after touching the tunnel code, run `npx vitest run` there. A change to
`HostProtocol.h` is a change to `packages/supervisor-host/src/hostProtocol.ts` too.

## Rules this code keeps

- **Stdout is the app's protocol.** Only `protocol::emit` writes there, and nothing at all in `--config` mode.
- **State lives on the loop's thread.** Blocking work goes through `Loop::work`; a socket's own
  callback thread never waits.
- **Paths cross as UTF-8.** `paths::utf8` and `paths::fromUtf8`, never a narrow `path::string()` for
  anything a user named.
- **A dependency is fetched and pinned** — a tag for a git source, a SHA-256 for an archive.
