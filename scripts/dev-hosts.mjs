// dev-hosts.mjs — the bits of dev topology that belong to no single app, named once for all
// the vite configs: the hostnames the dev servers answer to. A vite dev server refuses a Host
// it was not told about, so this list is what makes the studio reachable at all in dev. See docs/dev.md for the topology behind it.

/** k7's own dev host (../docs/remote.md). */
export const DEV_HOST = "app.priv.k7.rocks";

/** The documentation's dev host: k7's dev server answers it with the docs alone, as the hosted k7 does (../docs/dev.md). */
export const DOCS_DEV_HOST = "docs.priv.k7.rocks";

/** The former dev hosts, whose pages k7 moves to DEV_HOST as the hosted k7 does its former hosts (../docs/dev.md). */
export const LEGACY_DEV_HOSTS = [
  "priv.st0.app",
  "play.priv.st0.app",
  "k7.priv.st0.app",
  "studio.test",
];
