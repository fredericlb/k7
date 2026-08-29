#!/usr/bin/env node
// stage.mjs — everything the app CARRIES, and the C++ engine that heads it: the vendored
// node, the two esbuilt .mjs bundles, the demo songs, the Faust libraries and onnxruntime.
// Split out of build-engine.mjs so the staging has one definition while two packagers use
// it, and so neither file breaks the 500-line rule. Full rationale: docs/buildEngine.md.

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
} from "node:fs";
import { basename, dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url)); // apps/studio-desktop/scripts
export const trayDir = dirname(here); //               apps/studio-desktop
export const repo = join(trayDir, "..", ".."); //      the monorepo root
export const engineDir = join(repo, "engine", "moteur");
export const CACHE = join(trayDir, ".cache"); // vendored downloads (gitignored)

// The Node we vendor: pinned and downloaded, a Homebrew one being a shim (docs/buildEngine.md).
export const NODE_VERSION = "v22.23.1";

// The CMake preset for this host. Linux has no packaged tray target yet, but the engine still builds.
export const PRESET =
  { darwin: "macos-clang", win32: "windows-msvc" }[process.platform] ??
  "release-gcc";

export function run(cmd, args, cwd, extraEnv, { allowFail = false } = {}) {
  console.log(`\n▸ ${cmd} ${args.join(" ")}\n  in ${cwd}`);
  const r = spawnSync(cmd, args, {
    cwd,
    stdio: "inherit",
    env: { ...process.env, ...extraEnv },
    // cmake and the npm shims are resolved through the shell on Windows (.cmd).
    shell: process.platform === "win32",
  });
  if (r.error?.code === "ENOENT") {
    console.error(`\nerror: '${cmd}' not found on PATH.`);
    process.exit(1);
  }
  if (r.status !== 0) {
    console.error(`\nerror: ${cmd} ${args[0]} failed (exit ${r.status}).`);
    if (!allowFail) process.exit(r.status ?? 1);
  }
  return r.status ?? 0;
}

export // The freshest built engine binary, Debug last — see @studio/engine-client's engineBinary.ts.
function findEngineBinary() {
  const build = join(engineDir, "build");
  if (!existsSync(build)) return null;
  const names = ["studio-moteur.exe", "studio-moteur"];
  const configs = ["", "Release", "RelWithDebInfo", "Debug"];
  const found = [];
  for (const preset of readdirSync(build))
    for (const cfg of configs)
      for (const name of names) {
        const p = join(build, preset, cfg, name);
        if (existsSync(p) && statSync(p).isFile())
          found.push({ path: p, debug: cfg === "Debug" });
      }
  if (!found.length) return null;
  found.sort(
    (a, b) =>
      Number(a.debug) - Number(b.debug) ||
      statSync(b.path).mtimeMs - statSync(a.path).mtimeMs,
  );
  return found[0].path;
}

export // The build number the tray displays, stamped into the binary by build.rs — when it was BUILT, not run.
function buildNumber() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}.${p(d.getHours())}${p(d.getMinutes())}`;
}

export const BUILD_NUMBER = buildNumber();

/** Refuse a vendored Node that is not the one nodejs.org published — see docs/buildEngine.md. */
function verifyNodeArchive(archivePath, archive) {
  const sumsPath = join(CACHE, `SHASUMS256-${NODE_VERSION}.txt`);
  if (!existsSync(sumsPath))
    run(
      "curl",
      [
        "-fsSL",
        "-o",
        sumsPath,
        `https://nodejs.org/dist/${NODE_VERSION}/SHASUMS256.txt`,
      ],
      CACHE,
    );

  const line = readFileSync(sumsPath, "utf8")
    .split("\n")
    .find((l) => l.trim().endsWith(` ${archive}`));
  if (!line) {
    console.error(`\nerror: ${archive} is not listed in SHASUMS256.txt.`);
    process.exit(1);
  }
  const want = line.trim().split(/\s+/)[0].toLowerCase();
  const got = createHash("sha256")
    .update(readFileSync(archivePath))
    .digest("hex");
  if (got !== want) {
    // Removed, not just refused: leaving it means the next run finds it "cached" and trusts it.
    rmSync(archivePath, { force: true });
    console.error(
      `\nerror: ${archive} failed its checksum and has been deleted.\n` +
        `  expected ${want}\n  got      ${got}`,
    );
    process.exit(1);
  }
  console.log(`  sha256 ok — ${archive}`);
}

export // Download (once, cached) an official self-contained Node and return its binary.
function vendorNode() {
  const plat = { darwin: "darwin", win32: "win", linux: "linux" }[
    process.platform
  ];
  const arch = { arm64: "arm64", x64: "x64" }[process.arch];
  if (!plat || !arch) {
    console.error(
      `error: no vendored Node for ${process.platform}/${process.arch}.`,
    );
    process.exit(1);
  }
  const name = `node-${NODE_VERSION}-${plat}-${arch}`;
  const isWin = plat === "win";
  const archive = `${name}.${isWin ? "zip" : "tar.gz"}`;
  const cached = join(CACHE, name, isWin ? "node.exe" : "bin/node");
  if (existsSync(cached)) return cached;

  mkdirSync(CACHE, { recursive: true });
  const archivePath = join(CACHE, archive);
  console.log(`\n=== vendoring Node ${NODE_VERSION} (${plat}-${arch}) ===`);
  if (!existsSync(archivePath))
    run(
      "curl",
      [
        "-fsSL",
        "-o",
        archivePath,
        `https://nodejs.org/dist/${NODE_VERSION}/${archive}`,
      ],
      CACHE,
    );
  verifyNodeArchive(archivePath, archive);
  // Windows: System32's bsdtar BY PATH — it reads .zip, and a bare `tar` may resolve to Git Bash's GNU tar.
  const tar = isWin
    ? join(process.env.SystemRoot ?? "C:\\Windows", "System32", "tar.exe")
    : "tar";
  run(tar, ["-xf", archive], CACHE);
  if (!existsSync(cached)) {
    console.error(`error: ${cached} missing after extracting ${archive}.`);
    process.exit(1);
  }
  return cached;
}

// The repo's demos/ into the app's resources, replaced wholesale (docs/buildEngine.md).
export function stageDemos(destDir) {
  const src = join(repo, "demos");
  if (!existsSync(src)) {
    console.error(`error: no demo songs at ${src}.`);
    process.exit(1);
  }
  rmSync(destDir, { recursive: true, force: true });
  cpSync(src, destDir, {
    recursive: true,
    filter: (p) => {
      const base = basename(p);
      return (
        base !== "node_modules" &&
        base !== ".git" &&
        !base.startsWith(".studio-")
      );
    },
  });
  const names = readdirSync(destDir).filter((n) => !n.startsWith("."));
  console.log(`  ${names.length} demo(s): ${names.join(", ")}`);
}

export /** The Faust standard libraries out of the engine's build tree, newest preset winning (docs/buildEngine.md). */
function stageFaustLibs(destDir) {
  const build = join(engineDir, "build");
  const found = existsSync(build)
    ? readdirSync(build)
        .map((preset) => join(build, preset, "_deps", "faust-src", "libraries"))
        .filter((p) => existsSync(join(p, "stdfaust.lib")))
    : [];
  if (!found.length) {
    console.error(
      "error: no Faust libraries found under engine/moteur/build/*/_deps/faust-src/libraries.\n" +
        "       Build the engine first — the libraries are a git submodule fetched by its CMake.",
    );
    process.exit(1);
  }
  found.sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
  rmSync(destDir, { recursive: true, force: true });
  mkdirSync(destDir, { recursive: true });
  // The `.lib` files only: the submodule's own docs, tests and CI config are not read by the compiler.
  let n = 0;
  for (const f of readdirSync(found[0]))
    if (f.endsWith(".lib")) {
      copyFileSync(join(found[0], f), join(destDir, f));
      n++;
    }
  console.log(`  ${n} Faust library file(s) from ${found[0]}`);
}

export /** One installed package into `resources/node_modules/`, for what a bundle cannot inline (docs/buildEngine.md). */
function stageNodeModule(name, destRoot, prune) {
  const src = join(repo, "node_modules", name);
  if (!existsSync(src)) {
    console.error(
      `error: ${name} is not installed at ${src} — run \`npm install\` at the repo root.`,
    );
    process.exit(1);
  }
  const dest = join(destRoot, name);
  rmSync(dest, { recursive: true, force: true });
  cpSync(src, dest, {
    recursive: true,
    dereference: true, // a workspace install may symlink; the bundle needs the bytes
    filter: (p) => !prune?.(relative(src, p)),
  });
  console.log(`  ${name}: ${src}\n     → ${dest}`);
}

export // Bundle one TypeScript entry into a single .mjs the vendored `node` runs with no node_modules beside it.
async function bundleTs(entry, outFile) {
  // esbuild's JS API, not its CLI: run() goes through cmd.exe on Windows, which splits --banner:js=... on spaces.
  let esbuild;
  try {
    esbuild = await import("esbuild");
  } catch {
    console.error(
      "error: esbuild not found — run `npm install` at the repo root.",
    );
    process.exit(1);
  }
  mkdirSync(dirname(outFile), { recursive: true });
  console.log(`\n▸ esbuild (API) ${relative(repo, entry)} → ${outFile}`);
  await esbuild.build({
    entryPoints: [entry],
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node22",
    // Native modules, external for OPPOSITE reasons — only one of the two is also staged (docs/buildEngine.md).
    external: ["fsevents", "onnxruntime-node"],
    // ESM output has no `require`, but the CommonJS deps here call it — without this the bundle dies at runtime.
    banner: {
      js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);",
    },
    outfile: outFile,
  });
}

/**
 * The Node-API directory ONNX Runtime actually ships, e.g. `bin/napi-v6`. DISCOVERED, never
 * spelled: this was pinned to `napi-v3` while the installed package had moved to `napi-v6`,
 * so the prune below excluded EVERY binding and the bundle carried the JS with no native
 * module at all. It fails at the first stem split, months later, saying "onnxruntime-node is
 * not installed — run `npm install` at the repo root", which means nothing on a user's machine.
 */
function ortNapiDir() {
  const bin = join(repo, "node_modules", "onnxruntime-node", "bin");
  if (!existsSync(bin)) return null;
  const dirs = readdirSync(bin).filter((n) => /^napi-v\d+$/.test(n));
  // Newest wins, matching what the package's own loader picks.
  dirs.sort((a, b) => Number(a.slice(7)) - Number(b.slice(7)));
  return dirs.at(-1) ?? null;
}

/** Everything under `bin/napi-v*` that is not this host's — see stageNodeModule's `prune`. */
export function pruneOtherPlatforms(rel) {
  const parts = rel.split(/[\\/]/);
  if (parts[0] !== "bin" || parts.length < 4) return false; // not deep enough to judge yet
  const napi = ortNapiDir();
  if (!napi) return false; // nothing to judge against; carry it all rather than carry nothing
  return !rel.startsWith(join("bin", napi, process.platform, process.arch));
}

/**
 * Everything the packaged app carries, in ONE FLAT directory. The layout is not a preference:
 * engine-host's bundle.ts derives its resource dir from `process.execPath`, which for the
 * supervisor is the VENDORED NODE — so node, the two .mjs bundles, songs, faust-libs and
 * node_modules must all be its siblings. Nest them and the installed app shows a working
 * engine with a permanently red icon and "file service down", with nothing in the log to say
 * why, while every developer machine works. See docs/buildEngine.md.
 */
export async function stageAll(destDir, engineBin) {
  mkdirSync(destDir, { recursive: true });

  const nodeBin = vendorNode();
  const exe = process.platform === "win32" ? ".exe" : "";
  for (const [src, name] of [
    [nodeBin, `node${exe}`],
    [engineBin, `studio-moteur${exe}`],
  ]) {
    const dest = join(destDir, name);
    copyFileSync(src, dest);
    chmodSync(dest, 0o755);
    console.log(`  ${name}: ${src}\n     → ${dest}`);
  }

  await bundleTs(
    join(repo, "packages", "file-service", "src", "server.ts"),
    join(destDir, "file-service.mjs"),
  );
  await bundleTs(
    join(repo, "packages", "engine-host", "src", "main.ts"),
    join(destDir, "engine-host.mjs"),
  );
  // The same supervisor with a terminal in front of it, for whoever wants only the engine.
  // Nearly free: the runtime, the engine binary, the demos and the Faust libs are all here.
  await bundleTs(
    join(repo, "packages", "engine-host", "src", "cli.ts"),
    join(destDir, "engine-cli.mjs"),
  );

  stageDemos(join(destDir, "songs"));
  stageFaustLibs(join(destDir, "faust-libs"));
  stageNodeModule(
    "onnxruntime-node",
    join(destDir, "node_modules"),
    pruneOtherPlatforms,
  );
  stageNodeModule("onnxruntime-common", join(destDir, "node_modules"));
}
