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

## `--mount=type=cache` keeps the npm cache when a manifest does change

A lockfile change invalidates the install layers, but the `/root/.npm` cache mount survives
between builds, so `npm ci` reinstalls from the local cache instead of the registry.

## The layers are kept in the registry, not only in the builder

The `BuildImageStep` exports its cache to `studio/cache:k7` (`mode=max`, so the install
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
