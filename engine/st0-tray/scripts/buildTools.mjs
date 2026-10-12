// buildTools.mjs — what the build scripts here all need: where output goes, spawning (with
// the Windows shell quirk), and the build stamp. Shared so build-engine.mjs,
// build-portable.mjs and package-release.mjs cannot drift on any of them.

import { spawnSync } from "node:child_process";
import { join } from "node:path";

// The one output root of the monorepo — deliverables at its top, nothing per-app about it.
export const distDir = (repo) => join(repo, "dist");

// Its subdirectories are working space, not deliverables: a release archive leaves them out.
export const WORK_DIRS = ["portable", "release"];

export function run(cmd, args, cwd, extraEnv, { allowFail = false } = {}) {
  console.log(`\n▸ ${cmd} ${args.join(" ")}\n  in ${cwd}`);
  const r = spawnSync(cmd, args, {
    cwd,
    stdio: "inherit",
    env: { ...process.env, ...extraEnv },
    // cmake and npm are resolved through the shell on Windows (.cmd shims).
    shell: process.platform === "win32",
  });
  if (r.error?.code === "ENOENT") {
    console.error(`\nerror: '${cmd}' not found on PATH.`);
    process.exit(1);
  }
  if (r.status !== 0) {
    console.error(`\nerror: ${cmd} ${args[0]} failed (exit ${r.status}).`);
    if (!allowFail) process.exit(r.status ?? 1);
  }
  return r.status ?? 0;
}

// The build number the tray displays, baked into its bundle by build-main.mjs — when it was BUILT, not run.
export function buildNumber() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}.${p(d.getHours())}${p(d.getMinutes())}`;
}
