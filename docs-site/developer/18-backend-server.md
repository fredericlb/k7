# The k7 backend server

`apps/k7/backend/src/server.ts` is one Express process (run under `tsx` in dev, as a bundle under Node 24 in the image). It is the studio's hosted backend: it **mints** the session every studio app verifies, stores each account's preferences and AI settings, mounts the rehearsal recorder and the media library (which itself mounts the engine registry, the shares and the file hub that starts each account's file service), and serves the built frontend — the image ships no nginx. Dev port 8789 (`PORT`).

It has **no file routes**. Every file and project operation belongs to the account's file service (`packages/file-service`), which the browser reaches through the hub; see [Frontend and backend boundary](./19-frontend-backend-boundary.md).

## Order of the middleware

The order is load-bearing; `server.ts` mounts, top to bottom:

1. **Refusal to start** (`apps/k7/backend/src/authGuard.ts`): unless `STUDIO_LOCAL_USER=1` (a device's own backend) or `STUDIO_DEV_AUTH=1` (a local dev session), the process exits when `OIDC_ISSUER`/`OIDC_CLIENT_ID` are missing (every visitor would be signed in as the dev stub) or when `SESSION_SECRET` is the public default or shorter than 32 characters.
2. **Security headers** (`apps/k7/backend/src/hardening.ts`): `X-Content-Type-Options: nosniff`, a strict referrer policy; Express's `x-powered-by` is off.
3. **Loopback only** (`apps/k7/backend/src/loopback.ts`) when `STUDIO_LOCAL_USER=1`: the tray's and phone's backend answer their own machine only, by peer address **and** `Host` header (a rebound DNS name reaching 127.0.0.1 is refused).
4. **CORS** (`apps/k7/backend/src/media/cors.ts`, `studioCors(originPolicyFromEnv())`): credentialed calls are answered only for origins under `COOKIE_DOMAIN`, those in `TRUSTED_ORIGINS`, and loopback pages on a user's own machine; a cross-site write from any other origin is refused.
5. Body parsers: the AI route first with its own limit, then one shared JSON parser (`apps/k7/backend/src/bodyLimits.ts`) at 256 kB, with a per-route table (the public comment at 64 kB) and no parsing at all under the file hub's paths, whose bodies stream through to the file services.
6. **OIDC** (`setupAuth` from `@frediverse/oidc`): owns `/auth/*` for the whole origin, cookie `studio.sid`, scopes from `OIDC_SCOPES`, `openid profile email groups` when it is empty. Keep `groups` in a value you set: the library admins are gated on the same cookie's groups.
7. **Handoff** (`apps/k7/backend/src/handoff.ts`): a sign-in made in the system browser carried into a phone app's own view by a one-use, PKCE-bound code (two minutes), and the signed-out local user of a machine's own backend.
8. **Rehearsal** (`mountRehearsal` from `@studio/rehearsal-server`) **before** the library, whose catch-all `/api` guard would otherwise swallow its public pages and its bearer.
9. **Media library** (`mountMedia`, `apps/k7/backend/src/media/mount.ts`) — Media section.
10. **Preferences**: `/api/preferences` behind `requireAuth`.
11. **AI**: `/api/ai/settings` and `/api/ai/organize`.
12. **Aliases**: on a host starting `play.` or `k7.`, every page (not `/api`, `/auth`) is redirected 301 to `/media…` or `/rehearsal…` on k7's root origin.
13. **The SPA**: precompressed static files from the frontend's build output (`dist` under `apps/k7/frontend`) — hashed assets cached for a year as immutable, the shell `no-cache` and only framable by the same origin — then `index.html` for every path except `/api`, `/auth` and `/assets/` (a missing chunk must 404, not return HTML).
14. **`jsonErrorHandler`**, last: a JSON body for every error, never a 5xx's message or stack.

`STUDIO_LISTEN_HOST` binds one interface (the tray and the phone set `127.0.0.1`). Requests may run 30 minutes (large uploads). On `SIGTERM`/`SIGINT` the media mount and rehearsal stop first (the account file services included), then the server drains, within 8 s of Docker's 10.

## Preferences

`packages/user-prefs` is the store: one small JSON file per user, named by a slug and a hash of the OIDC subject, written beside then renamed so a crash never leaves a file that reads as empty. `PREFS_DIR` is `STUDIO_PREFS_DIR` or `~/.studio/prefs/k7`. `preferencesRouter` (`packages/user-prefs/router.ts`) serves `GET` and `PUT /preferences`; a PUT replaces the document wholesale (so a field can be cleared).

The **zod schema in `server.ts` is the gate**, not a description:

```ts
const prefsSchema = z.object({
  engineId: z.string().optional(),
  commands: z.record(z.string(), commandPrefSchema).optional(),
  playbackTarget: z.string().optional(),
});
```

A field the browser sends and the schema does not declare is refused with a 400 naming it (`droppedKeys`), rather than silently stripped. Widening `K7Prefs` in `apps/k7/frontend/src/api.ts` is therefore only half of adding a preference; the other half is this schema. `engineId` is an id and never an address, since an engine's address changes between networks.

These are the **account's** preferences. The machine's own (vim mode, the audio device, channel labels) are the file service's `/preferences`, on the engine's machine.

## AI settings and AI organize

`apps/k7/backend/src/aiSettings.ts` keeps each account's Claude API key and model in a second prefs store (`<PREFS_DIR>/ai`). `GET /api/ai/settings` answers the model, the default model and a **hint** of the key (`sk-ant-…wxyz`), never the key. `PUT` is a patch: an absent field is kept, `null` or `""` clears it. This is why the key is not a field of the preferences document, which the browser reads and writes whole.

`apps/k7/backend/src/aiOrganize.ts` is the module builder's AI organize: it receives a module (its params, panel and screens), asks Claude for a new panel, checks the answer with the builder's own rules (`@studio/panel-rules/ai-organize`, React-free), hands the model its mistakes once (two rounds at most), and streams progress as NDJSON. The system prompt is cached. With no key on the account, the route is off and the builder shows no button.

## Running and checking

`npm run dev` at the repository root starts it with the frontend and the rest; alone, `npm run dev --workspace=k7-backend`. The Vite dev server proxies `/api` and `/auth` to it. `npm run test` and `npm run typecheck` in `apps/k7/backend`.
