# Signing in

Signing in is **optional**. Signed out, the app runs as a local user, offline and with nothing to
configure; signed in, it runs as an st0 account. The button at the right of the title bar
(`apps/st0/frontend/src/tabs/AccountButton.tsx`) shows the account's name and a log-out icon, or a
log-in icon when nobody is signed in.

## The local user

Signed out is not "no user": every screen of st0 sits behind `AuthGate`, and a gate that only an
identity provider can open would make the app useless offline. The backend is started with
`STUDIO_LOCAL_USER=1`, which mounts `/auth/local` (`apps/st0/backend/src/handoff.ts`): it signs in
the local user when there is no session, and keeps one that is already there. The window opens on
it, so a signed-in account survives a restart.

The local user carries the dev stub's identity, `dev@example.com`, so its workspaces are the ones a
run before sign-in existed made. An account's workspaces are its own, under its own email.

## st0's identity provider, as a public client

The app signs in to st0's own provider, `https://login.frediver.se` (Authelia), so an account here
is the account on st0.app. It is a **public** client, `st0-desktop`: an app on the user's machine
cannot keep a secret, so it has none, and PKCE alone proves the callback
(`commons/packages/oidc/index.ts` — no secret is what makes a client public). The provider has to
know that client:

```yaml
# Authelia: identity_providers.oidc.clients
- client_id: st0-desktop
  public: true
  authorization_policy: one_factor
  require_pkce: true
  pkce_challenge_method: S256
  redirect_uris:
    - http://127.0.0.1:18789/auth/callback
  scopes: [openid, profile, email, groups]
  token_endpoint_auth_method: none
```

The `redirect_uri` is the app's own backend, derived from the request like every other
deployment's, which is why the port is fixed (`docs/standalone.md`). `ST0_OIDC_ISSUER` and
`ST0_OIDC_CLIENT_ID` override both; an empty issuer leaves only the local user and the dev stub.

## In the system browser, never in a tab

A tab has no address bar, so a page in one cannot be told apart from the provider's — and a
password typed there is typed into the app. RFC 8252 §8.12 is that rule, and providers enforce it.
So `/auth/login` never loads in a tab (`src/routing.ts`): the strip's button and st0's own Sign in
both start `src/signIn.ts`, which opens the system browser on the backend's handoff
(`apps/st0/backend/docs/handoff.md`). The browser signs in at `127.0.0.1:18789`, the backend sends a
one-use code to a loopback port this process listens on, and the home tab trades it for the
session with a verifier the browser never saw. The handoff asks the browser to forget its own
session: the account is the app's.

## Changing account closes the project tabs

What a project tab holds — its workspace, its engine lease — belongs to the account that opened
it. Signing in or out closes every project tab and reloads home (`TabSet.reset`).

## Signing out

Sign out is the origin's own `POST /auth/logout`, wherever it is pressed: the strip's button or
st0's user menu. The main process does not hear about either; it watches the session **cookie**
(`watchSignOut` in `src/main.ts`), and the cookie going — logged out, or expired — sends the window
back to the local user. One signal for every way out, and none of them needs to know the desktop
exists.
