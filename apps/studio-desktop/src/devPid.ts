// devPid.ts — in DEV only, write our pid where the restart scripts can find it. Unpackaged,
// the process image is `electron`, not `studio-capot`, so scanning by name finds nothing:
// stopAll would report nothing to stop, the old instance would keep the single-instance lock,
// and the new one would exit without a word. Deliberately NOT under ~/.studio, whose layout is
// a contract owned by engine-client/paths.ts. See scripts/docs/restartApp.md.

import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { repoRoot } from "./hostCmd.ts";

/** `apps/studio-desktop/.cache/dev/app.pid`, beside the dev tray log, or null when there is no repo. */
function devPidPath(): string | null {
  const root = repoRoot();
  if (!root) return null;
  return join(root, "apps", "studio-desktop", ".cache", "dev", "app.pid");
}

export function writeDevPid(): void {
  const path = devPidPath();
  if (!path) return;
  try {
    mkdirSync(dirname(path), { recursive: true });
    // The PLATFORM rides along: under WSL this tree is mirrored to the host, and a pid from
    // the other side names an unrelated process there — which stopAll would then kill.
    writeFileSync(
      path,
      `${JSON.stringify({ pid: process.pid, platform: process.platform })}\n`,
      "utf8",
    );
  } catch {
    // A dev convenience must never stop the app starting.
  }
}

export function clearDevPid(): void {
  const path = devPidPath();
  if (!path) return;
  rmSync(path, { force: true });
}
