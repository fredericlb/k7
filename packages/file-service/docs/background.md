# The process-level net

The file service installs `unhandledRejection` and `uncaughtException` at startup
(`src/background.ts`).

## Why it is needed

Node ends the process on a rejection nobody catches. `void f()` only tells Biome a promise is
deliberately not awaited; it does not catch it. The file service has sites of that shape — two in a
route, one in a watcher callback — and its route guard `wrap()` (`commons/packages/http/route.ts`)
catches only what a handler **returns**, and `void` returns immediately, so the guard misses those
by construction.

The failure is quiet rather than loud: the service dies, the file hub starts it again on the next
request, and it can go on indefinitely without being noticed.

## The two halves are deliberately asymmetric

| |  |
|---|---|
| **unhandled rejection** | logged, the process lives. A poll that failed is not a reason to die, and the next one is seconds away. |
| **uncaught exception** | logged **with its stack**, then exit. The file hub starts it again. |

Surviving both is a trap: an uncaught exception leaves invariants broken, and a process that
goes on answering *wrongly* is worse than one that is absent. What the net adds is not survival
— it is the line that says which of the two happened.

## Work a command starts and does not wait for

`runInBackground` (`src/backgroundJobs.ts`) is what a verb's `background` hook runs on. A video
transcode is the first user: minutes long, so a `/command` request held open for it would freeze
the command bar. One job per TAG at a time, so running the verb twice joins the first run instead
of encoding one file twice. The job goes through `guard` like any other unawaited promise.

There is no progress route. A job reports through what it WRITES, the copy and the clip field
naming it, which moves the revision token every view already follows, and through one line in the
log when it ends. A registry the browser polled would be a second account of state the files
already hold.

## Not covered

`engine/k7-runtime` has one `try`/`catch` in its whole library (`NamPlugin.cpp`), no `try` at
`main()` level and no `std::set_terminate`. An exception thrown from a lambda posted on the
message thread ends the process without a word. Open lot — `docs/constat.md`.
