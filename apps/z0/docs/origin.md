# One origin, seven services, two session cookies — one of them borrowed

z0 lives under `/z0` on the same host as every other studio service, and that
single fact drives most of its wiring. This page collects the consequences, because each one
on its own reads like an arbitrary choice.

## Why the prefix is stripped for the API and not for the SPAs

The repo-root `proxy config` handles z0 in three blocks, and the order matters because
`handle` blocks are mutually exclusive and matched top to bottom.

- `/z0/api/*` — prefix **stripped**. The backend keeps seeing `/api/...` exactly as it
  would at a root, which is what the production edge does too.
- `/z0/auth/*`, `/z0/audio/*`, `/z0/ws*` — stripped. Nothing else: this block used to add
  `X-Forwarded-Prefix: /z0`, and that header is gone. See below.
- the seven SPAs — **not** stripped. Each vite `base` is the full public path, so the dev
  server must see the prefix; strip it and every asset request 404s against a server that is
  only listening under `/z0/<app>/`.

## Why z0 no longer sets `X-Forwarded-Prefix`

`redirectUriFor` builds `<origin><X-Forwarded-Prefix>/auth/callback`. z0 set the header so
its callback would be `/z0/auth/callback` rather than the origin root's, which belongs to
pl8 — the service with no prefix, the one that mints `studio.sid`.

It could not work, and the reason is not z0's: **the IdP has only the prefixless callback
registered on this client.** Asking for the prefixed one is refused at the authorization
endpoint, before any password is typed, so no account could sign into z0 at all. A service
mounted under a path cannot own an OIDC flow here. The header had one purpose and that
purpose was unreachable, so it is gone; the account login is pl8's. Full account in
[auth.md](auth.md).

## Why a second cookie still exists

`bt_session` **beside** `studio.sid` — one written here, one only read here.

The studio session models **an account**: an OIDC identity, resolved to a folder slug, that
owns workspaces and preferences. A blind-test player is a **guest** — they have a name they
typed, a seat in a session, and no account anywhere. Modelling that as a studio session would
mean either inventing accounts for strangers or teaching the shared session a guest kind that
only one app would use. So the guest cookie stays, and stays z0's.

What has changed is the other half. An operator who is a studio user no longer holds two
sessions: they hold the one studio session, the same one st0 and the médiathèque see, and
signing out of z0 signs them out of those too. Both cookies use **one** key, `common`'s —
z0's own `SESSION_SECRET` override had to go, and that is the whole configuration change.
What keeps a guest cookie from being renamed into an account is not a second key but the
signature itself, which covers the cookie's name; [auth.md](auth.md) shows it.

## The seam that surfaces a rename last

`backend/src/render.ts` sends `x-studio-engine-token` and friends to a file service. It is the
only consumer of those headers outside `packages/`, so a header rename that is otherwise
complete will still break here — and only when somebody renders, which is rare enough that
the failure arrives long after the change. Check it explicitly when touching the header names.
