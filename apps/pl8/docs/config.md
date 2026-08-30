# Where the media library reads its configuration

## `STUDIO_MEDIATEK` is required, with no default

The backend refuses to start without it. `@studio/mediatek` would otherwise fall back to
`<state>/mediatek`, which in a container is an empty directory nobody mounted: the service would
come up healthy and serve an empty library. That is the worst failure available here, so it is
the one the guard exists for.

## The loader writes into `process.env`

`server.ts` loads its section of the root `env.yaml` with `loadServiceEnv` and assigns the
result into `process.env` rather than keeping it in a constant.

The path is not passed from hand to hand: every consumer resolves it itself by reading the
environment, starting with `mediatekRoot()` (`packages/song/src/mediatekRoot.ts`), which
`@studio/mediatek`, `@studio/song` and the file service all lean on. A loader that merely
returned the value — `defineEnv`, which validates and answers an object without touching
`process.env` — would leave every one of those on the `<state>/mediatek` fallback while the
backend saw its own value and passed its own guard. The result is a service that starts,
declares itself healthy, and serves the wrong directory.

Import order does not matter, and must not be made to: nothing in the import graph reads
`STUDIO_MEDIATEK` at import time, `mediatekRoot()` being a function called at run time. A
formatter reordering imports would otherwise break this silently.

## Precedence

The yaml wins wherever it declares a key (`@frediverse/env`): explicit, per-service dev
configuration, so an ambient variable cannot annex a backend in passing. In production there is
no `env.yaml` — the images exclude it — and the Dockerfile sets `ENV STUDIO_MEDIATEK=/library`.

## What is optional, and the line

`STUDIO_MEDIATEK` is the only variable whose absence stops the service.

- `SLSKD_*`, `MUSICBRAINZ_USER_AGENT` — "Find songs". Without them the screen opens and names
  what is missing ([hunt.md](hunt.md)).
- `STUDIO_PREFS_DIR`, `STUDIO_PROJECTS_DIR`, `STUDIO_HUNTS_DIR` — move three dot directories off
  the volume. For tests; no deployment sets them.

The line is the same everywhere: what would produce a **lie** in its absence — an empty library
that looks full — stops the start; what produces a visibly disabled feature does not.

## One side effect

`loadServiceEnv` merges `common` with the service's section, by design. Real `OIDC_*` values in
`common` therefore swing the media library in dev from the "Dev User" stub to a real identity
provider, as they do for `k7-backend` and `z0-backend`. Keeping the stub means keeping those
keys out of `common`.
