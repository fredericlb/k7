# Audit — the services and the engine

Everything that links a surface to `engine/k7-runtime`: what is shared, what is copied, and where the
reliability of the connections gives way. Written to be executed in batches — the plan is at the
end of the page.

> **The other half is elsewhere.** This page stops at the socket. What happens once the message
> has arrived — the threads, the audio callback, the cost of loading a project, and the first-play
> freeze — is in
> [engine/k7-runtime/docs/audit-stabilite.md](../engine/k7-runtime/docs/audit-stabilite.md).

## Scope

Two services really talk to the engine: **k7's editor** and its **media library** (the `pl8` session), each by its two halves (browser +
backend), plus the **supervisor** (`engine/k7-supervisor`), which announces it to the registries. At the
margin, the **rehearsal pages** only listen, subscribing to the bench's master broadcast to record
a chain (`packages/ui-rehearsal/docs/chainSource.md`).

Volume: ~6,200 lines of TypeScript, tests excluded, in four engine packages (`engine-protocol` 809,
`engine-client` 470, `engine-browser` 3,047, `engine-registry` 1,888), 183 C++ files under
`engine/k7-runtime`, and 62 app files that import `@studio/engine-*`. The most churned files were the supervisor's loop and
`engine-browser/src/engine.ts` — reliability is decided there.

## What works, and must not be undone

**`engineAccess(base, json)`** is the single discovery path: every surface uses it, without
exception. The package removes a whole class of bug — the `base` passed twice, the unguarded list
that produces an eternal spinner.

**`packages/project-shell`** is the repo's one clean decoupling: it does not depend on
`engine-browser`, it declares `GateEngine { fileBase; token }` structurally, and the apps mount the
same `ProjectGate`. This is the pattern to reproduce.

**The C++ is hardened in depth**: `SessionRegistry` under mutex, non-inserting accessors, two verbs
`broadcast`/`broadcastTo`, audio emitter on its own thread, orphan listener purge. Sixteen failure
modes are documented and guarded there.

Documentation is in fact the repo's strong point: most of the traps in this area are written down
in black and white. The problem is not that the failure modes are unknown — it is that **a fix
stays local to the surface that suffered** as long as no package carries it.

## B. Security — to be decided, not mechanically corrected

**Settled for the LAN by pairing** (`engine/k7-runtime/docs/pairing.md`): a LAN peer drives, and
reads the token, only once the musician has paired it; the machine and the server's relay need
nothing. What follows is the situation pairing answered, kept for the reasoning.

**The engine token leaked by design.** `server/ServeMachine.cpp`, the `whoami` handler: `whoami` returned the token to any
socket that asked for it, with no prior authentication.

Consequences: anyone reaching `ws://<engine>:8765` — loopback, or the whole LAN when the supervisor
binds `0.0.0.0` — obtains in one message enough to claim the lease and deregister the engine. The
token has no expiry, and revoking it means deleting `engine-id.json`, which also changes the `id`
and breaks the remembered preference. There is no file route on that machine to reach with it:
workspaces are served by the server's file hub, which takes a session ticket and never this token
(`packages/file-hub/docs/fileHub.md`).

This is not a bug to patch: it is a trust model to settle. The options run from "accept it and
write it down" to "the engine no longer emits its token on `whoami`", which requires another proof
of identity for the probe. What the token proves today is written in
`packages/engine-registry/docs/token.md`.

## C. Duplication — what a package would save

### C3 — one predicate for "reachable"

k7's `apps/k7/frontend/src/components/EngineGate.tsx` tests `wsUrl`, `fileBase` and the token by
hand, where the package's `isReachable()` says the same thing and only
`apps/k7/frontend/src/settings/PairedDevicesSection.tsx` calls it — the token-less filtering
`access.md:37` describes is guarded in `choose.ts`, not in a picker that filters for itself.

### C4 — the shapes of the wire, declared once

The reply shapes both clients read, the decoders that fill a frame's absent fields, and the
`Outbox` a down socket holds are `@studio/engine-protocol/decode`, which the Node client
(`engine-client/src/engineControl.ts`) and the browser one (`engine-browser/src/engine.ts`,
`engineEvents.ts`, `engineLink.ts`) both import: a field one of them drops is a field both drop.

`ENGINE_PROXY_PATH` is defined once, in `web-protocol/engineAccess.ts`, and read by the relay
(`engine-registry/proxy.ts`), its guard (`engine-registry/mount.ts`) and the probe
(`engine-browser/src/probe.ts`).

What remains: the "latency or out of reach" formatting, a one-line function copied per picker
whose place is `web-protocol/quality.ts`, next to `formatLatency`.

### C5 — dead code

`probeLocalEngine()`, `EngineLookup.ambiguous`, `RELOOK_MS` outside its own file:
zero callers outside tests. The streaming instrumentation described in `streaming.md`
(jitter, drift, `dropped`) is exposed by no screen.

## D. The supervisor

- **No backoff on an unreachable registry**: `beat` relaunches N `fetch` every 5 s, forever,
  without logging or spacing. The contrast with the engine's crash watch, which does have a
  1 s → 30 s backoff, is stark.
- **`heartbeat()` is all-or-nothing**: three healthy registries out of four show red, without
  saying which one is missing — where the attached snapshot does carry the URLs.
- **`lastHeartbeatOk` conflates three things**: engine stopped, registry unreachable, and an
  out-of-cycle overwrite by `addRegistryUrl`.
- **Level 3 of `resolveRegistryUrls` is sticky**: a backend killed by `SIGKILL` leaves its
  announcement file behind, the supervisor beats forever towards a dead port, and combined with the
  all-or-nothing above it puts out the light for everyone else.
- **Pidfile adoption verifies nothing**: neither that the process is an engine, nor that it carries
  the same token. An engine adopted with another identity makes what the supervisor announces
  diverge from what the engine answers to `whoami` — and the probe, which compares the `id`s,
  declares it unreachable without a word.

## E. Tests — the asymmetry that costs

A hundred or so cases cover **the pure functions and the policies** well: `chooseEngine`,
`forSession`, `desiredSwitch`, `seqGap`, `decodeStreamFrame`. They cover **almost nothing of what concerns a socket over time**: opening,
closing, reopening, queueing, replay, ticket. Yet the thirty-odd bugs recorded in the docs are, to
three exceptions, **all** connection lifecycle bugs.

The lease is the exception: `engine-registry/registry.test.ts` covers the grant, the renewal, the
takeover, the loser's refusal, expiry without a goodbye, and release by secret. Covered by no test:
reconnection (no client), subscription replay — the only resynchronisation that exists —, the
`outbox`, the WebSocket half of the relay, `issueEngineTicket`/`verifyEngineTicket` (including
non-replay across engines, a central security property), `holdEngine`, and the ~35 dispatch
branches of the two clients.

Three C++ ↔ TS agreements are verified by nothing: the binary frame ("nothing checks that they do
but a listener, and a disagreement plays as noise"), the `broadcast`/`broadcastTo` choice for each
per-session reply — whose fix is a review convention —, and `ProjectDoc` against its ~60
`j.value(...)`, where a field renamed on the TS side silently takes its default on the C++ side.
That is exactly the failure mode of the `ClipMoved` stub: the changelog says success, the audio
does not move.

## Plan

Ordered by value/risk ratio.

### Batch 4 — C5's dead code

`probeLocalEngine`, `EngineLookup.ambiguous` and the streaming instrumentation no screen reads:
delete, or give each a caller.

### Batch 5 — the lifecycle tests

A fake engine and a fake registry in memory, then cover: reconnection, replay, `outbox`, ticket,
WebSocket relay. Plus a C++ ↔ TS contract test on the binary frame and on `PER_SESSION_REPLIES`.
This is the batch that stops the thirty already-fixed bugs coming back.

### Batch 6 — the trust model

Section B. To be settled before anything is written.

## Documentation corrections to make along the way

- `engine-browser/docs/access.md` presents token-less filtering as settled while k7's picker still
  does it by hand (C3).
- `engine-browser/docs/streaming.md` says "four apps" for `./stream` (there is one), and its table
  for reading the measurements describes instrumentation no screen exposes.
