#!/usr/bin/env node
// package-release.mjs — turn engine/st0-tray/out/ into ONE archive for the platform that
// produced it. Runs after `npm run engine:build`; the release workflow is its other caller.
// The archive is named for a STAMP, not for tauri.conf.json's version: that version has not
// moved in the life of the app, so two builds would otherwise overwrite each other.
// See docs/desktop-release.md.

import { spawnSync } from "node:child_process";
import {
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

const here = dirname(fileURLToPath(import.meta.url)); // engine/st0-tray/scripts
const trayDir = dirname(here);
const OUT = join(trayDir, "out");
const DIST = join(OUT, "dist");

function fail(message) {
  console.error(`error: ${message}`);
  process.exit(1);
}

function run(cmd, args, cwd) {
  console.log(`\n▸ ${cmd} ${args.join(" ")}\n  in ${cwd}`);
  const r = spawnSync(cmd, args, { cwd, stdio: "inherit" });
  if (r.error?.code === "ENOENT") fail(`'${cmd}' not found on PATH.`);
  if (r.status !== 0) fail(`${cmd} failed (exit ${r.status}).`);
}

const argIndex = process.argv.indexOf("--stamp");
const conf = JSON.parse(
  readFileSync(join(trayDir, "src-tauri", "tauri.conf.json"), "utf8"),
);
const stamp = (
  (argIndex > 0 ? process.argv[argIndex + 1] : undefined) ??
  process.env.STUDIO_RELEASE_STAMP ??
  conf.version
).replace(/[^A-Za-z0-9._-]/g, "-");

const platform = { win32: "windows", darwin: "macos", linux: "linux" }[
  process.platform
];
if (!platform) fail(`no desktop archive for ${process.platform}.`);
const arch = process.arch === "arm64" ? "arm64" : "x64";
const name = `st0-desktop_${stamp}_${platform}-${arch}`;

if (!existsSync(OUT)) fail(`nothing at ${OUT} — run \`npm run engine:build\` first.`);
// out/dev is the throwaway app of the dev loop and never ships; out/dist is our own output.
const entries = readdirSync(OUT).filter((n) => n !== "dev" && n !== "dist");
// The .app travels INSIDE the .dmg, so shipping both doubles the archive for nothing.
const hasDmg = entries.some((n) => n.endsWith(".dmg"));
const keep = entries.filter((n) => !(hasDmg && n.endsWith(".app")));
if (!keep.length) fail(`${OUT} holds no artifact — check the build output.`);

const staging = join(DIST, name);
rmSync(staging, { recursive: true, force: true });
mkdirSync(staging, { recursive: true });
// verbatimSymlinks: an unpackaged .app carries symlinks that must not become copies.
for (const entry of keep)
  cpSync(join(OUT, entry), join(staging, entry), {
    recursive: true,
    verbatimSymlinks: true,
  });

// tar.gz on Linux because a .deb and an .AppImage are only useful with their executable bit.
const zipped = process.platform !== "linux";
const archive = `${name}.${zipped ? "zip" : "tar.gz"}`;
rmSync(join(DIST, archive), { force: true });

if (process.platform === "win32")
  // System32's bsdtar BY PATH: it writes .zip from the extension, and a bare `tar` may be GNU tar.
  run(
    join(process.env.SystemRoot ?? "C:\\Windows", "System32", "tar.exe"),
    ["-a", "-c", "-f", archive, name],
    DIST,
  );
else if (process.platform === "darwin")
  // -y keeps symlinks as symlinks, which a .app that failed to become a .dmg still needs.
  run("zip", ["-r", "-y", "-q", archive, name], DIST);
else run("tar", ["-czf", archive, name], DIST);

rmSync(staging, { recursive: true, force: true });
const size = statSync(join(DIST, archive)).size;
console.log(`\n✔ ${join(DIST, archive)}  (${(size / 1e6).toFixed(1)} MB)`);
for (const entry of keep) console.log(`   • ${entry}`);
