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

The browser composes no LAN address at all. It opens a `wss://` towards **the origin it has
already loaded**, and the backend composes towards the engine:

```
browser ──wss://st0.priv.frediver.se/api/engine/<id>/ws──▶ st0 backend ──ws://127.0.0.1:8765──▶ engine
```

The backend is not a secure context: it calls whom it likes. It tries loopback then each LAN
address, in order (`hostsFor`), sequentially — the list is two or three entries, loopback wins as
soon as the backend shares the engine's machine, and a race would leave half-open sockets against
an audio process.

No mixed content, no local network permission, no port to open in a firewall.

## The two halves

They have different constraints, hence two shapes:

- **`engineFilesProxy`** — an ordinary Express route, mounted on `/engine/:id/files`
  (`router.ts`). A plain request crosses the middleware chain, so the session cookie already
  guards it.
- **`attachEngineProxy`** — attached to the **HTTP server**, not mounted as a route: a WebSocket
  `upgrade` never crosses Express's middleware chain. Which is also why the cookie cannot guard
  it, and why there is a **ticket**.

Each service calls `attachEngineProxy(server, registry)` after its `app.listen`, since each holds
its own registry instance (see [shared.md](shared.md)).

## The ticket

`/engines` mints one ticket per engine at the same time as it returns the list: that route is
already the authenticated one, and already returns every engine. A ticket asked for per engine
would have cost a round trip per engine, before a single one had been measured.

It lives a minute, HMAC-signed by a secret drawn at the startup of the **process that verifies
it**: nothing to share between machines, no secret to wire into each backend. A restart
invalidates those in flight, which costs the browser a reload of a list it polls anyway.

The engine's `id` is **in the path**, and the ticket is verified against it: a ticket cannot be
replayed against another engine. And the target always comes from the **registry**, never from the
request — a `?host=&port=` would make every backend an open relay towards everything it can reach.

## What the probe does with it

`candidatesFor` (`packages/engine-browser/src/probe.ts`) builds loopback, each LAN address, then
the relay. The order is documentary only: `rank` launches them **all in parallel** and keeps the
fastest. The relay pays one hop more, so it loses on its own wherever the direct link is allowed.

The `fileBase` travels with the address that answered, and that matters: a relayed socket beside a
direct `http://` to the file service would be the wall a second time, on the other half.

## The body a parser has already taken

`engineFilesProxy` is an Express route, so it inherits everything the service mounted in front of
it — and every service mounts `express.json()` for the whole application. By the time the relay is
reached the request stream is **already at its end**: a `req.pipe(up)` calls `end()` immediately
and upstream receives the original `content-length` with zero bytes behind it. Upstream then waits
for bytes that never come, the dial timeout fires, the next address does the same, and the relay
answers `502 engine file service unreachable` — a message that accuses the network where the relay
sabotaged itself. `GET`s pass, so the engine is chosen, measured and connected; the first
`POST /open` is what fails, and `diagnoseFileService` translates that into "origin blocked, allow
it in the tray". Three diagnostic screens, none naming the cause.

So the relay **replays** what the parser took (`replayBody`) rather than assuming an intact
stream, and recomputes the `content-length`: re-serialised bytes are not the bytes received. This
could as well be written "do not mount a parser in front" — but a mount-order rule every backend
must respect is exactly the kind nothing catches. `proxy.test.ts` mounts `express.json()` in front
of the relay, as they do.

Two edge consequences of the same gesture:

- A **streamed** body (`application/octet-stream`, the only one `express.json` leaves alone)
  cannot be replayed on the next address: the stream is spent. That case answers 502 instead of
  silently retrying with an empty body.
- The 1500 ms `timeout` is the **dial**'s, not the download's — the next section is about that
  word.

## 1500 ms is not a connect timeout

`timeout` on a Node `http.request` is **socket inactivity**. It does not measure "how long to
connect" but "how long since anything crossed the wire", connected or not. Disarming it in the
response callback — so at the first byte from upstream — leaves one thing outside: **the time the
engine's machine spends thinking**, bounded then at 1500 ms.

Almost every file service route answers at once: a listing, a file, a `/media` that starts flowing
immediately (the *download* is slow, not the wait). `POST /mediatek/analyse` is the exception, and
a total one — it says nothing until it has downloaded the master from the hosted media library
**and** run the engine over it. Minutes of silence, where a bound on the response tolerates a
second and a half; and each retry on the next address relaunches a full analysis on the same
machine by another path, work that continues on both sides with nobody waiting for it. The browser
sees "analysis impossible", the server sees sockets cut mid-body — a `BadRequestError: request
aborted` from `raw-body`, which is what a parser says when its client disappears.

The timer is therefore disarmed **at connection** and not at response, which is what "dial" means:

```ts
up.on("socket", (s) => {
  if (s.connecting) s.once("connect", () => up.setTimeout(0));
  else up.setTimeout(0); // recycled socket: there is nothing to dial
});
```

A **connected** socket then has no bound at all, deliberately: that is already the rule for
downloads, and a route that thinks for a long time is indistinguishable from a route that
downloads slowly. The remaining bound — connect within 1500 ms — is the only one the relay can
judge knowing nothing about the route called.

Not to be lost: `up.on("error")` then means what it says, *an unreachable host*, so retrying the
next address is free. If it also covered "answered too slowly", it would resend a request upstream
has already accepted and begun.

`proxy.test.ts` holds an upstream that takes 2200 ms to write its first line, and checks two
things: the response arrives, and upstream saw it **once**.

## The first message is queued

The browser sends `whoami` the instant the socket opens — and at that instant the *upstream*
socket is still being dialled. The relay holds what arrives before that and replays it once
upstream is open. Losing it would time out every probe: the relay would be "reachable" and answer
nothing, which is worse than unreachable.
