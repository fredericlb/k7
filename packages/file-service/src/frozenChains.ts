// frozenChains.ts — the home page's Frozen chains: the account's own chains, kept as files under
// `@account/chains/`, and the libraries' cold ones beside them read-only. A saved chain is an ordinary
// library chain, so `clip process … @account/<name>` and the recorder's live chains find it unaided.
// What a reader would get wrong: a module with engines takes its values under `engines.<engine>.params`,
// never its top-level `params`, which an engine ignores (packages/song/src/engines.ts). See docs/libraries.md.

import { randomUUID } from "node:crypto";
import { mkdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { isOfflineModule } from "@studio/audio-passes/coldPass";
import {
  type LibraryChainDir,
  libraryChainDirs,
  readFileTemplate,
  readTemplate,
} from "@studio/song/libraryChains";
import { loadModuleRefs } from "@studio/song/loader";
import { moduleCatalogue } from "@studio/song/moduleCatalogue";
import { resolveModule } from "@studio/song/moduleResolve";
import type { LoadedModule } from "@studio/song/rawDoc";
import { accountLibraryHome } from "@studio/song/sharedFolders";
import { wsExists, wsRead, wsWrite } from "@studio/song/yaml/workspaceFile";
import { currentEngine, engineNames } from "@studio/song-schema/engines";
import { ACCOUNT_LIBRARY, libraryRef } from "@studio/song-schema/moduleTypes";
import { formatChain } from "@studio/song-schema/yaml/chainFile";
import type {
  ChainModule,
  ChainModuleParams,
  FrozenChain,
  FrozenChainStep,
} from "@studio/web-protocol";
import { liveChains } from "./benchChain.ts";

/** A frozen chain's name: one path segment, what its file and its ref are named after. */
export const FROZEN_NAME = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;

/** The categories a step may come from: what treats audio, and what separates it. */
const STEP_CATEGORIES = new Set(["audio", "cold"]);

type Modules = Record<string, LoadedModule>;

/** The module that holds `ref`'s engines: itself, or the nearest base it extends that has some. */
function engineHolder(ref: string, byRef: Modules): LoadedModule | undefined {
  let m: LoadedModule | undefined = byRef[ref];
  for (let i = 0; m && i < 16; i++) {
    if (m.engineRefs && Object.keys(m.engineRefs).length) return m;
    const up: string | undefined =
      typeof m.extends === "string" ? m.extends : undefined;
    m = up ? byRef[up] : undefined;
  }
  return undefined;
}

const enginesOf = (ref: string, byRef: Modules) => {
  const holder = engineHolder(ref, byRef);
  return holder
    ? { engines: engineNames(holder), engine: currentEngine(holder) }
    : { engines: [] as string[], engine: undefined };
};

/** A step read off a chain file, in the builder's terms. */
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
    module: typeof module.extends === "string" ? module.extends : "",
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
    const { steps } = readTemplate(c);
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

/** The account's own chains, then the libraries' cold ones — the page's two lists, `dir` the bench resolving them. */
export function listFrozenChains(dir: string): FrozenChain[] {
  const byRef = loadModuleRefs(dir);
  const live = new Map(liveChains(dir).map((l) => [l.ref, l.unavailable]));
  const all = libraryChainDirs(dir).map((c) => frozenOf(c, byRef, live));
  const mine = all.filter((c) => c.mine);
  const cold = all.filter((c) => !c.mine && c.cold);
  const byName = (a: FrozenChain, b: FrozenChain) => a.ref.localeCompare(b.ref);
  return [...mine.sort(byName), ...cold.sort(byName)];
}

/** Every module a step may extend, as the builder's picker lists them. */
export function chainModules(dir: string): ChainModule[] {
  const byRef = loadModuleRefs(dir);
  return moduleCatalogue(dir)
    .filter((m) => STEP_CATEGORIES.has(m.category))
    .map((m) => {
      const resolved = resolveModule({ extends: m.ref } as LoadedModule, byRef);
      return {
        ref: m.ref,
        name: m.name,
        category: m.category,
        offline: isOfflineModule(resolved),
        ...enginesOf(m.ref, byRef),
      };
    });
}

/** What `ref` run as `engine` offers a step: its panel's knobs, with the module's defaults. */
export function chainModuleParams(
  dir: string,
  ref: string,
  engine?: string,
): ChainModuleParams {
  const byRef = loadModuleRefs(dir);
  if (!byRef[ref]) throw new Error(`no module "${ref}"`);
  const { engines, engine: fallback } = enginesOf(ref, byRef);
  if (engine && !engines.includes(engine))
    throw new Error(`"${ref}" has no engine "${engine}"`);
  const chosen = engine ?? fallback;
  const m = resolveModule(
    { extends: ref, ...(chosen ? { engine: chosen } : {}) } as LoadedModule,
    byRef,
  );
  const widgets = ((m.ui as { widgets?: unknown } | undefined)?.widgets ??
    {}) as Record<string, Record<string, unknown>>;
  const defaults = (m.params ?? {}) as Record<string, unknown>;
  const seen = new Set<string>();
  const params: ChainModuleParams["params"] = [];
  for (const w of Object.values(widgets)) {
    const name = typeof w.bind === "string" ? w.bind : "";
    if (!name || seen.has(name)) continue;
    seen.add(name);
    const min = Number(w.min ?? 0);
    const max = Number(w.max ?? 1);
    const value = Number(defaults[name] ?? min);
    params.push({
      name,
      label: typeof w.label === "string" ? w.label : name,
      min,
      max,
      value: Number.isFinite(value) ? value : min,
    });
  }
  return { ...(chosen ? { engine: chosen } : {}), params };
}

/** Where `name`'s file is in the account's library. */
const fileOf = (name: string): string =>
  join(accountLibraryHome(), "chains", `${name}.k7x`);

/** The chain file's item for one step: the engine's values under its engine, or the module's own. */
function itemOf(s: FrozenChainStep): Record<string, unknown> {
  const values = Object.keys(s.params).length ? s.params : undefined;
  return {
    id: s.id || randomUUID(),
    extends: s.module,
    ...(s.engine
      ? {
          engine: s.engine,
          ...(values ? { engines: { [s.engine]: { params: values } } } : {}),
        }
      : values
        ? { params: values }
        : {}),
    ...(s.bypass ? { bypass: true } : {}),
  };
}

/** Write `name` into the account's library as `steps`; throws with the reason, having written nothing. */
export function saveFrozenChain(
  dir: string,
  name: string,
  steps: FrozenChainStep[],
): FrozenChain {
  if (!FROZEN_NAME.test(name))
    throw new Error(
      `"${name}" is not a chain name — letters, digits, '-' and '_', starting with a letter or digit`,
    );
  if (!steps.length) throw new Error("a chain holds at least one step");
  const byRef = loadModuleRefs(dir);
  let offline = 0;
  for (const [i, s] of steps.entries()) {
    if (!byRef[s.module])
      throw new Error(`step ${i + 1}: no module "${s.module}"`);
    if (s.engine && !enginesOf(s.module, byRef).engines.includes(s.engine))
      throw new Error(
        `step ${i + 1}: "${s.module}" has no engine "${s.engine}"`,
      );
    if (
      isOfflineModule(
        resolveModule({ extends: s.module } as LoadedModule, byRef),
      )
    )
      offline++;
  }
  // A separator writes files, so nothing could follow it: the process verbs refuse such a chain (processChain.md).
  if (offline && steps.length > 1)
    throw new Error(
      "a chain separates or it treats: a separating module is the chain's only step",
    );
  const at = fileOf(name);
  const prev = wsExists(at) ? wsRead(at) : "";
  const text = formatChain(
    {
      steps: [
        // A step naming no engine of a module that has some runs its default, so its values go there.
        ...steps.map((s) =>
          itemOf({
            ...s,
            engine: s.engine ?? enginesOf(s.module, byRef).engine,
          }),
        ),
        { to: [{ chain: "@out" }] },
      ],
    } as never,
    prev,
  );
  const chain: LibraryChainDir = {
    ref: libraryRef(ACCOUNT_LIBRARY, name),
    library: ACCOUNT_LIBRARY,
    path: name,
    at,
    layout: "file",
    libraryRoot: accountLibraryHome(),
    nodes: [],
  };
  // Read back BEFORE it lands: a file a chain reader would refuse is never written.
  readFileTemplate(chain, text);
  mkdirSync(dirname(at), { recursive: true });
  wsWrite(at, text);
  const live = new Map(liveChains(dir).map((l) => [l.ref, l.unavailable]));
  return frozenOf(chain, byRef, live);
}

/** Remove one of the account's chains; a library's is never this account's to remove. */
export function deleteFrozenChain(name: string): void {
  if (!FROZEN_NAME.test(name)) throw new Error(`"${name}" is not a chain name`);
  const at = fileOf(name);
  if (!wsExists(at)) throw new Error(`no chain "${name}" of yours`);
  rmSync(at);
}
