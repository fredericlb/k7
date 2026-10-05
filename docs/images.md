# The four images — why their Dockerfiles open the same way

The OneDev job `build and publish studio images` builds st0, pl8, k7 and z0 one after the
other, as four `BuildImageStep`s (`.onedev-buildspec.yml`). Each Dockerfile builds from the repo root
(`apps/st0/docker/Dockerfile` and its three siblings), and each needs the same two expensive
things: an `npm ci` over the workspace, and the C toolchain `ssh2` builds its optional crypto binding with.

## An install depends on the manifests, never on the sources

The stage that runs `npm ci` sees the lockfile, `.npmrc` and every `package.json`, and nothing
else: the `manifests` stage cuts the build context down to those files. BuildKit keys a
`COPY` on file content, not on timestamps. So a push that touches no manifest finds every install
layer in the cache, and only the frontend build and the final `COPY . .` run.

The hazard this avoids: with `COPY . .` before `npm ci`, any edit to any file invalidates
the install, and every deploy pays for 1,200 packages and their native builds, eight times.

## The first three stages are byte-identical across the four files

`manifests`, `toolchain` and `deps` are spelled identically in all four Dockerfiles. Identical
instructions over identical inputs make identical cache keys, so the full install is built by
whichever image goes first and reused by the other three, even within one cold run. That is
why `deps` installs the WHOLE workspace rather than one app's frontend: one shared layer is
worth more than four smaller ones. An edit to one of those stages has to be made in all four,
or that image stops sharing and pays the install alone.

The production install (`backend-deps`) is per app, because the runtime image ships only its
backend's closure (see `commons/scripts/check-image-closure.cjs` for what that closure must
hold). It still sees only the manifests, so it is cached across deploys like the others.

## `--mount=type=cache` keeps the npm cache when a manifest does change

A lockfile change invalidates the install layers, but the `/root/.npm` cache mount survives
between builds, so `npm ci` reinstalls from the local cache instead of the registry.

## What all of this assumes

The cache lives in the Docker daemon (BuildKit) that OneDev's `BuildImageStep` runs on. On an
executor whose daemon is fresh for each build, none of it carries over between deploys. The
shared stages still pay off within one run, and the fix would then be a registry cache
(`--cache-to`/`--cache-from` in the step's `moreOptions`).
