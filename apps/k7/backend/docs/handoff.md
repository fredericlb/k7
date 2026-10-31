# The sign-in handoff

An app signs in through the **system browser** — an identity provider refuses an embedded view,
and RFC 8252 §8.12 is why. The browser then holds the session, and the app's own views need it.
`src/handoff.ts` carries it across. The phone apps use it (`engine/k7-runtime/docs/android.md`,
`engine/k7-runtime/docs/ios.md`). On a computer k7 already runs in the browser, which signs in through
`/auth/login` and needs no handoff (`apps/k7/frontend/docs/localApp.md`).

| route | opened in | does |
|---|---|---|
| `GET /auth/handoff/issue?redirect&challenge&state[&forget=1]` | the system browser | signs in if needed, then asks "Sign in k7 on this device?" |
| `POST /auth/handoff/issue` | the system browser, from that page | sends a one-use code to `redirect` |
| `GET /auth/handoff/redeem?code&verifier&return_to` | the app's own view | turns the code into a session there |
| `GET /auth/local?return_to` | a page on a machine's own backend | the signed-out local user — mounted only with `STUDIO_LOCAL_USER=1` |

## The code is useless alone

It is the PKCE shape, applied to the session rather than to the provider. The app keeps a
verifier and sends only its hash; the code is bound to that hash, and redeeming it takes the
verifier. A code read off a redirect, a log or a browser history opens nothing. It is **signed, not
stored** — the session's own secret with a suffix of its own, so a code can never pass for a session
cookie or an API token — dead after two minutes, long enough for a phone to switch apps, and
redeemed **once**: this process remembers the hash of every code redeemed until it would have
expired anyway. It carries the browser session's `iat` and `exp`, so the app's session ends when the
browser's would have, and a revocation of the account reaches it. It also carries the KEY of the
provider token that session kept, never the token (commons `packages/oidc/docs/session.md`), so the
app's view pairs with its server as the browser could (`packages/file-hub/docs/syncRelay.md`, "Pairing
without the browser"); the key opens nothing without a session cookie this process signed.

## Issue asks first

`isHandoffReturn` (`packages/web-protocol/handoff.ts`) limits where a code may go: loopback http,
an app listening on its own machine, or `se.frediver.k7:`, the phone app's scheme.
That is not enough on its own: any page can open `issue` with a `redirect` of its choosing, and a
signed-in browser would hand a session to whatever listens there. So the GET only shows a page
naming the account and the destination, and the code is minted by the POST that page sends, which
is refused unless it comes from this origin. There is no registered app nonce that could skip the
page: the request arrives in the system browser, whose cookie jar the app does not share.

A browser with no session, or with only the local user, is sent through `/auth/login` first with
`issue` as the return target, so the app opens ONE address whatever the browser holds. `forget=1`
drops the browser's session once the code is out — and only from the confirmed POST, so a link cannot
use it to sign anybody out, for an app whose session should be its own alone. The phone
does not ask for it, and the browser stays signed in to the studio.

## Redeem trusts the app's navigation, not the code

A code and a verifier prove the app that started the flow, not the browser that redeems it. An
attacker can start a flow for their OWN account and send the redeem link to someone else, whose
browser would then be signed in as the attacker — a login CSRF. Three rules close it:

- **Only the app's own navigation redeems.** The apps load the redeem address themselves
  (`loadUrl`, `load`), which the browser engine marks `Sec-Fetch-Site: none`; a link followed from
  another site says `cross-site` and is refused. A WebView that sends no `Sec-Fetch-Site` is
  accepted when its `X-Requested-With` names the phone app, a header no page can set.
- **It never replaces another account.** A browser already signed in as someone else gets a 409
  and is told to sign out first. The local user, or the same account, is replaced.
- **A nonce cookie set by the app is not used**: the code comes back to the app through the system
  browser, whose cookies the app's view does not share, so nothing could set one where redeem reads.

## The local user

`/auth/local` keeps any session it finds and otherwise signs in a user with no groups, which can
never be an admin. It is the signed-out state of the tray and the phone, and a hosted deployment does not mount it. It answers
a request from this machine, addressed to this machine by name, and refuses every other with `403`
(`standalone.md`).
