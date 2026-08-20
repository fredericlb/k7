// dev-hosts.mjs — the bits of dev topology that belong to no single app, named once for all
// twelve vite configs: the hostnames the dev servers answer to, and the one backend port that
// is not the caller's own. A vite dev server refuses a Host it was not told about, so this list
// is what makes the studio reachable at all in dev. See docs/dev.md for the topology behind it.

/**
 * The dev URL. One origin, one path per service — `st0.priv.frediver.se/pl8`, `/m9`, `/k7` —
 * with st0 answering the root, exactly as production does under `studio.frediver.se`.
 *
 * The NAME does not follow the apps, and agrees with this one by accident: it was given for the
 * médiathèque, back when the médiathèque was called `st0` and served the root. That app is `pl8`
 * now, and the editor took the freed name — so the host matches again without ever having moved.
 * A hostname lives in a router and in everyone's bookmarks, and renaming it buys nothing this
 * repo can spend.
 *
 * It resolves to the LAN server, which reverse-proxies to the dev servers on the workstation.
 */
export const DEV_HOST = "st0.priv.frediver.se";

/**
 * Names still accepted besides `DEV_HOST`.
 *
 * `studio.test` was the dev URL until the LAN server took over, and it is kept for exactly
 * two reasons, both of which end: a local Caddy may still be running and answering it on
 * 127.0.0.1, and the reverse proxy may still forward with `Host: studio.test` rather than the
 * public name. Vite rejects an unlisted Host outright, so dropping this before both are
 * settled would answer 403 to every request instead of failing somewhere legible. Delete it
 * once neither holds.
 */
export const LEGACY_DEV_HOSTS = ["studio.test"];

/**
 * st0's backend, which serves `/auth/*` for the WHOLE origin.
 *
 * Here rather than in each vite config because it is the one port a config names that is NOT
 * its own backend: every SPA on this origin carries one session, minted by one service, and in
 * dev each dev server has to forward `/auth` there itself when it is visited directly on its
 * port. `defineAppConfig`'s `proxyPaths` cannot express it — that helper points every path at
 * the caller's `backendPort`, which is right for `/api` and wrong for exactly this one.
 *
 * It moved once already, from the médiathèque's 8795, and the whole cost of that move was
 * finding the three configs that had a copy of it. Hence one export.
 *
 * st0 owns the flow because it is the service with NO path prefix: `redirectUriFor` builds
 * `<origin>/auth/callback`, and that is the single redirect_uri the IdP has registered. See
 * packages/web-protocol/services.ts.
 */
export const AUTH_BACKEND_PORT = 8789;
