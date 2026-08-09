// bench.ts — the workbench: a generated `.l8` project whose `modules/` folder IS the
// médiathèque's, and the one project whose saves are written back to the catalogue instead of
// forking a copy. Opened on the catalogue at large, or on ONE chain — same bench either way.
// Rationale and the alternatives rejected: apps/st0/docs/banc.md.

import {
  cpSync,
  existsSync,
  linkSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join, sep } from "node:path";
import { remoteWriter } from "@studio/mediatek/remote";
import {
  benchChainCollision,
  CHAIN_FILE,
  chainToBench,
} from "@studio/song/benchChain";
import { mediatekDirFor, mediatekRoot } from "@studio/song/mediatekRoot";
import { BENCH_EDGES, scaffoldBench } from "@studio/song/scaffoldBench";
import {
  BENCH_PROJECT,
  benchChainPath,
  benchProjectForChain,
} from "@studio/web-protocol/projects";
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
  ensureBenchProject(userEmail, BENCH_PROJECT);
  return { workspace: BENCH_WORKSPACE, project: BENCH_PROJECT };
}

/** The scaffold and the catalogue mirror both benches share. Answers the project folder. */
function ensureBenchProject(userEmail: string, project: string): string {
  const dir = join(workspaceRoot(slugify(userEmail), BENCH_WORKSPACE), project);
  const first = !existsSync(join(dir, "project.yaml"));
  if (first) scaffoldBench(dir, basename(project, ".l8"));

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
        if (entry.name === "io" && mod === BENCH_EDGES.out) continue;
        if (entry.name === "audio" && mod === BENCH_EDGES.strip) continue;
        rmSync(join(modules, entry.name, mod), {
          recursive: true,
          force: true,
        });
      }
    }
    mirror(catalogue, modules);
  }
  return dir;
}

/**
 * The same bench, opened on ONE médiathèque chain — `@banc/chains/<path>.l8`.
 *
 * The chain is not COPIED into a project so much as read as one: `chains.yaml` is the catalogue's
 * file with its two boundary nodes translated into the bench's furniture (`@studio/song/benchChain`),
 * and `instances/` is the chain's own settings, which is the other half of what a chain is.
 *
 * Rewritten from the catalogue on every open, exactly as the modules are and for the same
 * reason: this is a VIEW of a shared chain, and a stale one would have you editing something
 * nobody else can see. Nothing here is yours to keep — what you wire IS the chain, and it goes
 * back where it came from when you save it.
 *
 * Refuses, rather than guesses, when the chain has a node named like the bench's own furniture:
 * see `benchChainCollision`. The message is the user's, so the route hands it over as a 409.
 */
export function ensureChainBench(
  userEmail: string,
  chainPath: string,
): { workspace: string; project: string } {
  const source = join(mediatekRoot(), chainPath);
  const chainsFile = join(source, CHAIN_FILE);
  if (!existsSync(chainsFile))
    throw new Error(`no chain at ${chainPath} in this machine's médiathèque`);
  const text = readFileSync(chainsFile, "utf8");
  const clash = benchChainCollision(text, BENCH_EDGES);
  if (clash) throw new Error(clash);

  const project = benchProjectForChain(chainPath);
  const dir = ensureBenchProject(userEmail, project);
  writeFileSync(join(dir, CHAIN_FILE), chainToBench(text, BENCH_EDGES));

  // The instances, which are flat and named by their file in both places — the médiathèque's
  // chain folder and an l8 project use the same shape, which is why this is a copy and not a
  // conversion. Emptied first, so an instance dropped from the chain does not linger.
  const instances = join(dir, "instances");
  rmSync(instances, { recursive: true, force: true });
  if (existsSync(join(source, "instances")))
    cpSync(join(source, "instances"), instances, { recursive: true });

  return { workspace: BENCH_WORKSPACE, project };
}

/** Is this workspace + project the bench? What decides whether a save writes through. */
export function isBenchProject(root: string, projectDir: string): boolean {
  // The WORKSPACE is what is reserved, so every project in it is a bench — the module bench and
  // one folder per chain opened. Naming the project here instead would have made the chain
  // benches ordinary projects, whose module saves fork instead of reaching the catalogue.
  return basename(root) === BENCH_WORKSPACE;
}

/** Which chain a bench project is a view of, from the project path — null for the module bench. */
export function benchChainOf(root: string, projectRel: string): string | null {
  if (basename(root) !== BENCH_WORKSPACE) return null;
  return benchChainPath(projectRel.split(sep).join("/"));
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

/**
 * Push a file the chain bench just saved back to the chain it is a view of.
 *
 * `rel` is the path inside the chain folder — `chains.yaml`, or `instances/<name>.yaml` — and it
 * arrives ALREADY translated back into `@in`/`@out`, because only the caller knows which file
 * needed translating. This one just carries bytes.
 *
 * The local cache is written as well as the hosted library, which is the difference from
 * `pushModuleToMediatek` and is deliberate: the bench rewrites `chains.yaml` from the cache on
 * every open, so on a machine with no hosted library configured — where the cache IS the library
 * — a push-only save would be discarded by the very next open. With a library configured the
 * two land the same bytes, and the next pull re-fetches over them.
 */
export async function pushChainToMediatek(
  chainPath: string,
  rel: string,
  content: string,
): Promise<void> {
  const local = join(mediatekRoot(), chainPath, rel);
  mkdirSync(dirname(local), { recursive: true });
  writeFileSync(local, content, "utf8");

  const base = mediatekBase();
  if (!base) return;
  try {
    await remoteWriter({ base, token: mediatekToken() ?? undefined }).put(
      `${chainPath}/${rel}`,
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
