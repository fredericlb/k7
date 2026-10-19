// demos.ts — keep every user's "Examples" workspace stocked with the app's bundled demo
// songs, so a first-time user doesn't land on an empty picker. They are MANAGED content:
// mirrored when the app is UPDATED, or when the user resets the examples (an edited demo is
// overwritten, a deleted one re-created), while anything else under Examples is never touched.
// Copy a demo to tinker with it. See docs/workspaces.md.

import { createHash } from "node:crypto";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
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

/** The bundled demo folders' names; empty when there is no bundle. */
export function demoNames(): string[] {
  const src = demosDir();
  return src ? bundledDemoNames(src) : [];
}

/** Whether `path` in `workspace` is a MANAGED demo — one an update or a reset overwrites, which the UI has to say. */
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

/** Beside the demos in Examples: the bundle they were last mirrored from. */
export const DEMOS_STAMP = ".demos-stamp";

/** Which bundle this is: an update reinstalls the demos, so their sizes and times move with it (docs/workspaces.md). */
export function demosStamp(): string | null {
  const src = demosDir();
  if (!src) return null;
  const hash = createHash("sha1").update(process.env.APP_VERSION ?? "");
  const walk = (dir: string, rel: string) => {
    for (const e of readdirSync(dir, { withFileTypes: true }).sort((a, b) =>
      a.name.localeCompare(b.name),
    )) {
      const abs = join(dir, e.name);
      if (!demoCopyFilter(abs) || e.name.startsWith(".")) continue;
      if (e.isDirectory()) walk(abs, `${rel}${e.name}/`);
      else {
        const st = statSync(abs);
        hash.update(`${rel}${e.name}\0${st.size}\0${st.mtimeMs}\n`);
      }
    }
  };
  try {
    walk(src, "");
  } catch {
    return null;
  }
  return hash.digest("hex");
}

/** Mirror the demos and remember which bundle they came from; the reset and the update both end here. */
export function mirrorDemosStamped(examplesDir: string): string[] {
  const synced = mirrorDemos(examplesDir);
  const stamp = demosStamp();
  if (synced.length && stamp)
    try {
      writeFileSync(join(examplesDir, DEMOS_STAMP), `${stamp}\n`);
    } catch {
      // Unwritten, the next start mirrors again: the old behaviour, never a loss.
    }
  return synced;
}

/** Whether Examples already holds this bundle's demos. */
function stocked(examplesDir: string): boolean {
  const stamp = demosStamp();
  if (!stamp) return false;
  try {
    return (
      readFileSync(join(examplesDir, DEMOS_STAMP), "utf8").trim() === stamp
    );
  } catch {
    return false;
  }
}

/** Stock this account's Examples at startup when the app was updated since — or never stocked them; never throws. */
export function syncExamples(): void {
  try {
    const dir = join(rootDir(), EXAMPLES_WORKSPACE);
    if (stocked(dir)) {
      console.log(`   ${EXAMPLES_WORKSPACE}: up to date with this build`);
      return;
    }
    const synced = mirrorDemosStamped(dir);
    console.log(
      `   ${EXAMPLES_WORKSPACE}: ${synced.join(", ") || "no demos found"}`,
    );
  } catch {
    // The demos are a courtesy; a service that cannot copy them still serves.
  }
}
