# `engineAccess` — one object for reaching an engine

The pieces exist separately: `registry.ts` (the routes), `probe.ts` (measuring), `choose.ts`
(the policy), `lease.ts` (the lease). `access.ts` binds them to the registry's address, once.

## The registry's address is given once, to the constructor

`base` is where the registry answers — k7's backend, the one registry (`packages/engine-registry/docs/shared.md`):
`serviceUrl(…, "pl8")`, which is k7's origin, for k7 and z0's editor, and the host's `apiBase()` for the
media library's screens; k7 names the backend holding its preferences through `prefsBase`. It decides both the registry's routes
and what the probe composes.
Passed separately to two functions it is two places for one fact, and nothing would force an app
to keep them in step. The one that drifts most quietly is the probe's, and it is what decides
whether the **relay** is offered: a service can then list its engines correctly and reach none of
them remotely, with no type noticing.

```ts
export const engines = engineAccess<PublicEngine, K7Prefs>(PL8, json, { prefsBase: BASE, hostedFiles: true });
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

## Who is taken unasked

Registration is open — a machine enrols with no account (`packages/engine-registry/docs/heartbeat.md`)
— so the list is not a list of the user's machines: anyone can heartbeat an engine and claim any
performance score. Taking one without a click would bind the account's workspaces to a stranger's
tunnel. So `chooseEngine` and `bestEngine` only ever take an engine that passes `mayAutoPick`
(`choose.ts`), and offer every other one in the picker:

1. the engine the account **remembered** — an explicit pick, saved by the picker or the header's
   engine menu;
2. an engine reached **directly** (`reachedDirectly`, `probe.ts`): the probe's winning socket is
   one of the engine's own loopback or private addresses, dialled from this browser, and its
   `whoami` answered there with the id and a token. That engine is on the user's machine or the
   user's network. A public address, the relay or WebRTC do not count, since what answers there
   is whatever the stranger registered;
3. the **server's own** engine, which the registry marks `server` because its tunnel presented the
   deployment's render key (`packages/engine-tunnel/docs/jobs.md`) — a secret no stranger holds.

The bench's rule in k7 (`accountEngine`) is not an exception: it takes the engine the account
already holds a claim on, and a claim is named by the session, never by the engine.

A first open from an HTTPS page on a machine with no local engine therefore lands on the picker
until the user clicks one, which remembers it. The server repeats the check on its side: a route
that reaches an engine for an account requires that account to hold a claim on it
(`packages/engine-registry/docs/claim.md`).

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
| the media library, `useSongEngine` | **always** — whether the account's engine answers decides where a song plays |
| k7 `EngineGate` | **only while `picking`** — re-measuring after the choice takes the screen backwards under someone working |

The probe's timeout is **3 s**. Candidates are measured in parallel, so an absent engine costs
one timeout rather than one per address; and on any machine but the engine's the only workable
route is the relay, which a loopback round-trip's budget would declare unreachable for being
merely longer.

## The probe offers only what can succeed

An HTTPS page does not open `ws://` to a LAN address. Listing them anyway works — the browser
discards them — but each discarded attempt counts as **mixed content**, and that is what makes a
page non-installable. The surfaces menu could then not be added to a home screen, which is the
device it exists for (`apps/k7/frontend/docs/external.md`).

`candidatesFor` therefore offers loopback — potentially trustworthy by definition, dialable from
HTTPS — and the relay. LAN addresses stay listed over plain HTTP, where they work. An engine whose
supervisor holds a tunnel adds a fourth, `rtc:`, a WebRTC data channel straight to its machine
(`packages/engine-tunnel/docs/rtc.md`); `openSocket` makes it a WebSocket to everything above it,
and it is raced like the others rather than preferred. The server answers a WebRTC offer only for an
account holding a claim on the engine, so before the claim that candidate simply loses; the relay,
before the claim, carries the probe and nothing else (`packages/engine-registry/docs/proxy.md`).

## Hosted files are opt-in, per app

When the registry's server hosts the workspaces (`packages/file-hub/docs/fileHub.md`), an app
built with `hostedFiles: true` sends every file call there instead of to the engine's machine:
`fileBase` becomes the hub, and `fileToken` a ticket the hub minted from the session, with the
chosen engine's id after a `~`. The ticket rides in the header the file service's gate already
reads, so none of the calls that build that header change, and none of them need a cookie
across origins. `token` stays the engine's own, since the claim is checked against it.

`hostedFiles()` answers the same hub with no engine in the ticket, for a page that lists or edits
files and plays nothing — k7's home page, whose workspaces exist whether or not an engine runs.

k7 and z0's editor opt in: they open a project, and a project is the server's. The media library does not —
its player resolves songs against the engine machine's own médiathèque cache and sends the
engine a document itself, which the server's files would name in paths the engine cannot open.

## Outside this object

- **`EngineClient`**: opening the socket with the service's session
  (`sessionFor(SESSIONS.k7, …)`), which each app holds and only one of them must —
  `@studio/engine-protocol/docs/sessions.md`.
- **The file service**: `fileBase` goes from the probe into `@studio/project-shell/fileApi`, and
  **travels with the address that answered**. A relayed socket beside a direct `http://` rebuilds
  the mixed-content wall on the other half (`@studio/engine-registry/docs/proxy.md`).
- **The picker's policy**: the media library leaves an editor open with no engine, k7's gate does not. A
  product difference, not a plumbing one. k7 asks only when no TRUSTED engine is usable (see
  "Who is taken unasked" above): every open takes `bestEngine` (`choose.ts`) afresh among those,
  and does not store what it took as the preference. The order, each step only among the equals
  of the one before:
  1. **compatibility** with the project (`compat.ts`): the share of the plugins the project
     needs its engine to host — internal and VST alike — that the engine's catalogue has,
     `available / required × 100`, floored so only a full house reads 100. An engine whose
     catalogue did not arrive in time ranks below any score;
  2. the engine this account last **chose** — saved only by the header's engine menu, an explicit
     pick, which a faster machine elsewhere does not overrule;
  3. the engine on **this machine**, the one that answered over loopback (`onThisMachine`): its
     sound comes out where you sit, and a stronger machine elsewhere on the LAN would otherwise
     take the tab and play out of speakers in another room;
  4. the **latency class** (Q1, Q2, Q3);
  5. the **performance** score.

  The latency in ms only breaks a tie left after all of them. A remembered engine that is gone
  or busy is no candidate, so the choice falls to this machine's.

  The formula is `@studio/web-protocol/compat`, and it is applied on one of two roads, by where
  the project's files live (`apps/k7/frontend/src/engineCompat.ts`):
  - **on the server** (hosted files): the server lists the needs, `/project-plugins`, with no
    engine bound; each catalogue comes from the engine itself, `list-plugins` on a socket of its
    own — a probe query, answered without a session — and the browser scores;
  - **on the engine's machine**: that machine's file service scores the project against its own
    engine's scan, `/project-compat`, and each candidate answers for itself.

  When nothing could be told (no `@local` project in the address, no engine answered)
  compatibility is left out and the order starts at 2.

  The header's engine menu (k7's `EngineSwitch`) is an explicit choice, and it saves the
  preference — step 2 above.
