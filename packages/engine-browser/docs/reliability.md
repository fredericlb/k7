# Holding a link, not just opening one

What `EngineClient` does between the socket opening and it closing for good. Almost every bug in
this area is a lifecycle bug — never a protocol one (`docs/audit-moteur.md`).

## The ticket expires, the address does not

The URL is not a string frozen at construction but an `EngineUrl`: a function, called again
**before every attempt**.

This is the area's most expensive failure mode. From any machine other than the engine's, the only
workable route is the relay — an HTTPS page will not open a `ws://` to a LAN address — and the
relayed URL carries a ticket that lives **one minute** (`engine-registry/proxy.ts`). Frozen at
construction, any reconnection more than a minute after the probe replays a dead ticket, gets a
401, and starts over. Indefinitely, with nothing ever asking for the list again. The nominal path,
then, not an edge case.

`engines.linkUrl(chosen)` is what gets passed: it returns the **already-probed** address on the
first call — the gate has just paid that round trip, and repeating it would be free in latency and
expensive in sockets — then a fresh address on every one after. A function, so no surface can
succeed at only half of it.

Returning `null` means "no engine to reach right now": the client waits and asks again, instead of
counting that as a connection failure.

## An open socket carrying nothing

There is no ping anywhere in this protocol, nor underneath it: the engine's server embeds
IXWebSocket with `kPingIntervalSeconds(-1)` — heartbeat disabled. A frozen relay, an expired NAT,
a laptop coming out of sleep therefore leave a socket that declares itself `OPEN` and carries
nothing: `close` never fires, the reconnection never triggers, and `send()` writes into the void.
Hence a watchdog on the browser side.

It is asymmetric on purpose:

- **Anything arriving** counts as proof of life. The engine pushes its state ~20 times a second,
  so a busy client never probes — the cost is nil in the common case.
- **Nothing for `ENGINE_IDLE_PING_MS`** and we send `whoami`. It is the only verb the engine
  answers whatever its state, and it is *engine-global*: it comes back even to a client driving no
  session, which a watchdog sitting on the state frame alone would not cover.
- **No reply within `ENGINE_PONG_TIMEOUT_MS`** and the socket is dead whatever it claims. We close
  it ourselves rather than wait for a `close` that will not come.

A link that goes down says nothing about the transport, and the last frame said `playing: true`.
So the host resets its store on disconnect (`EngineStore.offline`): stopped, meters at the floor,
the playhead left where it stood. A dead engine plays nothing, and the screen must not pretend it
does.

## The backoff, and why it doubles

A fixed one-second backoff means a tab forgotten in the background, on a machine whose engine is
off, hits the relay once a second for as long as the tab lives — and each hit costs the backend a
**sequential** dial of every advertised address. Same pattern as `pruneIdleLinks` in the file
service.

Hence: doubling from `ENGINE_RECONNECT_MIN_MS`, capped at `ENGINE_RECONNECT_MAX_MS`, and
**jittered** — half the interval is drawn at random. The jitter is for the other half of the
problem: several tabs dropped by one relay restart would otherwise come back in lockstep. The
counter resets on a socket that actually opened.

### The generation

Every `connect()` bumps a counter, and a socket's handlers do nothing once it has moved. That is
what makes the second opinion harmless: the watchdog and the `close` event can both be talking
about the same socket, and without this guard the second would schedule a **second** backoff
ladder beside the first. Two ladders each doubling is how a discreet retry becomes a flood.

## The queue covers a blink, and nothing more

With no size or age limit, the `outbox` would accumulate everything the surface sent during a
ten-minute outage and fire it **all at once** on reconnection, stale transport verbs included.

So it is bounded by `ENGINE_OUTBOX_MAX` (oldest out — the most recent command is the one that
still describes what the person wants) and by `ENGINE_OUTBOX_TTL_MS` on replay: a command nobody
is waiting for is not worth sending.

`sendNow()` is for what is only valid on THIS socket — the watchdog's `whoami`, the document
replayed below: queueing those would make no sense.

## The document, replayed

Subscriptions (`watch-plugin-params`, `subscribe-waveform`, `broadcast`) live in the engine and
are replayed on every open. So is the **document**, and that is the half easily forgotten.

It shows badly and costs a lot: if the engine restarts, it comes back empty and the surface goes
on driving it. The only symptom is "the engine ignores Play", without a log line tying it to a
connection that blinked.

`sendProject` therefore keeps its document, and the open resends it **first** — before the
subscriptions and before the queue, since both talk about a document the engine does not have yet.
It is cheap: `EngineHost::apply` diffs against a baseline that survives the outage, so a resend
yields a correct diff rather than a full reload.

The `hello` preceding all that carries `role: "driver"`, and it is a field rather than a separate
verb on purpose: the engine counts its drivers per session and releases a project whose last one
has gone, so a reconnection that did not re-declare itself would make the engine drop the very
document the next line is about to replay. Making it a field of `hello` makes it impossible to
forget — every connection sends one.

### Who calls `sendProject`, and what is not folded

st0 never calls it: its documents are **compiled** from a folder of YAML, which the file service
does, so its browser only drives transport. An app that builds its own document (a module preview,
a deck) has nothing to compile and no reason to go through a second process to reach a socket it
already holds.

The document goes **as is**. The Node client folds groups onto their members and strips video
before sending; a document from `@studio/engine-protocol/build` has neither, so both folds are the
identity there. Fold before calling if yours can have either.

## The activity thread

`BeginActivity` marks a slice of work and returns its end callback. The engine pushes state at
frame rate and parameters at 20 Hz: a handler gone slow is therefore invisible in a profile taken
afterwards, and obvious in a hang report. Whether anyone is watching is the host's business, not
this client's — hence the default that does nothing.

## One budget for reaching an engine

`ENGINE_REACH_BUDGET_MS` and `ENGINE_DIAL_TIMEOUT_MS` live in `@studio/web-protocol` because both
halves have to agree.

The browser probes its candidates **in parallel**: it spends the budget once. The relay dials them
**in sequence**; spending it *per address* would mean a machine advertising two dead interfaces (a
VPN, a Docker bridge) asks three times the browser's patience and is declared unreachable while
the engine answers quietly on loopback. So both stop at the same wall, and a first dead address
can eat at most `ENGINE_DIAL_TIMEOUT_MS`.

The other end of the same problem is in the supervisor's `engine/st0-supervisor/src/Addresses.cpp`: phantom interfaces — VPN,
containers, WSL, Hyper-V — are not advertised at all. They are not `internal`, so a filter on that
alone lets them through, and they carry perfectly ordinary private addresses; only their **name**
tells them apart.
