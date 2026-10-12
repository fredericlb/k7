// build.mjs — bundle an app's Electron main process to <app>/dist, with the servers' guard beside it.
// CJS because Electron's ESM main is awkward around __dirname; `electron` is external since Electron provides it.

import { createRequire } from "node:module";
import { basename, extname, join } from "node:path";
import * as esbuild from "esbuild";

const require = createRequire(import.meta.url);

/** `entries` are paths to the app's own entry files (main, preload…); each becomes dist/<name>.cjs. */
export async function buildMain({ appRoot, entries }) {
  const guard = require.resolve("@studio/electron-shell/guard");
  // Named, so every output lands flat in dist/ however far apart the entries live.
  const named = Object.fromEntries(
    [...entries, guard].map((e) => [basename(e, extname(e)), e]),
  );
  // Two entries of one name would silently overwrite each other in dist/.
  if (Object.keys(named).length !== entries.length + 1)
    throw new Error(`entry names must be unique, and none may be guard.ts`);
  await esbuild.build({
    entryPoints: named,
    outdir: join(appRoot, "dist"),
    outExtension: { ".js": ".cjs" },
    bundle: true,
    platform: "node",
    format: "cjs",
    target: "node22",
    sourcemap: true,
    external: ["electron"],
    logLevel: "info",
  });
}
