# The sign-in handoff

An app signs in through the **system browser** — an identity provider refuses an embedded view,
and RFC 8252 §8.12 is why. The browser then holds the session, and the app's own views need it.
`src/handoff.ts` carries it across. Two apps use it: the desktop (`apps/st0-standalone/docs/signIn.md`)
and the phone (`engine/st0-engine/docs/android.md`).

| route | opened in | does |
|---|---|---|
| `GET /auth/handoff/issue?redirect&challenge&state[&forget=1]` | the system browser | signs in if needed, then sends a one-use code to `redirect` |
| `GET /auth/handoff/redeem?code&verifier&return_to` | the app's own view | turns the code into a session there |
| `GET /auth/local?return_to` | the desktop's window | the signed-out local user — mounted only with `STUDIO_LOCAL_USER=1` |

## The code is useless alone

It is the PKCE shape, applied to the session rather than to the provider. The app keeps a
verifier and sends only its hash; the code is bound to that hash, and redeeming it takes the
verifier. A code read off a redirect, a log or a browser history opens nothing. It is also
**signed, not stored** — the session's own secret with a suffix of its own, so a code can never
pass for a session cookie or an API token — and dead after two minutes, long enough for a phone to
switch apps.

## Where a code may be sent

`isHandoffReturn` (`packages/web-protocol/handoff.ts`) is the security of `issue`: anything looser
lets a link mint a session into an address of the sender's choosing. Loopback http, which is the
desktop listening on its own machine, or `se.frediver.st0:`, the phone app's scheme. Nothing else.

## Issue signs in first

A browser with no session, or with only the local user, is sent through `/auth/login` with `issue`
itself as the return target, so the app opens ONE address whatever the browser holds. `forget=1`
drops the browser's session once the code is out: the desktop asks for it, since the session is
the app's now. The phone does not, and the browser stays signed in to the studio.

## The local user

`/auth/local` keeps any session it finds and otherwise signs in a user with no groups, which can
never be an admin. It is the desktop's signed-out state, and a hosted deployment does not mount it.
