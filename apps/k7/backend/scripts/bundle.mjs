// bundle.mjs — k7's backend and the file service it starts as plain JS, what the desktop and phone apps run,
// with the files they read at run time laid out at their repo paths. A source's `import.meta` is rewritten to
// its ORIGINAL path under that tree, so a bundle reads `../meta` or `frontend/dist` as the source did.
// Usage: node bundle.mjs <outDir>, after the frontend's build; `--in-tree` for the server image. See ../docs/standalone.md.

import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
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
if (!out) throw new Error("usage: bundle.mjs <outDir> [--in-tree] [--list]");
// The server image: the two entries only, in a folder of the checkout, whose files they read where they lie.
const inTree = process.argv.includes("--in-tree");

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
      // In `/` whatever the host: the bundle runs on a phone, where a Windows `\` would name one file.
      const posix = relative(repo, args.path).split(sep).join("/");
      if (posix.includes("node_modules/")) return undefined;
      const text = readFileSync(args.path, "utf8");
      if (!text.includes("import.meta")) return undefined;
      metaUsers.add(posix);
      const rel = JSON.stringify(posix);
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
  // Node 24 everywhere: the server image and CI run it, and Electron embeds it (docs/images.md).
  target: "node24",
  // ssh2's optional native helpers: absent, it falls back to JS, as in the desktop app.
  // playwright-core: imported lazily by the server's picture render, from node_modules; its own optional imports do not bundle.
  external: ["cpu-features", "*.node", "playwright-core"],
  plugins: [metaPlugin],
  logLevel: "warning",
  legalComments: "none",
};

if (inTree) {
  if (relative(repo, dirname(resolve(out))) !== "")
    throw new Error("--in-tree wants a folder directly in the checkout");
  rmSync(out, { recursive: true, force: true });
  await build({
    ...common,
    entryPoints: {
      backend: "apps/k7/backend/src/server.ts",
      "file-service": "packages/file-service/src/server.ts",
    },
    outdir: out,
    outExtension: { ".js": ".mjs" },
    banner: { js: banner("..") },
  });
  if (process.argv.includes("--list"))
    console.log([...metaUsers].sort().join("\n"));
  console.log(`backend bundled in ${out}, reading the checkout around it`);
  process.exit(0);
}

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
