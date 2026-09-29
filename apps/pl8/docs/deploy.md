# Deploying the médiathèque

The library is **hosted**: the deployed pl8 owns the files, and `<state>/mediatek` on a musician's
machine is a cache the moteur reads from. The service is `pl8`, on its own subdomain
(`play.st0.app`), in an image of its own — one Node process that serves its built SPA itself, with
no nginx (`apps/pl8/docker/Dockerfile`, `docs/versioning.md`). Three things set it apart from st0's,
and each is the médiathèque being a library rather than an editor.

## 1. It is stateful. The volume IS the library.

st0's image has no volume: its state is a signed session cookie and its preferences. Here the
container owns everyone's songs, samples and recordings — and, under `/workspaces`, the accounts'
working copies (`packages/file-hub/docs/fileHub.md`).

`VOLUME ["/library"]` is declared so a `docker run` with no `-v` still gets an anonymous
volume instead of writing into the container layer, where an upload would survive exactly
until the next deploy — and would look like it had worked. The image sets
`STUDIO_MEDIATEK=/library`, and `STUDIO_FILES_ROOT` is required at boot ([config.md](config.md)).

The catalogue has **no database**, and that is not a shortcut — `packages/mediatek/docs/index.md`
argues the filesystem is the index, and being on a server changes nothing about that
argument. It is also what lets one scanner serve both sides: the server walks its volume,
the client walks its cache, same `scanFamily`, same `familyRevision`.

One thing on this volume is not a file: the comments visitors leave on a shared snapshot,
in `.shares/comments.db`. What is different about them is that they have MANY writers, which
is the one thing the filesystem-as-index argument does not cover — see
[comments.md](comments.md).

On an empty volume the backend creates its layout — `songs/`, `samples/{audio,video}/`,
`recordings/`, `playlists/`, `library/{ir,nam}/`, `.cache/` and `mediatek.yaml` — and answers
`401` on `/api/mediatek` without a session.

## 2. It VERIFIES the session, it does not mint it

`/auth/*` is **st0's**: the `redirect_uri` registered with the IdP is `<st0 origin>/auth/callback`,
so the flow belongs to st0, and a page here sends the browser to `authOrigin(origin)` to sign in.

So `setupAuth` here passes `mountRoutes: []` like k7 and z0, and only verifies. It needs the same
`SESSION_SECRET` and `COOKIE_DOMAIN` as st0 (`docker/docker-compose.yml` repeats them on every
service): with a secret of its own every `/api` call 401s while the SPA still looks logged in, and
without the shared domain the cookie st0 sets never reaches this subdomain.

The failure mode to recognise: if the service that MINTS is down, **no studio service can be
logged into**, and each of the others reports its own 401 rather than pointing at it.

## 3. It moves media, so nothing in front may buffer or cut it

The backend streams in both directions itself: a file goes out through `@frediverse/http`'s
`streamFile`, which answers `206` to every Range request a player makes, and an upload comes in
through `rawToDisk` (`backend/src/upload.ts`), straight to a file on the volume, up to 512 MB. A
request gets 30 minutes (`server.requestTimeout`), because a large upload over a slow link is a long
request doing exactly what it should. Whatever fronts the container — Traefik here — must stream
rather than spool, and must not cut a request shorter than that, or the big files are the ones
that fail and the backend's own limit and message never run.

The engine relay is a WebSocket on the same process: `engine.serve` attaches it to the HTTP server
(`packages/engine-registry/docs/proxy.md`), under `/api/engine/<id>/ws`. A driving socket is idle
for long stretches by design, so the edge must not time an idle WebSocket out either. Its HTTP
half — `/api/engine/<id>/files` — is an ordinary request; what it needs is that **nothing consumes
the body before it**.

## The install closure, checked rather than assumed

`npm ci --workspace pl8-frontend --workspace pl8-backend --include-workspace-root` in the
Dockerfile's `deps` stage computes the dependency closure from each workspace's own
`package.json`. `--include-workspace-root`
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

The image build itself: CI is where it runs.

The two assumptions most likely to be wrong ARE checkable here, and are worth re-checking when
the Dockerfile moves:

1. `npm run build --workspace pl8-frontend` produces `index.html` in the frontend's `dist/`, plus a
   full-sized stylesheet — the path the final stage `COPY`s from.
2. The backend boots with nothing but `STUDIO_MEDIATEK`, `STUDIO_FILES_ROOT` and `PORT`, on two
   empty directories.

And on the deployed side: `SESSION_SECRET` and the `OIDC_*` triple must be set, or the service
comes up in **dev auth mode with a stub 'Dev User'** — it says so on stderr, and on a public
origin that line is the difference between a library and a free-for-all.
