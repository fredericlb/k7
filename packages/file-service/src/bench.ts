// bench.ts — the BENCH: one live rig, in a workspace of its own: the bare rig, or one seeded with a
// library CHAIN, scaffolded again on every open unless it was edited since, which is where a frozen
// chain is tuned with real panels and sound before `chain save` writes it (frozenChains.ts).
// What a reader would get wrong: what the bench copied is recorded BESIDE the project, never in it,
// so the editor's tree shows nothing of it. Rationale: apps/k7/backend/docs/media/banc.md.

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { scaffoldLive } from "@studio/song/scaffoldLive";
import { wsRead, wsWrite } from "@studio/song/yaml/workspaceFile";
import {
  BENCH_PROJECT,
  BENCH_WORKSPACE,
  benchChainOf,
} from "@studio/web-protocol/projects";
import { spliceChain } from "./benchChain.ts";
import { refreshLibraries } from "./libraries.ts";
import { workspaceRoot } from "./slug.ts";

// Re-exported for the file service's own modules; the browser reads it from web-protocol, which is why it lives there.
export { BENCH_WORKSPACE };

/**
 * The bench's project folder, whether or not it exists: the directory the ACCOUNT's own views
 * (its chains, a cut's model) resolve modules through when no workspace is open. Any project
 * sees the same libraries; this one is simply always the same.
 */
export const benchDir = (): string =>
  join(workspaceRoot(BENCH_WORKSPACE), BENCH_PROJECT);

/** What the bench holds a copy of: the chain (null for the bare rig), each node's source step id, and the rig as copied. */
export interface BenchSource {
  ref: string | null;
  ids: Record<string, string>;
  stamp: string;
}

const sourceFile = (): string =>
  join(workspaceRoot(BENCH_WORKSPACE), "bench-source.json");

/** A fingerprint of the rig's graph and node files: a bench whose fingerprint moved was edited. */
export function benchStamp(dir: string = benchDir()): string {
  const h = createHash("sha1");
  h.update(wsRead(join(dir, "graph.k7x")));
  const nodes = join(dir, "nodes");
  if (existsSync(nodes))
    for (const f of readdirSync(nodes).sort()) {
      h.update(f);
      h.update(wsRead(join(nodes, f)));
    }
  return h.digest("hex");
}

/** What the bench copied, or null when no bench was made since this was recorded. */
export function readBenchSource(): BenchSource | null {
  try {
    return JSON.parse(wsRead(sourceFile())) as BenchSource;
  } catch {
    return null;
  }
}

/** Record what the bench now holds, stamped as it stands: what `chain save` does after writing. */
export function writeBenchSource(source: Omit<BenchSource, "stamp">): void {
  wsWrite(
    sourceFile(),
    JSON.stringify({ ...source, stamp: benchStamp() }, null, 2),
  );
}

/** Whether the bench on disk holds `chain` with edits a fresh copy would throw away. */
function editedOn(chain: string | null): boolean {
  const was = readBenchSource();
  if (!was || was.ref !== chain || !existsSync(benchDir())) return false;
  try {
    return benchStamp() !== was.stamp;
  } catch {
    return false;
  }
}

/** The bench `project` names: made fresh, unless it holds that chain already with edits not saved. */
export async function ensureBench(
  _userEmail: string,
  project: string,
): Promise<{ workspace: string; project: string }> {
  const chain = benchChainOf(project);
  if (chain === undefined) throw new Error(`'${project}' is no bench`);
  // A bare `@<library>` names no chain: a library is edited from any project, by an admin.
  if (chain && /^@[a-z0-9-]+$/.test(chain))
    throw new Error(
      `'${chain}' is a library, not a chain — an admin edits it from any project`,
    );
  const opened = { workspace: BENCH_WORKSPACE, project: BENCH_PROJECT };
  const root = workspaceRoot(BENCH_WORKSPACE);
  mkdirSync(root, { recursive: true });
  // The libraries given their folders, so the rig resolves its chain — docs/libraries.md.
  await refreshLibraries();
  // A reload must not cost the knobs turned since the bench opened: they are kept until saved or another chain is opened.
  if (editedOn(chain)) return opened;
  // A bench per CHAIN is an address that no longer exists; left there it would be a project saving nowhere.
  rmSync(join(root, "chains"), { recursive: true, force: true });

  const dir = benchDir();
  rmSync(dir, { recursive: true, force: true });
  // Named after the workspace and not after the folder: what the app says everywhere is "the bench".
  // A GRAPH, not chain files: spliceChain wires the library chain between nodes it names (`IN`, `fader`).
  scaffoldLive(dir, BENCH_WORKSPACE, "graph");
  // Recorded as the ADDRESS names it, which is what the next open compares.
  const ids = chain ? spliceChain(dir, chain).ids : {};
  writeBenchSource({ ref: chain, ids });
  return opened;
}
