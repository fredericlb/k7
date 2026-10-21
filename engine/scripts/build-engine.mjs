#!/usr/bin/env node
// build-engine.mjs — `npm run engine:build`: builds the C++ engine and the native supervisor, then stages the
// command-line engine into dist/k7-runtime/ — the two binaries side by side, what they load, an example config.
// The tray is packaged from these builds by apps/k7-tray, not here. See docs/buildEngine.md.

import { copyFileSync, existsSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { stageEngine } from "@studio/supervisor-host/stageEngine";
import { distDir, run } from "./buildTools.mjs";
import { buildSupervisor } from "./supervisorBuild.mjs";

const repo = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const engineDir = join(repo, "engine", "k7-runtime");

// The CMake preset for this host, overridable because CI names its own (docs/release.md).
const PRESET =
  process.env.STUDIO_ENGINE_PRESET ||
  ({ darwin: "macos-clang", win32: "windows-msvc" }[process.platform] ??
    "release-gcc");

console.log(`\n=== engine (${PRESET}) ===`);
run("node", [join("scripts", "build.mjs"), PRESET], engineDir);
console.log("\n=== supervisor ===");
buildSupervisor(repo);

console.log("\n=== command-line engine ===");
const out = join(distDir(repo), "k7-runtime");
rmSync(out, { recursive: true, force: true });
stageEngine({ repo, bin: out });
const example = join(repo, "engine", "k7-supervisor", "engine.example.json");
if (existsSync(example)) copyFileSync(example, join(out, "engine.json"));
console.log(`\n✔ staged in ${out}`);
console.log(
  `   run: ${join(out, "k7-supervisor")} --config ${join(out, "engine.json")}`,
);
