# Signing in

Signing in is **optional**. Signed out, the app runs as a local user, offline and with nothing to
configure; signed in, it runs as an k7 account. The control is at the top of the home page
(`apps/k7/frontend/src/projects/AccountBar.tsx`, around `src/tabs/AccountButton.tsx`): the account's
name and a log-out icon, or a log-in icon when nobody is signed in. On the home page and not in the
title bar, because an account is chosen where its workspaces are listed, and the title bar is the
tabs'. The main process takes a sign-in from the strip or the home tab, and from no other page.

## The local user

Signed out is not "no user": every screen of k7 sits behind `AuthGate`, and a gate that only an
identity provider can open would make the app useless offline. The backend is started with
`STUDIO_LOCAL_USER=1`, which mounts `/auth/local` (`apps/k7/backend/src/handoff.ts`): it signs in
the local user when there is no session, and keeps one that is already there. The window opens on
it, so a signed-in account survives a restart.

The local user carries the dev stub's identity, `dev@example.com`, so its workspaces are the ones a
run before sign-in existed made. An account's workspaces are its own, under its own email.

## k7's identity provider, as a public client

The app signs in to k7's own provider, `https://login.frediver.se` (Authelia), so an account here
is the account on app.k7.rocks. It is a **public** client, `st0-desktop`: an app on the user's machine
cannot keep a secret, so it has none, and PKCE alone proves the callback
(`commons/packages/oidc/index.ts` — no secret is what makes a client public). The provider has to
know that client, by that id: it is a name the provider holds, like the hostnames, so it keeps its
`st0` spelling whatever the app is called — a client id the provider does not list fails every
sign-in with "Client authentication failed".

```yaml
# Authelia: identity_providers.oidc.clients
- client_id: st0-desktop
  public: true
  authorization_policy: one_factor
  require_pkce: true
  pkce_challenge_method: S256
  # the client asks for http://127.0.0.1:<port>/auth/callback, <port> anywhere in 22000-23000
  redirect_uris:
    - http://127.0.0.1:22000/auth/callback
    # … one per port, to http://127.0.0.1:23000/auth/callback, on a provider that matches exactly
  scopes: [openid, profile, email, groups]
  token_endpoint_auth_method: none
```

The `redirect_uri` is the app's own backend, derived from the request like every other
deployment's, so its port is the one the app picked at boot in its range (`docs/standalone.md`,
"Addresses") — the same from launch to launch unless that port was taken meanwhile. The provider
must therefore accept the desktop's loopback callback on ANY port of the range, as RFC 8252 §7.3
asks of an authorization server for a native app's loopback redirect; a provider that matches
redirect URIs exactly needs every URI of the range registered, from
`http://127.0.0.1:22000/auth/callback` to `http://127.0.0.1:23000/auth/callback`. `K7_OIDC_ISSUER` and
`K7_OIDC_CLIENT_ID` override both; an empty issuer leaves only the local user and the dev stub.

## In the system browser, never in a tab

A tab has no address bar, so a page in one cannot be told apart from the provider's — and a
password typed there is typed into the app. RFC 8252 §8.12 is that rule, and providers enforce it.
So `/auth/login` never loads in a tab (`src/routing.ts`): the strip's button and k7's own Sign in
both start `src/signIn.ts`, which opens the system browser on the backend's handoff
(`apps/k7/backend/docs/handoff.md`). The browser signs in at the app's `127.0.0.1:<port>`, the backend sends a
one-use code to a loopback port this process listens on, and the home tab trades it for the
session with a verifier the browser never saw. The handoff asks the browser to forget its own
session: the account is the app's.

## Changing account closes the project tabs

What a project tab holds — its workspace, its engine lease — belongs to the account that opened
it. Signing in or out closes every project tab and reloads home (`TabSet.reset`).

## Signing out

Sign out is the origin's own `POST /auth/logout`, wherever it is pressed: the strip's button or
k7's user menu. The main process does not hear about either; it watches the session **cookie**
(`watchSignOut` in `src/main.ts`), and the cookie going — logged out, or expired — sends the window
back to the local user. One signal for every way out, and none of them needs to know the desktop
exists.
