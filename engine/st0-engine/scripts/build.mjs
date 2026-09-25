#!/usr/bin/env node
// build.mjs — configure only when there is no cache, then build. A warm `cmake --preset` costs
// about a minute here and changes nothing: the generated build system re-runs configure ITSELF
// when a CMakeLists changes — ZERO_CHECK under the Visual Studio generator, a regeneration rule
// in build.ninja under Ninja. The cache is the one thing an explicit configure buys.

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const moteur = dirname(dirname(fileURLToPath(import.meta.url)));
const preset = process.argv[2];
if (!preset) {
  console.error("usage: build.mjs <preset>   e.g. windows-msvc, macos-clang, android-arm64");
  process.exit(1);
}

function cmake(args) {
  const r = spawnSync("cmake", args, {
    cwd: moteur,
    stdio: "inherit",
    // cmake is a .cmd shim on Windows, which spawn will not run without a shell.
    shell: process.platform === "win32",
  });
  if (r.status !== 0) process.exit(r.status ?? 1);
}

if (!existsSync(join(moteur, "build", preset, "CMakeCache.txt")))
  cmake(["--preset", preset]);
cmake(["--build", "--preset", preset]);
