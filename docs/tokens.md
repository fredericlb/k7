# Tokens

`npm run tokens` gives k7's backend its own `API_TOKEN_SECRET` in `env.yaml`, and does nothing
else. It is idempotent — a secret already there is left alone — so it is safe on every checkout.

```
npm run tokens              # generate k7-backend.API_TOKEN_SECRET if it is missing
npm run tokens -- --dry-run # say what it would do
```

## Why no service token is minted

A token is a signed `{jti, sub, iat, exp}` (`commons/packages/oidc/apiToken.ts`). Every service that calls the media library with one is mounted in k7's
backend itself, so the backend mints the token and hands it over in code, as an EPHEMERAL token
held in its memory only and never written to a store (`apps/k7/backend/docs/sessions.md`):

| caller | `sub` | minted by |
|---|---|---|
| the rehearsal recorder (`@studio/rehearsal-server`) | `service:k7` | `apps/k7/backend/src/server.ts`, from the library's own scheme (`mediaTokens()` in `apps/k7/backend/src/media/mount.ts`) |
| an account's file service | the account | the file hub, when it starts that service (`packages/file-service/docs/mediatekLink.md`) |

Nothing reaches the library over a loopback address typed into a config file, and nothing has to
be pasted into `env.yaml`. A musician's machine syncing the hosted library gets its token over the
wire, from `POST /api/token` on k7's origin.

## Why the secret is still generated

Left unset, the library signs with `${SESSION_SECRET}:pl8`. That works, and is what nobody should rely on: rotating the session
secret would then log everyone out *and* revoke every machine's sync in one move. Restart k7's
backend after the secret is written; every token signed with the previous one is void.

## Two secrets, on purpose

The rehearsal recorder's personal tokens — the ones users saved in their settings to publish from
k7 — are signed with **`K7_API_TOKEN_SECRET`**, not with `API_TOKEN_SECRET`. Unset, it falls back
to `${SESSION_SECRET}:api-token`. This script never touches it: generating one would void every
token already saved. The two schemes also answer on different routes — `/api/token/publish` is the
recorder's, the rest of `/api/token` the library's.

## Rotation and revocation

A token is valid only while its id is listed in its scheme's store, so its owner revokes one alone,
and it expires after 90 days (`apps/k7/backend/docs/sessions.md`). Rotating a secret still kills
every token signed with it at once, which is why each secret belongs to the one scheme that
verifies it. A token of the `{sub, iat}` format, with no id, is refused.

## The URLs are not configuration

`packages/web-protocol/services.ts` holds the one table, every address derived from k7's origin
— `https://app.k7.rocks` in production (`packages/web-protocol/docs/addresses.md`). `play.st0.app`
and `k7.st0.app` are former hosts read as that origin: they answer `/api/*` (and `/rtc` for the
recorder's phone microphone) and send every page to `/media` or `/rehearsal` at k7's origin. **`/auth/*` belongs to
k7**, since the registered `redirect_uri` is on its origin.
