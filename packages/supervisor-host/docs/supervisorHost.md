# The supervisor host

`engine/k7-supervisor` as the child of a node process: k7's backend under the tray, which runs the
machine's supervisor and so its engine (`apps/k7/backend/docs/localEngine.md`). The Android and iOS apps
drive the same supervisor the same way, from Kotlin and Swift (`engine/k7-runtime/docs/android.md`). The
package also stages the binaries every package carries: the tray's (`apps/k7-tray/scripts/stage.mjs`) and
the command-line engine's (`engine/scripts/build-engine.mjs`).

| subpath | what it holds |
|---|---|
| `supervisorHost` | the supervisor spawned and kept running |
| `hostProtocol` | the NDJSON frames it speaks, typed from `schema/hostProtocol.schema.json` |
| `stageEngine` | the newest engine and supervisor builds copied into an app's staging `bin/` |

## Not a server

`engine/k7-supervisor` is native and speaks NDJSON on stdio
(`engine/k7-supervisor/docs/hostProtocol.md`), so it gets no guard and no tsx: `SupervisorHost`
spawns it directly and keeps it running. Five choices:

- **Death is read from the process, never the pipe.** The engine outlives a supervisor crash by
  design, and a stdout copy inside it would hold the pipe open; Node's `exit` event is the
  process's own.
- **A crash is relaunched on 1s→30s backoff**, reset only after a run of 20s. One that dies at
  once is broken, and relaunching it every second would bury the log.
- **The backstop kills only an engine the pidfile proves.** An engine still alive after the
  teardown is killed from `engine.pid`, and a pid is reused by the OS: `enginePid.ts` reads the
  start time and executable the supervisor wrote there and kills only when the OS reports the same
  for an executable named `k7-runtime`. A bare pid, or a process the OS will not describe, is left
  running (`engine/k7-supervisor/docs/supervisorPolicy.md`).
- **A write to a dead supervisor is logged, not thrown.** Its stdin's EPIPE has a listener, since
  an `error` event nobody hears ends the process.
- **It is spawned `detached` on Windows, and told `STUDIO_HOST_PID`.** libuv's job lets
  grandchildren break away, so the engine would survive a force-killed host. The supervisor makes
  the job itself and hands the host the only handle.

## One schema for the wire

`schema/hostProtocol.schema.json` is the host protocol's single definition
(`engine/k7-supervisor/docs/hostProtocol.md`). It lives in this package because this is the one
place that both runs JavaScript tests in CI and is reachable by path from the engine's CMake, which
points `HostProtocol_test.cpp` at `schema/fixtures/`. Five choices:

- **The TypeScript types are generated, by quicktype, and committed.** `npm run generate` runs
  `scripts/generateProtocol.mjs`, which pins quicktype's exact version and fetches it through npx;
  no build and no CI job runs it, so nothing depends on it but the person changing the schema.
  `src/hostProtocol.generated.ts` is excluded from biome and from `lint:comments` by its name.
- **What a host does with a frame stays hand-written.** `Snapshot`, `EMPTY_SNAPSHOT` and
  `snapshotOf` are derived from the generated `StateFrame`: a frame may leave an empty list out and
  writes null for "none", and a snapshot has every list and no null.
- **The C++ writer is not generated.** nlohmann's `NLOHMANN_DEFINE_TYPE_*` cannot say what the wire
  says: an `error` absent when empty, `downloads` absent when empty, `pluginCount` null, `paths`
  folded from two fields, a fixed key order. The writer stays, and fixtures hold it to the schema.
- **The schema test validates with zod's `fromJSONSchema`.** zod is already a dependency of the
  repository, where ajv is not; the suite also checks that a frame breaking the schema is refused,
  so the converter is proved to enforce what the test relies on.
- **The phones decode no typed frame.** `SupervisorHost.kt` and `SupervisorHost.swift` hand each
  snapshot, as the dictionary it arrived as, to the page that draws it, and read only a handful of
  keys themselves: the `engine` frame, `sessions[].playing`, `instances[].url`, a result's `ok`.
  quicktype's Kotlin decoders need Klaxon, Jackson or kotlinx.serialization, none of which the app
  has, and a typed copy beside the dictionary would decode the heaviest frame twice for those keys.

