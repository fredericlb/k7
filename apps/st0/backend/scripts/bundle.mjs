// bundle.mjs — st0's backend and the file service it starts as plain JS, what the desktop and phone apps run,
// with the files they read at run time laid out at their repo paths. A source's `import.meta` is rewritten to
// its ORIGINAL path under that tree, so a bundle reads `../meta` or `frontend/dist` as the source did.
// Usage: node bundle.mjs <outDir>, after the frontend's build. See ../docs/standalone.md.

import { execFileSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const repo = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
  "..",
);
const out = process.argv[2];
if (!out) throw new Error("usage: bundle.mjs <outDir>");

// The bundles' own folder; `import.meta` of a source resolves against its parent, the staged tree.
const BIN = "bin";

// What the bundles read beside themselves, at the path the source names it from.
const DATA = [
  "apps/st0/frontend/dist",
  "packages/song/meta",
  "packages/song/samples/video/sample.mp4",
  "packages/commands/commands.yaml",
  "demos",
];

// Every source whose `import.meta` was rewritten, printed with --list so DATA can be checked against it.
const metaUsers = new Set();

/** `import.meta.*` of a repo source, as that source's own location under the staged tree. */
const metaPlugin = {
  name: "source-meta",
  setup(b) {
    b.onLoad({ filter: /\.(m?[jt]sx?)$/ }, (args) => {
      if (args.path.includes("/node_modules/")) return undefined;
      const text = readFileSync(args.path, "utf8");
      if (!text.includes("import.meta")) return undefined;
      metaUsers.add(relative(repo, args.path));
      const rel = JSON.stringify(relative(repo, args.path));
      const contents = text
        .replaceAll("import.meta.url", `__st0Url(${rel})`)
        .replaceAll("import.meta.dirname", `__st0Dir(${rel})`)
        .replaceAll("import.meta.filename", `__st0File(${rel})`);
      const ext = args.path.split(".").pop();
      return {
        contents,
        loader: ext === "mjs" ? "js" : ext,
        resolveDir: dirname(args.path),
      };
    });
  },
};

// CommonJS deps want `require` and `__dirname` (the bundle's own), and every source's meta wants the tree's root.
const banner = (up) => `import { createRequire as __st0Req } from "node:module";
import { dirname as __st0Dn, join as __st0Join } from "node:path";
import { fileURLToPath as __st0F2P, pathToFileURL as __st0P2F } from "node:url";
const require = __st0Req(import.meta.url);
const __filename = __st0F2P(import.meta.url);
const __dirname = __st0Dn(__filename);
const __st0Root = __st0Join(__st0Dn(__st0F2P(import.meta.url)), ${JSON.stringify(up)});
const __st0File = (rel) => __st0Join(__st0Root, rel);
const __st0Dir = (rel) => __st0Dn(__st0File(rel));
const __st0Url = (rel) => __st0P2F(__st0File(rel)).href;`;

const common = {
  absWorkingDir: repo,
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node24",
  // ssh2's optional native helpers: absent, it falls back to JS, as in the desktop app.
  external: ["cpu-features", "*.node"],
  plugins: [metaPlugin],
  logLevel: "warning",
  legalComments: "none",
};

rmSync(out, { recursive: true, force: true });
mkdirSync(join(out, BIN), { recursive: true });

await build({
  ...common,
  entryPoints: {
    backend: "apps/st0/backend/src/server.ts",
    "file-service": "packages/file-service/src/server.ts",
  },
  outdir: join(out, BIN),
  outExtension: { ".js": ".mjs" },
  banner: { js: banner("..") },
});

// The DSP runner is spawned by its path beside nodeProject.ts, so it is bundled to that same path.
const DSP_RUNNER = "packages/song/src/dspRunner.mjs";
await build({
  ...common,
  entryPoints: [DSP_RUNNER],
  outfile: join(out, DSP_RUNNER),
  banner: { js: banner("../../..") },
});

if (process.argv.includes("--list"))
  console.log([...metaUsers].sort().join("\n"));

for (const rel of DATA) {
  const from = join(repo, rel);
  if (!existsSync(from))
    throw new Error(`${rel} is missing — build the frontend first`);
  cpSync(from, join(out, rel), { recursive: true });
}

// The library a fresh desktop or phone seeds its list with: one commit, no network.
execFileSync("git", [
  "clone",
  "-q",
  "--bare",
  "--depth",
  "1",
  "--",
  `file://${join(repo, "st0-library")}`,
  join(out, "st0-library.git"),
]);

writeFileSync(join(out, "STAMP"), `${new Date().toISOString()}\n`);
console.log(`backend bundled in ${out}`);
