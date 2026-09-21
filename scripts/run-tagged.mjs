#!/usr/bin/env node
// run-tagged.mjs — run a host command and leave its PID where the stopper can find it.
//
// The stopper otherwise kills by PORT, and that cannot see a task which is still STARTING: it
// holds no socket yet, survives the stop, binds the port a moment later and the replacement dies
// on EADDRINUSE. A PID is true from the task's first instant. See ../docs/wsl.md.

import { spawn } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { pidFileFor } from "./host-pid.mjs";

// A directory and then plain words: nested quotes do not survive node's argv escaping and
// cmd's own parser, and the command came out as a path that does not exist.
const [tag, cwd, ...words] = process.argv.slice(2);
const command = words.join(" ");
if (!tag || !cwd || !command) {
  console.error("usage: run-tagged <tag> <dir> <command…>");
  process.exit(2);
}

const file = pidFileFor(tag);
mkdirSync(dirname(file), { recursive: true });
// Written BEFORE the command starts: the whole point is to be findable during the boot.
writeFileSync(file, String(process.pid), "utf8");

const drop = () => {
  try {
    rmSync(file, { force: true });
  } catch {
    // The stopper removes it too; whoever is second finding it gone is the normal case.
  }
};

const child = spawn(command, { cwd, stdio: "inherit", shell: true });
child.on("exit", (code) => {
  drop();
  process.exit(code ?? 0);
});
for (const sig of ["SIGINT", "SIGTERM"])
  process.on(sig, () => {
    child.kill();
    drop();
  });
