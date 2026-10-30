// demos.ts — keep every user's "Examples" workspace stocked with the app's bundled demo
// songs, so a first-time user doesn't land on an empty picker. They are MANAGED content:
// checked on every startup (an edited demo is overwritten, a deleted one re-created; one left as
// the last mirror made it is not copied again — docs/workspaces.md),
// while anything else under Examples is never touched. Copy a demo to tinker with it.

import { createHash } from "node:crypto";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { writeFileAtomic } from "@studio/song/atomicWrite";
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
  const stamps = readStamps(examplesDir);
  const next: Record<string, Stamp> = {};
  const synced: string[] = [];
  for (const folder of names) {
    const dest = join(examplesDir, folder);
    const from = treeStamp(join(src, folder));
    const was = stamps[folder];
    // Both sides as the last mirror left them: nothing to copy — docs/workspaces.md.
    if (was && was.src === from && was.dest === treeStamp(dest)) {
      next[folder] = was;
      continue;
    }
    try {
      // Replace, don't merge: rm first, so a file removed from a demo can't linger and the copy mirrors the bundle.
      rmSync(dest, { recursive: true, force: true });
      cpSync(join(src, folder), dest, {
        recursive: true,
        filter: demoCopyFilter,
      });
      synced.push(folder);
      next[folder] = { src: from, dest: treeStamp(dest) };
    } catch {
      // One bad demo shouldn't cost the others.
    }
  }
  writeStamps(examplesDir, next);
  return synced;
}

/** A demo folder's mirror, as last made: both trees' stamps. */
interface Stamp {
  src: string;
  dest: string;
}

/** Beside the demos, hidden from every walk; Examples removed takes it along, so the next start mirrors all. */
const stampFile = (examplesDir: string): string =>
  join(examplesDir, ".studio-demos.json");

function readStamps(examplesDir: string): Record<string, Stamp> {
  try {
    return JSON.parse(readFileSync(stampFile(examplesDir), "utf8"));
  } catch {
    return {};
  }
}

function writeStamps(examplesDir: string, stamps: Record<string, Stamp>): void {
  try {
    writeFileAtomic(stampFile(examplesDir), JSON.stringify(stamps));
  } catch {
    // Unwritten, the next start mirrors everything again, as it would without a stamp.
  }
}

/** Every file under `dir` the mirror copies, by path, size and mtime; "" when there is no such folder. */
function treeStamp(dir: string): string {
  const lines: string[] = [];
  const walk = (at: string, rel: string): void => {
    for (const e of readdirSync(at, { withFileTypes: true })) {
      const abs = join(at, e.name);
      if (!demoCopyFilter(abs)) continue;
      const r = `${rel}/${e.name}`;
      if (e.isDirectory()) walk(abs, r);
      else {
        const st = statSync(abs);
        lines.push(`${r}:${st.size}:${st.mtimeMs}`);
      }
    }
  };
  try {
    walk(dir, "");
  } catch {
    return "";
  }
  return createHash("sha1").update(lines.sort().join("\n")).digest("hex");
}

/** Mirror the bundled demos into this account's Examples, once at startup — which is also its FIRST use, the hub starting a service on demand; never throws. */
export function syncExamples(): void {
  try {
    const synced = mirrorDemos(join(rootDir(), EXAMPLES_WORKSPACE));
    console.log(
      `   ${EXAMPLES_WORKSPACE}: ${synced.join(", ") || "demos up to date"}`,
    );
  } catch {
    // The demos are a courtesy; a service that cannot copy them still serves.
  }
}
