# The relay — reaching an engine the browser may not call

The engine listens in the clear, on `ws://<machine>:8765`. Studio pages are served over HTTPS.
Those two sentences do not hold together, and that is the whole subject of this page.

## The wall

An HTTPS page cannot open a `ws://` or a `fetch("http://…")`: the browser refuses it as **mixed
content**, before any network request. The one exception is loopback, deemed safe. The exact
consequence:

| from | `ws://127.0.0.1:8765` | `ws://192.168.x.y:8765` |
|---|---|---|
| the engine's machine | allowed, and it is the engine | allowed but useless |
| another machine on the LAN | allowed, and it is **not** the engine | **blocked** |

Hence a symptom that sends you looking in the wrong place: from a remote machine the only address
that produces a real network attempt is loopback — which hits the remote machine itself. The LAN
address being blocked appears in no Network tab, only in the console. So one reads "the client
insists on localhost" where one should read "the LAN address was refused before it left".

This wall is **independent of the network**. Everything else can be green — engine listening on
`0.0.0.0:8765`, Windows firewall rules on `Allow` for the exact binary, `nc -vz <ip> 8765`
succeeding from the remote machine — and the browser still refuses. Checking the network proves
nothing here: read the console.

macOS adds a second wall at the same place: since macOS 15 a browser needs "Local network"
permission to reach a private address, and a `nc` succeeding from Terminal says nothing about the
browser, each application holding its own.

## The way out

The browser composes no LAN address at all. It opens a `wss://` towards **the registry's own backend** — k7's, the
page's own origin — and the backend composes towards the engine:

```
browser ──wss://priv.st0.app/api/engine/<id>/ws──▶ k7 backend ──tunnel, or ws://<address>:8765──▶ engine
```

The backend is not a secure context: it calls whom it likes, which is why it calls only one place
(`hostsFor`): the address the engine's **heartbeat came from** — loopback when the engine shares the
backend's machine, its LAN address when it shares its network. Never an address the heartbeat
NAMES: the heartbeat is open, and dialling what it names would let anyone aim this server at any
host it can reach. An engine whose heartbeat arrives over IPv6 or through a NAT is reached through
its tunnel alone.

No mixed content, no local network permission, no port to open in a firewall.

**The engine's own tunnel comes first.** An engine whose supervisor dialled in
(`packages/engine-tunnel/docs/tunnel.md`) is reached through that socket, whatever network it is
on; the addresses above are the fallback, and they only answer when the server shares the
engine's network.

## Sockets only

`attachEngineProxy` is attached to the **HTTP server**, not mounted as a route: a WebSocket
`upgrade` never crosses Express's middleware chain. Which is also why the cookie cannot guard it,
and why there is a **ticket**. There is no file half: files are the server's own
(`packages/file-hub/docs/fileHub.md`), so nothing plain-HTTP crosses to the engine's machine here.

The upgrade listener runs before any session check, for anyone who sends one. It never throws:
an engine id that is not valid percent-encoding is a 400, and anything else that throws is
logged and destroys that socket, because an uncaught exception there ends the process
(`packages/engine-tunnel/docs/tunnel.md`, "Nothing on a tunnel is trusted for shape").

k7's backend calls `attachEngineProxy(server, registry)` after its `app.listen`, being the one service
that holds a registry (see [shared.md](shared.md)); every page of the origin relays through it.

## The ticket

`/engines` mints one ticket per engine at the same time as it returns the list: that route is
already the authenticated one, and already returns every engine. A ticket asked for per engine
would have cost a round trip per engine, before a single one had been measured.

It lives a minute, HMAC-signed by a secret drawn at the startup of the **process that verifies
it**: nothing to share between machines, no secret to wire into each backend. A restart
invalidates those in flight, which costs the browser a reload of a list it polls anyway.

The engine's `id` is **in the path**, and the ticket is verified against it: a ticket cannot be
replayed against another engine. The ticket also carries the **account** it was minted for, so the
relay knows whose claim to ask about. And the target always comes from the **registry**, never from
the request — a `?host=&port=` would make every backend an open relay towards everything it can
reach.

## Before a claim, the probe and nothing else

The engine trusts the relay's socket as it trusts its own machine (`token.md`): whatever crosses it
can load a document, drop a session, approve a pairing. So a ticket is not enough to drive.
`relayGate.ts` asks, on every frame, whether the ticket's account holds a live claim on the engine
(`claim.md`):

| | without a claim | with one |
|---|---|---|
| browser → engine | `whoami`, `pair`, `list-plugins` — what `probe.ts` and `compat.ts` send to pick | everything |
| engine → browser | `whoami`, `plugins`, `error` | everything |

Anything else the browser sends is **held**, in order, rather than dropped: a page opens its driving
socket and claims the engine at the same moment, and the claim may land a few hundred milliseconds
after the socket's first `hello`. Held frames go through the moment the claim exists; after 10 s
without one (`CLAIM_GRACE_MS`), or past a bound on what is held, the socket closes with 4403. A
claim taken over by another account stops the loser at its next frame, without a reconnect.

What this gate does not cover: a browser that reaches the engine DIRECTLY — loopback on its own
machine, or a LAN address once paired — talks to the engine with nobody in between; the engine's
own origin check and pairing are what guard that path (`engine/k7-runtime/docs/pairing.md`).

## What the probe does with it

`candidatesFor` (`packages/engine-browser/src/probe.ts`) builds loopback, each LAN address, then
the relay. The order is documentary only: `rank` launches them **all in parallel** and keeps the
fastest. The relay pays one hop more, so it loses on its own wherever the direct link is allowed.

## The body a parser has already taken

`replayBody` lives here and serves the file hub (`packages/file-hub/index.ts`), which relays plain
requests to an account's file service. Every service mounts `express.json()` for the whole
application, so by the time a relaying route is reached the request stream is **already at its
end**: a `req.pipe(up)` would call `end()` at once and upstream would receive the original
`content-length` with zero bytes behind it, then wait for bytes that never come. So a relay
**replays** what the parser took rather than assuming an intact stream, and recomputes the
`content-length`: re-serialised bytes are not the bytes received. "Do not mount a parser in front"
would say the same, as a mount-order rule every backend must respect — exactly the kind nothing
catches.

## The first message is queued

The browser sends `whoami` the instant the socket opens — and at that instant the *upstream*
socket is still being dialled. The relay holds what arrives before that and replays it once
upstream is open. Losing it would time out every probe: the relay would be "reachable" and answer
nothing, which is worse than unreachable.
