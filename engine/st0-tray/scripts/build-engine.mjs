#!/usr/bin/env node
// build-engine.mjs — `npm run engine:build`: builds the C++ engine, the native supervisor and the
// tray's installer, and collects them into the repo's dist/. See docs/buildEngine.md.

import { spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
} from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildNumber, distDir, run, WORK_DIRS } from "./buildTools.mjs";
import { buildSupervisor } from "./supervisorBuild.mjs";

const here = dirname(fileURLToPath(import.meta.url)); // engine/st0-tray/scripts
const trayDir = dirname(here); //                      engine/st0-tray — the app a release ships
const repo = join(trayDir, "..", ".."); //             the monorepo root
const engineDir = join(repo, "engine", "st0-engine");
const OUT = distDir(repo); //                          <repo>/dist — the monorepo's output root
const CACHE = join(trayDir, ".cache"); // the dmg's staging (gitignored)

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

// Build the .dmg ourselves: a bundler's dmg target drives an `hdiutil convert` that fails here (docs/buildEngine.md).
function makeDmg(appPath, destDir) {
  if (process.platform !== "darwin") return null;
  const conf = {
    productName: "st0-tray",
    version: JSON.parse(readFileSync(join(trayDir, "package.json"), "utf8"))
      .version,
  };
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

// ── 1. the C++ engine ──────────────────────────────────────────────────────────

// Delegated to the moteur's own build.mjs, and never run in dev (docs/buildEngine.md).
console.log(`\n=== engine (${PRESET}) ===`);
run("node", [join("scripts", "build.mjs"), PRESET], engineDir);
console.log("\n=== supervisor ===");
buildSupervisor(repo);

const engineBin = findEngineBinary();
if (!engineBin) {
  console.error(
    "error: the engine built but no binary was found under engine/st0-engine/build.",
  );
  process.exit(1);
}

// ── 3. the tray app ────────────────────────────────────────────────────────────
// The tray stages the builds itself (scripts/stage.mjs), the same way for a release and a dev package.
{
  console.log("\n=== tray (electron) ===");
  rmSync(join(trayDir, "out"), { recursive: true, force: true });
  // On macOS the .app only: makeDmg wraps it with the retried `hdiutil create` (docs/buildEngine.md).
  const trayStatus = run(
    "npm",
    [
      "run",
      "package",
      ...(process.platform === "darwin" ? ["--", "--mac", "dir"] : []),
    ],
    trayDir,
    { STUDIO_BUILD: BUILD_NUMBER },
    { allowFail: true },
  );

  // ── 4. collect into dist/ ────────────────────────────────────────────────────
  console.log("\n=== collecting into dist/ ===");
  // Fresh each build, but the working dirs stay — a release shouldn't delete the dev app you're iterating with.
  if (existsSync(OUT))
    for (const entry of readdirSync(OUT))
      if (!WORK_DIRS.includes(entry))
        rmSync(join(OUT, entry), { recursive: true, force: true });
  mkdirSync(OUT, { recursive: true });

  const collected = [];
  // The standalone engine, alongside the installers (each carries its own copy).
  cpSync(engineBin, join(OUT, basename(engineBin)));
  collected.push(basename(engineBin));

  const out = join(trayDir, "out");
  // electron-builder's top level holds the installers beside blockmaps, update manifests and its own debug file.
  for (const entry of existsSync(out) ? readdirSync(out) : [])
    if (/\.(exe|deb|appimage)$/i.test(entry)) {
      cpSync(join(out, entry), join(OUT, entry));
      collected.push(entry);
    }
  const macDir = existsSync(out)
    ? readdirSync(out).find((d) => d.startsWith("mac"))
    : undefined;
  const app =
    macDir && readdirSync(join(out, macDir)).find((n) => n.endsWith(".app"));
  if (app) {
    cpSync(join(out, macDir, app), join(OUT, app), {
      recursive: true,
      verbatimSymlinks: true,
    });
    collected.push(app);
    console.log("\n=== dmg ===");
    const dmg = makeDmg(join(OUT, app), OUT);
    if (dmg) collected.push(dmg);
    else
      console.warn(
        "warning: dmg creation failed (the .app is still in dist/).",
      );
  }

  console.log(`\n✔ built into ${OUT}`);
  for (const name of collected) console.log(`   • ${name}`);
  if (collected.length < 2) {
    console.error(
      "error: no tray installer was collected — check the build output above.",
    );
    process.exit(trayStatus || 1);
  }
  if (trayStatus !== 0) {
    console.error(
      "\nerror: the tray packaging failed (above) — collected what it did produce.",
    );
    process.exit(trayStatus);
  }
  process.exit(0);
}
