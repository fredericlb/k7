#!/usr/bin/env node
// build-engine.mjs — `npm run engine:build`: builds the C++ engine and the tray app and
// collects both into the repo's dist/. The engine is staged as the tray's sidecar first,
// so the bundle carries its own copy and needs no repo build dir. See docs/buildEngine.md.

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
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, extname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildNumber,
  distDir,
  hostTriple,
  run,
  tauriCmd,
  WORK_DIRS,
} from "./buildTools.mjs";

const here = dirname(fileURLToPath(import.meta.url)); // engine/st0-tray/scripts
const trayDir = dirname(here); //                      engine/st0-tray — this app IS the tray
const repo = join(trayDir, "..", ".."); //             the monorepo root
const engineDir = join(repo, "engine", "st0-engine");
const OUT = distDir(repo); //                          <repo>/dist — the monorepo's output root
const CACHE = join(trayDir, ".cache"); // vendored downloads (gitignored)

// The Node we vendor: pinned and downloaded, a Homebrew one being a shim (docs/buildEngine.md).
const NODE_VERSION = "v22.23.1";

// The CMake preset for this host, overridable because a CI runner carries an older toolchain (docs/desktop-release.md).
const PRESET =
  process.env.STUDIO_ENGINE_PRESET ||
  ({ darwin: "macos-clang", win32: "windows-msvc" }[process.platform] ??
    "release-gcc");

// The freshest built engine binary, Debug last — see @studio/engine-client's engineBinary.ts.
function findEngineBinary() {
  const build = join(engineDir, "build");
  if (!existsSync(build)) return null;
  const names = ["st0-engine.exe", "st0-engine"];
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

const BUILD_NUMBER = buildNumber();

// `--sidecar-only`: stage the sidecars without building — see docs/buildEngine.md.
const sidecarOnly = process.argv.includes("--sidecar-only");

// `--dev`: a DEBUG tray app carrying nothing, so the Rust takes its fallbacks (docs/buildEngine.md).
const devMode = process.argv.includes("--dev");

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

/** The Faust standard libraries out of the engine's build tree, newest preset winning (docs/buildEngine.md). */
function stageFaustLibs(destDir) {
  const build = join(engineDir, "build");
  const found = existsSync(build)
    ? readdirSync(build)
        .map((preset) => join(build, preset, "_deps", "faust-src", "libraries"))
        .filter((p) => existsSync(join(p, "stdfaust.lib")))
    : [];
  if (!found.length) {
    console.error(
      "error: no Faust libraries found under engine/st0-engine/build/*/_deps/faust-src/libraries.\n" +
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

/** One installed package into `resources/node_modules/`, for what a bundle cannot inline (docs/buildEngine.md). */
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

// The platform tree ONNX Runtime will actually load, e.g. `bin/napi-v3/win32/x64`.
const ORT_KEEP = join("bin", "napi-v3", process.platform, process.arch);

/** Everything under `bin/napi-v3/` that is not this host's — see stageNodeModule's `prune`. */
function pruneOtherPlatforms(rel) {
  const parts = rel.split(/[\\/]/);
  if (parts[0] !== "bin" || parts.length < 4) return false; // not deep enough to judge yet
  return !rel.startsWith(ORT_KEEP);
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
    // Native modules, external for OPPOSITE reasons — only one of the two is also staged (docs/buildEngine.md).
    external: ["fsevents", "onnxruntime-node"],
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

// Build the .dmg ourselves: Tauri's target drives an `hdiutil convert` that fails here (docs/buildEngine.md).
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

// A debug tray app carrying NOTHING, so the Rust takes its dev fallbacks (docs/buildEngine.md).
function buildDevApp() {
  const OUT_DEV = join(OUT, "dev");
  console.log("\n=== tray (debug, no vendored payload) ===");
  const tauri = tauriCmd(trayDir);
  // --config takes a file PATH, not inline JSON: cmd.exe strips the quotes and Tauri chokes. A file is quoting-proof.
  const cfgPath = join(tmpdir(), "studio-tray-dev-config.json");
  writeFileSync(
    cfgPath,
    JSON.stringify({
      bundle: { externalBin: [], resources: [], targets: ["app"] },
    }),
  );
  // Only macOS has an "app" bundle format, so elsewhere the debug executable IS the dev artifact.
  const bundled = process.platform === "darwin";
  const status = run(
    tauri.cmd,
    [
      ...tauri.args,
      "build",
      "--debug",
      ...(bundled ? [] : ["--no-bundle"]),
      "--config",
      cfgPath,
    ],
    trayDir,
    { CI: "true", STUDIO_BUILD: BUILD_NUMBER },
    { allowFail: true },
  );
  rmSync(OUT_DEV, { recursive: true, force: true });
  mkdirSync(OUT_DEV, { recursive: true });
  const debugDir = join(trayDir, "src-tauri", "target", "debug");
  let got;
  if (bundled) {
    got = collectBundles(join(debugDir, "bundle"), OUT_DEV);
  } else {
    got = [];
    const name = process.platform === "win32" ? "st0-tray.exe" : "st0-tray";
    const exe = join(debugDir, name);
    if (existsSync(exe)) {
      cpSync(exe, join(OUT_DEV, name));
      chmodSync(join(OUT_DEV, name), 0o755);
      got.push(name);
    }
  }
  if (!got.length) {
    console.error("error: no dev app produced — check the build output above.");
    process.exit(status || 1);
  }
  console.log(`\n✔ dev app in ${OUT_DEV}`);
  for (const n of got) console.log(`   • ${n}`);
  console.log(
    "\n  It uses the REPO's engine (engine/st0-engine/build) and runs the file service from\n" +
      "  source via tsx — edit either and just restart the app. Not distributable.",
  );
  process.exit(status);
}

// ── 1. the C++ engine ──────────────────────────────────────────────────────────

// Delegated to the moteur's own build.mjs, and never run in dev (docs/buildEngine.md).
if (!sidecarOnly && !devMode) {
  console.log(`\n=== engine (${PRESET}) ===`);
  run("node", [join("scripts", "build.mjs"), PRESET], engineDir);
}

const engineBin = findEngineBinary();
if (!engineBin && !devMode) {
  console.error(
    sidecarOnly
      ? "error: no engine binary under engine/st0-engine/build — build it first (npm run engine:build)."
      : "error: the engine built but no binary was found under engine/st0-engine/build.",
  );
  process.exit(1);
}

// ── 2. stage what the app will carry (release only) ────────────────────────────

// Tauri copies externalBin beside the tray executable, which is what makes the .app self-contained.
if (devMode) {
  if (!engineBin)
    console.warn(
      "warning: no engine binary under engine/st0-engine/build — the dev app will have nothing to\n" +
        "  run until you build one (npm run build:mac --workspace st0-engine).",
    );
  buildDevApp();
  // buildDevApp() exits.
}

const triple = hostTriple();
const sidecarDir = join(trayDir, "src-tauri", "binaries");
mkdirSync(sidecarDir, { recursive: true });

// Everything the app must carry to run without the repo: the engine, and a self-contained node.
const stage = (src, name) => {
  // Tauri resolves externalBin as `<name>-<triple>` PLUS the platform's executable extension (.exe on Windows).
  const ext = process.platform === "win32" ? ".exe" : "";
  const dest = join(sidecarDir, `${name}-${triple}${ext}`);
  cpSync(src, dest);
  chmodSync(dest, 0o755); // must stay executable inside the bundle
  console.log(`  ${name}: ${src}\n     → ${dest}`);
};

console.log("\n=== sidecars ===");
stage(engineBin, "st0-engine");
stage(vendorNode(), "node");

// The one Node process the app ships — the supervisor; the file service runs on the server, not here.
console.log("\n=== supervisor bundle ===");
await bundleTs(
  join(repo, "packages", "engine-host", "src", "main.ts"),
  join(trayDir, "src-tauri", "resources", "engine-host.mjs"),
);

// …and the one dependency neither bundle could swallow, plus what IT requires (docs/buildEngine.md).
console.log("\n=== native node modules ===");
const resourceModules = join(trayDir, "src-tauri", "resources", "node_modules");
mkdirSync(resourceModules, { recursive: true });
stageNodeModule("onnxruntime-node", resourceModules, pruneOtherPlatforms);
stageNodeModule("onnxruntime-common", resourceModules);
// OPTIONAL, as the package is: without it the supervisor declines WebRTC and the relay remains.
if (existsSync(join(repo, "node_modules", "node-datachannel"))) {
  stageNodeModule("node-datachannel", resourceModules);
  const platformPkg = `@node-datachannel/${process.platform}-${process.arch}${process.platform === "win32" ? "-msvc" : process.platform === "linux" ? "-gnu" : ""}`;
  if (existsSync(join(repo, "node_modules", platformPkg)))
    stageNodeModule(platformPkg, resourceModules);
} else
  console.warn(
    "  node-datachannel not installed — the packaged supervisor will offer no WebRTC path",
  );

// The Faust standard libraries, which the engine resolves at RUNTIME — fatal when missing (docs/buildEngine.md).
console.log("\n=== faust libraries ===");
stageFaustLibs(join(trayDir, "src-tauri", "resources", "faust-libs"));

if (sidecarOnly) {
  console.log(
    "\n✔ sidecars staged — cargo/tauri commands on the tray will build now.",
  );
  process.exit(0);
}

// ── 3. the tray app ────────────────────────────────────────────────────────────
console.log("\n=== tray (tauri release bundle) ===");
const tauri = tauriCmd(trayDir);
// CI=true skips bundle_dmg.sh's Finder styling, and a dmg failure is non-fatal (docs/buildEngine.md).
const trayArgs = [...tauri.args, "build"];
// tauri.conf.json asks for "app", which is the macOS wrapper — the other two name their own.
const releaseTargets = { win32: ["nsis"], linux: ["deb", "appimage"] }[
  process.platform
];
if (releaseTargets) {
  const relCfg = join(tmpdir(), "studio-tray-release-config.json");
  writeFileSync(
    relCfg,
    JSON.stringify({ bundle: { targets: releaseTargets } }),
  );
  trayArgs.push("--config", relCfg);
}
const trayStatus = run(
  tauri.cmd,
  trayArgs,
  trayDir,
  { CI: "true", STUDIO_BUILD: BUILD_NUMBER },
  {
    allowFail: true,
  },
);

// ── 4. collect into dist/ ──────────────────────────────────────────────────────
console.log("\n=== collecting into dist/ ===");
// Fresh each build, but the working dirs stay — a release shouldn't delete the dev app you're iterating with.
if (existsSync(OUT))
  for (const entry of readdirSync(OUT))
    if (!WORK_DIRS.includes(entry))
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
    console.warn("warning: dmg creation failed (the .app is still in dist/).");
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
