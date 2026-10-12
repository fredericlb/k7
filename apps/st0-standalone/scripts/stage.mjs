// stage.mjs — build staging/ for electron-builder: the backend BUNDLED, the binaries beside it.
// The bundle is the one the phone runs too, frontend, demos and library included (apps/st0/backend/docs/standalone.md).

import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { stageEngine } from "@studio/supervisor-host/stageEngine";

const app = join(dirname(fileURLToPath(import.meta.url)), "..");
const repo = join(app, "..", "..");
const staging = join(app, "staging");
const bin = join(staging, "bin");

const run = (cmd, args, cwd = repo) => {
  console.log(`$ ${cmd} ${args.join(" ")}`);
  execFileSync(cmd, args, {
    cwd,
    stdio: "inherit",
    shell: process.platform === "win32",
  });
};

rmSync(staging, { recursive: true, force: true });
mkdirSync(staging, { recursive: true });

console.log("· frontend");
run("npm", ["exec", "--workspace", "st0-frontend", "--", "vite", "build"]);

console.log("· backend");
run("node", [
  join(repo, "apps", "st0", "backend", "scripts", "bundle.mjs"),
  join(staging, "backend"),
]);

console.log("· engine and supervisor");
stageEngine({ repo, bin });

console.log(`staged in ${staging}`);
