// stage.mjs — build staging/ for electron-builder: the source tree the backend runs from, its prod deps, the binaries, the library.
// The backend runs as raw TypeScript under tsx, exactly as in its Docker image, so what ships is SOURCE plus node_modules.
// See ../docs/standalone.md for why the tree is copied whole rather than bundled.

import { execFileSync } from "node:child_process";
import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const app = join(dirname(fileURLToPath(import.meta.url)), "..");
const repo = join(app, "..", "..");
const staging = join(app, "staging");
const src = join(staging, "app-src");
const bin = join(staging, "bin");
const exe = (n) => (process.platform === "win32" ? `${n}.exe` : n);

const run = (cmd, args, cwd = repo) => {
  console.log(`$ ${cmd} ${args.join(" ")}`);
  execFileSync(cmd, args, {
    cwd,
    stdio: "inherit",
    shell: process.platform === "win32",
  });
};

/** Tracked and untracked-but-not-ignored files of a git tree, relative to it. */
const lsFiles = (dir) =>
  execFileSync(
    "git",
    ["ls-files", "-z", "--cached", "--others", "--exclude-standard"],
    { cwd: dir },
  )
    .toString("utf8")
    .split("\0")
    .filter(
      (f) => f && existsSync(join(dir, f)) && statSync(join(dir, f)).isFile(),
    );

// What the backend and the file service import; every workspace manifest too, since npm ci reads them all.
const KEEP = [
  /^apps\/st0\//,
  /^packages\//,
  /^demos\//,
  /^package(-lock)?\.json$/,
  /^\.npmrc$/,
];
const keep = (f) => f.endsWith("package.json") || KEEP.some((r) => r.test(f));
const DROP = [/\/node_modules\//, /\/dist\//, /\.test\.tsx?$/];

function copyTree(from, files, to) {
  for (const f of files) {
    if (DROP.some((r) => r.test(`/${f}`))) continue;
    mkdirSync(dirname(join(to, f)), { recursive: true });
    copyFileSync(join(from, f), join(to, f));
  }
}

/** The newest build of a CMake target, as paths.ts picks it at run time. */
function newestBuild(project, name) {
  const build = join(repo, "engine", project, "build");
  const found = existsSync(build)
    ? readdirSync(build)
        .map((p) => join(build, p, exe(name)))
        .filter((p) => existsSync(p))
    : [];
  found.sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
  if (!found[0])
    throw new Error(`no build of ${name} under ${build} — build it first`);
  return found[0];
}

/** The Faust `.lib` files the engine's CMake fetched; the engine looks for `faust-libs/` beside itself. */
function faustLibs() {
  const build = join(repo, "engine", "st0-engine", "build");
  for (const preset of readdirSync(build)) {
    const cache = join(build, preset, "CMakeCache.txt");
    if (!existsSync(cache)) continue;
    const m = /^STUDIO_FAUST_LIBS:[A-Z]+=(.*)$/m.exec(
      readFileSync(cache, "utf8"),
    );
    if (m && existsSync(join(m[1].trim(), "stdfaust.lib"))) return m[1].trim();
  }
  throw new Error(
    "no Faust libraries named by any engine/st0-engine/build/*/CMakeCache.txt",
  );
}

rmSync(staging, { recursive: true, force: true });
mkdirSync(bin, { recursive: true });

console.log("· frontends");
run("npm", ["exec", "--workspace", "st0-frontend", "--", "vite", "build"]);

console.log("· source");
copyTree(repo, lsFiles(repo).filter(keep), src);
const commons = join(repo, "commons");
copyTree(
  commons,
  lsFiles(commons).filter(
    (f) => f.endsWith("package.json") || /^(packages|dev)\//.test(f),
  ),
  join(src, "commons"),
);
cpSync(
  join(repo, "apps", "st0", "frontend", "dist"),
  join(src, "apps", "st0", "frontend", "dist"),
  { recursive: true },
);

console.log("· production dependencies");
// --ignore-scripts: the only install script that matters (ssh2's crypto binding) targets the system node's ABI, not Electron's, and has a JS fallback.
run(
  "npm",
  [
    "ci",
    "--omit=dev",
    "--ignore-scripts",
    "--no-audit",
    "--no-fund",
    "--workspace",
    "st0-backend",
  ],
  src,
);

console.log("· engine and supervisor");
const supervisor = newestBuild("st0-supervisor", "st0-supervisor");
copyFileSync(
  newestBuild("st0-engine", "st0-engine"),
  join(bin, exe("st0-engine")),
);
copyFileSync(supervisor, join(bin, exe("st0-supervisor")));
for (const f of readdirSync(dirname(supervisor)))
  if (
    /^(libonnxruntime.*\.(dylib|so.*)|onnxruntime.*\.dll|DirectML\.dll)$/.test(
      f,
    )
  )
    cpSync(join(dirname(supervisor), f), join(bin, f), {
      verbatimSymlinks: true,
    });
const faust = faustLibs();
mkdirSync(join(bin, "faust-libs"));
for (const f of readdirSync(faust))
  if (f.endsWith(".lib"))
    copyFileSync(join(faust, f), join(bin, "faust-libs", f));

console.log("· library");
run("git", [
  "clone",
  "-q",
  "--bare",
  "--",
  join(repo, "st0-library"),
  join(staging, "st0-library.git"),
]);

console.log(`staged in ${staging}`);
