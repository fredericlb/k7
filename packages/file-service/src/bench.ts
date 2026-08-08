// bench.ts — the module bench: a generated `.l8` project whose `modules/` folder IS the
// médiathèque's, and the one project whose module saves are written back to the catalogue
// instead of forking a copy. Rationale and the alternatives rejected: apps/st0/docs/banc.md.

import {
  cpSync,
  existsSync,
  linkSync,
  mkdirSync,
  readdirSync,
  rmSync,
} from "node:fs";
import { basename, join } from "node:path";
import { remoteWriter } from "@studio/mediatek/remote";
import { mediatekDirFor } from "@studio/song/mediatekRoot";
import { scaffoldBench } from "@studio/song/scaffoldBench";
import { BENCH_PROJECT } from "@studio/web-protocol/projects";
import { mediatekBase, mediatekToken } from "./mediatekLink.ts";
import { slugify, workspaceRoot } from "./slug.ts";

/**
 * The workspace the bench lives in — reserved, and not a repository.
 *
 * Capitalised and unprefixed for the same reason `Examples` is: `assertWorkspaceName` takes an
 * ALLOWLIST that a leading underscore fails, so the obvious `_banc` is not a name this service
 * will make. Reserved by convention rather than by mechanism, exactly as its neighbour is.
 */
export const BENCH_WORKSPACE = "Banc";

/** A module folder's own files, as opposed to what it LOADS. Copied; the rest is linked. */
const DEFINITION = /\.(ya?ml|ts|vstpreset)$/i;

/**
 * Mirror the médiathèque's modules into the bench.
 *
 * Definitions are COPIED — they are small, and they are the files that get written; a write to
 * a hardlink would edit the cache in place, which is a cache and would be overwritten by the
 * next sync without anything reaching the catalogue.
 *
 * Everything else — impulse responses, NAM profiles, samples — is HARDLINKED where the
 * filesystem allows it and copied where it does not. Those are the big files and nothing edits
 * them, so duplicating their bytes for every bench open would be the one thing that made this
 * feature expensive. Same volume in every layout we ship (`~/.studio/mediatek` beside
 * `~/.studio/root`), so the link normally takes.
 */
function mirror(from: string, to: string): void {
  mkdirSync(to, { recursive: true });
  for (const entry of readdirSync(from, { withFileTypes: true })) {
    const src = join(from, entry.name);
    const dst = join(to, entry.name);
    if (entry.isDirectory()) {
      mirror(src, dst);
      continue;
    }
    if (!entry.isFile()) continue; // a socket or a dangling symlink is not ours to reproduce
    if (existsSync(dst)) rmSync(dst, { force: true });
    if (DEFINITION.test(entry.name)) {
      cpSync(src, dst);
      continue;
    }
    try {
      linkSync(src, dst);
    } catch {
      cpSync(src, dst); // another volume, or a filesystem with no links — pay the bytes
    }
  }
}

/**
 * Make (or refresh) the bench for this user, and answer where it is.
 *
 * REGENERATED on every open rather than kept: the catalogue is what it is a view of, and a
 * bench that had drifted from it would be worse than no bench — you would be editing a module
 * that is not the one anybody else sees. What survives a regeneration is the part that is
 * yours: `chains.yaml`, `instances/` and `tracks/`, which is exactly what you wire.
 */
export function ensureBench(userEmail: string): {
  workspace: string;
  project: string;
} {
  const dir = join(
    workspaceRoot(slugify(userEmail), BENCH_WORKSPACE),
    BENCH_PROJECT,
  );
  const first = !existsSync(join(dir, "project.yaml"));
  if (first) scaffoldBench(dir, "banc");

  // The modules, every time. Removed first so a module DELETED from the catalogue disappears
  // here too — a stale one would still resolve, still compile, and still play, which is how you
  // end up debugging a module that no longer exists.
  const modules = join(dir, "modules");
  const catalogue = mediatekDirFor("modules");
  if (existsSync(catalogue)) {
    // …except the two the scaffold owns. They are the bench's own furniture (the output sink
    // and the strip), not the catalogue's, and wiping them would break the chain on every open.
    for (const entry of readdirSync(modules, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      for (const mod of readdirSync(join(modules, entry.name))) {
        if (entry.name === "io" && mod === "OUT") continue;
        if (entry.name === "audio" && mod === "mixer") continue;
        rmSync(join(modules, entry.name, mod), {
          recursive: true,
          force: true,
        });
      }
    }
    mirror(catalogue, modules);
  }
  return { workspace: BENCH_WORKSPACE, project: BENCH_PROJECT };
}

/** Is this workspace + project the bench? What decides whether a module save writes through. */
export function isBenchProject(root: string, projectDir: string): boolean {
  return (
    basename(root) === BENCH_WORKSPACE && basename(projectDir) === BENCH_PROJECT
  );
}

/**
 * Push a module file the bench just saved up to the hosted catalogue.
 *
 * Fire-and-forget by nature and by choice: the file on this machine is already written, so a
 * hosted library that is down costs the push and not the edit — and the next bench open
 * re-mirrors from the cache, which the pull will have refreshed by then. Reported by throwing
 * nothing and logging once, exactly as `mediatekPull` treats the same failure.
 *
 * `rel` is the path INSIDE the modules folder (`audio/reverb/module.yaml`), which is the path
 * the médiathèque's own write route takes, prefixed by its family.
 */
export async function pushModuleToMediatek(
  rel: string,
  content: string,
): Promise<void> {
  const base = mediatekBase();
  if (!base) return; // no hosted library configured — the local cache IS the library
  try {
    await remoteWriter({ base, token: mediatekToken() ?? undefined }).put(
      `modules/${rel}`,
      content,
    );
  } catch (e) {
    console.warn(
      `[bench] saved locally, but the médiathèque refused it: ${(e as Error).message}`,
    );
  }
}

/** The bench's own module folder, absolute — what a write is tested against. */
export function benchModulesDir(projectDir: string): string {
  return join(projectDir, "modules");
}
