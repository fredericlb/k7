// bench.ts — a generated `.st0` project that IS one chain of the library submodule, and whose
// saves are written back into it instead of forking a copy. Opened on ONE chain, never on the
// catalogue at large: modules are edited from st0's Libraries tab.
// Rationale: apps/pl8/docs/banc.md.

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
import { BENCH_EDGES, scaffoldBench } from "@studio/song/scaffoldBench";
import { setFileValue } from "@studio/song/yaml/edit";
import {
  benchChainPath,
  benchProjectForChain,
} from "@studio/web-protocol/projects";
import { ensureLibraries, librariesDir } from "./libraries.ts";
import { workspaceRoot } from "./slug.ts";

/** The workspace the bench lives in — reserved by convention, capitalised as `Examples` is. */
export const BENCH_WORKSPACE = "Banc";

// Nothing is copied in: the library is a submodule, and a bench draws no timeline it does not declare.

/** The scaffold both benches share, answering the project folder — see apps/pl8/docs/banc.md. */
function ensureBenchProject(project: string): string {
  const dir = join(workspaceRoot(BENCH_WORKSPACE), project);
  const projectFile = join(dir, "project.yaml");
  if (!existsSync(projectFile)) scaffoldBench(dir, basename(project, ".st0"));
  return dir;
}

/** The same bench opened on ONE chain, rewritten from the library on every open (apps/pl8/docs/banc.md). */
export async function ensureChainBench(
  userEmail: string,
  chainPath: string,
  libraries: string,
): Promise<{ workspace: string; project: string }> {
  // A workspace of its own, so a library submodule of its own: the chain and its modules are both in it.
  const root = workspaceRoot(BENCH_WORKSPACE);
  mkdirSync(root, { recursive: true });
  await ensureLibraries(userEmail, root, libraries);

  const source = join(librariesDir(root), chainPath);
  const graphFile = join(source, CHAIN_FILE);
  if (!existsSync(graphFile))
    throw new Error(
      `no chain at ${chainPath} in the libraries repository this account uses`,
    );
  const text = readFileSync(graphFile, "utf8");
  const clash = benchChainCollision(text, BENCH_EDGES);
  if (clash) throw new Error(clash);

  const project = benchProjectForChain(chainPath);
  const dir = ensureBenchProject(project);
  writeFileSync(join(dir, CHAIN_FILE), chainToBench(text, BENCH_EDGES));

  // A copy and not a conversion, since both places use one shape; emptied first, so a dropped node goes.
  const nodes = join(dir, "nodes");
  rmSync(nodes, { recursive: true, force: true });
  if (existsSync(join(source, "nodes")))
    cpSync(join(source, "nodes"), nodes, { recursive: true });

  return { workspace: BENCH_WORKSPACE, project };
}

/** Is this workspace + project the bench? What decides whether a save writes through. */
export function isBenchProject(root: string, projectDir: string): boolean {
  // The WORKSPACE is what is reserved, so every project in it is a bench — one folder per chain opened.
  return basename(root) === BENCH_WORKSPACE;
}

/** Which chain a bench project is a view of, from the project path — null for the module bench. */
export function benchChainOf(root: string, projectRel: string): string | null {
  if (basename(root) !== BENCH_WORKSPACE) return null;
  return benchChainPath(projectRel.split(sep).join("/"));
}

/** Write a saved bench file back into the chain it is a view of; publishing stays `project commit`. */
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
