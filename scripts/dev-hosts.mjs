// dev-hosts.mjs — the bits of dev topology that belong to no single app, named once for all
// the vite configs: the hostnames the dev servers answer to. A vite dev server refuses a Host
// it was not told about, so this list is what makes the studio reachable at all in dev. See docs/dev.md for the topology behind it.

/** st0's own dev host (../docs/remote.md). */
export const DEV_HOST = "priv.st0.app";

/** The `play.` alias of DEV_HOST: st0's dev server answers it too, as the hosted st0 does (../docs/remote.md). */
export const ALIAS_DEV_HOST = "play.priv.st0.app";

/** The `k7.` alias of DEV_HOST: the rehearsal recorder's former host, answered by st0's dev server (../docs/remote.md). */
export const K7_ALIAS_DEV_HOST = "k7.priv.st0.app";

/** Names still accepted besides the above, for two reasons that both end (../docs/remote.md). */
export const LEGACY_DEV_HOSTS = ["studio.test"];
