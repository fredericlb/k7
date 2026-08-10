// dev-hosts.mjs — the hostnames the dev servers answer to, named once for all twelve vite
// configs. A vite dev server refuses a Host it was not told about, so this list is what makes
// the studio reachable at all in dev. See docs/dev.md for the topology behind it.

/**
 * The dev URL. One origin, one path per service — `st0.priv.frediver.se/l8`, `/m9`, `/v1` —
 * with st0 answering the root, exactly as production does under `studio.frediver.se`.
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
