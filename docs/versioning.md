# Versioning and the deployment pipeline

How the studio image gets a version, and how that version reaches the screen. This
mirrors what `../phare` does, with one deliberate difference noted below.

The whole thing exists to answer one question: **looking at a running app, which image
is that?** There is no version endpoint and no `/healthz` — phare has none either. The
stamp is visible in exactly two places, the SPA chrome and the image tag, and they are
the same string.

## ONE image, like phare's

Every hosted app of this repo ships in a single container — `apps/studio/docker/` —
l8 at the origin root, pl8 and k7 under their prefixes, z0's six SPAs under `/z0`, four
backends beside one nginx that owns the path routing. It replaced four images (k7, l8,
pl8, z0), each with its own Dockerfile, nginx.conf and build job.

The reason is the origin. These apps were never independent: they share one hostname,
one session cookie, and one prefixless `/auth/*` that pl8's backend owns wherever its own
SPA sits (the IdP has a single redirect_uri registered — `apps/z0/docs/origin.md` is the
post-mortem of trying otherwise). Four images meant the EDGE held the path table, so which app answered which
prefix was configuration living outside this repo, and each image had to be told which
prefix to strip. Now the edge sends the whole origin **unstripped** and one nginx.conf,
versioned next to the apps, decides. Deploying is one pull.

phare keeps douane out of its monolith because it fronts Authelia and deploys on its own
cadence. **Nothing here plays that part**, so the studio image holds everything —
`engine/moteur` and `engine/capot` excepted, and those are not server software at all:
they run on the musician's machine, beside the audio interface.

What it costs is written down rather than discovered: the four backends now share a
container lifecycle, so any one of them dying recycles all four. That is `run-backends.sh`'s
rule and phare's, and it is the price of one deployment unit. z0 in particular used to
supervise and RESTART its own backend in place (its old `docker/entrypoint.sh`); it no
longer does.

## The chain

```
OneDev CommandStep (node -e, Europe/Paris)  →  ./build_version   e.g. "26.08031412"
  ├─ SetBuildVersionStep  ─────────────────→  the OneDev build version
  ├─ RegistryOutput tags  ─────────────────→  …/studio/studio:26.08031412
  └─ --build-arg APP_VERSION=@build_version@
       → Dockerfile frontend-build stage:  ARG APP_VERSION=dev
                                           ENV VITE_APP_VERSION=$APP_VERSION
         → vite inlines import.meta.env.VITE_APP_VERSION as a literal
           → dist/ → COPY into /usr/share/nginx/html of the runtime stage
             → <span>{VERSION}</span> in every app's chrome
```

One stamp now covers all nine SPAs, which is the honest thing for one image: they ship
together, so they were never separately versionable in practice.

`YY.MMDDHHmm` in Europe/Paris — `26.08031412` is 3 August 2026, 14:12. Sortable,
readable at a glance, and short enough to sit in a header without crowding it. The
computation falls back to UTC if the builder image lacks timezone data, so a missing
tzdata shifts the stamp by an hour or two rather than failing the build.

The image also carries `:latest` and `:@commit_hash@`. Three tags, three uses: the one
you deploy, the one you can `git show`, and the one you can read.

## Why `ENV` and not phare's `RUN VITE_APP_VERSION=… npm run build`

**This is the one place studio deliberately does not copy phare**, and consolidating into
one image made it matter more rather than less.

Phare writes the variable as a command prefix on the `RUN` line. That works there because
its monolith builds each SPA on its own `RUN`… and would not survive being written as a
chain, which is exactly the shape studio needs.

`apps/studio/docker/Dockerfile` builds **nine** SPAs in one `&&` chain. A shell
command-prefix assignment applies to the first command only, so
`VITE_APP_VERSION=x npm run build -w a && npm run build -w b` stamps `a` and silently
ships the other eight as `dev`. Nothing fails; you just get eight wrong SPAs in a
correctly tagged image — the worst combination, because the tag says the stamp is right.

`ENV` in the `frontend-build` stage covers the whole chain. That stage is a throwaway
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

### Turbo is *not* a hazard here, though it looks like one

`turbo.json` declares no `globalEnv` and no `env`, and turbo 2 defaults to strict env
mode — which reads like `VITE_APP_VERSION` should be filtered out of task environments
and left out of the cache key. It is not, because turbo infers the framework from each
workspace and adds Vite's `VITE_*` to the env key automatically.

Measured on turbo 2.10.8: `turbo run build --filter=pl8` with two different values
produced two different task hashes (`d459578664edb92f` / `04f869a3a312cc63`) and a fresh
bundle each time, correctly stamped. So the variable both reaches the build and busts
the cache.

The Dockerfiles still call `npm run build --workspace <x>` directly, but that predates
the stamp and is about build *scope*, not about this variable. If you ever add a
build-time variable **without** a framework-recognised prefix, that one really would need
a `globalEnv` entry.

## The fallback is `dev`, twice

`ARG APP_VERSION=dev` in the Dockerfile covers a plain `docker build` — including
`npm run images`, whose `commons/scripts/build-images.sh` passes only `BASE_IMAGE`. So
locally built images read `dev`, and their `rN` tag scheme is unrelated to CI's.

That script finds its apps by globbing `apps/*/docker/Dockerfile` and names the image
after the folder, so the consolidation renamed nothing by hand: one folder, one image,
`dev.frediver.se/frediverse/studio/studio` — the same `<repo>/<app>` shape phare's
`phare/phare` has.

`?? "dev"` at each render site covers `vite dev` and a bare `vite build`, where the
variable is absent entirely. `??` and not `||`: an explicitly empty
`VITE_APP_VERSION=` renders as an empty string rather than `dev`, which is a real if
harmless edge.

Both layers exist so the stamp can never render `undefined`.

## Where it shows

All nine SPAs, now all in one image, so the nine stamps are always the same string.
`VERSION` is read at module scope in each so it constant-folds into the bundle.

| public path | SPA | render site |
|---|---|---|
| `/` | `pl8-frontend` | `apps/pl8/frontend/src/Library.tsx` — header, after the subtitle |
| `/` | `l8-frontend` | `apps/l8/frontend/src/App.tsx` — header, after the title |
| `/k7` | `k7-frontend` | `apps/k7/frontend/src/views/HeaderView.tsx` — beside the mark |
| `/z0` | `z0-online` | `src/App.tsx` — header |
| `/z0/editor` | `z0-editor` | `src/views/EditorView.tsx` — `.topbar` |
| `/z0/monitor` | `z0-monitor` | `src/views/MonitorView.tsx` — `.topbar` |
| `/z0/remote` | `z0-remote` | `src/views/RemoteView.tsx` — `.status-bar` |
| `/z0/buzzer` | `z0-buzzer` | `src/views/BuzzerView.tsx` — fixed bottom-left |
| `/z0/presenter` | `z0-presenter` | `src/components/Game2D.tsx` — overlay, bottom-left |

The path column is also the folder each `dist/` lands in under
`/usr/share/nginx/html`, and the `base` its vite config declares. Those three have to
agree or the SPA loads and its assets 404 — which is why the Dockerfile's COPY block and
the nginx `location` list read in the same order as this table.

Styling follows each app's own idiom — Tailwind utilities where the surrounding chrome
is Tailwind (l8, pl8, z0-online), a small class in the app's CSS file
everywhere else. There is deliberately **no** shared version component: putting it in
`z0-shared`'s auth badge would have landed it in six places at once, but that badge
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

The URL was an absolute Windows path (`C:/Users/flb/Src/commons`) until August 2026,
which no build agent could resolve. If you clone this repo and `commons/` comes up
empty, run `git submodule sync && git submodule update --init`.
