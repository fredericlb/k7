// demos.ts — keep every user's "Examples" workspace stocked with the app's bundled demo
// songs, so a first-time user doesn't land on an empty picker. They are MANAGED content:
// mirrored on every startup (an edited demo is overwritten, a deleted one re-created),
// while anything else under Examples is never touched. Copy a demo to tinker with it.

import { cpSync, existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { EXAMPLES_WORKSPACE } from "@studio/web-protocol/projects";
import { rootDir } from "./slug.ts";

// The workspace the demos are put in, named where the home page can read it too.
export { EXAMPLES_WORKSPACE };

/** Where the demo songs live: $STUDIO_DEMOS when a packaged app sets it, else walk up to `demos` (this file is bundled at a different depth than it sits in the repo). */
function demosDir(): string | null {
  const env = process.env.STUDIO_DEMOS;
  if (env && existsSync(env)) return env;

  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 8; i++) {
    const candidate = join(dir, "demos");
    if (existsSync(candidate)) return candidate;
    const up = dirname(dir);
    if (up === dir) break;
    dir = up;
  }
  return null;
}

// The demo names from the bundle; empty when there is none, since a missing dir must never fail the caller.
function bundledDemoNames(src: string): string[] {
  try {
    return readdirSync(src, { withFileTypes: true })
      .filter((e) => e.isDirectory() && !e.name.startsWith("."))
      .map((e) => e.name);
  } catch {
    return [];
  }
}

/** Whether `path` in `workspace` is a MANAGED demo — one a restart overwrites, which the UI has to say. */
export function isManagedDemo(workspace: string, path: string): boolean {
  if (workspace !== EXAMPLES_WORKSPACE || path.includes("/")) return false;
  const src = demosDir();
  return !!src && bundledDemoNames(src).includes(path);
}

// The caches and VCS noise a checkout accumulates: per-machine state, and a stale cache is worse than none.
const demoCopyFilter = (s: string): boolean => {
  const base = s.split(/[/\\]/).pop() ?? "";
  return (
    base !== "node_modules" && base !== ".git" && !base.startsWith(".studio-")
  );
};

/** Replace each bundled demo folder wholesale, leaving the user's own projects alone; best-effort. */
export function mirrorDemos(examplesDir: string): string[] {
  const src = demosDir();
  if (!src) return [];
  const names = bundledDemoNames(src);
  if (!names.length) return [];
  try {
    mkdirSync(examplesDir, { recursive: true });
  } catch {
    return [];
  }
  const synced: string[] = [];
  for (const folder of names) {
    const dest = join(examplesDir, folder);
    try {
      // Replace, don't merge: rm first, so a file removed from a demo can't linger and the copy mirrors the bundle.
      rmSync(dest, { recursive: true, force: true });
      cpSync(join(src, folder), dest, {
        recursive: true,
        filter: demoCopyFilter,
      });
      synced.push(folder);
    } catch {
      // One bad demo shouldn't cost the others.
    }
  }
  return synced;
}

/** Mirror the bundled demos into this account's Examples, once at startup — which is also its FIRST use, the hub starting a service on demand; never throws. */
export function syncExamples(): void {
  try {
    const synced = mirrorDemos(join(rootDir(), EXAMPLES_WORKSPACE));
    console.log(
      `   ${EXAMPLES_WORKSPACE}: ${synced.join(", ") || "no demos found"}`,
    );
  } catch {
    // The demos are a courtesy; a service that cannot copy them still serves.
  }
}
