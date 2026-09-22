# Where the media library reads its configuration

## `STUDIO_MEDIATEK` is optional, same as everywhere else

The backend used to refuse to start without it, guarding against `<state>/mediatek` silently
resolving to an empty, unmounted directory in a container. That guard only ever protected a
misconfigured PRODUCTION deployment — the Dockerfile always sets `ENV STUDIO_MEDIATEK=/library`
explicitly there — while in local dev it just added friction: the fallback (`~/.st0/mediatek`,
`mediatekRoot()` in `packages/song/src/mediatekRoot.ts`) is already the right answer. Dropped in
favour of matching every other backend: absence just means the default, and `ensureLayout()`'s
own try/catch at startup (server.ts) still surfaces a library that's genuinely unavailable
without hard-exiting the process.

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

## What is optional

Nothing stops the service from starting anymore — every variable here just changes behavior:

- `STUDIO_MEDIATEK` — the library root; absence means `~/.st0/mediatek` (or `$STUDIO_HOME`'s
  equivalent), same default every other backend gets.
- `SLSKD_*`, `MUSICBRAINZ_USER_AGENT` — "Find songs". Without them the screen opens and names
  what is missing ([hunt.md](hunt.md)).
- `STUDIO_PREFS_DIR`, `STUDIO_PROJECTS_DIR`, `STUDIO_HUNTS_DIR` — move three dot directories off
  the volume. For tests; no deployment sets them.

## One side effect

`loadServiceEnv` merges `common` with the service's section, by design. Real `OIDC_*` values in
`common` therefore swing the media library in dev from the "Dev User" stub to a real identity
provider, as they do for `k7-backend` and `z0-backend`. Keeping the stub means keeping those
keys out of `common`.
