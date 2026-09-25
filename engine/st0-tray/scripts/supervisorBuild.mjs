// supervisorBuild.mjs — building and finding the native supervisor (engine/st0-supervisor), and the
// ONNX Runtime files its build leaves beside it. Shared by build-engine.mjs and the dev session, so
// "which binary is the supervisor" has one answer. See docs/buildEngine.md.

import { existsSync, readdirSync, statSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { run } from "./buildTools.mjs";

/** The supervisor's CMake preset for this host; `$STUDIO_SUPERVISOR_PRESET` for a runner's older toolchain. */
export function supervisorPreset() {
  return (
    process.env.STUDIO_SUPERVISOR_PRESET ||
    ({ darwin: "macos-clang", win32: "windows-msvc" }[process.platform] ??
      "dev-gcc")
  );
}

/** Configure (once) and build the supervisor with CMake; exits on failure, like every step here. */
export function buildSupervisor(repo) {
  const dir = join(repo, "engine", "st0-supervisor");
  const preset = supervisorPreset();
  if (!existsSync(join(dir, "build", preset, "CMakeCache.txt")))
    run("cmake", ["--preset", preset], dir);
  run("cmake", ["--build", "--preset", preset], dir);
}

/** The freshest built supervisor, Debug last — the rule the engine binary follows too. */
export function findSupervisor(repo) {
  const build = join(repo, "engine", "st0-supervisor", "build");
  if (!existsSync(build)) return null;
  const found = [];
  for (const preset of readdirSync(build))
    for (const cfg of ["", "Release", "RelWithDebInfo", "Debug"])
      for (const name of ["st0-supervisor.exe", "st0-supervisor"]) {
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

/** The ONNX Runtime files the build copied beside `bin` — what the packaged app must carry with it. */
export function onnxRuntimeFiles(bin) {
  const dir = dirname(bin);
  return readdirSync(dir)
    .filter((n) =>
      /^(libonnxruntime.*\.(dylib|so.*)|onnxruntime.*\.dll|DirectML\.dll)$/.test(
        n,
      ),
    )
    .map((n) => join(dir, n))
    .filter((p) => statSync(p).isFile() && !basename(p).endsWith(".dSYM"));
}
