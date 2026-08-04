#!/usr/bin/env node
// dev.mjs — `npm run dev`: the whole studio in ONE turbo run, so the session is the same
// TUI as every other `dev` here — tasks left, logs right. All this adds is the filter
// list, DERIVED from the workspace so a new app joins by existing, the browser editor
// (a root task, which needs naming explicitly), and the backstop that stops the detached
// tray on the way out. See docs/dev.md.

import { spawn } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { stopAll } from "../engine/capot/scripts/trayProcess.mjs";

const repo = join(dirname(fileURLToPath(import.meta.url)), "..");

const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);

/** Every workspace package, resolved from the root globs — all either literal or one `*` segment. */
function workspacePackages() {
  const root = JSON.parse(readFileSync(join(repo, "package.json"), "utf8"));
  const dirs = new Set();
  for (const glob of root.workspaces) {
    if (!glob.includes("*")) {
      dirs.add(join(repo, glob));
      continue;
    }
    const base = join(repo, glob.slice(0, glob.indexOf("*")));
    if (!existsSync(base)) continue;
    for (const entry of readdirSync(base, { withFileTypes: true }))
      if (entry.isDirectory()) dirs.add(join(base, entry.name));
  }
  return [...dirs].flatMap((dir) => {
    const file = join(dir, "package.json");
    if (!existsSync(file)) return [];
    const pkg = JSON.parse(readFileSync(file, "utf8"));
    return pkg.name && pkg.scripts?.dev
      ? [{ name: pkg.name, dev: pkg.scripts.dev }]
      : [];
  });
}

// `moteur`'s dev is the native monitor — the engine AND the tray, because one process must
// own both. `capot`'s is `tauri dev`, the tool for a human watching a terminal, which is the
// wrong one here and would fight the monitor for the same single-instance tray.
const isNative = (name) => name === "moteur";
// `apps/<x>` whose dev merely re-invokes turbo over its own children. Running both would
// start every server twice.
const isAggregator = (dev) => dev.trimStart().startsWith("turbo run");
// `tsc --noEmit --watch`: real feedback, but six more panes for something each app's own
// `npm run dev` still gives you. Opt in.
const isTypecheck = (dev) => /\btsc\b/.test(dev) && dev.includes("--watch");

const tasks = workspacePackages().filter(
  ({ name, dev }) =>
    name !== "capot" &&
    !isAggregator(dev) &&
    (flag("typecheck") || !isTypecheck(dev)) &&
    (!flag("no-native") || !isNative(name)),
);

// The browser editor is a ROOT task (`//#vscode`), and no package filter can reach the root
// — hence a second task name and `--filter=//`. Naming the root cannot recurse back into
// this file: the root's `dev` script is not a turbo task (there is no `//#dev`), so turbo
// runs only the tasks it has definitions for. Verified with `turbo run dev vscode --dry`.
const withEditor = !flag("no-vscode");
const turboArgs = [
  "run",
  "dev",
  ...(withEditor ? ["vscode"] : []),
  ...tasks.map((t) => `--filter=${t.name}`),
  ...(withEditor ? ["--filter=//"] : []),
];

// No --ui: turbo.json's `tui` is the point. stdio inherit hands it the real console.
const turbo = spawn("turbo", turboArgs, {
  cwd: repo,
  stdio: "inherit",
  shell: process.platform === "win32", // turbo is a .cmd shim here
});

let stopping = false;
async function shutdown(code = 0) {
  if (stopping) return;
  stopping = true;
  turbo.kill();
  // The tray is DETACHED, so it outlives whatever started it. The monitor stops it on its
  // own signal, but the TUI may terminate it too abruptly for that — and an orphaned
  // menu-bar icon with no session to explain it is the one leak worth being sure about.
  if (!flag("no-native"))
    try {
      await stopAll();
    } catch {}
  process.exit(code);
}
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => void shutdown());
turbo.on("exit", (code) => void shutdown(code ?? 0));
