#!/usr/bin/env node
// build.mjs — configure only when there is no cache, then build, ONE build per build folder at a time
// and with a compiler cap. A warm `cmake --preset` costs a minute and changes nothing: the generated
// build system re-configures itself when a CMakeLists changes. Two builds in one folder are the trap:
// ninja keeps no lock, so they corrupt `.ninja_deps` and every later build recompiles all ~540 objects.
// See docs/build.md.

import { spawnSync } from "node:child_process";
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  rmSync,
  writeSync,
} from "node:fs";
import { availableParallelism } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const moteur = dirname(dirname(fileURLToPath(import.meta.url)));
const preset = process.argv[2];
if (!preset) {
  console.error("usage: build.mjs <preset>   e.g. windows-msvc, macos-clang, android-arm64");
  process.exit(1);
}
const buildDir = join(moteur, "build", preset);
const lockPath = join(buildDir, ".build.lock");

/** Is the process holding the lock still there? A crash or a kill leaves its lock behind. */
function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e.code === "EPERM"; // it exists, it is merely not ours to signal
  }
}

/** Take the folder's lock, waiting for a running build rather than racing it. */
function lock() {
  mkdirSync(buildDir, { recursive: true });
  let told = false;
  for (;;) {
    try {
      const fd = openSync(lockPath, "wx");
      writeSync(fd, String(process.pid));
      closeSync(fd);
      return;
    } catch (e) {
      if (e.code !== "EEXIST") throw e;
    }
    const holder = Number(readFileSync(lockPath, "utf8")) || 0;
    if (!holder || !alive(holder)) {
      rmSync(lockPath, { force: true }); // a stale lock: its build is gone
      continue;
    }
    if (!told) console.log(`build.mjs: ${preset} is being built by pid ${holder} — waiting for it`);
    told = true;
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1000);
  }
}
const unlock = () => rmSync(lockPath, { force: true });

// Ninja runs cores+2 jobs by default, and a JUCE or Tracktion unity file takes a gigabyte each: leave
// the machine two cores. NOT under the Visual Studio generator, where this becomes MSBuild's /m on top
// of /MP — the 144-compiler case AGENTS.md warns about.
const env = { ...process.env };
if (process.platform !== "win32" && !env.CMAKE_BUILD_PARALLEL_LEVEL)
  env.CMAKE_BUILD_PARALLEL_LEVEL = String(Math.max(1, availableParallelism() - 2));

function cmake(args) {
  const r = spawnSync("cmake", args, {
    cwd: moteur,
    stdio: "inherit",
    env,
    // cmake is a .cmd shim on Windows, which spawn will not run without a shell.
    shell: process.platform === "win32",
  });
  if (r.status !== 0) {
    unlock();
    process.exit(r.status ?? 1);
  }
}

lock();
process.on("exit", unlock);
for (const sig of ["SIGINT", "SIGTERM"])
  process.on(sig, () => {
    unlock();
    process.exit(130);
  });

if (!existsSync(join(buildDir, "CMakeCache.txt"))) cmake(["--preset", preset]);
cmake(["--build", "--preset", preset]);
