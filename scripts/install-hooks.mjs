// install-hooks.mjs — point git at the tracked hooks in .githooks/.
// Runs as `prepare`, so also inside every image's `npm ci`, where there is no checkout: it must never fail.

import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";

if (existsSync(".git")) {
  try {
    execFileSync("git", ["config", "core.hooksPath", ".githooks"], {
      stdio: "ignore",
    });
  } catch {
    // No git binary here: nothing to install.
  }
}
