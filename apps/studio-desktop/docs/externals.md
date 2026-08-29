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
this machine's own window has `crypto.subtle` and a tablet does not. Two consequences, and
neither has a workaround worth shipping:

- **no service worker, so no PWA install.** That is precisely what `external.md`'s "the
  starting point of a PWA" section is for: the surface opens in a browser tab and reopens from
  scratch rather than living as an app;
- **no `getUserMedia`**, so no webcam surface on that device.

Three answers, in order of preference:

1. **Configure a server.** The tablet then uses its https origin exactly as it does today,
   reaching the engine through the origin's relay — and nothing is lost.
2. **Offline, accept the tab.** Say so where the address is given, rather than letting someone
   conclude the install is broken.
3. **Do not ship a self-signed certificate** to be trusted per device. It is the obvious third
   idea and it is worse than both.

The failure signature if this goes unwritten: "Install app" never appears on the tablet and the
surface reopens from scratch every time, which reads as a caching bug.
