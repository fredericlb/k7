#!/usr/bin/env node
// build-engine.mjs — `npm run engine:build`: builds the C++ engine and the tray app and
// collects both into out/. The engine is staged as the tray's sidecar first, so the
// bundle carries its own copy and needs no repo build dir. See docs/buildEngine.md.

import { spawnSync } from "node:child_process";
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, extname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url)); // apps/capot/scripts
const trayDir = dirname(here); //                      apps/capot — this app IS the tray
const repo = join(trayDir, "..", ".."); //             the monorepo root
const engineDir = join(repo, "apps", "moteur");
const OUT = join(trayDir, "out");
const CACHE = join(trayDir, ".cache"); // vendored downloads (gitignored)

// The Node we vendor into the app: pinned and downloaded, since a Homebrew node is a shim that breaks off
// this machine. Kept on the repo's Node 22 line (.nvmrc). See docs/buildEngine.md.
const NODE_VERSION = "v22.23.1";

// The CMake preset for this host. Linux has no packaged tray target yet, but the engine still builds.
const PRESET =
  { darwin: "macos-clang", win32: "windows-msvc" }[process.platform] ??
  "release-gcc";

function run(cmd, args, cwd, extraEnv, { allowFail = false } = {}) {
  console.log(`\n▸ ${cmd} ${args.join(" ")}\n  in ${cwd}`);
  const r = spawnSync(cmd, args, {
    cwd,
    stdio: "inherit",
    env: { ...process.env, ...extraEnv },
    // cmake/tauri are resolved through the shell on Windows (.cmd shims).
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

// The workspace-hoisted Tauri CLI, else fall back to npx fetching it.
function tauriCmd() {
  let dir = trayDir;
  for (;;) {
    const bin = join(dir, "node_modules", ".bin", "tauri");
    if (existsSync(bin)) return { cmd: bin, args: [] };
    const up = dirname(dir);
    if (up === dir) break;
    dir = up;
  }
  return { cmd: "npx", args: ["--yes", "@tauri-apps/cli@2"] };
}

// The freshest built engine binary (mirrors the CLI's findEngineBinary).
function findEngineBinary() {
  const build = join(engineDir, "build");
  if (!existsSync(build)) return null;
  const names = ["lanes-engine.exe", "lanes-engine"];
  const configs = ["", "Release", "RelWithDebInfo", "Debug"];
  const found = [];
  for (const preset of readdirSync(build))
    for (const cfg of configs)
      for (const name of names) {
        const p = join(build, preset, cfg, name);
        if (existsSync(p) && statSync(p).isFile()) found.push(p);
      }
  if (!found.length) return null;
  found.sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
  return found[0];
}

// The build number the tray displays, stamped into the binary by build.rs — when it was BUILT, not run.
function buildNumber() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}.${p(d.getHours())}${p(d.getMinutes())}`;
}
const BUILD_NUMBER = buildNumber();

// This host's Rust target triple — Tauri sidecars are named `<name>-<triple>` and it strips the suffix.
function hostTriple() {
  const r = spawnSync("rustc", ["-vV"], {
    encoding: "utf8",
    shell: process.platform === "win32",
  });
  const host = /^host:\s*(.+)$/m.exec(r.stdout ?? "")?.[1]?.trim();
  if (!host) {
    console.error(
      "error: could not determine the Rust host triple (is rustc on PATH?).",
    );
    process.exit(1);
  }
  return host;
}

// `--sidecar-only`: stage the sidecars without building. tauri_build validates externalBin, so a plain
// `cargo check` / `tauri dev` needs them present.
const sidecarOnly = process.argv.includes("--sidecar-only");

// `--dev`: a DEBUG tray app carrying nothing — the Rust falls back to the repo's engine build and to a
// separately-run, hot-reloading file service. See docs/buildEngine.md.
const devMode = process.argv.includes("--dev");

// Download (once, cached) an official self-contained Node and return its binary.
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

// Bundle the file service into one .mjs the vendored Node runs directly, and copy this app's songs/ into the
// app's resources (minus a checkout's per-machine junk), replaced wholesale so deleted demos don't linger.
function stageDemos(destDir) {
  const src = join(trayDir, "songs");
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
        !base.startsWith(".lanes-")
      );
    },
  });
  const names = readdirSync(destDir).filter((n) => !n.startsWith("."));
  console.log(`  ${names.length} demo(s): ${names.join(", ")}`);
}

// Bundle one TypeScript entry into a single .mjs the vendored `node` runs with no node_modules beside it.
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
    // fsevents is an optional native module chokidar falls back from; it can't be bundled and must not fail us.
    external: ["fsevents"],
    // ESM output has no `require`, but the CommonJS deps here call it — without this the bundle dies at runtime.
    banner: {
      js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);",
    },
    outfile: outFile,
  });
}

// Collect the real deliverables out of a Tauri bundle dir — it also holds tooling and huge scratch images.
const ARTIFACT_EXT = new Set([
  ".app",
  ".dmg",
  ".exe",
  ".msi",
  ".deb",
  ".rpm",
  ".appimage",
  ".zip",
]);
const isArtifact = (name) =>
  !name.startsWith("rw.") && ARTIFACT_EXT.has(extname(name).toLowerCase());

function collectBundles(bundleDir, dest) {
  const found = [];
  if (!existsSync(bundleDir)) {
    console.warn(`warning: no tauri bundle at ${bundleDir}`);
    return found;
  }
  for (const kind of readdirSync(bundleDir)) {
    const kindDir = join(bundleDir, kind);
    if (!statSync(kindDir).isDirectory()) continue;
    for (const entry of readdirSync(kindDir)) {
      if (!isArtifact(entry)) continue;
      cpSync(join(kindDir, entry), join(dest, entry), { recursive: true });
      found.push(entry);
    }
  }
  return found;
}

// Build the .dmg ourselves: Tauri's target drives `hdiutil convert`, which fails here with EAGAIN even on a
// trivial image. `hdiutil create -srcfolder` works, at the cost of the styled Finder window. See docs/buildEngine.md.
function makeDmg(appPath, destDir) {
  if (process.platform !== "darwin") return null;
  const conf = JSON.parse(
    readFileSync(join(trayDir, "src-tauri", "tauri.conf.json"), "utf8"),
  );
  const arch = process.arch === "arm64" ? "aarch64" : process.arch;
  const name = `${conf.productName}_${conf.version}_${arch}.dmg`;
  const dmg = join(destDir, name);
  const staging = join(CACHE, "dmg-staging");

  rmSync(staging, { recursive: true, force: true });
  mkdirSync(staging, { recursive: true });
  cpSync(appPath, join(staging, basename(appPath)), { recursive: true });
  symlinkSync("/Applications", join(staging, "Applications"));

  rmSync(dmg, { force: true });
  // hdiutil is intermittently flaky here, so retry rather than silently shipping without a dmg; `-ov` makes it safe.
  let status = 1;
  for (let attempt = 1; attempt <= 4 && status !== 0; attempt++) {
    if (attempt > 1) {
      // EAGAIN means try again LATER — an instant retry just fails again (seen: three in a row, then success).
      const pause = 3 * (attempt - 1);
      console.log(`  hdiutil failed — waiting ${pause}s, retry ${attempt}/4`);
      spawnSync("sleep", [String(pause)]);
    }
    status = run(
      "hdiutil",
      [
        "create",
        "-volname",
        conf.productName,
        "-srcfolder",
        staging,
        "-ov",
        "-format",
        "UDZO",
        dmg,
      ],
      destDir,
      undefined,
      { allowFail: true },
    );
  }
  rmSync(staging, { recursive: true, force: true });
  return status === 0 ? name : null;
}

// A debug tray app carrying NOTHING: emptying externalBin and resources makes the Rust take its dev fallbacks,
// so editing the engine or the file service needs no rebuild of this app.
function buildDevApp() {
  const OUT_DEV = join(OUT, "dev");
  console.log("\n=== tray (debug, no vendored payload) ===");
  const tauri = tauriCmd();
  // --config takes a file PATH, not inline JSON: cmd.exe strips the quotes and Tauri chokes. A file is quoting-proof.
  const cfgPath = join(tmpdir(), "lanes-tray-dev-config.json");
  writeFileSync(
    cfgPath,
    JSON.stringify({
      bundle: { externalBin: [], resources: [], targets: ["app"] },
    }),
  );
  // Windows has no "app" bundle format, so no bundle/ dir is produced — the debug exe IS the dev artifact.
  const win = process.platform === "win32";
  const status = run(
    tauri.cmd,
    [
      ...tauri.args,
      "build",
      "--debug",
      ...(win ? ["--no-bundle"] : []),
      "--config",
      cfgPath,
    ],
    trayDir,
    { CI: "true", LANES_BUILD: BUILD_NUMBER },
    { allowFail: true },
  );
  rmSync(OUT_DEV, { recursive: true, force: true });
  mkdirSync(OUT_DEV, { recursive: true });
  const debugDir = join(trayDir, "src-tauri", "target", "debug");
  let got;
  if (win) {
    got = [];
    const exe = join(debugDir, "engine-tray.exe");
    if (existsSync(exe)) {
      cpSync(exe, join(OUT_DEV, "engine-tray.exe"));
      got.push("engine-tray.exe");
    }
  } else {
    got = collectBundles(join(debugDir, "bundle"), OUT_DEV);
  }
  if (!got.length) {
    console.error("error: no dev app produced — check the build output above.");
    process.exit(status || 1);
  }
  console.log(`\n✔ dev app in ${OUT_DEV}`);
  for (const n of got) console.log(`   • ${n}`);
  console.log(
    "\n  It uses the REPO's engine (apps/moteur/build) and runs the file service from\n" +
      "  source via tsx — edit either and just restart the app. Not distributable.",
  );
  process.exit(status);
}

// ── 1. the C++ engine ──────────────────────────────────────────────────────────
// Dev mode never rebuilds it — it points at whatever is in apps/moteur/build, which is what makes the loop fast.
// Delegated to the moteur's own build:* npm scripts; Linux has no such script yet and keeps its preset here.
if (!sidecarOnly && !devMode) {
  const engineScript = {
    win32: "build:win",
    darwin: "build:mac",
  }[process.platform];
  if (engineScript) {
    console.log(`\n=== engine (npm run ${engineScript}) ===`);
    run("npm", ["run", engineScript], engineDir);
  } else {
    console.log(`\n=== engine (${PRESET}) ===`);
    run("cmake", ["--preset", PRESET], engineDir);
    run("cmake", ["--build", "--preset", PRESET], engineDir);
  }
}

const engineBin = findEngineBinary();
if (!engineBin && !devMode) {
  console.error(
    sidecarOnly
      ? "error: no engine binary under apps/moteur/build — build it first (npm run engine:build)."
      : "error: the engine built but no binary was found under apps/moteur/build.",
  );
  process.exit(1);
}

// ── 2. stage what the app will carry (release only) ────────────────────────────
// Tauri copies externalBin into the bundle beside the tray executable, which is what makes the .app
// self-contained — engine.rs prefers that copy over the dev repo build dir.
if (devMode) {
  if (!engineBin)
    console.warn(
      "warning: no engine binary under apps/moteur/build — the dev app will have nothing to\n" +
        "  run until you build one (npm run build:mac --workspace moteur).",
    );
  buildDevApp();
  // buildDevApp() exits.
}

const triple = hostTriple();
const sidecarDir = join(trayDir, "src-tauri", "binaries");
mkdirSync(sidecarDir, { recursive: true });

// Everything the app must carry to run without the repo or anything on PATH: the engine, and a self-contained
// node to run the bundled file service.
const stage = (src, name) => {
  // Tauri resolves externalBin as `<name>-<triple>` PLUS the platform's executable extension (.exe on Windows).
  const ext = process.platform === "win32" ? ".exe" : "";
  const dest = join(sidecarDir, `${name}-${triple}${ext}`);
  cpSync(src, dest);
  chmodSync(dest, 0o755); // must stay executable inside the bundle
  console.log(`  ${name}: ${src}\n     → ${dest}`);
};

console.log("\n=== sidecars ===");
stage(engineBin, "lanes-engine");
stage(vendorNode(), "node");

// The two Node processes the app ships, each bundled to a single .mjs. Built in --sidecar-only too, and must be:
// tauri.conf.json lists both as resources and Tauri ERRORS on a glob matching nothing.
console.log("\n=== file service bundle ===");
await bundleTs(
  join(repo, "apps", "lanes", "packages", "file-service", "src", "server.ts"),
  join(trayDir, "src-tauri", "resources", "file-service.mjs"),
);

console.log("\n=== supervisor bundle ===");
await bundleTs(
  join(repo, "apps", "lanes", "packages", "engine-host", "src", "main.ts"),
  join(trayDir, "src-tauri", "resources", "engine-host.mjs"),
);

// The demo songs. A new workspace is seeded from these, and an installed .app has no repo to copy them from.
console.log("\n=== demo songs ===");
stageDemos(join(trayDir, "src-tauri", "resources", "songs"));

if (sidecarOnly) {
  console.log(
    "\n✔ sidecars staged — cargo/tauri commands on the tray will build now.",
  );
  process.exit(0);
}

// ── 3. the tray app ────────────────────────────────────────────────────────────
console.log("\n=== tray (tauri release bundle) ===");
const tauri = tauriCmd();
// CI=true skips bundle_dmg.sh's Finder styling, which needs a GUI session. A dmg failure is deliberately
// non-fatal — the .app is built first and is still good — so we collect, then exit non-zero below.
const trayArgs = [...tauri.args, "build"];
if (process.platform === "win32") {
  const relCfg = join(tmpdir(), "lanes-tray-release-config.json");
  writeFileSync(relCfg, JSON.stringify({ bundle: { targets: ["nsis"] } }));
  trayArgs.push("--config", relCfg);
}
const trayStatus = run(
  tauri.cmd,
  trayArgs,
  trayDir,
  { CI: "true", LANES_BUILD: BUILD_NUMBER },
  {
    allowFail: true,
  },
);

// ── 4. collect into out/ ───────────────────────────────────────────────────────
console.log("\n=== collecting into out/ ===");
// Fresh each build, but leave out/dev alone — a release build shouldn't delete the dev app you're iterating with.
if (existsSync(OUT))
  for (const entry of readdirSync(OUT))
    if (entry !== "dev")
      rmSync(join(OUT, entry), { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

const collected = [];

// The standalone engine, alongside the bundles (the .app carries its own copy).
cpSync(engineBin, join(OUT, basename(engineBin)));
collected.push(basename(engineBin));

collected.push(
  ...collectBundles(
    join(trayDir, "src-tauri", "target", "release", "bundle"),
    OUT,
  ),
);

// Package the .app into a .dmg (our own hdiutil path — see makeDmg).
const app = collected.find((n) => n.endsWith(".app"));
if (app) {
  console.log("\n=== dmg ===");
  const dmg = makeDmg(join(OUT, app), OUT);
  if (dmg) collected.push(dmg);
  else
    console.warn("warning: dmg creation failed (the .app is still in out/).");
}

console.log(`\n✔ built into ${OUT}`);
for (const name of collected) console.log(`   • ${name}`);
if (!collected.length) {
  console.error("error: nothing was collected — check the build output above.");
  process.exit(1);
}
if (trayStatus !== 0) {
  console.error(
    "\nerror: the tray bundler failed (above) — collected what it did produce.",
  );
  process.exit(trayStatus);
}
