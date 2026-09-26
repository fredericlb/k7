// moduleResolve.ts — "what does this module actually run with?", answered ONCE.
//
// A module inherits twice: from the module it `extends`, and from the generic a node
// sits under. Both are the same merge, written once here. Resolving is a step you pass
// THROUGH — the brand on ResolvedModule means a consumer cannot take a raw module by
// accident. See docs/moduleResolve.md.

import { FILE_PARAMS } from "@studio/song-schema/moduleTypes";
import {
  type ControllerFile,
  ControllerFileSchema,
} from "@studio/song-schema/yaml/moduleSchema";
import { applyAlternative } from "./alternatives";
import { resolveModuleAssetIn } from "./assetPath";
import { basePresetIn } from "./basePreset";
import type {
  InstrumentType,
  ModuleUI,
  Rack,
  RackSound,
  Widget,
} from "./graph";
import type { LoadedModule } from "./rawDoc";

/** A module with its ancestry folded in; the brand is phantom and free — see docs/moduleResolve.md. */
declare const RESOLVED: unique symbol;
export type ResolvedModule = LoadedModule & { readonly [RESOLVED]: true };

/** Fields a module owns rather than inherits — WHEN IT HAS THEM, see docs/moduleResolve.md. */
const OWN_ONLY = [
  "kind",
  "inputs",
  "category",
  "name",
  "file",
  "node",
  "home",
] as const;

/** Every key of `o` whose value is not undefined — the shape a spread should carry. */
function defined(o: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(o)) if (v !== undefined) out[k] = v;
  return out;
}

/** Merge a parent UNDER a child; an UNDEFINED child value is not a value — see docs/moduleResolve.md. */
export function mergeAuthored(
  parent: Record<string, unknown>,
  child: Record<string, unknown>,
): Record<string, unknown> {
  type Nested = Record<string, unknown> & {
    symbols?: Record<string, unknown>;
    widgets?: Record<string, unknown>;
  };
  // One sub-object merged per entry, so a module adding one symbol to a base keeps the base's.
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

/** `m` with its ancestry folded in, then its ALTERNATIVE applied ONCE — see docs/moduleResolve.md. */
export function resolveModule(
  m: LoadedModule,
  byRef: Record<string, LoadedModule>,
  seen: Set<string> = new Set(),
): ResolvedModule {
  return applyAlternative(foldExtends(m, byRef, seen));
}

/** The `extends` half, deepest first, cycle-guarded by ref — see docs/moduleResolve.md. */
function foldExtends(
  m: LoadedModule,
  byRef: Record<string, LoadedModule>,
  seen: Set<string>,
): ResolvedModule {
  const ref = m.extends ? String(m.extends) : "";
  const parent = ref && !seen.has(ref) ? byRef[ref] : undefined;
  if (!parent) return m as ResolvedModule;
  seen.add(ref);
  const merged = mergeAuthored(
    foldExtends(parent, byRef, seen) as unknown as Record<string, unknown>,
    m as unknown as Record<string, unknown>,
  ) as unknown as ResolvedModule;
  return withInheritedFiles(merged, m, byRef);
}

/** Re-resolve what this module NAMED against the WHOLE chain's folders — see docs/moduleResolve.md. */
function withInheritedFiles(
  merged: ResolvedModule,
  child: LoadedModule,
  byRef: Record<string, LoadedModule>,
): ResolvedModule {
  // Only what THIS module named — an inherited ref was already resolved where it was declared.
  const authored = child.assets;
  const base = (child as { base?: unknown }).base;
  const wantsAssets = !!authored && FILE_PARAMS.some((p) => authored[p]);
  const wantsBase = typeof base === "string" && !!base.trim();
  if (!wantsAssets && !wantsBase) return merged;

  // The chain's folders, nearest first. Cycle-guarded like resolveModule itself.
  const folders: (string | undefined)[] = [child.folderAbs];
  const walked = new Set<string>();
  let next: string = child.extends ? String(child.extends) : "";
  while (next && !walked.has(next)) {
    walked.add(next);
    const parent: LoadedModule | undefined = byRef[next];
    if (!parent) break;
    folders.push(parent.folderAbs);
    next = parent.extends ? String(parent.extends) : "";
  }
  if (folders.length < 2) return merged; // nothing inherited — the loader's answer already stands

  const out = { ...(merged as LoadedModule) } as LoadedModule;
  if (wantsAssets && authored)
    for (const param of FILE_PARAMS) {
      const ref = authored[param];
      if (typeof ref === "string" && ref)
        out[param] = resolveModuleAssetIn(ref, folders);
    }
  // The nearest folder that HAS this base wins; a miss leaves the merged answer alone, never blanks it.
  if (wantsBase)
    for (const folder of folders) {
      const hit = folder ? basePresetIn(folder, base) : undefined;
      if (hit) {
        out.preset = hit;
        break;
      }
    }
  return out as ResolvedModule;
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

/** What a module IS: a plugin slot or a note→clip rack, "plugin" when unstated — docs/moduleResolve.md. */
export function resolvedType(m: ResolvedModule | undefined): InstrumentType {
  return m?.type === "rack" ? "rack" : "plugin";
}

/** The rack a module runs — total, so a module with no rack answers an empty one. */
export function resolvedRack(m: ResolvedModule | undefined): Rack {
  const r = m?.rack;
  return {
    rackType: r?.rack_type === "slice" ? "slice" : "samples",
    source: r?.source != null ? String(r.source) : undefined,
    // The seam cast: raw symbols passed the module schema, so each carries a numeric note.
    symbols: (r?.symbols ?? {}) as Record<string, RackSound>,
  };
}

/** The widget grid a module SHOWS, normalised, with `hidden` widgets dropped — docs/moduleResolve.md. */
export function resolvedUI(
  m: ResolvedModule | undefined,
): ModuleUI | undefined {
  const ui = m?.ui as ModuleUI | undefined;
  if (!ui) return undefined;
  const widgets: Record<string, Widget> = { ...(ui.widgets ?? {}) };
  for (const [id, w] of Object.entries(widgets))
    if (w?.hidden) delete widgets[id];
  const out: ModuleUI = { cols: ui.cols ?? 0, rows: ui.rows ?? 0, widgets };
  if (typeof ui.script === "string" && ui.script) out.script = ui.script;
  return out;
}

/** The MIDI map a module PLAYS BY, VALIDATED rather than trusted — see docs/moduleResolve.md. */
export function resolvedCc(
  m: ResolvedModule | undefined,
): ControllerFile | undefined {
  if (!m?.cc) return undefined;
  const r = ControllerFileSchema.safeParse(m.cc);
  return r.success && Object.keys(r.data).length ? r.data : undefined;
}
