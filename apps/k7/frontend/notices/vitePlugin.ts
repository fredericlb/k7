// vitePlugin.ts — `virtual:k7-notices`, the third-party notices computed from the tree the build sees.
// Built, never checked in: the list cannot drift from the lockfile. A build refuses a dependency
// whose licence nobody can name; the dev server only warns (../docs/about.md).

import { fileURLToPath } from "node:url";
import type { Plugin } from "vite";
import { collect } from "./collect.ts";

const ID = "virtual:k7-notices";
const RESOLVED = `\0${ID}`;

export function noticesPlugin(): Plugin {
  const root = fileURLToPath(new URL("../../../../", import.meta.url));
  let build = false;
  return {
    name: "k7-notices",
    configResolved(config) {
      build = config.command === "build";
    },
    resolveId: (source) => (source === ID ? RESOLVED : undefined),
    load(id) {
      if (id !== RESOLVED) return;
      const { notices, errors, warnings } = collect(root);
      if (errors.length && build) this.error(errors.join("\n"));
      const all = [...errors, ...warnings];
      if (all.length) this.warn(`notices:\n  ${all.join("\n  ")}`);
      // JSON.parse of a string literal parses faster than the same data as an object literal.
      return `export default JSON.parse(${JSON.stringify(JSON.stringify(notices))});`;
    },
  };
}
