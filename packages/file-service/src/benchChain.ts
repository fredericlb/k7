// benchChain.ts — a library CHAIN played live on the bench: which chains can be, and putting one
// between the rig's input and its fader. What k7 records through (../../ui-rehearsal/docs/chainSource.md).
//
// The one thing a reader would get wrong: the chain is COPIED into the bench, never referenced, and
// as the bench's own segments and node files whichever layout the library keeps it in — an edit made
// while auditioning reaches nothing shared until `chain save` writes it as the account's own chain
// (frozenChains.ts). See apps/k7/backend/docs/media/banc.md.

import { copyFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { isOfflineModule } from "@studio/audio-passes/coldPass";
import {
  findLibraryChain,
  type LibraryChainDir,
  libraryChainDirs,
  readTemplate,
  type TemplateStep,
} from "@studio/song/libraryChains";
import { loadModuleRefs } from "@studio/song/loader";
import { resolveModule } from "@studio/song/moduleResolve";
import {
  LIVE_FADER,
  LIVE_INPUT,
  LIVE_RECORDER,
} from "@studio/song/scaffoldLive";
import { wsWriteData, wsWriteText } from "@studio/song/yaml/workspaceDoc";
import { wsCopy, wsRead } from "@studio/song/yaml/workspaceFile";
import { formatChains, parseGraph } from "@studio/song-schema/yaml/graphFile";
import { GRAPH_FILE } from "@studio/song-schema/yaml/graphSchema";
import type { LiveChain } from "@studio/web-protocol";

/** The rig's own node names, which a chain's nodes must not reuse once copied beside them. */
export const RIG_NODES: ReadonlySet<string> = new Set([
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

/** Why `chain` cannot be played live, or null when it can; `byRef` is the library it resolves against. */
function refusal(
  chain: LibraryChainDir,
  byRef: Record<string, LoadedModule>,
): string | null {
  let steps: TemplateStep[];
  try {
    const read = readTemplate(chain);
    if (read.missing.length) return `it lacks ${read.missing[0]}`;
    steps = read.steps;
  } catch (e) {
    return `it does not read — ${(e as Error).message}`;
  }
  if (!steps.length) return "it holds no step";
  for (const step of steps) {
    // A file chain's nodes are named afresh in the bench, so only a folder chain's names can collide.
    if (chain.layout === "folder" && RIG_NODES.has(step.name))
      return `its node "${step.name}" has the name of one of the rig's own`;
    const m = resolveModule(step.module as unknown as LoadedModule, byRef);
    if (needsDisk(m))
      return `"${step.label}" only works on audio already on disk`;
  }
  return null;
}

/** A bench name for a file chain's node, which has only an id: the module it extends, made unique. */
function benchName(step: TemplateStep, taken: Set<string>): string {
  const ext =
    typeof step.module.extends === "string" ? step.module.extends : "";
  const base =
    ext
      .split("/")
      .pop()
      ?.replace(/[^A-Za-z0-9_-]+/g, "-") || "node";
  let name = base;
  for (let i = 2; taken.has(name); i++) name = `${base}-${i}`;
  taken.add(name);
  return name;
}

/** Every library's chains, by `@<library>/<path>`, each with why it cannot run live against `dir`'s modules — a cold one is listed, not dropped (../../ui-rehearsal/docs/chainSource.md). */
export function liveChains(dir: string): LiveChain[] {
  const byRef = loadModuleRefs(dir);
  return libraryChainDirs(dir).map((c) => ({
    ref: c.ref,
    unavailable: refusal(c, byRef),
  }));
}

/** Put the chain `ref` of the library between the bench's input and its fader; throws with the reason. */
export function spliceChain(
  benchDir: string,
  ref: string,
): { ref: string; ids: Record<string, string> } {
  // A BARE ref is the default library's: bench addresses minted before libraries had names say one.
  const chain = findLibraryChain(ref, benchDir);
  if (!chain) throw new Error(`no chain "${ref}" in the library`);
  const why = refusal(chain, loadModuleRefs(benchDir));
  if (why) throw new Error(`the chain "${ref}" cannot run live: ${why}`);

  const rig = parseGraph(wsRead(join(benchDir, GRAPH_FILE)));
  if (!rig.value) throw new Error("the bench has a graph that does not read");

  // The template is one run: the input feeds its first step, and its last feeds the fader.
  const { steps } = readTemplate(chain);
  const taken = new Set([
    ...RIG_NODES,
    ...Object.keys(rig.value.modules ?? {}),
  ]);
  const names = steps.map((s) =>
    chain.layout === "folder" ? s.name : benchName(s, taken),
  );
  const modules: Record<string, string[]> = {};
  for (const [node, dests] of Object.entries(rig.value.modules ?? {}))
    if (node !== LIVE_INPUT) modules[node] = dests;
  modules[LIVE_INPUT] = [names[0]];
  names.forEach((n, i) => {
    modules[n] = [names[i + 1] ?? LIVE_FADER];
  });

  mkdirSync(join(benchDir, "nodes"), { recursive: true });
  steps.forEach((s, i) => {
    const at = join(benchDir, "nodes", names[i]);
    // A folder chain's node file is copied as written, its comments with it.
    if (chain.layout === "folder")
      wsCopy(join(chain.at, "nodes", `${s.name}.k7x`), `${at}.k7x`);
    else wsWriteData(`${at}.k7x`, s.module);
    if (s.preset) copyFileSync(s.preset, `${at}.vstpreset`);
  });
  wsWriteText(
    join(benchDir, GRAPH_FILE),
    formatChains(
      {
        modules,
        bypassed: [
          ...(rig.value.bypassed ?? []),
          ...names.filter((_, i) => steps[i].bypass),
        ],
      },
      [
        `The bench, with the library chain "${ref}" COPIED between the input and the fader.`,
        "Nothing here is saved by itself: `chain save <name>` writes the run into your chains. See apps/k7/backend/docs/media/banc.md.",
      ],
    ),
  );
  // Which step each bench node copies, so a save keeps the step's id and its comments.
  return {
    ref: chain.ref,
    ids: Object.fromEntries(names.map((n, i) => [n, steps[i].name])),
  };
}
