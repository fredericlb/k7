// dev-hosts.mjs — the bits of dev topology that belong to no single app, named once for all
// twelve vite configs: the hostnames the dev servers answer to, and the one backend port that
// is not the caller's own. A vite dev server refuses a Host it was not told about, so this list
// is what makes the studio reachable at all in dev. See docs/dev.md for the topology behind it.

/** The dev URL: one origin, one path per service, st0 at the root (../docs/remote.md). */
export const DEV_HOST = "st0.priv.frediver.se";

/** Names still accepted besides `DEV_HOST`, for two reasons that both end (../docs/remote.md). */
export const LEGACY_DEV_HOSTS = ["studio.test"];

/** st0's backend, which serves `/auth/*` for the WHOLE origin — exported once (../docs/dev.md). */
export const AUTH_BACKEND_PORT = 8789;
