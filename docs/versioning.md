# Versioning and the deployment pipeline

How the studio image gets a version, and how that version reaches the screen. This
mirrors what `../phare` does, with one deliberate difference noted below.

The whole thing exists to answer one question: **looking at a running app, which image
is that?** There is no version endpoint and no `/healthz` — phare has none either. The
stamp is visible in exactly two places, the SPA chrome and the image tag, and they are
the same string.

## FOUR images, and why st0/pl8/k7 do not share phare's shape

Each of `apps/st0/docker/Dockerfile`, `apps/pl8/docker/Dockerfile` and
`apps/k7/docker/Dockerfile` builds its OWN image: one process, no nginx — the backend serves
its own built frontend directly (`express.static` + an SPA fallback, in each app's own
`src/server.ts`). They don't start from the shared `frediverse-base` image
(`commons/dev/docker-runtime`) at all, since there's no second process (nginx) to supervise
alongside the backend. Traefik reaches each one directly by hostname
(`docker/docker-compose.yml`) — st0 at the root domain, pl8 and k7 each on their own subdomain.

`apps/z0/docker/Dockerfile` is the one exception, shaped like phare's monolith: it serves six
SPAs behind one nginx (`apps/z0/docker/nginx.conf`) reverse-proxying its own backend, and lives on
st0's hostname — Traefik reaches it by a `PathPrefix(/z0)` rule layered on st0's domain, its own
container. `engine/st0-engine`, `engine/st0-supervisor` and `engine/st0-tray` are in none of these
four: they run on the musician's own machine, beside the audio interface.

What four images cost is paid per-app instead of once: each image ships and
restarts on its own, so a crash in one does not recycle the other three — the opposite of
phare's/z0's shared-lifecycle trade, and worth naming since it's the reason z0 alone still pays it.

## The chain

```
OneDev CommandStep (node -e, Europe/Paris)  →  ./build_version   e.g. "26.08031412"
  ├─ SetBuildVersionStep  ─────────────────→  the OneDev build version
  ├─ RegistryOutput tags  ─────────────────→  …/studio/<app>:26.08031412   (one per image)
  └─ --build-arg APP_VERSION=@build_version@   (passed to all four BuildImageSteps)
       → Dockerfile frontend-build stage:  ARG APP_VERSION=dev
                                           ENV VITE_APP_VERSION=$APP_VERSION
         → vite inlines import.meta.env.VITE_APP_VERSION as a literal
           → dist/ → COPY into the runtime stage (each app's own frontend/dist; z0's six
             land in /usr/share/nginx/html, the one image that still has an nginx)
             → <span>{VERSION}</span> in every app's chrome
```

One stamp covers every SPA that renders one, because the four `BuildImageStep`s all get the
SAME `@build_version@` from ONE `compute build version` step — they ship from one CI run, so
so four images are not separately versioned in practice.

`YY.MMDDHHmm` in Europe/Paris — `26.08031412` is 3 August 2026, 14:12. Sortable,
readable at a glance, and short enough to sit in a header without crowding it. The
computation falls back to UTC if the builder image lacks timezone data, so a missing
tzdata shifts the stamp by an hour or two rather than failing the build.

The image also carries `:latest` and `:@commit_hash@`. Three tags, three uses: the one
you deploy, the one you can `git show`, and the one you can read. Only the commit's is pushed
before the tests pass; the other two follow once they have ([images.md](images.md)).

## Why `ENV` and not phare's `RUN VITE_APP_VERSION=… npm run build`

**This is the one place studio deliberately does not copy phare**, and it still matters for
`apps/z0/docker/Dockerfile`, which builds several SPAs (st0/pl8/k7 each build one, and a command-prefix
`RUN` would be harmless for those three, but there's no reason to write the one image that
still needs the safer form differently from the other three).

Phare writes the variable as a command prefix on the `RUN` line. That works there because
its monolith builds each SPA on its own `RUN`… and would not survive being written as a
chain, which is the shape any one `RUN` building several SPAs takes.

`apps/z0/docker/Dockerfile` builds **six** SPAs in one `RUN`. Written as a chain, a shell
command-prefix assignment applies to the first command only, so
`VITE_APP_VERSION=x npm run build -w a && npm run build -w b` stamps `a` and silently
ships the other five as `dev`. Nothing fails; you just get five wrong SPAs in a
correctly tagged image — the worst combination, because the tag says the stamp is right.

`ENV` in the `frontend-build` stage covers whatever that `RUN` runs. That stage is a throwaway
whose only export is `dist/`, so the variable reaches no runtime image.

## Two things that would silently break it

Both produce a working build that ships the wrong stamp — no error, no warning.

1. **Moving `ARG APP_VERSION` before the first `FROM`.** A build arg declared in the
   global scope is not visible inside a stage unless re-declared there; it would expand
   to empty. `ARG BASE_IMAGE` sits before the first `FROM` on purpose — it feeds
   `FROM ${BASE_IMAGE}` — and is the exception, not the pattern to copy.

2. **Renaming the variable to something without the `VITE_` prefix.** There is no
   `define` block anywhere; the mechanism is Vite's default `envPrefix`. A
   `BUILD_VERSION` would simply not be inlined.

Neither the Dockerfiles' `npm run build --workspace <x>` nor the root `npm run build`
(`npm run build --workspaces --if-present`) caches anything, so there is no cache key to
strip the variable from and no stale bundle to worry about: every build reads it fresh.

## The fallback is `dev`, twice

`ARG APP_VERSION=dev` in each Dockerfile covers a plain `docker build` — including
`npm run images`, whose `commons/scripts/build-images.sh` passes only `BASE_IMAGE` (unused by
st0/pl8/k7's own Dockerfiles, only consumed by z0's). So locally built images read `dev`, and
their `rN` tag scheme is unrelated to CI's.

That script finds its apps by globbing `apps/*/docker/Dockerfile` and names the image
after the folder, so nothing is named by hand: `apps/st0/docker/Dockerfile` becomes
`dev.frediver.se/frediverse/studio/st0`, and so on for `pl8`, `k7` and `z0` — the same
`<repo>/<app>` shape phare's `phare/phare` has, four times over instead of once.

`?? "dev"` at each render site covers `vite dev` and a bare `vite build`, where the
variable is absent entirely. `??` and not `||`: an explicitly empty
`VITE_APP_VERSION=` renders as an empty string rather than `dev`, which is a real if
harmless edge.

Both layers exist so the stamp can never render `undefined`.

## Where it shows

Eight of the nine SPAs, across four images — all built from the SAME `@build_version@` (see "The
chain" above), so the eight stamps read as one string though the images ship apart. `VERSION` is read at module scope in each so it
constant-folds into the bundle.

| image | where it answers | SPA | render site |
|---|---|---|---|
| st0 | `/` (root of its own subdomain) | `st0-frontend` | `apps/st0/frontend/src/projects/Home.tsx`, `LibrariesPage.tsx` — tooltip on the header's title |
| pl8 | `/` (root of its own subdomain) | `pl8-frontend` | `apps/pl8/frontend/src/Library.tsx` — tooltip on the header's title |
| k7 | `/` (root of its own subdomain) | `k7-frontend` | `apps/k7/frontend/src/views/HeaderView.tsx` — tooltip on the header's title |
| z0 | `/z0` | `z0-online` | `src/App.tsx` — header |
| z0 | `/z0/monitor` | `z0-monitor` | `src/views/MonitorView.tsx` — `.topbar` |
| z0 | `/z0/remote` | `z0-remote` | `src/views/RemoteView.tsx` — `.status-bar` |
| z0 | `/z0/buzzer` | `z0-buzzer` | `src/views/BuzzerView.tsx` — fixed bottom-left |
| z0 | `/z0/presenter` | `z0-presenter` | `src/components/Game2D.tsx` — overlay, bottom-left |
| z0 | `/z0/editor` | `z0-editor` | **nowhere** — it ships in the image and renders no stamp |

Where the bar is `@frediverse/ui`'s `AppHeader` — st0, pl8, k7 — the stamp is its `version` prop, a
tooltip on the app's name and never visible text: nobody needs it in the moment, and it is one hover
away for whoever asks which image this is.

`z0-editor` is the one gap, and it is listed rather than left out so the table still answers
"what is in the image". Its chrome is `@frediverse/ui` like st0's rather
than z0's own CSS, so when the stamp is added the placement is st0's idiom and not the
`.topbar` class its z0 siblings share.

For z0's six, the "where it answers" column is also the folder each `dist/` lands in under
`/usr/share/nginx/html`, and the `base` its vite config declares. Those three have to
agree or the SPA loads and its assets 404 — which is why `apps/z0/docker/Dockerfile`'s COPY
block and `apps/z0/docker/nginx.conf`'s `location` list read in the same order as this table.
st0/pl8/k7 have no such table to keep in sync: each backend serves its own `frontend/dist`
directly (`express.static` in `src/server.ts`), no nginx and no location list involved.

Styling follows each app's own idiom — Tailwind utilities where the surrounding chrome
is Tailwind (st0, pl8, z0-online), a small class in the app's CSS file
everywhere else. There is deliberately **no** shared version component: putting it in
`z0-shared`'s auth badge would land it in six places at once, but that badge
is an inline topbar item in three apps and a fixed top-right overlay in the other three.

Two placements are constrained by things already on screen, and both constraints are
recorded next to the CSS rule:

- **buzzer** — the stamp is `pointer-events: none`. The buzz handler is on the page
  container, not the circle, so a span that swallowed taps would carve a dead zone out
  of the buzz surface. Do not "fix" this with `stopPropagation`.
- **remote** — the stamp is left-aligned in `.status-bar` flow, *not* `margin-left: auto`.
  `.auth-badge` is fixed at top/right 6px on `z-index: 9999` and would cover it.

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
