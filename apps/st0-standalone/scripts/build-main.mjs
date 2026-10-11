// build-main.mjs — bundle the Electron main process to dist/main.cjs, with the backends' guard and the window's preload beside it.
// CJS because Electron's ESM main is awkward around __dirname; `electron` is external since Electron provides it.

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as esbuild from "esbuild";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

await esbuild.build({
  entryPoints: ["main", "guard", "preload"].map((n) =>
    join(root, "src", `${n}.ts`),
  ),
  outdir: join(root, "dist"),
  outExtension: { ".js": ".cjs" },
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node22",
  sourcemap: true,
  external: ["electron"],
  logLevel: "info",
});
