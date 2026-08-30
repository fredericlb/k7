# A second device

`apps/st0/frontend/docs/external.md` is what an external surface IS. This page is only what the
desktop app has to get right for one to work over the LAN, and what it cannot give.

The app already binds `0.0.0.0` (`docs/server.md`), like the file service does, so the tablet
loads `http://<lan-ip>:<webPort>/external` and everything below follows from that.

## What works with no change at all

- **`/external` reaches the app.** `main.tsx` reads it *before* the router, so it must be a
  real navigation answered with `index.html` — which the SPA catch-all does. A `try_files`
  that 404s unknown paths would not.
- **The two calls it makes** — `/workspaces/surfaces` and `/engine/served` — go to the **file
  service** on 8770, not to us. `file-service/src/cors.ts` already admits *any http origin on a
  loopback or private address, any port*, so there is no allowlist entry to add. That rule is
  a test, never a reflection, and it stays that way.
- **The engine** is reached at `ws://<lan-ip>:8765` directly, no relay, no TLS.

## The one thing that had to be built

`externalHref` picks a project's address from the register — `/<repo>/<projet>` when the
repository is registered, `@local/…` when it is not — and its own comment says why: *"so the
tablet and the laptop claim the same song"*.

Offline that is free: both devices get the shim's empty register and both choose `@local`.

**Paired, it was not.** The proxy attaches the account bearer for a loopback caller only, so
this machine saw the real register and the tablet saw an empty one. They would have computed
different addresses, hence different `projectClaimKey`s, hence two claims on one project — the
laptop showing `ProjectTakenOver`, which has no Retry by design, and the song flickering
between two people. Exactly the failure `external.md` warns about.

So the LAN may read **`GET /pl8/api/projects` and `/revision`, and nothing else**, with `uri`
blanked on every row. The name is the half of an address a person reads and is the whole
reason the tablet asks; the URI is the git host, port and path, which `launch.md` already keeps
out of addresses for the same reason it is kept out of here. Writes, shares, the deploy key and
the médiathèque all stay the shim's 503, and the bearer never leaves the loopback path.

`src/server/lan.test.ts` runs that over a real socket wherever the machine has a non-loopback
address, because `req.socket.remoteAddress` is not exercised any other way.

## The honest loss: no secure context

`http://192.168.x.x:<port>` is **not** a secure context. `http://127.0.0.1` is — which is why
this machine's own window has `crypto.subtle` and a tablet does not. What follows from that is
no longer one loss but two halves that came apart, and only one of them is still standing.

**The camera is answered**, by the one powerful feature that turned out not to be gated on a
secure context at all: `RTCPeerConnection`. The machine opens the lens and the tablet receives it
over a peer connection, which needs no certificate and is exempt from the mixed-content rule that
stops every other way of reaching this machine. [camera.md](camera.md) is that page.

**The service worker is not, and cannot be.** Registration requires a secure context and there is
no exemption comparable to WebRTC's, so there is no install and no offline shell. What the
surface gets instead is the *other* half of looking like an app, neither of which needs a secure
context either — the browser's own fullscreen, and a screen that stays lit. Both live in st0
(`apps/st0/frontend/docs/external.md`), because they are what the surface DRAWS rather than
anything this server does.

Three answers to the half that remains, in order of preference:

1. **Configure a server.** The tablet then uses its https origin exactly as it does today,
   reaching the engine through the origin's relay — and nothing is lost.
2. **Offline, accept the tab.** Say so where the address is given, rather than letting someone
   conclude the install is broken.
3. **Do not ship a self-signed certificate** to be trusted per device. It is the obvious third
   idea and it is worse than both.

The failure signature if this goes unwritten: "Install app" never appears on the tablet and the
surface reopens from scratch every time, which reads as a caching bug.
