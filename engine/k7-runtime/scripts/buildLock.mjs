// buildLock.mjs — ONE build per build folder at a time, and a compiler cap, for every script that runs
// `cmake --build`: build.mjs, and run-tests.mjs, which builds the test targets in the same folder the dev
// watcher builds the engine in. Ninja keeps no lock, so two builds there corrupt `.ninja_deps` and every
// later build recompiles everything — and enough compilers at once freeze the machine. See docs/build.md.

import {
  closeSync,
  mkdirSync,
  openSync,
  readFileSync,
  rmSync,
  writeSync,
} from "node:fs";
import { availableParallelism } from "node:os";
import { join } from "node:path";

/** Is the process holding the lock still there? A crash or a kill leaves its lock behind. */
function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e.code === "EPERM"; // it exists, it is merely not ours to signal
  }
}

/** Take `buildDir`'s lock, waiting for a running build rather than racing it; released on any exit. */
export function takeBuildLock(buildDir, who) {
  const lockPath = join(buildDir, ".build.lock");
  mkdirSync(buildDir, { recursive: true });
  let told = false;
  for (;;) {
    try {
      const fd = openSync(lockPath, "wx");
      writeSync(fd, String(process.pid));
      closeSync(fd);
      break;
    } catch (e) {
      if (e.code !== "EEXIST") throw e;
    }
    const holder = Number(readFileSync(lockPath, "utf8")) || 0;
    if (!holder || !alive(holder)) {
      rmSync(lockPath, { force: true }); // a stale lock: its build is gone
      continue;
    }
    if (!told) console.log(`${who}: ${buildDir} is being built by pid ${holder} — waiting for it`);
    told = true;
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1000);
  }
  const unlock = () => rmSync(lockPath, { force: true });
  process.on("exit", unlock);
  for (const sig of ["SIGINT", "SIGTERM"])
    process.on(sig, () => {
      unlock();
      process.exit(130);
    });
  return unlock;
}

/**
 * The environment a build runs in: ninja's default is cores+2 jobs, and a JUCE or Tracktion unity file
 * takes a gigabyte each, so two cores are left to the machine. NOT under the Visual Studio generator,
 * where this becomes MSBuild's /m on top of /MP — the 144-compiler case AGENTS.md warns about.
 */
export function cappedBuildEnv() {
  const env = { ...process.env };
  if (process.platform !== "win32" && !env.CMAKE_BUILD_PARALLEL_LEVEL)
    env.CMAKE_BUILD_PARALLEL_LEVEL = String(Math.max(1, availableParallelism() - 2));
  return env;
}
