# Sessions and tokens: where k7 keeps what makes them revocable

The rules — stamps, lifetimes, revocation epochs, token ids — are `@frediverse/oidc`'s
(`commons/packages/oidc/docs/session.md`, `commons/packages/oidc/docs/apiTokens.md`). This page is
what k7 chooses on top.

## One folder, on the media volume

`src/authState.ts` puts that state under `$STUDIO_AUTH_DIR`, else `.auth/` on the media volume
(`mediatekDir()`): it survives a redeploy like the library does, and a dot-folder is one no library
scan lists.

| file | holds |
|---|---|
| `session-revocations.json` | each account's "not before" epoch, written by `POST /auth/logout?everywhere=1` |
| `library-tokens.json` | the media library's tokens (`src/media/tokenRoutes.ts`) |

The rehearsal recorder's publish tokens are listed in its own data dir, `api-tokens.json` under
`K7_DATA_DIR` (`packages/rehearsal-server/docs/audio.md`), since they are signed with its own secret.

## Lifetimes

k7 takes the package's defaults: a session lives 7 days, and 12 hours when it carries groups — the
bound on how long an admin removed at the IdP keeps admin rights here. A token lives 90 days.

## What a deploy of these rules does

Every session minted before the stamps existed is refused, so everyone signs in once. Every token in
the old `{sub, iat}` format is refused: a CLI or an app holding one mints a new one (k7's settings
for a publish token, the pairing for an app).

## Tokens handed over in code

The token k7 hands the rehearsal recorder (`service:k7`) and the one each account's file service is
started with are **ephemeral**: held in this process's memory, never listed, and dead when it
stops — which is also when those holders stop.

## The provider's token, on a machine only

Under `STUDIO_LOCAL_USER` (the tray, the phones) the backend keeps each sign-in's provider access
token, and its refresh token when the provider hands one (`keepAccessToken`, `keepRefreshToken`):
it is what pairs the machine with its server with no browser
(`packages/file-hub/docs/syncRelay.md`, "Pairing without the browser"). In memory only, so a restart
loses it and the next pairing takes the browser. A hosted server keeps none: nothing there needs to
speak for the person at the provider.

## The token routes

| route | does |
|---|---|
| `POST /api/token` | mint a library token, `{label}` in the body |
| `GET /api/token` | the owner's library tokens, without the tokens themselves |
| `DELETE /api/token/:id` | revoke one of them |
| `GET /api/token/pair?return&state` | mint one for a native app, sent to its loopback port only |
| `POST`/`GET /api/token/publish`, `DELETE /api/token/publish/:id` | the same for the recorder's publish tokens |

All of them take the session only. A POST or DELETE from a site outside the origin allowlist is
refused before it reaches them (`docs/media/cors.md`). The pairing route is the one GET that mints:
its only exit is a loopback address, which `isLoopbackReturn` enforces.
