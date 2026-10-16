# Versioning and the deployment pipeline

How the studio image gets a version, and how that version reaches the screen. This
mirrors what `../phare` does, with one deliberate difference noted below.

The whole thing exists to answer one question: **looking at a running app, which image
is that?** There is no version endpoint and no `/healthz` — phare has none either. The
stamp is visible in exactly two places, the SPA chrome and the image tag, and they are
the same string.

## One image built here, and why k7 does not share phare's shape

`apps/k7/docker/Dockerfile` builds k7's image — the editor, the media library and the rehearsal
recorder: one process, no nginx — the backend serves its own built frontend directly
(`express.static` + an SPA fallback, in `apps/k7/backend/src/server.ts`). It doesn't start from the
shared `frediverse-base` image (`commons/dev/docker-runtime`) at all, since there's no second
process (nginx) to supervise alongside the backend. Traefik reaches it directly by hostname
(`docker/docker-compose.yml`) — at the root domain and on the `play.` and `k7.` aliases, which the
media library and the rehearsal recorder it serves keep answering
(`packages/web-protocol/docs/addresses.md`).

z0 is deployed beside it from the same `docker/docker-compose.yml` — Traefik reaches it by a
`PathPrefix(/z0)` rule layered on k7's domain, its own container — but its image is built, tagged
and stamped by z0's own repository, and the compose file pulls it by its own `Z0_VERSION`.
`engine/k7-runtime` and `engine/k7-supervisor` are not in k7's image. The server's own engine is
an image of its own, `k7-runtime`, which is tagged with k7's stamp and has no SPA to show it
([server-engine.md](server-engine.md)). The desktop app, `apps/k7-standalone`, is in no image. The rehearsal recorder's store is a SQLite
file inside k7's process, so it ships with k7's stamp.

Two containers on one hostname each ship and restart on their own, so a crash in one does not
recycle the other. Inside k7's image the trade is phare's: the editor, the library and the
rehearsal recorder are one process and restart together.

## The chain

```
OneDev CommandStep (node -e, Europe/Paris)  →  ./build_version   e.g. "26.08031412"
  ├─ SetBuildVersionStep  ─────────────────→  the OneDev build version
  ├─ RegistryOutput tags  ─────────────────→  …/studio/k7:26.08031412
  └─ --build-arg APP_VERSION=@build_version@   (passed to the BuildImageStep)
       → Dockerfile frontend-build stage:  ARG APP_VERSION=dev
                                           ENV VITE_APP_VERSION=$APP_VERSION
         → vite inlines import.meta.env.VITE_APP_VERSION as a literal
           → dist/ → COPY into the runtime stage (k7's frontend/dist)
             → the stamp in k7's chrome
```

The image tag and the stamp in the SPA come from ONE `compute build version` step, so they
cannot disagree. z0's stamp is its own repository's and is not comparable with this one.

`YY.MMDDHHmm` in Europe/Paris — `26.08031412` is 3 August 2026, 14:12. Sortable,
readable at a glance, and short enough to sit in a header without crowding it. The
computation falls back to UTC if the builder image lacks timezone data, so a missing
tzdata shifts the stamp by an hour or two rather than failing the build.

The image also carries `:latest` and `:@commit_hash@`. Three tags, three uses: the one
you deploy, the one you can `git show`, and the one you can read. Only the commit's is pushed
before the tests pass; the other two follow once they have ([images.md](images.md)).

## Why `ENV` and not phare's `RUN VITE_APP_VERSION=… npm run build`

**This is the one place studio deliberately does not copy phare.**

Phare writes the variable as a command prefix on the `RUN` line. That works there because
its monolith builds each SPA on its own `RUN`… and would not survive being written as a
chain, which is the shape any one `RUN` building several SPAs takes. k7 builds one SPA today, so
a command prefix would be harmless here; `ENV` is kept because it stays right when a second build
joins the `RUN`, and the prefix does not.

Written as a chain, a shell command-prefix assignment applies to the first command only, so
`VITE_APP_VERSION=x npm run build -w a && npm run build -w b` stamps `a` and silently ships `b`
as `dev`. Nothing fails; you just get a wrong SPA in a correctly tagged image — the worst
combination, because the tag says the stamp is right.

`ENV` in the `frontend-build` stage covers whatever that `RUN` runs. That stage is a throwaway
whose only export is `dist/`, so the variable reaches no runtime image.

## Two things that would silently break it

Both produce a working build that ships the wrong stamp — no error, no warning.

1. **Moving `ARG APP_VERSION` before the first `FROM`.** A build arg declared in the
   global scope is not visible inside a stage unless re-declared there; it would expand
   to empty.

2. **Renaming the variable to something without the `VITE_` prefix.** There is no
   `define` block anywhere; the mechanism is Vite's default `envPrefix`. A
   `BUILD_VERSION` would simply not be inlined.

Neither the Dockerfile's `npm run build --workspace <x>` nor the root `npm run build`
(`npm run build --workspaces --if-present`) caches anything, so there is no cache key to
strip the variable from and no stale bundle to worry about: every build reads it fresh.

## The fallback is `dev`, twice

`ARG APP_VERSION=dev` in the Dockerfile covers a plain `docker build` — including
`npm run images`, whose `commons/scripts/build-images.sh` passes only `BASE_IMAGE`, which k7's
Dockerfile does not read. So locally built images read `dev`, and
their `rN` tag scheme is unrelated to CI's.

That script finds its apps by globbing `apps/*/docker/Dockerfile` and names the image
after the folder, so nothing is named by hand — under the checkout's own folder name, which is the
`<repo>` of `<repo>/<app>`, the shape phare's `phare/phare` has. CI's images are
`dev.frediver.se/frediverse/k7/k7-webapp` and `…/k7/k7-runtime`, OneDev's registry keeping a project's images
under its path (`frediverse/k7`). The two do not meet: the script names an image after its app's folder,
so a hand-built one is `<checkout>/k7`, never CI's `k7-webapp`, and nothing deployed pulls it.

`?? "dev"` at each render site covers `vite dev` and a bare `vite build`, where the
variable is absent entirely. `??` and not `||`: an explicitly empty
`VITE_APP_VERSION=` renders as an empty string rather than `dev`, which is a real if
harmless edge.

Both layers exist so the stamp can never render `undefined`.

## Where it shows

One SPA, one image:

| image | where it answers | SPA | render site |
|---|---|---|---|
| k7 | `/` (root of its own subdomain), the media library under `/media`, the rehearsal pages under `/rehearsal` | `k7-frontend` | `apps/k7/frontend/src/projects/HomeSidebar.tsx` — tooltip on the sidebar's title, on every home page including the media library's and the rehearsal pages' |

`VERSION` is read at module scope so it constant-folds into the bundle.

In k7's home sidebar the stamp is a
tooltip on the app's name and never visible text: nobody needs it in the moment, and it is one hover
away for whoever asks which image this is.

k7 serves its own `frontend/dist` directly (`express.static` in `src/server.ts`), with no nginx
and no location list to keep in step with the SPA's `base`.

## The submodule, and why CI needs a credential

`.gitmodules` uses `url = ../commons.git` — relative to whatever origin the clone has.
On a developer machine that resolves against the SSH remote; on the OneDev agent it
resolves against the project's HTTP origin. This is why every `CheckoutStep` uses

```yaml
    cloneCredential:
      type: HttpCredential
      accessTokenSecret: submodule-token
```

rather than `DefaultCredential`: the default credential authenticates the *parent*
clone, not the submodule fetch that follows it.

**`submodule-token` is a job secret in studio's OneDev project settings, not in this
repo.** Secrets are per-project, so phare's does not carry over. If checkout fails after
a fresh setup, that secret is the first thing to check — a missing one fails with an
unresolved-secret error, a wrong one with a 401 on the commons fetch.

If you clone this repo and `commons/` comes up empty, run
`git submodule sync && git submodule update --init`.

## The shell is asked again on every load, its assets never

k7 serves its own `frontend/dist` from the backend (`src/server.ts`), with two
cache rules. `index.html` — and every other file outside `assets/`, the manifest and the icons —
goes out `no-cache`: a browser may keep it, but asks the server before each use, so the first load
after a deploy is the new build. Files under `assets/` go out `immutable` for a year: Vite names
each one after a hash of its content, so a name never comes back with other bytes, and a new
`index.html` names the new ones. Express's default (`max-age=0`) would have had the browser
re-check every chunk on every load for nothing.

`no-cache` and not `max-age=0`: the two read the same until the server is unreachable, where some
browsers serve a stale `max-age=0` copy and a `no-cache` one is not served unchecked.

A **service worker** is the other cache, and it ignores these headers for what it precached. k7
registers one (`apps/k7/frontend/src/appMain.tsx`, `commons/dev/vite-config/docs/pwa.md` for how
a deploy reaches an open tab). An app on an iPhone's home screen can still be RESUMED
from memory without any request at all; closing it in the app switcher is what makes it load.
