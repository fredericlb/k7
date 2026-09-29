# Deploying the médiathèque

The library is **hosted**: `studio.frediver.se` owns the files, and `<state>/mediatek` is a
cache the moteur reads from. The service is `pl8`, served under `/pl8`, and the whole design
depends on it being deployed — a Dockerfile, an nginx entry and a CI job.

Its image follows st0's closely, because the shape is the same — an SPA and a Node backend
behind one nginx, on the repo-root base image. Three things differ, and each of them is the
médiathèque being a library rather than an editor.

## 1. It is stateful. The volume IS the library.

st0's image deliberately has no volume: its state is a session cookie and an in-memory
engine list, both fine to lose. Here the container owns everyone's songs, samples and
modules.

`VOLUME ["/library"]` is declared so a `docker run` with no `-v` still gets an anonymous
volume instead of writing into the container layer, where an upload would survive exactly
until the next deploy — and would look like it had worked.

`STUDIO_MEDIATEK=/library` is set in the image, and the backend **refuses to boot without
it**. That refusal is load-bearing: a missing root would otherwise scan an empty directory
and serve a perfectly plausible, empty catalogue. A library that has silently lost
everything looks exactly like a library nobody has filled in yet.

The catalogue has **no database**, and that is not a shortcut — `packages/mediatek/docs/index.md`
argues the filesystem is the index, and being on a server changes nothing about that
argument. It is also what lets one scanner serve both sides: the server walks its volume,
the client walks its cache, same `scanFamily`, same `familyRevision`.

One thing on this volume is not a file: the comments visitors leave on a shared snapshot,
in `.shares/comments.db`. What is different about them is that they have MANY writers, which
is the one thing the filesystem-as-index argument does not cover — see
[comments.md](comments.md).

Verified: on an empty volume the backend creates its layout (`songs/`, `samples/`,
`modules/`, `ui/`, `library/`, `.cache/`, `mediatek.yaml`) and answers `401` on
`/api/mediatek` without a session.

## 1b. It VERIFIES the session, it does not mint it

The edge sends `/auth/*` to **st0's** backend, the service with no path prefix: the `redirect_uri`
registered with the IdP is `<origin>/auth/callback`, so the flow belongs to whoever answers the
root.

So `setupAuth` here passes `mountRoutes: []` like k7 and z0, and only verifies. It still needs
the same `SESSION_SECRET` from `env.yaml`'s `common`: give this section one of its own and every
`/pl8/api` call 401s while the SPA still looks logged in.

The failure mode to recognise: if the service that MINTS is down, **no studio service can be
logged into**, and each of the others reports its own 401 rather than pointing at it.

## 2. It moves media, so nginx must not buffer

The `/(api|auth)/` location carries three settings st0's does not:

* **`proxy_buffering off`.** Without it nginx reads the whole upstream response into memory
  and then a temp file before sending a byte. On a video that means the first frame waits
  for the last, *and every Range request the player makes pays it again* —
  `@frediverse/http`'s `streamFile` answers `206` precisely so it does not have to.
* **`proxy_request_buffering off`**, so an upload streams to disk rather than being spooled
  whole by nginx first.
* **`proxy_read_timeout` / `proxy_send_timeout` at 600s.** A large upload over a slow link
  is a long request doing exactly what it should; the default 60s cuts it off mid-file.

`client_max_body_size 512m` matches the `express.raw` limit on `PUT /api/mediatek/file`. A
mismatch is the kind of fault that only shows on the big files, because nginx answers `413`
itself and the backend's own limit — and its error message — never runs.

## 3. One WebSocket location, and only one

The engine is a **choice** — the account picks a machine, which is not always the browser's —
and an HTTPS page may not open a `ws://` to a LAN address. So this origin relays one, and
exactly one, path:

```
location ~ ^/api/engine/[^/]+/ws$
```

`Upgrade`/`Connection` and `proxy_read_timeout 1d`, because a driving socket is idle for long
stretches by design. It must come **before** the `^/(api|auth)/` block: nginx takes regex
locations in the order written, and the general one would swallow it.

The relay's HTTP half — `/api/engine/<id>/files` — needs no location of its own: it is an
ordinary request under `/api`. What it does need is that **nothing consumes the body before
it**; see `packages/engine-registry/docs/proxy.md`.

## The install closure, checked rather than assumed

`npm ci --workspace pl8-frontend --workspace pl8-backend --include-workspace-root` in the
Dockerfile's `deps` stage computes the dependency closure from each workspace's own
`package.json` — the same graph turbo prune used to walk, minus turbo. `--include-workspace-root`
is the one manual knob: drop it and a root-level devDependency a package only reaches through
peer-dependency hoisting (`@inlang/paraglide-js` via `@frediverse/i18n`, for one) goes missing at
build time. A second, backend-only install (`--workspace pl8-backend --omit=dev`) is what the
runtime stage ships: `node_modules/@studio/*` are symlinks into the workspace, so a package
missing from the image is a dangling link and a crash on first import.

Both closures are worth inspecting when either changes. The full one pulls in
`commons/packages/ui` — which matters more than it looks, because `index.css` `@source`s
`commons/packages/ui/src` and **Tailwind emits nothing at all for a `@source` path that does not
exist**. The app builds cleanly and renders unstyled. The check: `dist/assets/*.css` is ~51 KB,
not ~2 KB.

## What cannot be checked from a dev machine

The image build itself. Docker's daemon runs in WSL here but the socket is `root:docker` and the
dev account is not in that group, with `sudo` asking for a password — so `docker build` is out of
reach, and CI is where it runs.

The two assumptions most likely to be wrong ARE checkable here, and are worth re-checking when
the Dockerfile moves:

1. `npm run build --workspace pl8-frontend` produces `index.html` in the frontend's `dist/`, plus a
   full-sized stylesheet — the path the final stage `COPY`s from.
2. The backend boots with nothing but `STUDIO_MEDIATEK` and `PORT`, on an empty directory.

And on the deployed side: `SESSION_SECRET` and the `OIDC_*` triple must be set, or the service
comes up in **dev auth mode with a stub 'Dev User'** — it says so on stderr, and on a public
origin that line is the difference between a library and a free-for-all.
