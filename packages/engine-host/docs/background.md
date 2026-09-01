# The process-level net

Every process on the audio axis installs `unhandledRejection` and `uncaughtException` at
startup.

## Why it is needed

Node ends the process on a rejection nobody catches. `void f()` only tells Biome a promise is
deliberately not awaited; it does not catch it. The supervisor runs seven timers that touch the
network or the disk (`supervisor.ts`), and the file service has three sites of the same shape —
two in a route, one in a watcher callback. Its route guard `wrap()`
(`commons/packages/http/route.ts`) catches only what a handler **returns**, and `void` returns
immediately, so the guard misses those by construction.

The failure is quiet rather than loud: the supervisor dies, the engine stays alive behind it,
the app relaunches it on its backoff and the new supervisor re-adopts the engine through its
pidfile. It recovers, so it can go on indefinitely without being noticed.

## The two halves are deliberately asymmetric

| |  |
|---|---|
| **unhandled rejection** | logged, the process lives. A poll that failed is not a reason to die, and the next one is seconds away. |
| **uncaught exception** | logged **with its stack**, then exit. The app (for the supervisor) and `fileServiceWatch` (for the service) restart it. |

Surviving both is a trap: an uncaught exception leaves invariants broken, and a process that
goes on answering *wrongly* is worse than one that is absent. What the net adds is not survival
— it is the line that says which of the two happened.

## Two copies rather than a package

`packages/engine-host/src/background.ts` and `packages/file-service/src/background.ts` share a
body and differ only in the channel: the supervisor writes to `stderr`, where the app collects
it for the merged log; the service writes through `console.error` with its neighbours' prefix.

Neither package may depend on the other — the supervisor launches the service. Their only shared
dependency is `@studio/engine-client`, and the engine's Node client is not the home of a
process-level guard. `commons/` is shared with `phare`, so touching it commits two repositories.
A package for ten lines is a decision, not a cleanup.

## Not covered

`engine/st0-engine` has one `try`/`catch` in its whole library (`NamPlugin.cpp`), no `try` at
`main()` level and no `std::set_terminate`. An exception thrown from a lambda posted on the
message thread ends the process without a word. Open lot — `docs/constat.md`.
