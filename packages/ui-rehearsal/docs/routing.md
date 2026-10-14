# The rehearsal pages' addresses

The pages live under `/rehearsal/*` on k7's origin, and nowhere else. Their own paths — `/songs`,
`/settings`, `/@<name>` — would collide with k7's at the root, so the prefix is not optional.

## The prefix is the host's

The package writes no absolute path. The host hands it the prefix twice: to the components through
`RehearsalHostProvider` (`src/host.tsx`), and to the fetch layer through `configureRehearsal`
(`src/config.ts`), which is module-level because `api.ts` and `rtc.ts` are not components and a
context cannot reach them. Every navigation goes through `useRehearsalNav`, and the route table
(`src/routes/RehearsalRoutes.tsx`) is written relative, as though the pages owned the origin.

## No API origin to configure

The API answers on the same origin as the pages — `/api/*` and `/rtc`, served by k7's backend
(`packages/rehearsal-server`) — so every call is relative to `apiBase`, which k7 sets to its own
`BASE`. Every request carries the session cookie (`credentials: "include"`). Signing in and out is
k7's, on the same origin; the pages draw no login screen of their own.

URLs handed to the browser — an `<audio src>`, an `<img src>`, a download link — spell `apiBase`
out themselves, since the browser is what fetches them.

## Two addresses are read before k7's sign-in gate

- **A public page**, `/rehearsal/@<nametag>`, which nobody signs in to see. A React Router path
  cannot put a parameter after a literal `@` in the same segment, so `/@:nametag` never matches;
  `publicPageAt` (`src/addresses.ts`) reads the address by hand, and k7 checks it BEFORE its
  `AuthGate` mounts (`apps/k7/frontend/src/appMain.tsx`). The gate sends a visitor who is not
  signed in to the login page, and a public page must never go through it.
- **The phone's microphone**, `/rehearsal/remote`. It is behind the gate — it records into the
  signed-in person's session — but outside the home's frame: a phone held as a microphone needs
  the input picker and nothing else.

Both are exported from the package's entry, which is light on purpose: the host's entry imports it
before any lazy chunk has loaded.

## The `k7.` host is a permanent alias

`k7.st0.app` (`k7.priv.st0.app` in dev) answers from k7's container: `/api/*`, `/auth/*` and
`/rtc` as on the root origin, and anything else is a 301 to `/rehearsal` + the same path at the
root (`apps/k7/backend/src/server.ts`). It stays because of what was handed out under that name and
cannot be recalled: publish URLs and tokens saved in workspaces' `.settings.json`, public page
links sent to an audience, and installed PWAs. Why `k7` resolves to k7's origin is
`packages/web-protocol/docs/addresses.md`.

## The signalling socket

`src/rtc.ts` opens `${apiBase}/rtc` on the same host; the server takes upgrades on `/rtc` alone
and leaves every other one to the engine registry (`packages/rehearsal-server/docs/audio.md`). In
dev, k7's Vite server proxies `/rtc` as a WebSocket path (`apps/k7/frontend/vite.config.ts`).
