// frozenChains.ts — the home page's Frozen chains: the account's own chains, kept as files under
// `@account/chains/`, and the libraries' cold ones beside them read-only. A chain is EDITED on the bench,
// with the engine's panels and sound, and `chain save` writes the bench's run back here as a chain file.
// What a reader would get wrong: a node file goes into the chain WHOLE, its engine and every field it
// holds, never re-derived; only its id comes from what the bench copied. See docs/libraries.md.

import { randomUUID } from "node:crypto";
import { copyFileSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { isOfflineModule } from "@studio/audio-passes/coldPass";
import {
  findLibraryChain,
  type LibraryChainDir,
  libraryChainDirs,
  readFileTemplate,
  readTemplate,
} from "@studio/song/libraryChains";
import { loadModuleRefs } from "@studio/song/loader";
import { resolveModule } from "@studio/song/moduleResolve";
import { loadPreferences, setRehearsalChain } from "@studio/song/preferences";
import type { LoadedModule } from "@studio/song/rawDoc";
import { LIVE_FADER, LIVE_INPUT } from "@studio/song/scaffoldLive";
import { accountLibraryHome } from "@studio/song/sharedFolders";
import { wsData } from "@studio/song/yaml/workspaceDoc";
import { wsExists, wsRead, wsWrite } from "@studio/song/yaml/workspaceFile";
import { ACCOUNT_LIBRARY, libraryRef } from "@studio/song-schema/moduleTypes";
import { formatChain } from "@studio/song-schema/yaml/chainFile";
import { parseGraph } from "@studio/song-schema/yaml/graphFile";
import { GRAPH_FILE } from "@studio/song-schema/yaml/graphSchema";
import type { FrozenChain, FrozenChainStep } from "@studio/web-protocol";
import { benchDir, readBenchSource, writeBenchSource } from "./bench.ts";
import { liveChains, RIG_NODES } from "./benchChain.ts";

/** A frozen chain's name: one path segment, what its file and its ref are named after. */
export const FROZEN_NAME = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;

type Modules = Record<string, LoadedModule>;
type Item = Record<string, unknown> & { id: string; extends?: unknown };
type ChainInput = { channel: string | number[] };

/** What a step is a use of: the module it extends, else the plugin it names itself. */
function moduleLabel(module: Record<string, unknown>): string {
  if (typeof module.extends === "string") return module.extends;
  const plugin = module.plugin as { name?: unknown } | undefined;
  return typeof plugin?.name === "string" ? plugin.name : "";
}

/** A step read off a chain file, in the list's terms: the engine's values when it names one. */
function stepOf(
  name: string,
  module: Record<string, unknown>,
): FrozenChainStep {
  const engine = typeof module.engine === "string" ? module.engine : undefined;
  const engines = module.engines as
    | Record<string, { params?: Record<string, number | string> }>
    | undefined;
  const params =
    (engine ? engines?.[engine]?.params : undefined) ??
    (module.params as Record<string, number | string> | undefined) ??
    {};
  return {
    id: name,
    module: moduleLabel(module),
    ...(engine ? { engine } : {}),
    params: { ...params },
    ...(module.bypass ? { bypass: true } : {}),
  };
}

function frozenOf(
  c: LibraryChainDir,
  byRef: Modules,
  live: Map<string, string | null>,
): FrozenChain {
  const base = {
    ref: c.ref,
    name: c.path,
    mine: c.library === ACCOUNT_LIBRARY,
    liveRefusal: live.get(c.ref) ?? null,
  };
  try {
    const { steps, input } = readTemplate(c);
    const cold =
      steps.length > 0 &&
      steps.every((s) =>
        isOfflineModule(
          resolveModule(s.module as unknown as LoadedModule, byRef),
        ),
      );
    return {
      ...base,
      cold,
      steps: steps.map((s) => stepOf(s.name, s.module)),
      ...(input ? { input } : {}),
    };
  } catch (e) {
    return {
      ...base,
      cold: false,
      steps: [],
      unreadable: (e as Error).message,
    };
  }
}

const liveMap = (dir: string) =>
  new Map(liveChains(dir).map((l) => [l.ref, l.unavailable]));

/** The account's own chains, then the libraries' cold ones — the page's two lists, `dir` the bench resolving them. */
export function listFrozenChains(dir: string): FrozenChain[] {
  const byRef = loadModuleRefs(dir);
  const live = liveMap(dir);
  const all = libraryChainDirs(dir).map((c) => frozenOf(c, byRef, live));
  const mine = all.filter((c) => c.mine);
  const cold = all.filter((c) => !c.mine && c.cold);
  const byName = (a: FrozenChain, b: FrozenChain) => a.ref.localeCompare(b.ref);
  return [...mine.sort(byName), ...cold.sort(byName)];
}

/** Where `name`'s file is in the account's library. */
const fileOf = (name: string): string =>
  join(accountLibraryHome(), "chains", `${name}.k7x`);

const accountChain = (name: string): LibraryChainDir => ({
  ref: libraryRef(ACCOUNT_LIBRARY, name),
  library: ACCOUNT_LIBRARY,
  path: name,
  at: fileOf(name),
  layout: "file",
  libraryRoot: accountLibraryHome(),
  nodes: [],
});

/** Write `items` as the account's chain `name`, with each item's preset file and the input it names; throws with the reason, having written nothing. */
function writeAccountChain(
  dir: string,
  name: string,
  items: Item[],
  presets: Record<string, string> = {},
  input?: ChainInput,
): FrozenChain {
  if (!FROZEN_NAME.test(name))
    throw new Error(
      `"${name}" is not a chain name — letters, digits, '-' and '_', starting with a letter or digit`,
    );
  // An input alone is a chain: recording from that socket is what it keeps.
  if (!items.length && !input)
    throw new Error("a chain holds at least one step, or an input");
  const byRef = loadModuleRefs(dir);
  let offline = 0;
  for (const [i, it] of items.entries()) {
    // A step extends a library module, or names its plugin itself, as `node new` writes an engine-provided one.
    const ref = typeof it.extends === "string" ? it.extends : "";
    if (ref ? !byRef[ref] : !it.plugin)
      throw new Error(
        ref
          ? `step ${i + 1}: no module "${ref}"`
          : `step ${i + 1} names no module and no plugin`,
      );
    if (isOfflineModule(resolveModule(it as unknown as LoadedModule, byRef)))
      offline++;
  }
  // A separator writes files, so nothing could follow it: the process verbs refuse such a chain (processChain.md).
  if (offline && items.length > 1)
    throw new Error(
      "a chain separates or it treats: a separating module is the chain's only step",
    );
  const chain = accountChain(name);
  const prev = wsExists(chain.at) ? wsRead(chain.at) : "";
  const text = formatChain(
    {
      ...(input ? { input } : {}),
      steps: [...items, { to: [{ chain: "@out" }] }],
    } as never,
    prev,
  );
  // Read back BEFORE it lands: a file a chain reader would refuse is never written.
  readFileTemplate(chain, text);
  mkdirSync(dirname(chain.at), { recursive: true });
  wsWrite(chain.at, text);
  const presetDir = join(accountLibraryHome(), "vstpresets");
  for (const [id, from] of Object.entries(presets)) {
    mkdirSync(presetDir, { recursive: true });
    copyFileSync(from, join(presetDir, `${id}.vstpreset`));
  }
  return frozenOf(chain, byRef, liveMap(dir));
}

/** The bench's run from its input to its fader, as chain items: one node after another, or a throw saying why not. */
function benchRun(dir: string): {
  items: Item[];
  presets: Record<string, string>;
  ids: Record<string, string>;
  outside: string[];
  input?: ChainInput;
} {
  const graph = parseGraph(wsRead(join(dir, GRAPH_FILE))).value;
  if (!graph) throw new Error("the bench has a graph that does not read");
  const modules = graph.modules ?? {};
  const bypassed = new Set(graph.bypassed ?? []);
  const known = readBenchSource()?.ids ?? {};
  const items: Item[] = [];
  const presets: Record<string, string> = {};
  const ids: Record<string, string> = {};
  const seen = new Set<string>();
  for (let at = LIVE_INPUT; ; ) {
    const next = modules[at] ?? [];
    if (next.length !== 1)
      throw new Error(
        `"${at}" feeds ${next.length ? next.join(" and ") : "nothing"}: a chain is one run from ${LIVE_INPUT} to ${LIVE_FADER}`,
      );
    const node = next[0] as string;
    if (node === LIVE_FADER) break;
    if (seen.has(node)) throw new Error(`"${node}" loops back on itself`);
    seen.add(node);
    const file = join(dir, "nodes", `${node}.k7x`);
    if (!wsExists(file)) throw new Error(`"${node}" has no node file`);
    const id = known[node] ?? randomUUID();
    ids[node] = id;
    items.push({
      id,
      ...wsData(file),
      ...(bypassed.has(node) ? { bypass: true } : {}),
    });
    const preset = join(dir, "nodes", `${node}.vstpreset`);
    if (wsExists(preset)) presets[id] = preset;
    at = node;
  }
  // The bench's modules off that run — unwired, or after the fader — which the chain does not hold.
  const outside = readdirSync(join(dir, "nodes"))
    .filter((f) => f.endsWith(".k7x"))
    .map((f) => f.slice(0, -".k7x".length))
    .filter((n) => !RIG_NODES.has(n) && !seen.has(n))
    .sort();
  // The socket IN is fed from is the chain's too: a chain of nothing but an input is a way to record.
  const channel = wsExists(join(dir, "nodes", `${LIVE_INPUT}.k7x`))
    ? (wsData(join(dir, "nodes", `${LIVE_INPUT}.k7x`)).channel as
        | ChainInput["channel"]
        | undefined)
    : undefined;
  const input = channel !== undefined ? { channel } : undefined;
  if (!items.length && !input)
    throw new Error(
      outside.length
        ? `nothing sits between ${LIVE_INPUT} and ${LIVE_FADER}: ${outside.join(", ")} ${outside.length === 1 ? "is" : "are"} on the bench but not wired between them — insert ${outside.length === 1 ? "it" : "them"} on the ${LIVE_INPUT} → ${LIVE_FADER} cable`
        : `nothing to keep yet: pick ${LIVE_INPUT}'s input channel, or hover the ${LIVE_INPUT} → ${LIVE_FADER} cable and click ⊕ to insert a module`,
    );
  return { items, presets, ids, outside, input };
}

/** `chain save [name]`: the bench's run written as the account's chain; a bench opened on one of the account's chains names itself. */
export function saveBenchChain(
  name?: string,
): FrozenChain & { outside: string[] } {
  const dir = benchDir();
  const source = readBenchSource();
  const mine = `@${ACCOUNT_LIBRARY}/`;
  const chosen =
    name ??
    (source?.ref?.startsWith(mine) ? source.ref.slice(mine.length) : undefined);
  if (!chosen)
    throw new Error(
      "name the chain: `chain save <name>` writes it as @account/<name>",
    );
  const { items, presets, ids, outside, input } = benchRun(dir);
  const saved = writeAccountChain(dir, chosen, items, presets, input);
  // The bench now holds that chain, unedited: the next open of its address rebuilds it from the file.
  writeBenchSource({ ref: saved.ref, ids });
  return { ...saved, outside };
}

/** A copy of any library chain as the account's chain `name`: every step whole, with fresh ids and its presets. */
export function copyFrozenChain(
  dir: string,
  from: string,
  name: string,
): FrozenChain {
  const chain = findLibraryChain(from, dir);
  if (!chain) throw new Error(`no chain "${from}" in the libraries`);
  if (wsExists(fileOf(name)))
    throw new Error(`you already have a chain "${name}"`);
  const items: Item[] = [];
  const presets: Record<string, string> = {};
  const read = readTemplate(chain);
  for (const s of read.steps) {
    // Fresh ids: two chains sharing an id would share their presets' file names.
    const id = randomUUID();
    items.push({ id, ...s.module, ...(s.bypass ? { bypass: true } : {}) });
    if (s.preset) presets[id] = s.preset;
  }
  return writeAccountChain(dir, name, items, presets, read.input);
}

/** Remove one of the account's chains; a library's is never this account's to remove. */
export function deleteFrozenChain(name: string): void {
  if (!FROZEN_NAME.test(name)) throw new Error(`"${name}" is not a chain name`);
  const at = fileOf(name);
  if (!wsExists(at)) throw new Error(`no chain "${name}" of yours`);
  rmSync(at);
  // Rehearsals named it: they record from the microphone again rather than through a chain that is gone.
  if (loadPreferences().rehearsalChain === libraryRef(ACCOUNT_LIBRARY, name))
    setRehearsalChain("");
}

/** The chain rehearsals are recorded through, or null: they record from the microphone. */
export const rehearsalChain = (): string | null =>
  loadPreferences().rehearsalChain ?? null;

/** Choose the rehearsal chain among the account's own that can run live; `""` clears it. */
export function chooseRehearsalChain(dir: string, ref: string): string | null {
  const want = ref.trim();
  if (want) {
    const chain = listFrozenChains(dir).find((c) => c.ref === want);
    if (!chain?.mine)
      throw new Error(`"${want}" is not one of your frozen chains`);
    // A rehearsal is recorded LIVE, through the bench: a chain that cannot play live records nothing.
    if (chain.liveRefusal)
      throw new Error(
        `"${want}" cannot be recorded through live: ${chain.liveRefusal}`,
      );
  }
  return setRehearsalChain(want).rehearsalChain ?? null;
}
