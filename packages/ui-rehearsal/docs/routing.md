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
backend or, on the tray, to its forward to the paired server (`apps/k7/frontend/docs/serverPicker.md`).
`hostBase` stays the machine's: "Fetch song" searches its library and hunt, and the bench its
engines. Every request carries the session cookie (`credentials: "include"`). Signing in and out is
k7's, on the same origin; the pages draw no login screen of their own.

URLs handed to the browser — an `<audio src>`, an `<img src>`, a download link — spell `apiBase`
out themselves, since the browser is what fetches them.

## Two addresses are read before k7's sign-in gate

- **A public page**, `/rehearsal/@<nametag>`, which a visitor may open without signing in. Whether
  they may is the page's visibility (`packages/rehearsal-server/docs/pages.md`): a page open to
  anyone signed in answers 401 to nobody, and the screen offers a sign-in link that comes back to
  the same address, rather than the gate's redirect, so a page that turns out to be someone else's
  does not loop through the login. A React Router path
  cannot put a parameter after a literal `@` in the same segment, so `/@:nametag` never matches;
  `publicPageAt` (`src/addresses.ts`) reads the address by hand, and k7 checks it BEFORE its
  `AuthGate` mounts (`apps/k7/frontend/src/appMain.tsx`). The gate sends a visitor who is not
  signed in to the login page, and a public page must never go through it.
- **The phone's microphone**, `/rehearsal/remote`. It is behind the gate — it records into the
  signed-in person's session — but outside the home's frame: a phone held as a microphone needs
  the input picker and nothing else.

The public page is recognised by the package's entry, which is light on purpose: the host's entry
imports it before any lazy chunk has loaded; the microphone is a plain route of the host's. Their screens are a lazy entry of their own, `./public`
(`src/public.ts`), apart from `./pages`, which holds the signed-in routes: one module exporting both
would be one chunk of both, and an anonymous visitor of a public page would download every
signed-in screen — the songbook, the exercises, the editors — to read one page.

## The `k7.` host is a permanent former host

`k7.st0.app` (`k7.priv.st0.app` in dev) answers from k7's container: `/api/*`, `/auth/*` and
`/rtc` as on k7's origin, and anything else is a 301 to `/rehearsal` + the same path at k7's
origin, `app.k7.rocks` (`apps/k7/backend/src/server.ts`). It stays because of what was handed out under that name and
cannot be recalled: publish URLs and tokens saved in workspaces' `.settings.json`, public page
links sent to an audience, and installed PWAs. Why `k7` resolves to k7's origin is
`packages/web-protocol/docs/addresses.md`.

## The signalling socket

`src/rtc.ts` opens `${apiBase}/rtc` on the same host; the server takes upgrades on `/rtc` alone
and leaves every other one to the engine registry (`packages/rehearsal-server/docs/audio.md`). In
dev, k7's Vite server proxies `/rtc` as a WebSocket path (`apps/k7/frontend/vite.config.ts`).

## A confirmation is asked in the page

A deletion is confirmed through `@frediverse/ui/ask` (`src/confirm.ts`), never `window.confirm`,
whose box ignores the page's language, its focus and its Escape. The dialog needs an `<AskHost/>`
of that same module, and k7's pages mount the one from `@studio/project-shell/ask`, a different
module with a host of its own; so the rehearsal pages mount theirs where they are drawn, in
`RehearsalRoutes` and in `RehearsalSettings`. Without it `askConfirm` answers no, and a delete
button does nothing.
