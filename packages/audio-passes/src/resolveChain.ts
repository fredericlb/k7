// resolveChain.ts — which chain a bounce runs: one of the project's own, taken off the compiled
// document, or a library's, read off its template with its offline steps diverted to cold steps.
// A chain either bounces or separates, never both. See docs/processChain.md.

import {
  DSP_GRAPH_PLUGIN,
  enginePlugin,
  pluginDoc,
} from "@studio/engine-protocol/build";
import {
  type LibraryChainDir,
  libraryChainDirs,
  readTemplate,
} from "@studio/song/libraryChains";
import { loadModuleRefs } from "@studio/song/loader";
import { type MissingModel, missingModel } from "@studio/song/modelCache";
import { resolveModule } from "@studio/song/moduleResolve";
import type { PluginDoc, ProjectDoc } from "@studio/song/project";
import { MIXER_PLUGIN } from "@studio/song/project";
import { wsRead } from "@studio/song/yaml/workspaceFile";
import {
  DEFAULT_LIBRARY,
  libraryRefParts,
} from "@studio/song-schema/moduleTypes";
import { INSTRUMENTAL } from "@studio/song-schema/stems";
import {
  type ColdStep,
  coldStepOf,
  isOfflineModule,
  outputsOf,
} from "./coldPass";

/** The one track a bounce document has. A name, so a doc read by hand says what it was for. */
export const BOUNCE_CHAIN = "process";

// A module as `loadModuleRefs` hands it over — taken off that function, since `rawDoc` is not an export subpath.
type LoadedModule = ReturnType<typeof loadModuleRefs>[string];

/** A chain resolved far enough to render: what to call the result, and the plugins in order. */
export interface ResolvedChain {
  /** What the user typed — for messages. */
  ref: string;
  /** Filename-safe, appended to each render (`kick.wav` → `kick_vocal-strip.wav`). */
  slug: string;
  plugins: PluginDoc[];
  /** The steps that produce FILES instead of processing a buffer — an `offline` module, docs/processChain.md. */
  cold: ColdStep[];
  /** The track this chain already runs on, when it is one of the project's — the caller says so out loud. */
  ownTrack?: string;
}

/** Only numbers reach the engine — a file-valued param travels as its own field. Mirrors `numericParams`. */
function numbers(params: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(
    (params ?? {}) as Record<string, unknown>,
  ))
    if (typeof v === "number") out[k] = v;
  return out;
}

/** A jsdsp module's compiled graph, from the `.json` sibling of its source — the engine parses no files. */
function dspGraphOf(m: LoadedModule): string | undefined {
  if (!m.jsdsp) return undefined;
  const built = `${String(m.jsdsp).replace(/\.[tj]sx?$/, "")}.json`;
  try {
    return wsRead(built);
  } catch {
    return undefined; // never compiled on this machine — reported by the caller
  }
}

/** The chains this command can name: the project's own, then every library's under its `@<library>/` ref. */
export function chainNames(dir: string, project: ProjectDoc): string[] {
  const own = new Set<string>();
  for (const t of project.tracks)
    for (const p of t.plugins) {
      const at = p.id.indexOf(":");
      if (at > 0) own.add(p.id.slice(0, at));
    }
  return [...[...own].sort(), ...libraryChainDirs(dir).map((c) => c.ref)];
}

/** A chain of the PROJECT, taken off the compiled document under its `<chain>:` prefix — docs/processChain.md. */
function projectChain(
  project: ProjectDoc,
  name: string,
): { plugins: PluginDoc[]; ownTrack: string } | null {
  for (const t of project.tracks) {
    const plugins = t.plugins.filter((p) => p.id.startsWith(`${name}:`));
    if (plugins.length) return { plugins, ownTrack: t.id };
  }
  return null;
}

/** The library chain a ref names, by path then by bare name, in `library` or the default one first — docs/processChain.md. */
function findLibraryChainBy(
  library: string | null,
  want: string,
  dir: string,
): LibraryChainDir | null {
  const chains = libraryChainDirs(dir)
    .filter((c) => library === null || c.library === library)
    .sort(
      (a, b) =>
        Number(b.library === DEFAULT_LIBRARY) -
        Number(a.library === DEFAULT_LIBRARY),
    );
  return (
    chains.find((c) => c.path === want) ??
    chains.find((c) => c.path.split("/").pop() === want) ??
    null
  );
}

/** A library chain's steps as a bounce runs them: plugins in order, or the cold steps that separate. */
function mediatekChain(
  dir: string,
  chain: LibraryChainDir,
): {
  plugins: PluginDoc[];
  cold: ColdStep[];
  missing: string[];
  /** How many steps the chain runs — what tells "every step is offline" from "some are". */
  steps: number;
  /** Each OFFLINE step, what it declares it writes, and the model it names that this machine has not got. */
  offline: { step: string; outputs: string[]; model: MissingModel | null }[];
} {
  const read = readTemplate(chain);
  // A bypassed step is in the template and out of the signal, so a bounce skips it.
  const steps = read.steps.filter((s) => !s.bypass);
  const byRef = loadModuleRefs(dir);
  const plugins: PluginDoc[] = [];
  const cold: ColdStep[] = [];
  const missing: string[] = [...read.missing];
  const offline: {
    step: string;
    outputs: string[];
    model: MissingModel | null;
  }[] = [];

  for (const { name: id, label: step, module: raw } of steps) {
    const m = resolveModule(raw as unknown as LoadedModule, byRef);
    // An OFFLINE module is diverted here: it has no engine plugin by construction, docs/processChain.md.
    if (isOfflineModule(m)) {
      let outputs: string[] = [];
      try {
        outputs = outputsOf(step, m);
      } catch {
        /* a module naming outputs no separation writes — coldStepOf says so, below */
      }
      offline.push({ step, outputs, model: missingModel(m) });
      try {
        cold.push(coldStepOf(step, m));
      } catch (e) {
        missing.push((e as Error).message);
      }
      continue;
    }
    const { type, name } = enginePlugin(m.plugin, step);
    if (!type) {
      missing.push(
        `${step} (extends ${String(raw.extends ?? "nothing")} — not in this machine's cache)`,
      );
      continue;
    }
    const dspGraph = dspGraphOf(m);
    if (type === DSP_GRAPH_PLUGIN && !dspGraph) {
      missing.push(`${step} (its DSP graph has never been compiled here)`);
      continue;
    }
    plugins.push(
      pluginDoc({
        id: `${BOUNCE_CHAIN}:${id}`,
        type,
        name,
        path: m.preset ? String(m.preset) : "",
        ...(m.model ? { namFile: String(m.model) } : {}),
        ...(dspGraph ? { dspGraph } : {}),
        params: numbers(m.params),
      }),
    );
  }
  return {
    plugins,
    cold,
    missing,
    steps: steps.length + read.missing.length,
    offline,
  };
}

/** A library chain that SEPARATES, for the settings that pick which one this machine uses. */
export interface ColdChain {
  /** `@k7-core/<path>`, what `system stems` and the preferences store. */
  ref: string;
  /** One of its offline steps declares an `instrumental` output — what `system instrumental` insists on. */
  instrumental: boolean;
  /** Why THIS machine cannot run it yet — its model not downloaded, a module not in its cache — or null when it can. */
  unavailable: string | null;
  /** The models it needs and this machine has not got, that a `model_url` says where to fetch — empty when none. */
  downloads: { file: string; url: string }[];
}

/** The médiathèque's COLD chains — every step offline — each with why this machine cannot run it yet; docs/processChain.md. */
export function coldChains(dir: string): ColdChain[] {
  const out: ColdChain[] = [];
  for (const c of libraryChainDirs(dir)) {
    let chain: ReturnType<typeof mediatekChain>;
    try {
      chain = mediatekChain(dir, c);
    } catch {
      continue; // an unreadable graph file is no chain to offer
    }
    if (!chain.offline.length || chain.offline.length !== chain.steps) continue;
    out.push({
      ref: c.ref,
      instrumental: chain.offline.some((s) => s.outputs.includes(INSTRUMENTAL)),
      unavailable: chain.missing.length ? chain.missing.join("; ") : null,
      downloads: chain.offline.flatMap((s) =>
        s.model?.url ? [{ file: s.model.file, url: s.model.url }] : [],
      ),
    });
  }
  return out.sort((a, b) => a.ref.localeCompare(b.ref));
}

/** The chain to run, the project asked FIRST — throws with what to do next; see docs/processChain.md. */
export function resolveChain(
  dir: string,
  project: ProjectDoc,
  ref: string,
): ResolvedChain {
  const trimmed = ref.trim();
  if (!trimmed) throw new Error("no chain named");
  // `@<library>/<path>` names one library; a bare name is the project's first, then any library's.
  const named = libraryRefParts(trimmed);
  const library = named !== null;
  const want = (named ? named.rest : trimmed).replace(/^\/+|\/+$/g, "");
  const slug =
    want
      .split("/")
      .filter(Boolean)
      .pop()
      ?.replace(/[^A-Za-z0-9_-]+/g, "-") || "chain";

  if (!library) {
    const own = projectChain(project, trimmed);
    if (own) {
      const plugins = own.plugins
        .filter((p) => p.type !== MIXER_PLUGIN)
        .map((p) => {
          const copy: PluginDoc = { ...p };
          delete copy.sidechainFrom;
          return copy;
        });
      // A chain that is only a strip has nothing left to bake in once the mixer is dropped.
      if (!plugins.length)
        throw new Error(
          `chain '${trimmed}' has no treatment to apply — only ${own.ownTrack}'s strip, which stays live`,
        );
      // No cold steps: the compiler emits no plugin for an offline module, docs/processChain.md.
      return { ref: trimmed, slug, ownTrack: own.ownTrack, plugins, cold: [] };
    }
  }

  const found = findLibraryChainBy(named?.library ?? null, want, dir);
  if (!found) {
    const known = chainNames(dir, project);
    throw new Error(
      `no chain '${trimmed}' — known here: ${known.join(", ") || "none"}` +
        (libraryChainDirs(dir).length
          ? ""
          : " (this machine has cloned no library holding chains)"),
    );
  }
  const { plugins, cold, missing } = mediatekChain(dir, found);
  if (missing.length)
    throw new Error(
      `chain '${found.ref}' has steps this machine cannot load: ${missing.join(", ")}`,
    );
  if (!plugins.length && !cold.length)
    throw new Error(`chain '${found.ref}' puts the signal through no module`);
  // A chain either BOUNCES or SEPARATES, and mixing the two is refused by name — docs/processChain.md.
  if (cold.length && plugins.length)
    throw new Error(
      `chain '${found.ref}' both separates (${cold
        .map((c) => c.step)
        .join(
          ", ",
        )}) and processes (${plugins.length} module(s)) — a bounce cannot say which ` +
        "of the stems the next step treats. Put the separation in a chain of its own.",
    );
  return { ref: trimmed, slug, plugins, cold };
}
