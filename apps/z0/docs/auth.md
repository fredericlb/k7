# Who may come in, and through which door

z0 holds **its own** login for one half only: a blind-test player is a guest with no account, a
species the studio session does not model, and `bt_session` is z0's. An account's login belongs
to st0.

## A service under a path cannot hold its own flow

`redirectUriFor` builds `<origin><X-Forwarded-Prefix>/auth/callback`. The OAuth client has one
registered redirect_uri, the one with no prefix, so a z0 setting `X-Forwarded-Prefix: /z0` is
refused by the IdP before anything is displayed:

```
error_hint=The 'redirect_uri' parameter does not match any of the
           OAuth 2.0 Client's pre-registered 'redirect_uris'
```

Every account login would die there — the editor, and the presenter, monitor and remote, which
share the button. The rule is structural: only the service with no prefix can hold the flow, and
that is st0. It is why z0 mounts no auth routes, and sets no
`X-Forwarded-Prefix`.

## Two cookies, one of them ours

| cookie | signed by | what it carries |
|---|---|---|
| `bt_session` | z0, `SESSION_SECRET` | the guests: `guest` (a session's password, on the buzzer) and `guest_online` |
| `studio.sid` | st0, with the same key | the studio account, shared with st0 |

`currentUser()` is the single point of passage, and it reads the account first, the guest
second. **The order is load-bearing**: `/auth/logout` can only expire z0's cookie, so a guest
cookie masking an account would be impossible to sign out of from here. The WebSocket upgrade
repeats the read by hand (`ws.ts`), an `upgrade` being a raw http event cookie-session never
runs on.

## One secret, `common`'s

z0 declares no `SESSION_SECRET` of its own. A key that is not `common`'s produces no error: the
cookie simply never verifies.

A guest cannot rename their cookie to `studio.sid` and become an account. cookie-session signs
`<name>=<value>`, so the name is inside the signature and resigning would need the key; the name
is domain separation. Pinned by `backend/src/auth/session.test.ts`.

**A mismatched key fails in a circle**, which is why the SPA is what reports it: `/auth/me`
answers 401, the gate appears, the button goes to st0, which already knows you and sends you
back, and the gate returns identical. The backend cannot tell that from a visitor with no cookie
— `sessionFromCookieHeader` answers `null` for both — so the SPA remembers having asked, through
a `sessionStorage` token set by `login()`, and shows the reason instead of the button again. The
buzzer is spared: its door is a guest form.

## `groups` must be in the scopes

z0's authorisation reads `groups` (`AUTH_ADMIN_GROUPS`). The shared package defaults to
`openid profile email`, which gives every session an empty `groups` and answers 403 from the
editor, presenter, monitor and remote with nothing to explain it.
`apps/st0/backend/src/server.ts` passes `scopes` from `OIDC_SCOPES`, which carries `groups` in
`common`.

## Signing out closes what the principal holds

A guest → `POST /z0/api/auth/logout`. An account → that **plus** `POST /auth/logout` at the
root, since z0 does not sign `studio.sid` and cannot expire it. The rule lives in
`shared/src/account.ts` rather than in six copies.

## To check in a browser

- `/z0/editor` → "Sign in" → the IdP, then back **to the editor**;
- the badge shows the account and the editor opens instead of 403 — the `groups` check;
- the buzzer with a session's password: still a guest;
- sign out from the presenter, then open the media library → signed out there too, intended.
