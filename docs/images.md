# The k7 image — why its Dockerfile is staged the way it is

The OneDev job `build studio images` builds one image, k7 — the editor, the media library and the
rehearsal recorder — in a single `BuildImageStep` (`.onedev-buildspec.yml`). Its Dockerfile builds
from the repo root (`apps/k7/docker/Dockerfile`) and pays for two expensive things: an `npm ci`
over the workspace, and the C toolchain `ssh2` builds its optional crypto binding with. z0 is
deployed beside it but built by its own repository, which keeps the same stage layout by
convention only: nothing here checks the two against each other.

The server's engine is a second image built here, `k7-runtime`, in a job of its own because it
compiles C++: `docs/server-engine.md`.

## One Node version: 24

The image's stages, OneDev's jobs, GitHub's (through `.nvmrc`) and the bundles' esbuild target all
name Node 24, the active LTS: a test run on one version and a server on another is a bug found in
production. Its `node:sqlite`, the shares' comments store, needs no `--experimental-sqlite`, and
it has an alpine image. A move to the next LTS changes every `node:24-*` image tag, `.nvmrc`, the
root `engines` and `bundle.mjs`'s `target` in the same commit.

## An install depends on the manifests, never on the sources

The stage that runs `npm ci` sees the lockfile, `.npmrc` and every `package.json`, and nothing
else: the `manifests` stage cuts the build context down to those files. BuildKit keys a
`COPY` on file content, not on timestamps. So a push that touches no manifest finds every install
layer in the cache, and only the frontend build and the final `COPY . .` run.

The hazard this avoids: with `COPY . .` before `npm ci`, any edit to any file invalidates
the install, and every deploy pays for 1,200 packages and their native builds.

## `deps` installs the whole workspace

`manifests`, `toolchain` and `deps` are the first three stages, and `deps` installs the WHOLE
workspace rather than the frontend's closure: one install layer serves the frontend build and
stays valid whatever the frontend imports next.

The production install (`backend-deps`) is separate, because the runtime image ships only its
backend's closure (see `commons/scripts/check-image-closure.cjs` for what that closure must
hold). It still sees only the manifests, so it is cached across deploys like the others.

## The server runs a bundle, not source under tsx

The `frontend-build` stage also bundles the backend and the file service
(`apps/k7/backend/scripts/bundle.mjs server-dist --in-tree`), and the image runs
`node /app/server-dist/backend.mjs`, each account's file service starting from
`STUDIO_FILE_SERVICE_ENTRY` the same way. Under tsx, every process transpiled the whole package
graph on start and kept an esbuild child beside it, and the hub starts one file service per
account: that cost was paid per account, at every first request and every deploy.

`--in-tree` writes only the two entries, into a folder of the checkout, so each source's
`import.meta` points at the files the image already copies (`frontend/dist`, `song/meta`,
`commands.yaml`). The checkout stays in the image for that reason, and for `@studio/dsp` and esbuild,
with which the file service transpiles and jails a user's TypeScript DSP (`packages/song/docs/jsdspJail.md`). Its target is node 24, like the desktop and phone
bundles.

## No `mpv` in the runtime stage

The container has no sound device, and alpine's `mpv` pulls X, Wayland and mesa libraries for a
player that could never be heard. Without it the backend mounts no host-player routes and the
library does not offer the host's speakers (`packages/mpv-player/docs/mpvPlayer.md`).

## tini is PID 1, in the image

The backend starts a file service per account, and each of those starts ffmpeg, the engine for a
render and chromium for a picture. A service that dies before its children — killed past its stop
grace, or by its heap ceiling — leaves them re-parented to PID 1. Node never reaps a child it did
not spawn, so with node as PID 1 each one becomes a zombie, and one still running burns CPU for
nobody. So the image's `ENTRYPOINT` is `tini`, which reaps every orphan and forwards the stop
signal; the `CMD` `exec`s node, so node is tini's direct child and gets that signal. It is in the
image and not `init: true` in the compose file because the image runs elsewhere too — a bare
`docker run`, another orchestrator — and an init that only one deployment supplies is one the
others lack. tini only reaps: killing what a dead service left running is the file hub's job,
which signals each service's process group (`packages/file-hub/docs/fileHub.md`). The server's
engine image runs under tini for the same reason (`engine/docker/Dockerfile`).

## A readiness healthcheck, memory limits and capped logs

`HEALTHCHECK` asks `/api/ready`, answered only on loopback. It is ready when each volume the
environment names takes a one-byte write, and no file-service start has been waiting longer than
any timeout of the hub's own. Both are faults that persist until somebody acts: a full or
read-only disk, and a start the hub can no longer finish. A hub at its cap is NOT unready: it turns
one account away with a 503 and serves the others, and a check that failed on it would flip the
container on every busy evening. `/api/health` stays as the liveness probe: no session, no disk,
only that the event loop answers. The server's engine waits for the healthcheck (`service_healthy`)
rather than dialling a k7 still starting.

`docker/docker-compose.yml` caps k7 and the engine with separate `mem_limit`s, so a render or an
import on k7 cannot starve the engine's null sink. Inside k7's limit the backend, every account's
file service and their children share one budget, and an OOM kill there takes the whole backend
down. So each file service gets a heap ceiling (`STUDIO_FILE_SERVICE_HEAP_MB`), and the number of
them is capped from the same limit (`STUDIO_MAX_FILE_SERVICES`, derived as in
`packages/file-hub/docs/fileHub.md`). The compose file sets the cap explicitly, matching its
default `mem_limit`. Every service's json-file log is rotated (`LOG_MAX_SIZE`, `LOG_MAX_FILE`).

## `--mount=type=cache` keeps the npm cache when a manifest does change

A lockfile change invalidates the install layers, but the `/root/.npm` cache mount survives
between builds, so `npm ci` reinstalls from the local cache instead of the registry.

## The layers are kept in the registry, not only in the builder

The `BuildImageStep` exports its cache to `k7/cache:k7-webapp` (`mode=max`, so the install
stages are in it, not only the final image) and imports it on the next run. A builder that
starts empty, or one whose cache was pruned, still finds the installs. `image-manifest=true`
stores the cache as an ordinary OCI image, which a registry that refuses BuildKit's own cache
manifest still accepts.

## An image build checks no types

The frontends are built with `vite build` alone, not with their `build` script, whose second half
is `tsc`. Every frontend has a `typecheck` script, and `lint and test` runs all of them, so a type
error is still red; the image job just doesn't find it a second time.

## Built beside the tests, published after them

`build studio images` has no trigger. `publish studio images` does, and depends on it and on
`lint and test`, which therefore run at the same time. The build pushes the image under the
commit hash only, which nothing deploys. The publish job moves `:latest` and the version stamp
onto that manifest with `docker buildx imagetools create`, a copy inside the registry, once both
have passed. The stamp travels from the build job as an artifact, because it is baked into the
SPAs and a second clock reading could disagree with it.

## GitHub builds the same images, into GHCR

`.github/workflows/images.yml` is the same pipeline on GitHub, for `k7-webapp`, `k7-runtime` and the
Pi's `k7-runtime-pi`, under `ghcr.io/fredericlb/`: built beside `k7.yml` under the commit, tagged
`:latest` and with the stamp once `k7.yml` has passed for that commit. The Pi image builds on an
arm64 runner, natively. The engine's compile lives in cache mounts, which a registry cache does not
carry and a fresh runner starts without: a push that changes no native source reuses the compiled
layer whole, and one that does compiles cold. The deployment (`docker/docker-compose.yml`) still
pulls from OneDev's registry.

## The process runs as `node`, and its volumes must be `node`'s

The runtime stage ends on `USER node`: the code under `/app` stays root's, so a flaw in a route
cannot rewrite the server it runs in. What the process writes is its four volumes — `/data`,
`/library`, `/workspaces`, `/rehearsal-data` — which the image creates owned by `node` before
declaring them, so a FRESH volume inherits that owner. A volume that already holds files owned by
root keeps them: it needs a one-time `chown -R 1000:1000` of its contents (for instance
`docker run --rm -v <volume>:/v alpine chown -R 1000:1000 /v`) before this image can write to it.

## A `dsp` user that can read none of it

Compiling a project runs the account's `jsdsp.ts`, and that code must not reach another account's
workspace or the backend's secrets. So the image also has a `dsp` user (uid 10001), and a setuid
helper, `/usr/local/libexec/dsp-exec`. Only group `node` may execute the helper. It drops to `dsp`
before it runs node (`apps/k7/docker/dsp-exec.c`, `packages/song/docs/jsdspJail.md`). The four volumes
are mode 700, and the start re-applies that mode, because a volume created before it keeps the
mode it had. The helper is built static in a stage of its own, so `gcc` stays out of the runtime
stage. It needs the setuid bit honoured: a deployment that sets `no-new-privileges` turns every
jsdsp compile into a failure, and a module then plays its last committed `jsdsp.json`.
