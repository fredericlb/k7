// supervisorBuild.mjs — building and finding the native supervisor (engine/k7-supervisor).
// Shared by build-engine.mjs and the dev session, so "which binary is the supervisor" has one answer. See docs/buildEngine.md.

import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { run } from "./buildTools.mjs";

/** The supervisor's CMake preset for this host; `$STUDIO_SUPERVISOR_PRESET` for a runner's older toolchain. */
function supervisorPreset() {
  return (
    process.env.STUDIO_SUPERVISOR_PRESET ||
    ({ darwin: "macos-clang", win32: "windows-msvc" }[process.platform] ??
      "dev-gcc")
  );
}

/** Configure (once) and build the supervisor with CMake; exits on failure, like every step here. */
export function buildSupervisor(repo) {
  const dir = join(repo, "engine", "k7-supervisor");
  const preset = supervisorPreset();
  if (!existsSync(join(dir, "build", preset, "CMakeCache.txt")))
    run("cmake", ["--preset", preset], dir);
  run("cmake", ["--build", "--preset", preset], dir);
}

/** The freshest built supervisor, Debug last — the rule the engine binary follows too. */
export function findSupervisor(repo) {
  const build = join(repo, "engine", "k7-supervisor", "build");
  if (!existsSync(build)) return null;
  const found = [];
  for (const preset of readdirSync(build))
    for (const cfg of ["", "Release", "RelWithDebInfo", "Debug"])
      for (const name of ["k7-supervisor.exe", "k7-supervisor"]) {
        const p = join(build, preset, cfg, name);
        if (existsSync(p) && statSync(p).isFile())
          found.push({ path: p, debug: cfg === "Debug" });
      }
  found.sort(
    (a, b) =>
      Number(a.debug) - Number(b.debug) ||
      statSync(b.path).mtimeMs - statSync(a.path).mtimeMs,
  );
  return found[0]?.path ?? null;
}
