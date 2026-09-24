// buildTools.mjs — what the build scripts here all need: where output goes, spawning (with
// the Windows shell quirk), locating the Tauri CLI, the Rust host triple, and the build
// stamp. Shared so build-engine.mjs, build-portable.mjs and package-release.mjs cannot
// drift on any of them.

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";

// The one output root of the monorepo — deliverables at its top, nothing per-app about it.
export const distDir = (repo) => join(repo, "dist");

// Its subdirectories are working space, not deliverables: a release archive leaves them out.
export const WORK_DIRS = ["dev", "portable", "release"];

export function run(cmd, args, cwd, extraEnv, { allowFail = false } = {}) {
  console.log(`\n▸ ${cmd} ${args.join(" ")}\n  in ${cwd}`);
  const r = spawnSync(cmd, args, {
    cwd,
    stdio: "inherit",
    env: { ...process.env, ...extraEnv },
    // cmake/tauri are resolved through the shell on Windows (.cmd shims).
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

// The workspace-hoisted Tauri CLI, else fall back to npx fetching it.
export function tauriCmd(startDir) {
  let dir = startDir;
  for (;;) {
    const bin = join(dir, "node_modules", ".bin", "tauri");
    if (existsSync(bin)) return { cmd: bin, args: [] };
    const up = dirname(dir);
    if (up === dir) break;
    dir = up;
  }
  return { cmd: "npx", args: ["--yes", "@tauri-apps/cli@2"] };
}

// This host's Rust target triple — Tauri sidecars are named `<name>-<triple>` and it strips the suffix.
export function hostTriple() {
  const r = spawnSync("rustc", ["-vV"], {
    encoding: "utf8",
    shell: process.platform === "win32",
  });
  const host = /^host:\s*(.+)$/m.exec(r.stdout ?? "")?.[1]?.trim();
  if (!host) {
    console.error(
      "error: could not determine the Rust host triple (is rustc on PATH?).",
    );
    process.exit(1);
  }
  return host;
}

// The build number the tray displays, stamped into the binary by build.rs — when it was BUILT, not run.
export function buildNumber() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}.${p(d.getHours())}${p(d.getMinutes())}`;
}
