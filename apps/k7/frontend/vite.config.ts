import { alphaTab } from "@coderline/alphatab-vite";
import { frediverseParaglide } from "@frediverse/i18n/vite";
import { defineAppConfig } from "@frediverse/vite-config";
import type { Plugin } from "vite";
import { DEV_HOST, LEGACY_DEV_HOSTS } from "../../../scripts/dev-hosts.mjs";

const BASE = "/k7/";

// alphaTab 1.8.4 prefixes its workers' env import with the base, which dev import analysis cannot resolve — ../docs/score.md.
const alphaTabWorkerEnv: Plugin = {
  name: "k7:alphatab-worker-env",
  apply: "serve",
  enforce: "post",
  transform(code, id) {
    if (!id.includes("alphatab_worker")) return;
    const prefixed = `import ${JSON.stringify(`${BASE}@vite/env`)}`;
    if (!code.startsWith(prefixed)) return;
    return code.replace(prefixed, 'import "/@vite/env"');
  },
};

// `base` is what the dev proxy derives /k7/api and /k7/rtc from — see ../docs/routing.md.
export default defineAppConfig({
  dir: import.meta.url,
  base: BASE,
  port: 5173,
  backendPort: 8787,
  host: DEV_HOST,
  proxyPaths: ["/auth"],
  wsPaths: ["/rtc"],
  extend: {
    // alphaTab copies its font and soundfont and wires its worker and worklet — ../docs/score.md.
    plugins: [frediverseParaglide(), alphaTab(), alphaTabWorkerEnv],
    // The extra host names these servers answer to — see scripts/dev-hosts.mjs.
    server: { allowedHosts: LEGACY_DEV_HOSTS },
  },
});
