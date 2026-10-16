# The k7 image — why its Dockerfile is staged the way it is

The OneDev job `build studio images` builds one image, k7 — the editor, the media library and the
rehearsal recorder — in a single `BuildImageStep` (`.onedev-buildspec.yml`). Its Dockerfile builds
from the repo root (`apps/k7/docker/Dockerfile`) and pays for two expensive things: an `npm ci`
over the workspace, and the C toolchain `ssh2` builds its optional crypto binding with. z0 is
deployed beside it but built by its own repository, which keeps the same stage layout by
convention only: nothing here checks the two against each other.

The server's engine is a second image built here, `k7-runtime`, in a job of its own because it
compiles C++: `docs/server-engine.md`.

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
`commands.yaml`). The checkout stays in the image for that reason, and for the DSP runner, which
still compiles a user's TypeScript DSP with tsx. Its target is node 22, the image's; the desktop
and phone bundles target 24, Electron's.

## A healthcheck, memory limits and capped logs

`HEALTHCHECK` asks `/api/health`, which needs no session and touches no disk, so it fails only
when the event loop stops answering. The server's engine waits for it (`service_healthy`) rather
than dialling a k7 still starting. `docker/docker-compose.yml` caps k7 and the engine with
separate `mem_limit`s, so a render or an import on k7 cannot starve the engine's null sink, and
every account's file service with `STUDIO_FILE_SERVICE_HEAP_MB`, so one account's leak ends that
account's process. Every service's json-file log is rotated (`LOG_MAX_SIZE`, `LOG_MAX_FILE`).

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

## The process runs as `node`, and its volumes must be `node`'s

The runtime stage ends on `USER node`: the code under `/app` stays root's, so a flaw in a route
cannot rewrite the server it runs in. What the process writes is its four volumes — `/data`,
`/library`, `/workspaces`, `/rehearsal-data` — which the image creates owned by `node` before
declaring them, so a FRESH volume inherits that owner. A volume that already holds files owned by
root keeps them: it needs a one-time `chown -R 1000:1000` of its contents (for instance
`docker run --rm -v <volume>:/v alpine chown -R 1000:1000 /v`) before this image can write to it.
