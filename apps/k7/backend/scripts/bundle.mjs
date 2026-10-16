// bundle.mjs — k7's backend and the file service it starts as plain JS, what the desktop and phone apps run,
// with the files they read at run time laid out at their repo paths. A source's `import.meta` is rewritten to
// its ORIGINAL path under that tree, so a bundle reads `../meta` or `frontend/dist` as the source did.
// Usage: node bundle.mjs <outDir>, after the frontend's build. See ../docs/standalone.md.

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
import { bundleLibrary } from "./libraryArchive.mjs";

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
  "apps/k7/frontend/dist",
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
        .replaceAll("import.meta.url", `__k7Url(${rel})`)
        .replaceAll("import.meta.dirname", `__k7Dir(${rel})`)
        .replaceAll("import.meta.filename", `__k7File(${rel})`);
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
const banner = (up) => `import { createRequire as __k7Req } from "node:module";
import { dirname as __k7Dn, join as __k7Join } from "node:path";
import { fileURLToPath as __k7F2P, pathToFileURL as __k7P2F } from "node:url";
const require = __k7Req(import.meta.url);
const __filename = __k7F2P(import.meta.url);
const __dirname = __k7Dn(__filename);
const __k7Root = __k7Join(__k7Dn(__k7F2P(import.meta.url)), ${JSON.stringify(up)});
const __k7File = (rel) => __k7Join(__k7Root, rel);
const __k7Dir = (rel) => __k7Dn(__k7File(rel));
const __k7Url = (rel) => __k7P2F(__k7File(rel)).href;`;

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
    backend: "apps/k7/backend/src/server.ts",
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

// The library a fresh desktop or phone copies its `k7-core` from (`$STUDIO_LIBRARY_SEED`): a published version.
await bundleLibrary(repo, join(out, "k7-core"));

writeFileSync(join(out, "STAMP"), `${new Date().toISOString()}\n`);
console.log(`backend bundled in ${out}`);
