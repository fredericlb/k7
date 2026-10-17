# CORS answers a list, and a cross-site write is refused

`studioCors` (`apps/k7/backend/src/media/cors.ts`) runs before anything else in `server.ts`. It
decides two things for every request: whether the page that sent it may **read** the answer with
the session cookie, and whether a write from another site reaches a route at all.

## Why it cannot be open

Wherever `COOKIE_DOMAIN` is set — production, and the dev session behind the LAN proxy — the session
cookie `studio.sid` is `SameSite=None` (`commons/packages/oidc/index.ts`), so the browser attaches it
to a request from ANY site. CORS is then the only thing that stops a page elsewhere from reading what
that cookie unlocks: an API token minted at `/api/token`, a file hub ticket, a workspace's files.
Reflecting every origin with `Access-Control-Allow-Credentials` would hand all of it to whatever
page a signed-in user happens to visit.

## Who is on the list

`isAllowedOrigin` is a pure function, tested beside it:

| origin | why |
|---|---|
| the request's own host (`X-Forwarded-Host` first, as `publicOrigin` reads it) | a page calling its own origin, through the dev proxy too, where `Host` is rewritten |
| `https://` on `COOKIE_DOMAIN` or any subdomain of it | the `play.` and `k7.` aliases calling k7's root, and any sibling app sharing the cookie |
| each entry of `TRUSTED_ORIGINS`, exactly | another origin a deployment names on purpose — the same list its login bounces back to |
| `http://127.0.0.1:*`, `localhost`, `[::1]` | only where there is no `COOKIE_DOMAIN`, or with `STUDIO_LOCAL_USER=1`: a dev run on bare ports, or the desktop and phone backends; never on a hosted origin, where a loopback page is whatever runs on the visitor's machine |

Every other origin gets no CORS header at all, and a preflight from it is answered `204` empty, which
the browser reads as a refusal. Reading `COOKIE_DOMAIN` and `TRUSTED_ORIGINS` from the same
environment `setupAuth` reads keeps the cookie's reach and the list in one place: an origin that
shares the cookie is an origin that may read with it.

No route is open to every origin without credentials: a share is played on k7's own origin
(`sharePlayer.md`), so nothing outside the list needs a CORS answer.

## A write from another site is refused

CORS decides what a page may **read**, not what it may **send**: a form post or a plain `fetch`
with no preflight reaches the route and runs, cookie attached, whatever CORS says afterwards. So a
request other than `GET`, `HEAD` or `OPTIONS` is answered `403` when:

- its `Origin` header is present and not on the list (an opaque `null` origin included), or
- it has no `Origin` and `Sec-Fetch-Site` says `cross-site`.

A request with neither header passes: that is a native client — the supervisor, the desktop's main
process, a script with a bearer token — which carries no browser cookie for a page to ride. `GET`
routes stay unguarded, so a route that changes state on `GET` is a hole this guard does not close.

## The headers are a list

`Access-Control-Allow-Headers` names what a page actually sends, not whatever it asks for: the
file hub's calls (`/api/files`, `packages/file-hub/docs/fileHub.md`) carry the user, workspace,
engine-token and engine-id headers, so those are listed. The hub secret is not: a browser never
holds it, and a preflight asking for it is refused rather than answered.
