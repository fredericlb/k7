// engineCatalogue.ts — the modules the ENGINE provides, READ from its plugin scan
// (`~/.studio/exts.json`) rather than copied into files.
//
// No wrapper file mirrors that scan, so `_modules` holds only what someone authored — a jsdsp
// source, a rack's sample map.
//
// A leaf: nothing here imports beyond moduleTypes.ts, so loader.ts can use it without a cycle.

import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  categoryForRole,
  ENGINE_NS,
  engineModuleOf,
  engineRef,
  IO_MODULES,
  MODULE_TYPES,
  slugifyPluginName,
} from "@studio/song-schema/moduleTypes";
import type { LoadedModule } from "./rawDoc";
import { studioHome } from "./studioHome";

/** The scan cache. CONTRACT path — the C++ engine writes and reads this same file (PluginScan.cpp `extsCacheFile()`). */
export const EXTS_PATH = join(studioHome(), "exts.json");

/** One plugin as the engine's scan describes it. `format` is as scanned ("VST3", "internal"). */
export interface ScannedPlugin {
  name: string;
  format: string;
  /** JUCE's `fileOrIdentifier` — the one field that ADDRESSES a plugin, see docs/enginePlugin.md. */
  id?: string;
  manufacturer?: string;
  role?: string; // "instrument" | "audioEffect" | "midiEffect"
  instrument?: boolean;
  category?: string; // the plugin's own, e.g. "Fx|Delay" or "instrument|synth"
}

// Memoised per FILE, so the machine's cache and a test's fixture cannot evict each other.
const memo = new Map<string, { stamp: string; plugins: ScannedPlugin[] }>();

/** Every scanned plugin; EMPTY means "we cannot say", not "none installed" — docs/enginePlugin.md. */
export function scannedPlugins(file = EXTS_PATH): ScannedPlugin[] {
  if (!existsSync(file)) return [];
  let stamp: string;
  try {
    const st = statSync(file);
    stamp = `${st.mtimeMs}:${st.size}`;
  } catch {
    return [];
  }
  const hit = memo.get(file);
  if (hit && hit.stamp === stamp) return hit.plugins;
  const plugins: ScannedPlugin[] = [];
  try {
    const root = JSON.parse(readFileSync(file, "utf8"));
    for (const e of root.entries ?? [])
      for (const p of e.plugins ?? []) {
        if (!p?.name || !p?.format) continue;
        plugins.push({
          name: String(p.name),
          format: String(p.format),
          id: p.id ? String(p.id) : undefined,
          manufacturer: p.manufacturer ? String(p.manufacturer) : undefined,
          role: p.role ? String(p.role) : undefined,
          instrument: p.instrument === true,
          category: p.category ? String(p.category) : undefined,
        });
      }
  } catch {
    return []; // a corrupt cache reads as "unknown", not as "empty"
  }
  // Sorted so a map built from this is stable across runs, whatever order the scan wrote.
  plugins.sort(
    (a, b) => a.name.localeCompare(b.name) || a.format.localeCompare(b.format),
  );
  memo.set(file, { stamp, plugins });
  return plugins;
}

// "<format>|<name>", both lowercased — the engine's iequals(format) && iequals(name) match.
const scanKey = (format: string, name: string): string =>
  `${format.toLowerCase()}|${name.toLowerCase()}`;

/** Every scanned plugin as a "<format>|<name>" key set (both lowercased). Empty ⇒ "unknown" (see scannedPlugins). */
export function scannedPluginKeys(file = EXTS_PATH): Set<string> {
  return new Set(scannedPlugins(file).map((p) => scanKey(p.format, p.name)));
}

/** Does the engine know this external plugin? False only against a NON-EMPTY cache — docs/enginePlugin.md. */
export function isPluginScanned(
  format: string,
  name: string,
  file = EXTS_PATH,
): boolean {
  const keys = scannedPluginKeys(file);
  if (!keys.size) return true; // no cache to judge against
  return keys.has(scanKey(format, name));
}

/** Scanned plugin names grouped by lowercased format — `{ vst3: ["Serum"], internal: […] }`. */
export function scannedPluginNames(file = EXTS_PATH): Record<string, string[]> {
  const names: Record<string, string[]> = {};
  for (const p of scannedPlugins(file))
    (names[p.format.toLowerCase()] ??= []).push(p.name);
  return names;
}

// The ref vocabulary lives in moduleTypes.ts so a BROWSER can name an engine module — docs/enginePlugin.md.
export { ENGINE_NS, engineRef, IO_MODULES };

/** Every module the engine offers, keyed by ref — the scanned plugins plus IN and OUT. */
export function engineModules(file = EXTS_PATH): Record<string, LoadedModule> {
  const out: Record<string, LoadedModule> = {};
  for (const [name, { io }] of Object.entries(IO_MODULES))
    out[engineRef(name)] = {
      io,
      kind: MODULE_TYPES.io.kind,
      inputs: MODULE_TYPES.io.inputs,
      category: "io",
      file: name,
    };
  for (const p of scannedPlugins(file)) {
    // The ref and the plugin block come from moduleTypes, the one rule the browser applies too.
    const named = engineModuleOf(p);
    if (!named) continue;
    const { ref, plugin } = named;
    if (out[ref]) continue; // first wins — two scans of one plugin collapse to one module
    const category = categoryForRole(p);
    const meta = MODULE_TYPES[category];
    out[ref] = {
      plugin,
      kind: meta.kind,
      // The type's defaults and only those: a SCANNED plugin has no file to declare ports in.
      inputs: meta.inputs,
      outputs: meta.outputs,
      category,
      file: slugifyPluginName(p.name),
    };
  }
  return out;
}
