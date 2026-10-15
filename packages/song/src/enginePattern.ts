// enginePattern.ts — a strudel lane compiled for the ENGINE, which plays it: the plugin(s) heading the lane's halves.
// The pattern's text, its sample banks and how it shares a file with other lanes all travel in the document, since
// the engine parses no files — engine/k7-runtime/docs/patternPlugin.md.

import { join, resolve } from "node:path";
import { loadLanes } from "./loader";
import type { PluginDoc } from "./project";
import type { Lane } from "./trackModule";
import { wsRead } from "./yaml/workspaceFile";

// Must match PatternPlugin::xmlTypeName in the engine.
export const PATTERN_PLUGIN_TYPE = "studio_pattern";

/** A lane the engine plays a pattern on. */
export function isPatternLane(t: Lane): boolean {
  return t.type === "strudel" && !!t.strudel && !t.disabled;
}

/** Where a sound name is looked for as a sample, in order: the project's own, then the libraries the machine names. */
export function sampleBanks(dir: string): string[] {
  const banks = [join(dir, "samples")];
  if (process.env.DIRT_SAMPLES) banks.push(process.env.DIRT_SAMPLES);
  if (process.env.STRUDEL_SAMPLES) banks.push(process.env.STRUDEL_SAMPLES);
  return banks;
}

/** How one lane shares its pattern file: every label the file's lanes claim, and whether it takes the rest. */
export interface PatternShare {
  claimed: string[];
  catchAll: boolean;
}

/** Per pattern lane, its share of its file; the file's FIRST lane by name takes what no lane claims. */
export function patternShares(
  dir: string,
  lanes: Record<string, Lane>,
): Map<string, PatternShare> {
  const byFile = new Map<string, string[]>();
  for (const [name, t] of Object.entries(lanes).sort(([a], [b]) =>
    a.localeCompare(b),
  )) {
    if (!isPatternLane(t)) continue;
    const file = resolve(dir, String(t.strudel));
    byFile.set(file, [...(byFile.get(file) ?? []), name]);
  }
  const out = new Map<string, PatternShare>();
  for (const names of byFile.values())
    for (const [i, name] of names.entries())
      out.set(name, { claimed: names, catchAll: i === 0 });
  return out;
}

/** Every pattern file the project's lanes play, absolute: a save of one is a recompile. */
export function patternFiles(dir: string): string[] {
  let lanes: Record<string, Lane>;
  try {
    lanes = loadLanes(dir) ?? {};
  } catch {
    return [];
  }
  const out = new Set<string>();
  for (const t of Object.values(lanes))
    if (isPatternLane(t)) out.add(resolve(dir, String(t.strudel)));
  return [...out];
}

/**
 * The pattern plugin heading each of the lane's halves, by half id: one playing both on a bare-wired lane, else the
 * notes on `#midi` and the samples on `#audio` — where the Node clock used to put them.
 */
export function patternPlugins<H extends { id: string; port?: string }>(
  dir: string,
  lane: string,
  t: Lane,
  halves: H[],
  share: PatternShare,
  banks: string[],
): Map<string, PluginDoc> {
  let source = "";
  try {
    source = wsRead(resolve(dir, String(t.strudel)));
  } catch {
    // A missing file is already reported by the project's own validation; the lane then plays nothing.
  }
  const notes =
    halves.find((h) => h.port === "midi") ?? halves.find((h) => !h.port);
  const audio =
    halves.find((h) => h.port === "audio") ?? halves.find((h) => !h.port);
  const plays = new Map<H, PluginDoc["patternPlays"]>();
  if (notes && notes === audio) plays.set(notes, "both");
  else {
    if (notes) plays.set(notes, "notes");
    if (audio) plays.set(audio, "samples");
  }
  const out = new Map<string, PluginDoc>();
  for (const [half, what] of plays)
    out.set(half.id, {
      id: `${half.id}:pattern`,
      type: PATTERN_PLUGIN_TYPE,
      name: "Pattern",
      path: "",
      presetSave: "",
      role: "",
      enabled: true,
      params: {},
      patternSource: source,
      patternLabel: lane,
      patternCatchAll: share.catchAll,
      patternClaimed: share.claimed,
      patternPlays: what,
      patternOnly: plays.size === 1,
      patternBanks: banks,
    });
  return out;
}
