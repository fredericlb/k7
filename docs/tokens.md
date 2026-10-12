# Tokens

`npm run tokens` gives st0's backend its own `API_TOKEN_SECRET` in `env.yaml`, and does nothing
else. It is idempotent — a secret already there is left alone — so it is safe on every checkout.

```
npm run tokens              # generate st0-backend.API_TOKEN_SECRET if it is missing
npm run tokens -- --dry-run # say what it would do
```

## Why no service token is minted

A token is a **self-contained** `{sub, iat}` signed with HMAC-SHA256
(`commons/packages/oidc/apiToken.ts`): whoever holds the signing secret can mint one, with no
server-side record. Every service that calls the media library with one is mounted in st0's
backend itself, so the backend mints the token at boot and hands it over in code:

| caller | `sub` | minted by |
|---|---|---|
| the rehearsal recorder (`@studio/rehearsal-server`) | `service:k7` | `apps/st0/backend/src/server.ts`, from the library's own scheme (`mediaTokens()` in `apps/st0/backend/src/media/mount.ts`) |
| an account's file service | the account | the file hub, when it starts that service (`packages/file-service/docs/mediatekLink.md`) |

Nothing reaches the library over a loopback address typed into a config file, and nothing has to
be pasted into `env.yaml`. A musician's machine syncing the hosted library gets its token over the
wire, from `POST /api/token` on st0's origin.

## Why the secret is still generated

Left unset, the library signs with `${SESSION_SECRET}:pl8` — the suffix kept so every token
already issued still verifies. That works, and is what nobody should rely on: rotating the session
secret would then log everyone out *and* revoke every machine's sync in one move. Restart st0's
backend after the secret is written; every token signed with the previous one is void.

## Two secrets, on purpose

The rehearsal recorder's personal tokens — the ones users saved in their settings to publish from
st0 — are signed with **`K7_API_TOKEN_SECRET`**, not with `API_TOKEN_SECRET`. Unset, it falls back
to `${SESSION_SECRET}:api-token`, the secret those tokens were issued under. This script never
touches it: generating one would void every token already saved. The two schemes also answer on
different routes — `GET /api/token` is the recorder's, `POST /api/token` and
`GET /api/token/pair` are the library's.

## Rotation and revocation

There is no per-token revocation, by construction. Rotate a secret and every token signed with it
dies at once. That is the trade the scheme makes, and it is why each secret belongs to the one
scheme that verifies it.

## The URLs are not configuration

`packages/web-protocol/services.ts` holds the one table, every address derived from st0's origin
— `https://st0.app` in production (`packages/web-protocol/docs/addresses.md`). `play.st0.app` and
`k7.st0.app` are aliases of that origin: they answer `/api/*` (and `/rtc` for the recorder's phone
microphone) and send every page to `/media` or `/rehearsal` at the root. **`/auth/*` belongs to
st0**, since the registered `redirect_uri` is on its origin.
