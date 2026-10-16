// params.ts — during import, ask the engine to enumerate a plugin's parameters so emit.ts
// can write diffable text params instead of an opaque .vstpreset. The preset is only
// dropped when the engine reports the params fully reproduce the state; the whole step is
// a no-op without an engine binary. Full rationale: docs/import.md.

import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { extname, join } from "node:path";
import type { PluginOut, Song } from "./model.js";

const BEGIN = "STUDIO_PARAMS_BEGIN";
const END = "STUDIO_PARAMS_END";

// Locating the engine is the CALLER's job, and a copy of that search here broke on a move — docs/import.md.

// name -> { format, identifier } from the plugin cache, matching an imported plugin to one the engine can load.
type CacheEntry = { format: string; id: string };
function loadCacheIndex(): Map<string, CacheEntry> {
  const index = new Map<string, CacheEntry>();
  const file = join(homedir(), ".studio", "exts.json");
  if (!existsSync(file)) return index;
  try {
    const root = JSON.parse(readFileSync(file, "utf8"));
    for (const e of root.entries ?? [])
      for (const p of e.plugins ?? [])
        if (p?.name && p?.id)
          index.set(String(p.name).toLowerCase(), {
            format: String(p.format ?? ""),
            id: String(p.id),
          });
  } catch {
    /* ignore a corrupt cache */
  }
  return index;
}

// Parse the engine's fenced { params, complete } payload.
function parseDump(
  out: string,
): { params: Record<string, number>; complete: boolean } | undefined {
  const b = out.indexOf(BEGIN);
  const e = out.indexOf(END);
  if (b < 0 || e < 0 || e <= b) return undefined;
  try {
    const root = JSON.parse(out.slice(b + BEGIN.length, e).trim());
    const params: Record<string, number> = {};
    for (const [k, v] of Object.entries(root.params ?? {}))
      if (typeof v === "number") params[k] = v;
    return Object.keys(params).length
      ? { params, complete: !!root.complete }
      : undefined;
  } catch {
    return undefined;
  }
}

// Run the engine and capture stdout; undefined on non-zero exit / spawn failure.
function runEngine(engineExe: string, args: string[]): string | undefined {
  try {
    return execFileSync(engineExe, args, { encoding: "utf8", timeout: 30000 });
  } catch {
    return undefined;
  }
}

type Dump = { params: Record<string, number>; complete: boolean };
type DumpResult = { ok: true; dump: Dump } | { ok: false; reason: string };

// Dump one plugin's params, returning a readable reason on failure so a kept-as-preset plugin is never silent.
function dumpOne(
  engineExe: string,
  p: PluginOut,
  files: Record<string, Uint8Array>,
  cache: Map<string, CacheEntry>,
  tmpDir: string,
): DumpResult {
  const entry = cache.get(p.name.toLowerCase());
  const stateBytes = p.path ? files[p.path] : undefined;

  if (p.path) {
    if (!stateBytes)
      return {
        ok: false,
        reason: `state file '${p.path}' missing from the archive`,
      };
    if (!entry)
      return {
        ok: false,
        reason: `not in the plugin cache — run 'k7 engine scan' (looked up by name '${p.name}')`,
      };
    const stateFile = join(tmpDir, `state${extname(p.path) || ".vstpreset"}`);
    writeFileSync(stateFile, stateBytes);
    const out = runEngine(engineExe, [
      "--dump-params-ext",
      entry.format,
      entry.id,
      stateFile,
    ]);
    const d = out ? parseDump(out) : undefined;
    return d
      ? { ok: true, dump: d }
      : {
          ok: false,
          reason: "engine returned no params (preset load may have failed)",
        };
  }

  // No state file: try a built-in dump (fires only if p.type is a Tracktion type).
  const out = runEngine(engineExe, ["--dump-params", p.type]);
  const d = out ? parseDump(out) : undefined;
  return d
    ? { ok: true, dump: d }
    : { ok: false, reason: `no state to convert (type '${p.type}')` };
}

// Fill each plugin's params from the engine; mutates `song` and reports every plugin that stays a preset.
export function resolvePluginParams(
  song: Song,
  files: Record<string, Uint8Array>,
  engineExe: string | undefined,
): number {
  if (!engineExe) return 0; // the CLI already noted this
  const cache = loadCacheIndex();
  const memo = new Map<string, DumpResult>();
  const misses = new Map<string, string>(); // plugin name -> reason (deduped)
  const tmpDir = mkdtempSync(join(tmpdir(), "studio-params-"));
  let filled = 0;
  try {
    for (const t of song.tracks)
      for (const p of t.plugins ?? []) {
        // Key the dump cache by the STATE FILE too, or two presets share one dump — see docs/import.md.
        const key = `${p.name.toLowerCase()}|${p.type}|${p.path ?? ""}`;
        if (!memo.has(key))
          memo.set(key, dumpOne(engineExe, p, files, cache, tmpDir));
        const r = memo.get(key)!;
        if (r.ok) {
          p.params = r.dump.params;
          p.paramsComplete = r.dump.complete;
          filled++;
        } else {
          misses.set(p.name, r.reason);
        }
      }
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
  if (misses.size) {
    console.warn(
      `  ${misses.size} plugin(s) kept as .vstpreset (no text params):`,
    );
    for (const [name, reason] of misses)
      console.warn(`    ! ${name}: ${reason}`);
  }
  return filled;
}
