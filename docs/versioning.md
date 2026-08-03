# Versioning and the deployment pipeline

How a studio image gets a version, and how that version reaches the screen. This
mirrors what `../phare` does, with one deliberate difference noted below.

The whole thing exists to answer one question: **looking at a running app, which image
is that?** There is no version endpoint and no `/healthz` — phare has none either. The
stamp is visible in exactly two places, the SPA chrome and the image tag, and they are
the same string.

## The chain

```
OneDev CommandStep (node -e, Europe/Paris)  →  ./build_version   e.g. "26.08031412"
  ├─ SetBuildVersionStep  ─────────────────→  the OneDev build version
  ├─ RegistryOutput tags  ─────────────────→  …/studio/<app>:26.08031412
  └─ --build-arg APP_VERSION=@build_version@
       → Dockerfile frontend-build stage:  ARG APP_VERSION=dev
                                           ENV VITE_APP_VERSION=$APP_VERSION
         → vite inlines import.meta.env.VITE_APP_VERSION as a literal
           → dist/ → COPY into /usr/share/nginx/html of the runtime stage
             → <span>{VERSION}</span> in the app's chrome
```

`YY.MMDDHHmm` in Europe/Paris — `26.08031412` is 3 August 2026, 14:12. Sortable,
readable at a glance, and short enough to sit in a header without crowding it. The
computation falls back to UTC if the builder image lacks timezone data, so a missing
tzdata shifts the stamp by an hour or two rather than failing the build.

Each image also carries `:latest` and `:@commit_hash@`. Three tags, three uses: the one
you deploy, the one you can `git show`, and the one you can read.

## Why `ENV` and not phare's `RUN VITE_APP_VERSION=… npm run build`

Phare writes the variable as a command prefix on the `RUN` line. That works there
because every phare image builds exactly one SPA.

`apps/obscura/docker/Dockerfile` builds **six** in one `&&` chain. A shell command-prefix
assignment applies to the first command only, so `VITE_APP_VERSION=x npm run build -w a
&& npm run build -w b` stamps `a` and silently ships `b` through `f` as `dev`. Nothing
fails; you just get five wrong images.

So all four Dockerfiles use `ENV` in the `frontend-build` stage instead — same form
everywhere, so nobody has to remember which shape is safe for which file. `frontend-build`
is a throwaway stage whose only export is `dist/`, so the `ENV` reaches no runtime image.

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

Measured on turbo 2.10.8: `turbo run build --filter=mediatek` with two different values
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

`?? "dev"` at each render site covers `vite dev` and a bare `vite build`, where the
variable is absent entirely. `??` and not `||`: an explicitly empty
`VITE_APP_VERSION=` renders as an empty string rather than `dev`, which is a real if
harmless edge.

Both layers exist so the stamp can never render `undefined`.

## Where it shows

All nine SPAs. `VERSION` is read at module scope in each so it constant-folds into the
bundle.

| image | SPA | render site |
|---|---|---|
| pistes | `pistes-frontend` | `apps/pistes/frontend/src/App.tsx` — header, after the title |
| mediatek | `mediatek` | `apps/mediatek/src/Library.tsx` — header, after the subtitle |
| k7 | `k7-frontend` | `apps/k7/frontend/src/views/HeaderView.tsx` — beside the mark |
| obscura | `obscura-online` | `src/App.tsx` — header |
| obscura | `obscura-editor` | `src/views/EditorView.tsx` — `.topbar` |
| obscura | `obscura-monitor` | `src/views/MonitorView.tsx` — `.topbar` |
| obscura | `obscura-remote` | `src/views/RemoteView.tsx` — `.status-bar` |
| obscura | `obscura-buzzer` | `src/views/BuzzerView.tsx` — fixed bottom-left |
| obscura | `obscura-presenter` | `src/components/Game2D.tsx` — overlay, bottom-left |

Styling follows each app's own idiom — Tailwind utilities where the surrounding chrome
is Tailwind (pistes, mediatek, obscura-online), a small class in the app's CSS file
everywhere else. There is deliberately **no** shared version component: putting it in
`obscura-shared`'s auth badge would have landed it in six places at once, but that badge
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
