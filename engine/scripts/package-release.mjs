#!/usr/bin/env node
// package-release.mjs — one release file per kind, for the platform that produced it, into dist/release/:
// `engine` archives dist/k7-runtime/ (build-engine.mjs); `tray` renames the installers apps/k7-tray built and writes
// its updater fragment (trayRelease.mjs).
// Named for a STAMP, not a package version, which does not move with each build. See docs/release.md.

import { existsSync, mkdirSync, rmSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { distDir, run } from "./buildTools.mjs";
import { packageTray } from "./trayRelease.mjs";

const repo = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const RELEASE = join(distDir(repo), "release");

function fail(message) {
  console.error(`error: ${message}`);
  process.exit(1);
}

function arg(name) {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : undefined;
}

const kind = arg("--kind");
if (kind !== "engine" && kind !== "tray")
  fail("usage: package-release.mjs --kind engine|tray [--stamp <stamp>]");
const stamp = (
  arg("--stamp") ??
  process.env.STUDIO_RELEASE_STAMP ??
  "dev"
).replace(/[^A-Za-z0-9._-]/g, "-");
const platform = { win32: "windows", darwin: "macos", linux: "linux" }[
  process.platform
];
if (!platform) fail(`no release for ${process.platform}.`);
const arch = process.arch === "arm64" ? "arm64" : "x64";
mkdirSync(RELEASE, { recursive: true });

if (kind === "engine") {
  const staged = join(distDir(repo), "k7-runtime");
  if (!existsSync(staged))
    fail(`${staged} is missing — run engine/scripts/build-engine.mjs first.`);
  const name = `k7-runtime_${stamp}_${platform}-${arch}`;
  // tar.gz outside Windows: the binaries are only useful with their executable bit.
  const archive = `${name}.${platform === "windows" ? "zip" : "tar.gz"}`;
  rmSync(join(RELEASE, archive), { force: true });
  const parent = distDir(repo);
  if (platform === "windows")
    // System32's bsdtar BY PATH: it writes .zip from the extension, and a bare `tar` may be GNU tar.
    run(
      join(process.env.SystemRoot ?? "C:\\Windows", "System32", "tar.exe"),
      ["-a", "-c", "-f", join(RELEASE, archive), "k7-runtime"],
      parent,
    );
  else run("tar", ["-czf", join(RELEASE, archive), "k7-runtime"], parent);
  console.log(
    `\n✔ ${join(RELEASE, archive)}  (${(statSync(join(RELEASE, archive)).size / 1e6).toFixed(1)} MB)`,
  );
} else {
  packageTray({
    bundle: join(
      repo,
      "apps",
      "k7-tray",
      "src-tauri",
      "target",
      "release",
      "bundle",
    ),
    release: RELEASE,
    stamp,
    platform,
    arch,
  });
}
