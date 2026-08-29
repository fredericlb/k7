#!/usr/bin/env node
// make-dmg.mjs — a macOS dmg from an already-built .app, by hand:
//
//   node scripts/make-dmg.mjs out/mac-arm64/studio-capot.app
//
// A FALLBACK, not the normal path — electron-builder's `dmg` target is. It exists because
// that target drives `hdiutil` too, and hdiutil is intermittently flaky on this machine
// (errno 35 / EAGAIN, on an image of a few MB). If the packaged build fails there, set
// `mac.target: ["dir"]` and run this. Kept rather than deleted: the bug is still on the
// machine. See docs/buildEngine.md.

import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, rmSync, symlinkSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { CACHE, run, trayDir } from "./stage.mjs";

const appPath = resolve(process.argv[2] ?? "");
if (process.platform !== "darwin") {
  console.error("skip: a dmg is a macOS thing");
  process.exit(0);
}
if (!process.argv[2]) {
  console.error("usage: node scripts/make-dmg.mjs <path to .app>");
  process.exit(1);
}

const pkg = JSON.parse(
  await import("node:fs").then((fs) =>
    fs.readFileSync(join(trayDir, "package.json"), "utf8"),
  ),
);
const arch = process.arch === "arm64" ? "aarch64" : process.arch;
const name = `${pkg.name}_${pkg.version}_${arch}.dmg`;
const destDir = dirname(appPath);
const dmg = join(destDir, name);
const staging = join(CACHE, "dmg-staging");

rmSync(staging, { recursive: true, force: true });
mkdirSync(staging, { recursive: true });
cpSync(appPath, join(staging, basename(appPath)), { recursive: true });
symlinkSync("/Applications", join(staging, "Applications"));

rmSync(dmg, { force: true });
let status = 1;
for (let attempt = 1; attempt <= 4 && status !== 0; attempt++) {
  if (attempt > 1) {
    // EAGAIN means try again LATER — an instant retry just fails again (seen: three in a
    // row, then success). So the pause grows.
    const pause = 3 * (attempt - 1);
    console.log(`  hdiutil failed — waiting ${pause}s, retry ${attempt}/4`);
    spawnSync("sleep", [String(pause)]);
  }
  status = run(
    "hdiutil",
    [
      "create",
      "-volname",
      pkg.name,
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

if (status !== 0) {
  console.error("error: hdiutil failed four times — the .app is still in out/");
  process.exit(1);
}
console.log(`  → ${dmg}`);
