#!/usr/bin/env node
// build.mjs — configure only when there is no cache, then build, ONE build per build folder at a time
// and with a compiler cap. A warm `cmake --preset` costs a minute and changes nothing: the generated
// build system re-configures itself when a CMakeLists changes. Two builds in one folder are the trap:
// ninja keeps no lock, so they corrupt `.ninja_deps` and every later build recompiles all ~540 objects.
// See docs/build.md.

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { cappedBuildEnv, takeBuildLock } from "./buildLock.mjs";

const moteur = dirname(dirname(fileURLToPath(import.meta.url)));
const preset = process.argv[2];
if (!preset) {
  console.error("usage: build.mjs <preset>   e.g. windows-msvc, macos-clang, android-arm64");
  process.exit(1);
}
const buildDir = join(moteur, "build", preset);
const env = cappedBuildEnv();

function cmake(args) {
  const r = spawnSync("cmake", args, {
    cwd: moteur,
    stdio: "inherit",
    env,
    // cmake is a .cmd shim on Windows, which spawn will not run without a shell.
    shell: process.platform === "win32",
  });
  if (r.status !== 0) process.exit(r.status ?? 1); // the lock goes with the exit
}

takeBuildLock(buildDir, "build.mjs");

if (!existsSync(join(buildDir, "CMakeCache.txt"))) cmake(["--preset", preset]);
cmake(["--build", "--preset", preset]);
