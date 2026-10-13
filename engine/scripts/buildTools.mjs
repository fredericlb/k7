// buildTools.mjs — what the engine's build scripts share: where output goes, and spawning with the Windows
// shell quirk. Shared so build-engine.mjs and package-release.mjs cannot drift on either.

import { spawnSync } from "node:child_process";
import { join } from "node:path";

// The one output root of the monorepo — deliverables at its top, nothing per-app about it.
export const distDir = (repo) => join(repo, "dist");

export function run(cmd, args, cwd, extraEnv) {
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
    process.exit(r.status ?? 1);
  }
}
