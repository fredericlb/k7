#!/usr/bin/env node
// package-release.mjs — one release file per kind, for the platform that produced it, into dist/release/:
// `engine` archives dist/st0-engine/ (build-engine.mjs), `desktop` renames the installer apps/st0-standalone built.
// Named for a STAMP, not a package version, which does not move with each build. See docs/desktop-release.md.

import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  rmSync,
  statSync,
} from "node:fs";
import { dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { distDir, run } from "./buildTools.mjs";

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
if (kind !== "engine" && kind !== "desktop")
  fail("usage: package-release.mjs --kind engine|desktop [--stamp <stamp>]");
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
  const staged = join(distDir(repo), "st0-engine");
  if (!existsSync(staged))
    fail(`${staged} is missing — run engine/scripts/build-engine.mjs first.`);
  const name = `st0-engine_${stamp}_${platform}-${arch}`;
  // tar.gz outside Windows: the binaries are only useful with their executable bit.
  const archive = `${name}.${platform === "windows" ? "zip" : "tar.gz"}`;
  rmSync(join(RELEASE, archive), { force: true });
  const parent = distDir(repo);
  if (platform === "windows")
    // System32's bsdtar BY PATH: it writes .zip from the extension, and a bare `tar` may be GNU tar.
    run(
      join(process.env.SystemRoot ?? "C:\\Windows", "System32", "tar.exe"),
      ["-a", "-c", "-f", join(RELEASE, archive), "st0-engine"],
      parent,
    );
  else run("tar", ["-czf", join(RELEASE, archive), "st0-engine"], parent);
  console.log(
    `\n✔ ${join(RELEASE, archive)}  (${(statSync(join(RELEASE, archive)).size / 1e6).toFixed(1)} MB)`,
  );
} else {
  const out = join(repo, "apps", "st0-standalone", "out");
  // electron-builder's top level holds the installers beside blockmaps, update manifests and its own debug file.
  const installers = existsSync(out)
    ? readdirSync(out).filter((f) => /\.(dmg|exe|appimage)$/i.test(f))
    : [];
  if (!installers.length)
    fail(
      `no installer in ${out} — run \`npm run package --workspace st0-standalone\` first.`,
    );
  for (const f of installers) {
    const name = `st0_${stamp}_${platform}-${arch}${extname(f)}`;
    copyFileSync(join(out, f), join(RELEASE, name));
    console.log(`✔ ${join(RELEASE, name)}`);
  }
}
