# k7's paths: the `/k7` prefix, and what has none

k7 is served under a prefix, on an origin it shares with st0, pl8 and z0. Almost everything it
calls carries `/k7` in front; the exceptions are the reason this page exists.

## No API origin to configure

The SPA is served at `/k7` and its backend at `/k7/api`, on the same host — nginx routes it in
the image, Vite in dev — so every path stays relative. `BASE` (`apps/k7/frontend/src/api.ts`) is
**derived** from Vite's `base` rather than restated: the prefix is declared in
`apps/k7/frontend/vite.config.ts` and nowhere else. `createApiClient` sets
`credentials: "include"`, so every request carries the session cookie.

## `/auth` is not under the prefix

st0 owns `/auth/*` at the root of the origin for every service, so authentication calls go
through a bare `fetch` rather than the API client.

`loginUrl` is a **getter**, not a constant: it has to capture where you are at the moment of the
click. The parameter must be `return_to`, the name the OIDC package reads — a `redirect` is
ignored, and without it signing in falls back to `APP_ROOT`, the origin's root, which is not k7.

Signing out returns to `/` rather than staying here: the session belongs to the whole origin,
and an anonymous k7 bounces straight back into the login screen, which would make signing out
impossible.

## The router takes a `basename`

`apps/k7/frontend/src/main.tsx` passes `BASE_URL`, as st0 and pl8 do. Without it every
`navigate()` writes a bare `/sessions`, which does not belong to k7: the app works until the
first reload, and that reload lands outside it. With it, `useLocation()` reports paths without
the prefix, which is what lets `navForPath` and the route table be written as though k7 owned
the origin.

## URLs handed to the browser spell `BASE` out

`api.ts`'s `…Url` helpers are the exception to `f()`: they go into an `<audio src>`, an
`<img src>` or a download link, so the browser is what fetches and nothing is left to prefix the
service. A bare `/api/…` is not k7's, and the media answers 404.

## The signalling socket carries the prefix

`apps/k7/frontend/src/rtc.ts` opens on the same host with the service prefix. The edge routes
only `/k7/rtc*` this far and strips the prefix before the server, which is why the handler in
`apps/k7/backend/src/rtc.ts` recognises a bare `/rtc`.
