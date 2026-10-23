# Where the media library reads its configuration

## `STUDIO_FILES_ROOT` is required, `STUDIO_MEDIATEK` is not

**`STUDIO_FILES_ROOT`** — where the accounts' workspaces live — has no default, and the process
exits at boot without it (`requireFilesRoot`, `apps/k7/backend/src/media/fileHub.ts`): this is the
only place a workspace lives, and a backend without it would serve an origin where no project can
open (`packages/file-hub/docs/fileHub.md`).

**`STUDIO_MEDIATEK`** — the library root — is optional, like everywhere else: absence means
`~/.k7/mediatek` (`mediatekRoot()` in `packages/song/src/mediatekRoot.ts`). Refusing to start
without it would only guard a misconfigured production deployment, and the Dockerfile sets
`ENV STUDIO_MEDIATEK=/library` there; in dev the fallback is already the right answer.
`ensureLayout()`'s try/catch at startup (`mount.ts`'s `serve`) surfaces a library that is genuinely
unavailable without ending the process.

## The loader writes into `process.env`

`apps/k7/backend/src/server.ts` loads its section of the root `env.yaml` — `k7-backend`, which
holds the library's keys beside the session's — with `loadServiceEnv` and assigns the result into
`process.env` rather than keeping it in a constant.

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

## What else changes behaviour

- `MUSICBRAINZ_USER_AGENT` — how "Find songs" names itself to MusicBrainz ([hunt.md](hunt.md)).
  slskd itself is configured on the server page, `/settings/server`, not here ([settings.md](settings.md)).
- `SESSION_SECRET` — besides the session, the key the settings' secrets are sealed under, and the
  seed of the API token secret when `API_TOKEN_SECRET` is not set ([gate.md](gate.md)).
- `FFMPEG_BIN`, `YTDLP_BIN` — the two tools, when they are not on the `PATH`.
- `STUDIO_PROJECTS_DIR`, `STUDIO_HUNTS_DIR`, `STUDIO_SETTINGS_DIR`, `STUDIO_SHARES_DIR` — move
  four dot directories off the volume. For tests; no deployment sets them.
- `STUDIO_ENGINES_DIR` — the engine registry's state, `.engines` on the volume by default: an
  engine's id stays bound to its tunnel secret across a redeploy only while this outlives the
  container (`packages/engine-registry/docs/token.md`).
- `STUDIO_PREFS_DIR` — the one preferences document per person (`engineId`, `commands`,
  `playbackTarget`), which is k7's and not the volume's: `~/.studio/prefs/k7` by default,
  `/data/prefs` in the image.
- `STUDIO_FILES_WATCH=1` — set by `npm run dev` only: the account file services it starts restart
  on a source change, which this process's own watch cannot see.

That one is set by `apps/k7/backend/scripts/with-env.mjs`, which `dev` goes through: npm hands a
script to `cmd.exe` on Windows, and a leading `VAR=1` is shell syntax it reads as the command name.

## One side effect

`loadServiceEnv` merges `common` with the service's section, by design. Real `OIDC_*` values in
`common` therefore swing this whole backend in dev — the session it mints and the rehearsal
routes it hosts — from the "Dev User" stub to a real identity provider. Keeping the stub means keeping those keys out of `common`.
