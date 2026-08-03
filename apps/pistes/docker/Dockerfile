# syntax=docker/dockerfile:1
#
# pistes — the WEB EDITOR: the SPA plus the hosted Node backend, in one
# single-origin container. The final stage starts from the repo-root base image
# (nginx + shared entrypoint + proxy snippet), which must be built first — see
# build.sh / .onedev-buildspec.yml.
#
# What this image is NOT: the DAW itself. pistes's audio engine is a native
# (JUCE/Tracktion) binary and its file service owns the user's workspace on the
# machine the audio hardware is plugged into — neither can live in a hosted
# container, and neither is built here. This image is only the hosted half:
#
#   web/frontend  the SPA           -> nginx serves it on :80
#   web/backend   auth + registry   -> node on :8789, proxied at /api and /auth
#
# The backend knows WHO you are (the shared @frediverse/oidc gate) and WHICH
# engines have checked in (the in-memory registry). The browser then talks to the
# chosen engine's own file service DIRECTLY, cross-origin — so this image needs
# no `cue` CLI, no brain packages, and no volume. Its state is a signed session
# cookie and an in-memory engine list; both are fine to lose on restart.

# ---- prune: cut the monorepo down to just what pistes's web app needs -----
# `turbo prune` computes the workspace subset (the two web packages plus the
# shared libraries they depend on) and emits a matching pruned lockfile, so this
# Dockerfile never hand-lists workspaces — see apps/k7/docker/Dockerfile for
# why that list cannot be maintained by hand.
ARG BASE_IMAGE=frediverse-base:latest

FROM node:22-alpine AS pruner
WORKDIR /repo
RUN npm install -g turbo@2
COPY . .
RUN turbo prune pistes-frontend pistes-backend --docker
# A SECOND prune, scoped to the backend alone, is what the runtime stage ships:
# pistes-backend + @studio/web-protocol + @frediverse/oidc and nothing
# else — no frontend source, and none of the brain/engine packages (the backend
# stopped importing those when the file service moved out to the engine host).
# node_modules/@frediverse/* are symlinks into the workspace, so a package
# missing from the image is a dangling link and a crash on first import.
RUN turbo prune pistes-backend --docker --out-dir=out-backend

# ---- deps: install from the pruned lockfile --------------------------------
# out/json holds only package.json files + the pruned package-lock.json, so this
# layer stays cached until pistes's web dependencies actually change.
FROM node:22-alpine AS deps
WORKDIR /app
COPY --from=pruner /repo/out/json/ ./
RUN npm ci

# ---- frontend build --------------------------------------------------------
# `build` is `tsc --noEmit && vite build`, so a type error fails the image — the
# frontend consumes @studio/ui-* and @frediverse/ui as raw source, and those
# come in through the prune closure. @frediverse/ui in particular MUST be
# present: index.css `@source`s commons/packages/ui/src, and Tailwind silently
# generates no classes for a @source path that doesn't exist.
FROM deps AS frontend-build
WORKDIR /app
COPY --from=pruner /repo/out/full/ ./
# The build stamp "YY.MMDDHHmm" the buildspec also tags this image with, shown in
# the SPA chrome. A plain `docker build` leaves it "dev" — only CI claims a version.
# Declared here rather than before the first FROM so a new stamp busts this layer
# alone; see docs/versioning.md for why it is an ENV and not a RUN-line prefix.
ARG APP_VERSION=dev
ENV VITE_APP_VERSION=$APP_VERSION
RUN npm run build --workspace pistes-frontend

# ---- backend prod deps -----------------------------------------------------
# Installed from the BACKEND-ONLY prune, production-only, so the runtime tree
# carries neither the frontend's dependency set nor the repo-root toolchain
# (biome/turbo/rolldown/storybook — ~200MB of devDependencies that a `npm ci`
# here would otherwise pull in through the root package.json).
#
# `tsx` survives this because it is a real **dependency** of the backend, not a
# devDependency: this service runs its TypeScript directly in production (see
# web/CLAUDE.md), so the interpreter is part of the runtime, and pruning it away
# would leave the CMD with nothing to execute. Node's own type stripping is not
# a substitute — it refuses to strip types inside node_modules, and
# @studio/web-protocol is consumed as .ts source from exactly there.
FROM node:22-alpine AS backend-deps
WORKDIR /app
COPY --from=pruner /repo/out-backend/json/ ./
RUN npm ci --omit=dev

# ---- final image -----------------------------------------------------------
FROM ${BASE_IMAGE} AS runtime
WORKDIR /app
# Workspace dependencies are hoisted to /app/node_modules; the backend resolves
# them by walking up from /app/apps/pistes/backend, and its own
# package.json marks it ESM.
COPY --from=backend-deps /app/node_modules ./node_modules
# The backend's whole workspace closure, computed by the backend-only prune.
COPY --from=pruner /repo/out-backend/full/ ./

COPY --from=frontend-build /app/apps/pistes/frontend/dist /usr/share/nginx/html
COPY apps/pistes/docker/nginx.conf /etc/nginx/http.d/default.conf

# One volume, and only for this: what the service remembers ABOUT a person — today the
# engine they drive. The registry is still in-memory (an engine re-announces within 5s) and
# the user's files still live on the engine host, so nothing else here is worth keeping.
#
# Losing it costs each user one click, the next time they log in. That is the whole risk
# budget, and it is why this is a file and not a database — see
# packages/user-prefs/docs/store.md.
VOLUME /data
ENV STUDIO_PREFS_DIR=/data/prefs
ENV PORT=8789

WORKDIR /app/apps/pistes/backend
# The base image's entrypoint runs this alongside nginx. Invoked by absolute
# path rather than through npm so the process the entrypoint supervises (and
# signals) is the server itself, with no npm wrapper in between.
CMD ["/app/node_modules/.bin/tsx", "src/server.ts"]
