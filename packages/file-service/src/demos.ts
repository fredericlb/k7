// demos.ts — keep every user's "Examples" workspace stocked with the app's bundled demo
// songs, so a first-time user doesn't land on an empty picker. They are MANAGED content:
// mirrored on every startup (an edited demo is overwritten, a deleted one re-created),
// while anything else under Examples is never touched. Copy a demo to tinker with it.

import { cpSync, existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { rootDir } from "./slug.ts";

/** The workspace the demos are put in. */
export const EXAMPLES_WORKSPACE = "Examples";

/** Where the demo songs live: $STUDIO_DEMOS when the tray sets it (a packaged app), else walk up to `demos` (this file is bundled at a different depth than it sits in the repo). */
export function demosDir(): string | null {
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

/** Mirror the bundled demos into EVERY known user's Examples workspace, once at startup; never throws. */
export function syncAllRepos(): void {
  let slugs: string[];
  try {
    slugs = readdirSync(rootDir(), { withFileTypes: true })
      .filter((e) => e.isDirectory() && !e.name.startsWith("."))
      .map((e) => e.name);
  } catch {
    return; // no root yet (no user has ever connected) — nothing to sync
  }
  for (const slug of slugs) {
    try {
      const synced = mirrorDemos(join(rootDir(), EXAMPLES_WORKSPACE));
      if (synced.length)
        console.log(`   demos synced for ${slug}: ${synced.join(", ")}`);
    } catch {
      // One bad repo shouldn't stop the rest.
    }
  }
}
