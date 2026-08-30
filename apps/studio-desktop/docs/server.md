# The app's own origin

The app serves st0 itself, from `http://127.0.0.1:<webPort>`, and the window loads that. It is
the decision the whole desktop build rests on, so the reasoning is here rather than in a
comment.

## Why an http origin and not `app://`

`packages/web-protocol/services.ts` is `serviceUrl(origin, s) = studioOrigin(origin) +
SERVICE_PATHS[s]`, and the frontend reads `globalThis.location.origin` at module-eval time.
There is deliberately **no configuration seam** — `web-protocol/docs/addresses.md` says so in
as many words. So the origin the page runs on is not a detail; it is the whole contract.

A survey of what breaks under a custom scheme, against what a loopback http origin does:

| under `app://` | under `http://127.0.0.1:<port>/` |
|---|---|
| `parseLaunch("/index.html")` yields a repo called `index.html`, so `EngineGate` mounts instead of `Home` | pathname is `/` → no launch → `Home`. Unchanged. |
| `serviceUrl()` yields `app://bundle/pl8` — silently, since `studioOrigin` answers `""` rather than throwing | yields `http://127.0.0.1:<port>/pl8`, which we serve. Unchanged. |
| bare `/auth/me` and `/api/engines` resolve inside the bundle | resolve against this server. Unchanged. |
| the session cookie is `SameSite=Lax` and host-only, so it is never sent cross-site | first-party. Unchanged. |
| the file service refuses the origin | `file-service/src/cors.ts` already allows *any http origin on a loopback or private address, any port*. **No allowlist edit at all.** |
| `dist/index.html` references `/assets/…` absolutely (no `base` in vite's config) | served from the root. Unchanged. |
| `crypto.subtle` is absent, so `shareKey` throws | `http://127.0.0.1` **is** a secure context. Unchanged. |

That is the entire case: the frontend needs almost nothing.

Two consequences survive it. A second device reaches
`http://192.168.x.x:<port>`, which is **not** a secure context — no service worker, so no PWA
install, and no `getUserMedia`. And this server must never let a `/pl8` fetch simply fail; see
the shim's own page.

## The port is fixed, and remembered

`webPort` in `<state>/engine-tray.json`, default **8780** — free against 8765/8770 (engine,
file service), 8789/8795/8787/8080 (the hosted backends), 5223 (vite) and 10350 (Tilt). If
something holds it, `port.ts` probes upward and `main.ts` **writes back what it got**.

Ephemeral would be wrong four times over, and each is a bug you would meet rather than a
tidiness argument:

1. the file service captures its CORS allowlist from `STUDIO_REGISTRY_URL` **at spawn**;
2. `advertiseRegistry` writes a URL other processes read;
3. a second device has the address bookmarked;
4. a service worker's scope is per-origin, so a moving port orphans its cache.

## What is ours, and what leaves the machine

The **registry and the prefs are ours, always**. The desktop never proxies `/api/*` to a remote
st0: the engine it lists is on this machine and the direct loopback probe always wins. Only
`/pl8/*` and `/auth/*` ever leave.

It advertises as **`studio-desktop`**, not `st0`. A hosted st0 backend writes
`<state>/web-endpoints/st0.json`, and two writers of one file would take turns being the
registry the supervisor heartbeats to. With distinct slugs the supervisor heartbeats to both,
which is what "serving an engine to the web version" means.

## It binds `0.0.0.0`, and one predicate stops that being a mistake

Like the file service already does, because the same listener serves externals and
`docs/remote.md` makes the LAN the trust boundary.

But the pl8 proxy is **new authority**. The file service on the LAN is gated by the engine
token; the proxy will carry the user's studio *account* credential. So: the remote credential
is attached only when `req.socket.remoteAddress` is loopback (`origin.ts`). Non-loopback
clients get the static app, `/api/*` and `/auth/me`; `/pl8/*` answers 403.

Nothing shows when that is wrong — a LAN peer simply has the account. Only an explicit check
finds it, which is why there is one.

## Dev

With no bundled dist, `/` is passed through to the session's vite on 5223, WebSocket upgrades
included so HMR works. The window then runs the **same origin contract** a packaged build has,
rather than a second arrangement nobody exercises.

The passthrough is hand-rolled over `node:http` (`devProxy.ts`): one upstream, no rewriting, no
auth. The REMOTE proxy is a different question — headers, cookies, redirects, an OIDC round
trip — and is where a library earns its place.

## What it costs

`dist/main.cjs` goes from 36 kB to **1.8 MB**, and it is worth knowing where: `mime-db`
(207 kB), `iconv-lite`'s charset tables (~460 kB, via body-parser), `zod` (~130 kB, via the
registry), `ws`, `ipaddr.js`. That is express's own graph, i.e. the honest price of an
in-process HTTP server — and noise beside Electron's own ~150 MB.
