# Connecting a machine to a server

The desktop app is **not an OIDC client**, deliberately.

## Why not

`commons/packages/http/origin.ts` derives `redirect_uri` per request from the origin the
request arrived on. That leaves two ways to lose, and both are quiet:

- proxy with the remote's `Host` and the remote derives its OWN callback. The browser lands
  there, `Set-Cookie` is scoped to the remote origin, and our page at `127.0.0.1` can never
  send it. Login "succeeds" and `/auth/me` keeps saying nobody.
- forward `X-Forwarded-Host: 127.0.0.1:<port>` and the remote derives *our* callback — which
  the IdP must then have registered. RFC 8252 blesses loopback-any-port for **native** clients,
  but this is a confidential client (the secret is on the remote backend), so you are asking an
  IdP to accept a per-port loopback redirect for a web client. Keycloak needs a wildcard,
  Google refuses, and every install then depends on an IdP change.

## What happens instead

The OIDC dance happens **on the server's origin, in the system browser**, exactly as it does
for a web user. `redirectUriFor` derives the server's own origin, the IdP configuration is
untouched, and `origin.ts`'s constraint never fires against us.

What comes back to the loopback port is not an authorization code but a **studio token** — the
credential `bearerOrSession` was built for, and which `mediatekToken` is already provisioned
with by hand today.

```
app          armPairing() → a nonce, valid 2 minutes
  ↓  shell.openExternal(<server>/pl8/api/token/pair?return=http://127.0.0.1:<port>/desktop/pair&state=<nonce>)
browser      signs in on the SERVER's origin, as always
pl8          requireAuth, validates `return` is loopback http, redirects with token + identity + state
app          /desktop/pair: from here? armed? state matches? → keep the token
```

`shell.openExternal`, never a window of our own: RFC 8252 §8.12, and the browser is where the
user's password manager and existing session already are.

## The three checks, and why each is there

A token arriving on a loopback port means anything that can make this machine open a URL could
try to plant one. So `/desktop/pair` requires, in order:

1. **loopback** — `req.socket.remoteAddress`, never a header;
2. **armed and unexpired** — a link on its own pairs nothing, and a nonce left lying around
   stops being one after two minutes;
3. **the state matches** the nonce we generated, which is what binds the return to the request.

It is one-shot whatever the outcome: the pending pairing is cleared before any of the checks
run, so a refusal spends it too.

`isLoopbackReturn` lives in `@studio/web-protocol/pairing` because pl8 **validates** what the
app **builds**. Two spellings of "is this loopback" would be a hole, not a drift.

## What the token is for

The proxy attaches it as `Authorization: Bearer`, and only for a loopback caller — see
`docs/server.md`. The page holds no cookie for the remote at all, which is what keeps the
entire third-party-cookie and ITP class of problem out of the app.

pl8 mounts `bearerOrSession` on `/api/mediatek`, `/api/projects` and `/api/shares`. It does
**not** on `/api/stems` and `/api/hunt`, which are session-only — so those two 401 from the
desktop until they are widened. That is a one-line change each, and it belongs with the
médiathèque lot that needs them.

## Setting it

There is no settings window yet (`docs/window.md` says why), so the tray menu carries it: one
row that names the server when there is one, and prompts for it when there is not. macOS gets
a native prompt; elsewhere the settings file opens for hand-editing, which is what `settings.ts`
was designed for.
