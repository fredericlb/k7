// moduleResolve.ts — "what does this module actually run with?", answered ONCE.
//
// A module inherits twice: from the module it `extends`, and from the generic an instance
// sits under. Both are the same merge, and it used to live in five places that had already
// drifted. Resolving is now a step you pass THROUGH — the brand on ResolvedModule means a
// consumer cannot take a raw module by accident. See docs/moduleResolve.md.

import type {
  InstrumentType,
  ModuleUI,
  Rack,
  RackSound,
  Widget,
} from "./graph";
import type { LoadedModule } from "./rawDoc";

/**
 * A module with its ancestry folded in. The brand is phantom — nothing is written at
 * runtime — so this is free, and a serialized module is byte-identical to a raw one.
 *
 * It exists so `resolveModule` is the ONLY way to obtain one: a sixth inline copy of the
 * merge would not typecheck against the consumers that ask for this.
 */
declare const RESOLVED: unique symbol;
export type ResolvedModule = LoadedModule & { readonly [RESOLVED]: true };

/**
 * Fields a module owns rather than inherits — WHEN IT HAS THEM.
 *
 * They come from where it lives: `kind` and `inputs` off its type folder, `category` off the
 * folder that draws its icon, `file`/`instance`/`name` off the file itself. A module in
 * `audio/` that extends an instrument is still an effect.
 *
 * "When it has them" is load-bearing, and the loop below says it: the child's value wins only
 * if the KEY IS PRESENT. An instance in the project's flat `instances/` has no type folder to
 * read `kind`, `inputs` or `category` off, so the loader leaves them absent and they arrive
 * from whatever it extends — which is the whole reason an instance no longer has to be filed
 * under the module it uses. See docs/instances.md.
 */
const OWN_ONLY = [
  "kind",
  "inputs",
  "category",
  "name",
  "file",
  "instance",
  "home",
] as const;

/** Every key of `o` whose value is not undefined — the shape a spread should carry. */
function defined(o: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(o)) if (v !== undefined) out[k] = v;
  return out;
}

/**
 * Merge a parent UNDER a child: the child wins per key, params/symbols/widgets/assets
 * merge per entry.
 *
 * An UNDEFINED value on the child does not count as a value. That is the whole fix: the
 * loader writes `ir`/`nam`/`jsdsp`/`preset` on every module it decorates, at `undefined`
 * when there is none, so a plain spread had the child erase its parent's assets — which
 * is why five call sites had grown a `?? base?.x` for each one.
 */
export function mergeAuthored(
  parent: Record<string, unknown>,
  child: Record<string, unknown>,
): Record<string, unknown> {
  type Nested = Record<string, unknown> & {
    symbols?: Record<string, unknown>;
    widgets?: Record<string, unknown>;
  };
  // One sub-object merged per entry: absent on either side is the other whole, so a
  // module that adds one symbol to a base keeps the base's.
  const perEntry = (
    p: Nested | undefined,
    c: Nested | undefined,
    inner: "symbols" | "widgets",
  ): Nested | undefined => {
    if (!p) return c;
    if (!c) return p;
    return {
      ...p,
      ...defined(c),
      [inner]: { ...(p[inner] ?? {}), ...(c[inner] ?? {}) },
    };
  };
  const flat = (key: string): Record<string, unknown> | undefined => {
    const p = parent[key] as Record<string, unknown> | undefined;
    const c = child[key] as Record<string, unknown> | undefined;
    return p || c ? { ...(p ?? {}), ...(c ?? {}) } : undefined;
  };

  const out: Record<string, unknown> = {
    ...parent,
    ...defined(child),
    params: flat("params") ?? {},
    rack: perEntry(
      parent.rack as Nested | undefined,
      child.rack as Nested | undefined,
      "symbols",
    ),
    ui: perEntry(
      parent.ui as Nested | undefined,
      child.ui as Nested | undefined,
      "widgets",
    ),
    assets: flat("assets"),
  };
  for (const k of OWN_ONLY) if (k in child) out[k] = child[k];
  if (out.rack === undefined) delete out.rack;
  if (out.ui === undefined) delete out.ui;
  if (out.assets === undefined) delete out.assets;
  return out;
}

/**
 * `m` with its whole `extends` ancestry folded in, deepest first.
 *
 * Cycle-guarded by ref: a chain that loops stops at the repeat and resolves what it read
 * so far, because a bad `extends` should cost the inheritance, not the project. A ref that
 * names nothing is likewise not an error here — validate() is what reports it.
 */
export function resolveModule(
  m: LoadedModule,
  byRef: Record<string, LoadedModule>,
  seen: Set<string> = new Set(),
): ResolvedModule {
  const ref = m.extends ? String(m.extends) : "";
  const parent = ref && !seen.has(ref) ? byRef[ref] : undefined;
  if (!parent) return m as ResolvedModule;
  seen.add(ref);
  return mergeAuthored(
    resolveModule(parent, byRef, seen) as unknown as Record<string, unknown>,
    m as unknown as Record<string, unknown>,
  ) as unknown as ResolvedModule;
}

/** Resolve a ref against the map it lives in; undefined when nothing answers to it. */
export function resolveModuleRef(
  ref: string,
  byRef: Record<string, LoadedModule>,
): ResolvedModule | undefined {
  const m = byRef[ref];
  return m ? resolveModule(m, byRef, new Set([ref])) : undefined;
}

/** A whole map resolved, keys unchanged — what a consumer of many modules wants. */
export function resolveModuleMap<T extends Record<string, LoadedModule>>(
  modules: T,
  byRef: Record<string, LoadedModule> = modules,
): Record<keyof T & string, ResolvedModule> {
  const out = {} as Record<string, ResolvedModule>;
  for (const [k, m] of Object.entries(modules))
    out[k] = resolveModule(m, byRef, new Set([k]));
  return out;
}

/**
 * What a module IS: a plugin slot, or a note→clip rack. "plugin" when unstated.
 *
 * Distinct from `kind` (its type folder) and from `plugin.type` (the xmlTypeName): this
 * is the authored discriminator that decides whether the engine gets a plugin or a
 * sampler.
 */
export function resolvedType(m: ResolvedModule | undefined): InstrumentType {
  return m?.type === "rack" ? "rack" : "plugin";
}

/**
 * The rack a module runs: its flavour, its shared source, and every symbol.
 *
 * Total — a module with no rack answers an empty one, so the rack branch never has to
 * ask twice whether there is anything to read.
 */
export function resolvedRack(m: ResolvedModule | undefined): Rack {
  const r = m?.rack;
  return {
    rackType: r?.rack_type === "slice" ? "slice" : "samples",
    source: r?.source != null ? String(r.source) : undefined,
    // The seam cast: raw symbols passed the module schema, so each carries a numeric
    // note and the clip/from/to fields the consumers coerce.
    symbols: (r?.symbols ?? {}) as Record<string, RackSound>,
  };
}

/**
 * The widget grid a module SHOWS. Widgets are already merged per id by the resolver;
 * what is left is normalising.
 *
 * A `hidden` widget is dropped here. `hidden` exists only because an inherited widget
 * cannot be unset, so it is a wire detail no reader should have to think about — and
 * dropping it once means no panel has to remember to.
 */
export function resolvedUI(
  m: ResolvedModule | undefined,
): ModuleUI | undefined {
  const ui = m?.ui as ModuleUI | undefined;
  if (!ui) return undefined;
  const widgets: Record<string, Widget> = { ...(ui.widgets ?? {}) };
  for (const [id, w] of Object.entries(widgets))
    if (w?.hidden) delete widgets[id];
  return { cols: ui.cols ?? 0, rows: ui.rows ?? 0, widgets };
}
