# k7's paths: its own subdomain, and the one path that is not its

k7 answers at the root of its own subdomain — `k7.st0.app`, `k7.priv.st0.app` in dev
(`packages/web-protocol/services.ts`). Everything it calls is on that origin, except
authentication, which is the reason this page exists.

## No API origin to configure

The SPA and its backend share the origin — one process serves both in the image, Vite proxies in
dev — so every path stays relative. `BASE` (`apps/k7/frontend/src/api.ts`) is **derived** from
Vite's `base` rather than restated, and is empty at the root; every path still concatenates it, so
none breaks the day the mount moves. `createApiClient` sets `credentials: "include"`, so every
request carries the session cookie.

## `/auth` is st0's, on another origin

st0 owns `/auth/*` for every service, at the root of ITS origin: the IdP has one `redirect_uri`,
there. So authentication calls go to `authOrigin(origin)` — st0's origin — through a bare `fetch`
with `credentials: "include"`, never through the API client and never on k7's own origin, where
`/auth/login` would look the same and be wrong. The session cookie reaches k7 because it is scoped
to the studio's shared `COOKIE_DOMAIN`.

`loginUrl` is a **getter**, not a constant: it has to capture where you are at the moment of the
click. The parameter must be `return_to`, the name the OIDC package reads — a `redirect` is
ignored, and without it signing in falls back to st0's root, which is not k7.

Signing out returns to `/` rather than staying here: the session belongs to every studio service,
and an anonymous k7 bounces straight back into the login screen, which would make signing out
impossible.

## The router takes a `basename`

`apps/k7/frontend/src/main.tsx` passes `BASE_URL`, as st0 and pl8 do. At the root it changes
nothing, and it is what keeps `navigate()` inside the app if k7 is ever mounted under a path:
`useLocation()` reports paths without the prefix, which is what lets `navForPath` and the route
table be written as though k7 owned the origin.

## URLs handed to the browser spell `BASE` out

`api.ts`'s `…Url` helpers are the exception to `f()`: they go into an `<audio src>`, an
`<img src>` or a download link, so the browser is what fetches and nothing is left to prefix the
service.

## The signalling socket

`apps/k7/frontend/src/rtc.ts` opens `${BASE}/rtc` on the same host, and the handler in
`apps/k7/backend/src/rtc.ts` takes upgrades on `/rtc` alone and leaves every other one to its
owner.
