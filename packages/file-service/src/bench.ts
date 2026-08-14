// bench.ts — a generated `.l8` project that IS one chain of the library submodule, and whose
// saves are written back into it instead of forking a copy. Opened on ONE chain: the
// catalogue-at-large bench is gone, and modules are edited from l8's Libraries tab.
// Rationale: apps/st0/docs/banc.md.

import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join, sep } from "node:path";
import {
  benchChainCollision,
  CHAIN_FILE,
  chainToBench,
} from "@studio/song/benchChain";
import { projectModeOf } from "@studio/song/projectMode";
import { BENCH_EDGES, scaffoldBench } from "@studio/song/scaffoldBench";
import { setFileValue } from "@studio/song/yaml/edit";
import {
  benchChainPath,
  benchProjectForChain,
} from "@studio/web-protocol/projects";
import { ensureLibraries, librariesDir } from "./libraries.ts";
import { slugify, workspaceRoot } from "./slug.ts";

/**
 * The workspace the bench lives in — reserved, and not a repository.
 *
 * Capitalised and unprefixed for the same reason `Examples` is: `assertWorkspaceName` takes an
 * ALLOWLIST that a leading underscore fails, so the obvious `_banc` is not a name this service
 * will make. Reserved by convention rather than by mechanism, exactly as its neighbour is.
 */
export const BENCH_WORKSPACE = "Banc";

// The catalogue MIRROR was here — a copy-the-definitions, hardlink-the-rest walk that filled
// `<project>/modules` on every open. It existed because the catalogue was a machine-wide cache
// no project could reach; the library is a submodule in the workspace now, so the bench sees it
// the way a song does and there is nothing to copy. Two hundred folders per open, gone with it.

/**
 * Bring a bench made before `live` existed forward, in place.
 *
 * The folder is regenerated on every open but `project.yaml` is NOT — it is written once, and
 * `chains.yaml`/`nodes/` are deliberately what survives. So a bench that already existed would
 * keep saying "arrangement" forever and open with a timeline over the graph, which is the one
 * shape a bench has never been.
 *
 * Comment-preserving and idempotent: `setFileValue` rewrites the document rather than the text,
 * so the French header the scaffold wrote is still there afterwards, and a bench already saying
 * `live` is not touched at all.
 */
function ensureLive(projectFile: string): void {
  try {
    if (projectModeOf(dirname(projectFile)) === "live") return;
    setFileValue(projectFile, ["project_type"], "live");
  } catch {
    // A bench whose header will not parse is the compile's problem to report, with a line
    // number. Failing the OPEN here would leave no way to reach the editor that fixes it.
  }
}

/**
 * The scaffold both benches share. Answers the project folder.
 *
 * It used to MIRROR the whole module catalogue into `<project>/modules` on every open, copying
 * the definitions and hardlinking the rest. That is gone, and nothing replaced it: the bench
 * sits in a workspace, the workspace carries the library submodule, and `@st0/…` resolves
 * against it exactly as it does for a song. The mirror existed only because the catalogue was
 * a machine-wide cache no project could see — see `@studio/song`'s docs/sharedFolders.md.
 *
 * What is left in `<project>/modules` is the scaffold's own furniture, the output sink and the
 * strip, which are the bench's and not the library's.
 */
function ensureBenchProject(userEmail: string, project: string): string {
  const dir = join(workspaceRoot(slugify(userEmail), BENCH_WORKSPACE), project);
  const projectFile = join(dir, "project.yaml");
  if (!existsSync(projectFile)) scaffoldBench(dir, basename(project, ".l8"));
  else ensureLive(projectFile);
  return dir;
}

/**
 * The same bench, opened on ONE médiathèque chain — `@banc/chains/<path>.l8`.
 *
 * The chain is not COPIED into a project so much as read as one: `chains.yaml` is the catalogue's
 * file with its two boundary nodes translated into the bench's furniture (`@studio/song/benchChain`),
 * and `nodes/` is the chain's own settings, which is the other half of what a chain is.
 *
 * Rewritten from the catalogue on every open, exactly as the modules are and for the same
 * reason: this is a VIEW of a shared chain, and a stale one would have you editing something
 * nobody else can see. Nothing here is yours to keep — what you wire IS the chain, and it goes
 * back where it came from when you save it.
 *
 * Refuses, rather than guesses, when the chain has a node named like the bench's own furniture:
 * see `benchChainCollision`. The message is the user's, so the route hands it over as a 409.
 */
export async function ensureChainBench(
  userEmail: string,
  chainPath: string,
  libraries: string,
): Promise<{ workspace: string; project: string }> {
  // The bench has a workspace of its own, so it needs the library submodule of its own too:
  // the chain being opened is IN it, and so are the modules that chain names.
  const root = workspaceRoot(slugify(userEmail), BENCH_WORKSPACE);
  mkdirSync(root, { recursive: true });
  await ensureLibraries(userEmail, root, libraries);

  const source = join(librariesDir(root), chainPath);
  const chainsFile = join(source, CHAIN_FILE);
  if (!existsSync(chainsFile))
    throw new Error(
      `no chain at ${chainPath} in the libraries repository this account uses`,
    );
  const text = readFileSync(chainsFile, "utf8");
  const clash = benchChainCollision(text, BENCH_EDGES);
  if (clash) throw new Error(clash);

  const project = benchProjectForChain(chainPath);
  const dir = ensureBenchProject(userEmail, project);
  writeFileSync(join(dir, CHAIN_FILE), chainToBench(text, BENCH_EDGES));

  // The nodes, which are flat and named by their file in both places — the médiathèque's
  // chain folder and an l8 project use the same shape, which is why this is a copy and not a
  // conversion. Emptied first, so a node dropped from the chain does not linger.
  const nodes = join(dir, "nodes");
  rmSync(nodes, { recursive: true, force: true });
  if (existsSync(join(source, "nodes")))
    cpSync(join(source, "nodes"), nodes, { recursive: true });

  return { workspace: BENCH_WORKSPACE, project };
}

/** Is this workspace + project the bench? What decides whether a save writes through. */
export function isBenchProject(root: string, projectDir: string): boolean {
  // The WORKSPACE is what is reserved, so every project in it is a bench — one folder per chain
  // opened. Naming the project here instead would have made them ordinary projects, whose module
  // saves fork instead of reaching the catalogue.
  return basename(root) === BENCH_WORKSPACE;
}

/** Which chain a bench project is a view of, from the project path — null for the module bench. */
export function benchChainOf(root: string, projectRel: string): string | null {
  if (basename(root) !== BENCH_WORKSPACE) return null;
  return benchChainPath(projectRel.split(sep).join("/"));
}

/**
 * Write a file the chain bench just saved back into the chain it is a view of.
 *
 * `rel` is the path inside the chain folder — `chains.yaml`, or `nodes/<name>.yaml` — and it
 * arrives ALREADY translated back into `@in`/`@out`, because only the caller knows which file
 * needed translating. This one just carries bytes.
 *
 * A plain write, where this used to be a write plus a push to the hosted médiathèque. The
 * chain is in the library SUBMODULE now, so the file that is written is the file everyone
 * else will read — once somebody commits it. Publishing is `project commit`, deliberately:
 * a bench that pushed on every autosave would put a commit on a shared repository every time
 * a knob moved. There is nothing to fire and forget, so nothing here can fail silently.
 *
 * `root` is the bench WORKSPACE, which is where the submodule is mounted.
 */
export function writeChainToLibraries(
  root: string,
  chainPath: string,
  rel: string,
  content: string,
): void {
  const at = join(librariesDir(root), chainPath, rel);
  mkdirSync(dirname(at), { recursive: true });
  writeFileSync(at, content, "utf8");
}
