#!/usr/bin/env node
// build-engine.mjs — `npm run engine:build`: builds the C++ engine and the native supervisor, then stages the
// command-line engine into dist/st0-engine/ — the two binaries side by side, what they load, an example config.
// The desktop app is packaged from these builds by apps/st0-standalone, not here. See docs/buildEngine.md.

import { copyFileSync, existsSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { stageEngine } from "@studio/supervisor-host/stageEngine";
import { distDir, run } from "./buildTools.mjs";
import { buildSupervisor } from "./supervisorBuild.mjs";

const repo = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const engineDir = join(repo, "engine", "st0-engine");

// The CMake preset for this host, overridable because CI names its own (docs/desktop-release.md).
const PRESET =
  process.env.STUDIO_ENGINE_PRESET ||
  ({ darwin: "macos-clang", win32: "windows-msvc" }[process.platform] ??
    "release-gcc");

console.log(`\n=== engine (${PRESET}) ===`);
run("node", [join("scripts", "build.mjs"), PRESET], engineDir);
console.log("\n=== supervisor ===");
buildSupervisor(repo);

console.log("\n=== command-line engine ===");
const out = join(distDir(repo), "st0-engine");
rmSync(out, { recursive: true, force: true });
stageEngine({ repo, bin: out });
const example = join(repo, "engine", "st0-supervisor", "engine.example.json");
if (existsSync(example)) copyFileSync(example, join(out, "engine.json"));
console.log(`\n✔ staged in ${out}`);
console.log(
  `   run: ${join(out, "st0-supervisor")} --config ${join(out, "engine.json")}`,
);
