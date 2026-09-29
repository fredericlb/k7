# Gate.tsx — extended notes

## One gate: sign in, then the library

st0 stacks `AuthGate → EngineGate → ProjectGate`. pl8 needs the first and none of the others:

- **Auth**, because every route but the public share is behind a session or a bearer.
- **No engine.** The catalogue is served by this app's own backend, over its own volume; nothing
  about browsing it depends on a machine that makes sound. Playing a song on an engine picks one
  where it is asked for, in the playback picker (`playbackTarget.md`).
- **No workspace and no project.** The library belongs to the account, not to a repository, and a
  project is st0's to open (`packages/project-shell/docs/launch.md`).

So the gate asks `/auth/me` and either draws the library or the sign-in card.

## Whose login it goes through

**st0's backend** owns `/auth/*` for the whole origin, because st0 is what the origin root serves
and `redirectUriFor` builds `<origin>/auth/callback` with no prefix — a prefixless redirect_uri
belongs to the service that has no prefix. This backend passes `mountRoutes: []`, like k7 and z0.

This component is unaffected by that: it calls `/auth/me` and `/auth/login` and does not care who
answers. The consequence to know is the one st0's AGENTS.md states from the other side —
**signing out here signs you out of every studio service**, and st0 being down takes every
service's login with it, not just its own.

What makes the check pass is agreement, not routing: the same cookie name and the same
`SESSION_SECRET` out of `env.yaml`'s `common`. And no `scopes` here — asking the IdP for anything is
the job of whoever runs the flow.

## The bearer token, beside the session

`bearerOrSession` guards the library, the shares, the stems and the host's player, because their
other callers have **no cookie jar**: k7's backend filing a take, and each account's file service,
which this process starts and hands a token so it can reach the médiathèque over loopback
(`packages/file-hub/docs/fileHub.md`). A token is a signed `{sub, iat}` with no server-side storage,
and rotating the secret revokes every one at once.

`POST /api/token` mints one and is **session only**, deliberately: a token must not be able to mint
another. Two routes refuse the bearer for reasons of their own — the hunt, which spends an account's
reputation ([hunt.md](hunt.md)), and the settings, which hold the slskd key and have no headless
caller.

## No StrictMode

`main.tsx` renders without it, matching st0. Nothing in this app opens a socket on mount, so
turning it on is a free choice rather than a hazard — worth doing with a pass that looks for the
double-mount bugs it would surface.
