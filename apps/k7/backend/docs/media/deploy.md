# Deploying the médiathèque

The library is **hosted**: k7's deployed backend owns the files, and `<state>/mediatek` on a
musician's machine is a cache the moteur reads from. It is not a service of its own: the routes are
mounted by `mountMedia` (`apps/k7/backend/src/media/mount.ts`) inside k7's one process, which
serves its built SPA itself, with no nginx (`apps/k7/docker/Dockerfile`, `docs/versioning.md`).
Three things the library adds to that image, and each is the médiathèque being a library rather
than an editor.

## 1. It is stateful. The volume IS the library.

Here the container owns everyone's songs, samples and recordings — and, under `/workspaces`, the
accounts' working copies (`packages/file-hub/docs/fileHub.md`).

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

## 2. It answers two hosts, and one of them only for its API

The library answers on k7's own host, under `/media` for the screens and `/api/*` for the routes.
`play.st0.app`, a former host, is routed to the same container and is **permanent**: every installed
supervisor has `https://play.st0.app` saved as its registry, and every share link sent names it. On
that host `/api/*` and `/auth/*` answer as on k7's, and any other path is a 301 to the same path
under `/media` at k7's origin, `app.k7.rocks` (`server.ts`).
`packages/web-protocol/docs/addresses.md` is the page for the address side.

## 3. It moves media, so nothing in front may buffer or cut it

The backend streams in both directions itself: a file goes out through `@frediverse/http`'s
`streamFile`, which answers `206` to every Range request a player makes, and an upload comes in
through `rawToDisk` (`apps/k7/backend/src/media/upload.ts`), straight to a file on the volume, up
to 512 MB. A request gets 30 minutes (`server.requestTimeout`), because a large upload over a slow
link is a long request doing exactly what it should. Whatever fronts the container — Traefik here —
must stream rather than spool, and must not cut a request shorter than that, or the big files are
the ones that fail and the backend's own limit and message never run.

The engine relay is a WebSocket on the same process: `engine.serve` attaches it to the HTTP server
(`packages/engine-registry/docs/proxy.md`), under `/api/engine/<id>/ws`. A driving socket is idle
for long stretches by design, so the edge must not time an idle WebSocket out either. Its HTTP
half — `/api/engine/<id>/files` — is an ordinary request; what it needs is that **nothing consumes
the body before it**.

## What the runtime stage must carry

`yt-dlp` and `ffmpeg` for the hunt's fallback and the decodes ([hunt.md](hunt.md),
[analysis.md](analysis.md)), and `git`, `git-lfs` and `openssh-client` for the file
hub's clones.

The backend's install is `--workspace k7-backend --omit=dev`, and `node_modules/@studio/*` are
symlinks into the workspace: a package the media routes import and `k7-backend`'s `package.json`
does not list is a dangling link and a crash on first import, not a build error.

## What cannot be checked from a dev machine

The image build itself: CI is where it runs.

The assumption most likely to be wrong IS checkable here: the backend boots with nothing but
`STUDIO_MEDIATEK`, `STUDIO_FILES_ROOT` and `PORT`, on two empty directories.

And on the deployed side: `SESSION_SECRET` and the `OIDC_*` triple must be set, or the service
comes up in **dev auth mode with a stub 'Dev User'** — it says so on stderr, and on a public
origin that line is the difference between a library and a free-for-all.
