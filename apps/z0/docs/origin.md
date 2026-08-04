# One origin, seven services, two session cookies

z0 lives under `/z0` on the same host as every other studio service, and that
single fact drives most of its wiring. This page collects the consequences, because each one
on its own reads like an arbitrary choice.

## Why the prefix is stripped for the API and not for the SPAs

The repo-root `Caddyfile` handles z0 in three blocks, and the order matters because
`handle` blocks are mutually exclusive and matched top to bottom.

- `/z0/api/*` — prefix **stripped**. The backend keeps seeing `/api/...` exactly as it
  would at a root, which is what the production edge does too.
- `/z0/auth/*`, `/z0/audio/*`, `/z0/ws*` — stripped, **plus**
  `X-Forwarded-Prefix: /z0`.
- the six SPAs — **not** stripped. Each vite `base` is the full public path, so the dev server
  must see the prefix; strip it and every asset request 404s against a server that is only
  listening under `/z0/<app>/`.

## Why z0 sets `X-Forwarded-Prefix` and nobody else does

`redirectUriFor` builds `<origin>/auth/callback` with no prefix. That is correct for l8,
which owns `/auth/*` at the origin root and mints the shared `studio.sid` for the médiathèque
and m9 to verify.

z0 cannot join that flow, so it needs its callback to be `/z0/auth/callback`, and
the header is how the backend learns it is mounted under a prefix at all. Without it z0
would register a `redirect_uri` that collides with l8'.

## Why a second cookie exists at all

`bt_session`, not `studio.sid`.

The studio session models **an account**: an OIDC identity, resolved to a folder slug, that
owns workspaces and preferences. A blind-test player is a **guest** — they have a name they
typed, a seat in a session, and no account anywhere. Modelling that as a studio session would
mean either inventing accounts for strangers or teaching the shared session a guest kind that
only one app would use.

The cost is real and worth stating plainly: signing into z0 does not sign you into
l8, and signing out of l8 does not sign you out of z0. That is intended. An
operator who is also a studio user holds two sessions.

## The seam that surfaces a rename last

`backend/src/render.ts` sends `x-studio-engine-token` and friends to a file service. It is the
only consumer of those headers outside `packages/`, so a header rename that is otherwise
complete will still break here — and only when somebody renders, which is rare enough that
the failure arrives long after the change. Check it explicitly when touching the header names.
