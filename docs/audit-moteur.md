# Audit — the services and the engine

Everything that links a surface to `engine/st0-engine`: what is shared, what is copied, and where the
reliability of the connections gives way. Written to be executed in batches — the plan is at the
end of the page.

> **The other half is elsewhere.** This page stops at the socket. What happens once the message
> has arrived — the threads, the audio callback, the cost of loading a project, and the first-play
> freeze — is in
> [engine/st0-engine/docs/audit-stabilite.md](../engine/st0-engine/docs/audit-stabilite.md).

## Scope

Two services really talk to the engine: **st0** and **pl8**, each by its two halves (browser +
backend), plus the **supervisor** (`engine/st0-supervisor`), which announces it to the registries. At the
margin: **z0** links to it at one point only, a 74-line offline render
(`apps/z0/backend/src/render.ts`) that goes through the file service over HTTP and never the
socket; **k7** does not touch it at all.

Volume: ~7,400 lines of TypeScript in the five engine packages (`engine-protocol` 959,
`engine-client` 684, `engine-browser` 1,944, `engine-host` 3,029 — the TypeScript supervisor
`engine/st0-supervisor` now replaces —, `engine-registry` 793), 52 C++ files, and 35 app files that
import `@studio/engine-*`. The most churned files were the supervisor's loop and
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

**Settled for the LAN by pairing** (`engine/st0-engine/docs/pairing.md`): a LAN peer drives, and
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

### C2 — the engine pickers, three copies

The full-screen spinner, the "Connect" card, the engine row, and the `useRelook` effect duplicated
word for word with its `biome-ignore` (26 lines for a `useEngineList(active)` of ~12). The gates
share the `Phase` structure, `findEngine`, `pick`, the `auth.me` effect, the three render branches
and the `ranked.map` loop; what distinguishes them is a comment banner, an import and a few
strings.

A `@studio/engine-gate` carrying the phase machine, the parameterised relook effect,
`<EngineRow>`, the spinner and the anon card would bring **~770 lines down to about 400**. Above
all it would make the divergences below structurally impossible. The numbers are to be rechecked
when the batch is taken.

### C3 — the accidental divergences that package would remove

1. **Four different predicates for "reachable"**, two of which ignore the token
   (`z0/Gate.tsx:107`, `pl8/EnginePicker.tsx:49`). This is the bug `access.md:37` describes —
   guarded in `choose.ts` but not in the pickers, which filter for themselves. An `isReachable()`
   exists in the package and is **called nowhere**.
2. **z0 has no `useRelook`** — the only permanent picker that can stay stuck on "out of reach"
   until a reload, precisely what `relook.ts` exists to kill.
3. **z0 never takes the lease**, where `lease.md:20-27` records two apps shipping that bug
   independently. z0 drives no project, but it drives an engine, so the rule holds.
4. **`assigned` ignored by 2 gates out of 3**: only st0 hides an engine already taken.
5. **`select` before entering: st0 alone.** The other two enter on a token unverified server-side.
6. **"Search again" destroys the list** in z0 (`setPhase({k:"looking"})`), not in st0 or pl8.

### C4 — the shapes of the wire, declared twice

`EngineSessionInfo`, `EngineAudioDevice`, `EnginePluginInfo`, `EngineEditPlugin` exist in
duplicate, in `engine-browser/src/engine.ts:44-75` and `engine-client/src/engineControl.ts:55-78`,
with the same field-by-field coercions copied across. The comment at `engine.ts:41-43` acknowledges
it and says what to do: "if a third copy ever appears, move them there instead" — into
`engine-protocol`, which exists and carries only the erased types.

Two divergences have already been born there: the browser reads `pitches`/`clarity` on
`io-levels`, the Node client ignores them.

Same for the address list, built twice from the same `EngineAddresses`: `probe.ts:161-165`
(browser) and `proxy.ts:70-73` `hostsFor` (server), in two packages.

And for the "latency or out of reach" formatting: 5 copies of a one-line function whose place is
`web-protocol/quality.ts`, next to `formatLatency`.

Same family: `ENGINE_PROXY_PATH` is exported by `engine-registry` and **nobody imports it** — the
path is rewritten by hand on the browser side (`probe.ts:170`).

### C5 — dead code

`probeLocalEngine()`, `isReachable()`, `EngineLookup.ambiguous`, `RELOOK_MS`,
`StreamPlayer.snapshot()`: zero callers outside tests. `packages/player-web/src/moteurPlayer.ts`
(~300 lines, drives the engine through `EngineClient`) is instantiated by nobody — a seam taken on
purpose, see `docs/inventaire.md` §3. The streaming instrumentation described in `streaming.md`
(jitter, drift, `dropped`) is exposed by no screen.

Outside the engine scope but the same family: `apps/z0/buzzer/src/lib/ws.ts` and
`apps/z0/remote/src/lib/ws.ts` are identical to the byte (74 lines), `presenter` is a third copy of
69 lines. None of the three reconnects.

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
`forSession`, `desiredSwitch`, `normaliseOrigin`, `resolveRegistryUrls`, `seqGap`,
`decodeStreamFrame`. They cover **almost nothing of what concerns a socket over time**: opening,
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

### Batch 3 — `@studio/engine-gate`

C2 and C3. The biggest batch (~770 lines towards ~400), and the one that removes six divergences at
a stroke. The package must be born with the reconnection semantics of
`packages/engine-browser/docs/reliability.md` rather than freezing those of one picker.

### Batch 4 — move the wire shapes down into `engine-protocol`

C4, plus the C5 cleanup. The comment in the code already says what to do.

### Batch 5 — the lifecycle tests

A fake engine and a fake registry in memory, then cover: reconnection, replay, `outbox`, ticket,
WebSocket relay. Plus a C++ ↔ TS contract test on the binary frame and on `PER_SESSION_REPLIES`.
This is the batch that stops the thirty already-fixed bugs coming back.

### Batch 6 — the trust model

Section B. To be settled before anything is written.

## Documentation corrections to make along the way

- `engine-browser/docs/access.md`: its "where to wire `useRelook`" table omits z0, the one case
  where the doc says it must *always* be wired, and token-less filtering is presented there as
  settled while two surfaces still do it.
- `engine-browser/docs/lease.md` presents the lease as a closed subject; z0 takes none.
- `engine-browser/docs/streaming.md` says "four apps" for `./stream` (there is one), and its table
  for reading the measurements describes instrumentation no screen exposes.
- `engine-registry/docs/proxy.md` promises a clean 502 on a streamed body; the code
  (`proxy.ts:291`) retries on a stream already partly consumed.
