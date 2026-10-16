// engines.ts — a module's ENGINES: the other modules it can run as, one sub-folder each under its
// `engines/`, and which one is on. Pure struct work with no filesystem, so a browser may ask; the
// walk that FINDS them is @studio/song's. One thing a reader gets wrong: an engine is not an
// alternative — the module declares engines, a node picks one. See packages/song/docs/engines.md.

/** The folder beside `module.yaml` that holds one sub-folder per engine. */
export const ENGINES_DIR = "engines";

/** The engine a module runs when it names none and has one called this — the Tracktion built-in. */
const DEFAULT_ENGINE = "tracktion";

/** An engine's name is a folder name, and a word in a ref. */
export const ENGINE_NAME = /^[A-Za-z0-9_-]+$/;

/** The ref an engine is loaded under: its module's ref, then the folder it sits in. */
export const engineRefOf = (moduleRef: string, engine: string): string =>
  `${moduleRef}/${ENGINES_DIR}/${engine}`;

/** What a module carries about its engines once loaded — the AUTHORED half and the loader's. */
export interface EngineFields {
  /** The one it runs; absent is the default rule in `currentEngine`. */
  engine?: unknown;
  /** Per-engine values a module or node SETS — `{ <engine>: { params } }`. */
  engines?: unknown;
  /** Added by the loader: every engine the module's folder holds, name → ref. */
  engineRefs?: Record<string, string>;
}

/** Every engine name a module offers, sorted, the default first. */
export function engineNames(m: EngineFields | null | undefined): string[] {
  const names = Object.keys(m?.engineRefs ?? {}).sort();
  const at = names.indexOf(DEFAULT_ENGINE);
  if (at > 0) names.unshift(...names.splice(at, 1));
  return names;
}

/** The engine that is ON: the one named if the module has it, else `tracktion`, else the first. */
export function currentEngine(
  m: EngineFields | null | undefined,
): string | undefined {
  const names = engineNames(m);
  if (!names.length) return undefined;
  const want = typeof m?.engine === "string" ? m.engine : undefined;
  return want && names.includes(want) ? want : names[0];
}

/** The params a module or node set for ONE engine, from its `engines:` map. */
export function engineParams(
  m: EngineFields | null | undefined,
  engine: string,
): Record<string, number | string> | undefined {
  const all = m?.engines as
    | Record<string, { params?: Record<string, number | string> }>
    | undefined;
  return all?.[engine]?.params;
}
