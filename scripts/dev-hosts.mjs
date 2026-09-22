// dev-hosts.mjs — the bits of dev topology that belong to no single app, named once for all
// twelve vite configs: the hostnames the dev servers answer to, and the one backend port that
// is not the caller's own. A vite dev server refuses a Host it was not told about, so this list
// is what makes the studio reachable at all in dev. See docs/dev.md for the topology behind it.

/** st0's own dev host — z0 lives here too, being a path under st0's origin (../docs/remote.md). */
export const DEV_HOST = "priv.st0.app";

/** pl8's own dev host — a separate subdomain, not a path under DEV_HOST (../docs/remote.md). */
export const PL8_DEV_HOST = "play.priv.st0.app";

/** k7's own dev host — a separate subdomain, not a path under DEV_HOST (../docs/remote.md). */
export const K7_DEV_HOST = "k7.priv.st0.app";

/** Names still accepted besides the above, for two reasons that both end (../docs/remote.md). */
export const LEGACY_DEV_HOSTS = ["studio.test"];

/** st0's backend, which serves `/auth/*` for the WHOLE origin — exported once (../docs/dev.md). */
export const AUTH_BACKEND_PORT = 8789;
