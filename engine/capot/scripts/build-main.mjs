// build-main.mjs — bundle the Electron main process to dist/main.cjs.
// CJS on purpose: Electron's ESM main has sharp edges around asar and __dirname, and
// there is nothing to gain here. `--watch` keeps a context open for the dev session.
// `electron` is external because Electron provides it; `koffi` because it loads a .node.
// See docs/tray.md and ../../docs/dev.md.

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as esbuild from "esbuild";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");

// The same stamp shape build.rs produced for the Rust: YYYYMMDD.HHMM, local time.
function buildNumber() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return (
    `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}` +
    `.${p(d.getHours())}${p(d.getMinutes())}`
  );
}

const options = {
  entryPoints: [join(root, "src", "main.ts")],
  outfile: join(root, "dist", "main.cjs"),
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node22",
  sourcemap: true,
  external: ["electron", "koffi"],
  define: {
    __STUDIO_BUILD__: JSON.stringify(process.env.STUDIO_BUILD ?? buildNumber()),
  },
  logLevel: "info",
};

if (process.argv.includes("--watch")) {
  const ctx = await esbuild.context(options);
  await ctx.watch();
  console.log("watching engine/capot/src — save to rebuild dist/main.cjs");
} else {
  await esbuild.build(options);
}
