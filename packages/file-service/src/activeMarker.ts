// activeMarker.ts — which project a workspace had open, remembered in a marker BESIDE the workspace,
// never in it, so no sync of the workspace ever carries one person's open project to another.
// See docs/workspace.md.

import { mkdirSync, readFileSync, rmSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { writeFileAtomic } from "@studio/song/atomicWrite";

// Where each workspace's active-project marker lives: a folder BESIDE the workspaces, so no sync of one ever sees it.
const ACTIVE_MARKERS_DIR = ".active-projects";
// The marker a workspace kept INSIDE itself, moved out at its first read.
const LEGACY_MARKER = ".studio-active";

/** The marker file of the workspace at `root`: `<the workspaces' folder>/.active-projects/<workspace>`. */
export function activeMarkerOf(root: string): string {
  const abs = resolve(root);
  return join(dirname(abs), ACTIVE_MARKERS_DIR, basename(abs));
}

/** The workspace's open project, absolute; null when nothing is open. */
export function readActiveMarker(root: string): string | null {
  let rel: string;
  try {
    rel = readFileSync(activeMarkerOf(root), "utf8").trim();
  } catch {
    rel = moveLegacyMarker(root);
  }
  return rel ? resolve(root, rel) : null;
}

/** Remember `rel` (workspace-relative, "" for none) as the workspace's open project. */
export function writeActiveMarker(root: string, rel: string): void {
  const at = activeMarkerOf(root);
  mkdirSync(dirname(at), { recursive: true });
  writeFileAtomic(at, rel ? `${rel}\n` : "");
}

/** Read an in-workspace marker once, write it beside the workspace and delete it from the workspace. */
function moveLegacyMarker(root: string): string {
  const legacy = join(root, LEGACY_MARKER);
  let rel: string;
  try {
    rel = readFileSync(legacy, "utf8").trim();
  } catch {
    return "";
  }
  try {
    writeActiveMarker(root, rel);
    rmSync(legacy, { force: true });
  } catch {
    /* best-effort: read again next time */
  }
  return rel;
}
