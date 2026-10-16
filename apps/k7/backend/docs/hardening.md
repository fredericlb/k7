# What the backend refuses, and what every answer carries

## It refuses to start on a dev-user stub or a guessable secret

`@frediverse/oidc`'s `setupAuth` runs a **stub** when `OIDC_ISSUER` or `OIDC_CLIENT_ID` is missing:
`/auth/login` signs whoever asks in as one shared "Dev User". It also signs the session cookie with
a public literal when `SESSION_SECRET` is unset. Both are right for a laptop and fatal on a server,
and neither makes any noise: the site works, for everyone, as the same person.

So `src/server.ts` asks `src/authGuard.ts` before `setupAuth` runs, and exits with a `FATAL:` line
per reason when:

- `OIDC_ISSUER` or `OIDC_CLIENT_ID` is empty;
- `SESSION_SECRET` is empty, the public default, or shorter than **32 characters**.

Two flags lift both rules, and nothing else does:

| flag | who sets it | why it is safe there |
|---|---|---|
| `STUDIO_LOCAL_USER=1` | the desktop app and the phone, through `../standalone.json` | the backend answers its own machine only (`standalone.md`), and both generate a 64-hex-character secret anyway |
| `STUDIO_DEV_AUTH=1` | a developer, in `env.yaml`'s `k7-backend` section | a dev machine with no OIDC client registered; the dev session documented in `../../../../docs/dev.md` has a real one and does not set it |

The check lives here rather than in `commons/packages/oidc` because the stub is a feature there,
shared with phare; it is k7, the one backend that MINTS the session, that must never run it hosted.
The compose file asks for `OIDC_ISSUER` and `OIDC_CLIENT_ID` with `:?` as well, so a deployment
missing them fails at `docker compose up` before any container starts.

## Every answer carries two headers; the shell carries two more

`src/hardening.ts`, mounted first:

| header | on | why |
|---|---|---|
| `X-Content-Type-Options: nosniff` | every response | a media file or an upload is never reinterpreted as a script or a page |
| `Referrer-Policy: strict-origin-when-cross-origin` | every response, overwritable by a route | a share link or a project path in the address never leaves the origin in full |
| `Content-Security-Policy: frame-ancestors 'self'` | the SPA shell (`index.html`, wherever it is served) | no other site frames the editor to click through it; the rehearsal recorder's iframe on the bench is same-origin and stays allowed |
| `X-Frame-Options: SAMEORIGIN` | the SPA shell | the same, for a browser that ignores `frame-ancestors` |

There is **no `script-src`** policy. A panel's script and an engine's WebSocket address (any machine
the tunnel or a LAN reaches) are not known when the page is served, and a policy that has to list
them is a policy that breaks the app the first time one is missing. Framing is the attack a header
alone stops, so framing is what is set.

z0, at `/z0` on the same hostname, is its own container behind Traefik: none of this reaches it.

## A body is parsed small, before any guard

The shared JSON parser (`src/bodyLimits.ts`) runs ahead of `setupAuth` and every route's guard, so
its limit is what a stranger can make the one process parse — and a parse is synchronous work every
other request waits behind. It is **256 kB**. A route with other needs is named in its table and
gets its own limit there: the public comment form **64 kB** (a parser after the shared one would
never run, since a body is parsed only once), a songbook entry **2 MB**, for its free-text tablature
and lyrics. The AI organize route parses ahead of it at 2 MB, a big plugin's parameters being that
large.

The file hub's paths (`/api/files`, `/api/files-hub/internal`) are **not parsed at all**. The hub
pipes their bodies to an account's file service, which holds the 8 MB limit
(`packages/engine-registry/docs/shared.md`), and the few routes the hub answers itself read their
body after their own check (`packages/file-hub/docs/fileHub.md`).

## Errors answer JSON, and a 5xx says nothing

The last middleware, `jsonErrorHandler`, logs every error with its route and answers
`{ "error": … }`. A 4xx keeps its message — a 413 that says the body is too large is something the
caller can act on — unless the error is marked `expose: false`, as a missing static file is, whose
message is a server path; that one answers its status's name. A 5xx answers `"internal error"` and nothing more: its message is a file path,
a SQL fragment or a peer's address as often as not. A caller hanging up mid-upload is logged as a
warning, since three routes read a 512 MB body and that makes it an everyday event.

The image sets `NODE_ENV=production`, without which Express's own fallback handler prints the stack
into the page and the rehearsal server's check against the dev secret
(`packages/rehearsal-server/src/env.ts`) is skipped.
