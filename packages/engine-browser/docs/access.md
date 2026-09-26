# `engineAccess` — one object for reaching an engine

The pieces exist separately: `registry.ts` (the routes), `probe.ts` (measuring), `choose.ts`
(the policy), `lease.ts` (the lease). `access.ts` binds them to the service's prefix, once.

## The prefix is given once, to the constructor

`base` — `""` for st0, `/pl8` — decides both the registry's routes and what the probe composes.
Passed separately to two functions it is two places for one fact, and nothing would force an app
to keep them in step. The one that drifts most quietly is the probe's, and it is what decides
whether the **relay** is offered: a service can then list its engines correctly and reach none of
them remotely, with no type noticing.

```ts
export const engines = engineAccess<PublicEngine>(BASE, json);
```

## `find()` is the sequence, not the pieces

List, read the preference, measure, apply the policy. Written per surface that sequence
diverges: filtering on `wsUrl` alone offers an engine that answered without a token and cannot
then be selected, and raises a picker in front of a single reachable engine.

It answers `ranked` for the picker, `chosen` for starting, `ambiguous` for whether there is a
question to ask, and `rememberedId` for ticking the chosen row — including when that choice did
not answer, which a picker needs and a start does not.

`preferId` takes precedence over the stored preference: the same value, but already current when
somebody changes engine from a neighbouring header.

**A silent registry is not an error.** `find()` swallows both requests' failure and answers an
empty list — the honest state, and a screen, where a rejected promise inside a gate's effect is
an eternal spinner.

## A probe is a snapshot, so it is re-run

"Unreachable" is a state of its own — `probeEngines` answers `latency: null` when no candidate
replied in time — so without re-measuring one unlucky race marks an engine unreachable until the
page reloads.

`relook.ts` answers a counter for the dependencies of the effect calling `find()`. It advances
every 15 s, aligned on `REGISTRY_TTL_MS` — longer buys nothing, an engine that stopped beating
having left the list; shorter probes faster than the information can change — and when the tab
returns to the foreground, which is precisely when "unreachable" is read.

Where to wire it differs, and the difference is a choice:

| surface | when |
|---|---|
| pl8, `useEngineChoice` | **always** — a permanent picker in the header |
| st0 `EngineGate` | **only while `picking`** — re-measuring after the choice takes the screen backwards under someone working |

In pl8 the re-measure passes the current choice to `find(preferId)`, or an optimistic `choose()`
whose save has not landed is overwritten by the server's value and the picker drifts back.

The probe's timeout is **3 s**. Candidates are measured in parallel, so an absent engine costs
one timeout rather than one per address; and on any machine but the engine's the only workable
route is the relay, which a loopback round-trip's budget would declare unreachable for being
merely longer.

## The probe offers only what can succeed

An HTTPS page does not open `ws://` to a LAN address. Listing them anyway works — the browser
discards them — but each discarded attempt counts as **mixed content**, and that is what makes a
page non-installable. The surfaces menu could then not be added to a home screen, which is the
device it exists for (`apps/st0/frontend/docs/external.md`).

`candidatesFor` therefore offers loopback — potentially trustworthy by definition, dialable from
HTTPS — and the relay. LAN addresses stay listed over plain HTTP, where they work. An engine whose
supervisor holds a tunnel adds a fourth, `rtc:`, a WebRTC data channel straight to its machine
(`packages/engine-tunnel/docs/rtc.md`); `openSocket` makes it a WebSocket to everything above it,
and it is raced like the others rather than preferred.

## Hosted files are opt-in, per app

When the registry's server hosts the workspaces (`packages/file-hub/docs/fileHub.md`), an app
built with `hostedFiles: true` sends every file call there instead of to the engine's machine:
`fileBase` becomes the hub, and `fileToken` a ticket the hub minted from the session, with the
chosen engine's id after a `~`. The ticket rides in the header the file service's gate already
reads, so none of the calls that build that header change, and none of them need a cookie
across origins. `token` stays the engine's own, since the claim is checked against it.

`hostedFiles()` answers the same hub with no engine in the ticket, for a page that lists or edits
files and plays nothing — st0's home page, whose workspaces exist whether or not an engine runs.

st0 and z0's editor opt in: they open a project, and a project is the server's. pl8 does not —
its player resolves songs against the engine machine's own médiathèque cache and sends the
engine a document itself, which the server's files would name in paths the engine cannot open.

## Outside this object

- **`EngineClient`**: opening the socket with the service's session
  (`sessionFor(SESSIONS.st0, …)`), which each app holds and only one of them must —
  `@studio/engine-protocol/docs/sessions.md`.
- **The file service**: `fileBase` goes from the probe into `@studio/project-shell/fileApi`, and
  **travels with the address that answered**. A relayed socket beside a direct `http://` rebuilds
  the mixed-content wall on the other half (`@studio/engine-registry/docs/proxy.md`).
- **The picker's policy**: pl8 leaves an editor open with no engine, st0's gate does not. A
  product difference, not a plumbing one. st0 never asks, and never reuses the remembered
  engine either: every open takes `bestEngine` (`choose.ts`) afresh, and does not store it as
  the preference. The order, each step only among the equals of the one before:
  1. **compatibility** with the project (`compat.ts`): the share of the plugins the project
     needs its engine to host — internal and VST alike — that the engine's catalogue has,
     `available / required × 100`, floored so only a full house reads 100. An engine whose
     catalogue did not arrive in time ranks below any score;
  2. the **latency class** (Q1, Q2, Q3);
  3. the **performance** score.

  The latency in ms only breaks a tie left after all three. The remembered engine is used only
  when no candidate qualifies at all.

  The formula is `@studio/web-protocol/compat`, and it is applied on one of two roads, by where
  the project's files live (`apps/st0/frontend/src/engineCompat.ts`):
  - **on the server** (hosted files): the server lists the needs, `/project-plugins`, with no
    engine bound; each catalogue comes from the engine itself, `list-plugins` on a socket of its
    own — a probe query, answered without a session — and the browser scores;
  - **on the engine's machine**: that machine's file service scores the project against its own
    engine's scan, `/project-compat`, and each candidate answers for itself.

  When nothing could be told (no `@local` project in the address, no engine answered)
  compatibility is left out and the order starts at 2.

  The header's engine menu (st0's `EngineSwitch`) is still an explicit choice, and it still
  saves the preference; the gate simply no longer reads it first.
