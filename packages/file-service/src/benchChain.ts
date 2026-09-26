// benchChain.ts — a library CHAIN played live on the bench: which chains can be, and putting one
// between the rig's input and its fader. What k7 records through (apps/k7/docs/chainSource.md).
//
// The one thing a reader would get wrong: the chain is COPIED into the bench, never referenced.
// Nothing inlines a template into a host graph, and a copy dies with the bench — so an edit made
// while auditioning reaches nothing shared. See apps/pl8/docs/banc.md.

import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { isOfflineModule } from "@studio/audio-passes/coldPass";
import { chainSteps } from "@studio/song/chainsGraph";
import { loadModuleRefs } from "@studio/song/loader";
import { resolveModule } from "@studio/song/moduleResolve";
import {
  LIVE_FADER,
  LIVE_INPUT,
  LIVE_RECORDER,
} from "@studio/song/scaffoldLive";
import { librariesDirFor } from "@studio/song/sharedFolders";
import { formatChains, parseGraph } from "@studio/song-schema/yaml/graphFile";
import { GRAPH_FILE } from "@studio/song-schema/yaml/graphSchema";
import type { LiveChain } from "@studio/web-protocol";
import { parse as parseYaml } from "yaml";
import { walkLibraryChains } from "./libraryChains.ts";

/** A chain template's two ends, as its graph spells them — docs/graphFile.md. */
const CHAIN_IN = "@in";
const CHAIN_OUT = "@out";

/** The rig's own node names, which a chain's nodes must not reuse once copied beside them. */
const RIG_NODES = new Set([
  LIVE_INPUT,
  LIVE_FADER,
  LIVE_RECORDER,
  "MIX",
  "OUT",
]);

type LoadedModule = ReturnType<typeof loadModuleRefs>[string];

/** Why a step cannot run on a live input, or null: a cold or offline module needs the whole file first. */
function needsDisk(m: LoadedModule): boolean {
  return isOfflineModule(m) || (m as { cold?: unknown }).cold === true;
}

/** Why the chain at `abs` cannot be played live, or null when it can; `byRef` is the library it resolves against. */
function refusal(
  abs: string,
  byRef: Record<string, LoadedModule>,
): string | null {
  let steps: string[];
  try {
    steps = chainSteps(readFileSync(join(abs, GRAPH_FILE), "utf8"));
  } catch (e) {
    return `its graph does not read — ${(e as Error).message}`;
  }
  if (!steps.length) return "it holds no step";
  for (const step of steps) {
    if (RIG_NODES.has(step))
      return `its node "${step}" has the name of one of the rig's own`;
    let raw: Record<string, unknown>;
    try {
      raw = (parseYaml(
        readFileSync(join(abs, "nodes", `${step}.yaml`), "utf8"),
        {
          version: "1.2",
        },
      ) ?? {}) as Record<string, unknown>;
    } catch {
      return `no nodes/${step}.yaml`;
    }
    const m = resolveModule(raw as unknown as LoadedModule, byRef);
    if (needsDisk(m)) return `"${step}" only works on audio already on disk`;
  }
  return null;
}

/** The chains of `dir`'s library, each with why it cannot run live — a cold one is listed, not dropped (apps/k7/docs/chainSource.md). */
export function liveChains(dir: string): LiveChain[] {
  const byRef = loadModuleRefs(dir);
  return walkLibraryChains(librariesDirFor(dir, "chains")).map((c) => ({
    ref: c.ref,
    unavailable: refusal(c.dir, byRef),
  }));
}

/** Put the chain `ref` of the library between the bench's input and its fader; throws with the reason. */
export function spliceChain(benchDir: string, ref: string): void {
  const chain = walkLibraryChains(librariesDirFor(benchDir, "chains")).find(
    (c) => c.ref === ref,
  );
  if (!chain) throw new Error(`no chain "${ref}" in the library`);
  const why = refusal(chain.dir, loadModuleRefs(benchDir));
  if (why) throw new Error(`the chain "${ref}" cannot run live: ${why}`);

  const own = parseGraph(readFileSync(join(chain.dir, GRAPH_FILE), "utf8"));
  const rig = parseGraph(readFileSync(join(benchDir, GRAPH_FILE), "utf8"));
  if (!own.value || !rig.value)
    throw new Error(
      `the chain "${ref}" or the bench has a graph that does not read`,
    );

  // The template's ends become the rig's: `@in` is the input, `@out` the fader.
  const end = (n: string): string =>
    n === CHAIN_IN ? LIVE_INPUT : n === CHAIN_OUT ? LIVE_FADER : n;
  const modules: Record<string, string[]> = {};
  for (const [node, dests] of Object.entries(rig.value.modules ?? {}))
    if (node !== LIVE_INPUT) modules[node] = dests;
  for (const [node, dests] of Object.entries(own.value.modules ?? {}))
    modules[end(node)] = dests.map(end);

  mkdirSync(join(benchDir, "nodes"), { recursive: true });
  for (const file of chain.nodes)
    copyFileSync(join(chain.dir, "nodes", file), join(benchDir, "nodes", file));
  writeFileSync(
    join(benchDir, GRAPH_FILE),
    formatChains(
      {
        modules,
        bypassed: [
          ...(rig.value.bypassed ?? []),
          ...(own.value.bypassed ?? []),
        ],
      },
      `# The bench, with the library chain "${ref}" COPIED between the input and the fader.\n` +
        `# Nothing here is saved: edit the chain in st0's chains builder. See apps/pl8/docs/banc.md.`,
    ),
    "utf8",
  );
}
