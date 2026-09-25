// engineEntry.ts — what the ENGINE calls: bundled by engine/st0-engine/scripts/gen-strudel-bundle.mjs and run in QuickJS.
// Every event plays as a NOTE here: the engine resolves no sample names — engine/st0-engine/docs/patternPlugin.md.

import * as core from "@strudel/core";
import * as mini from "@strudel/mini";
import { evaluate } from "@strudel/transpiler";
import { labelKey, notePitch, queryEvents } from "./events";

// One note of one lane, in cycles; the engine turns cycles into time with the edit's tempo and metre.
export interface LaneNote {
  cycle: number;
  dur: number;
  key: number; // MIDI 0..127
  vel: number; // 0..1
}

let scopeReady: Promise<unknown> | null = null;
// biome-ignore lint/suspicious/noExplicitAny: a Strudel pattern is untyped
let current: any = null;

// Registers the pattern functions + mini-notation once; in a bundle there is nothing to import dynamically.
function ensureScope(): Promise<unknown> {
  scopeReady ??= core.evalScope(Promise.resolve(core), Promise.resolve(mini));
  return scopeReady;
}

// Evaluates a pattern file's source and makes it current; a throw leaves the previous one current.
async function load(code: string): Promise<boolean> {
  await ensureScope();
  const { pattern } = await evaluate(code);
  current = pattern;
  return true;
}

// The lane's notes in [from, to) cycles: events labelled for it, or every event when the lane claims no label.
function laneNotes(from: number, to: number, label: string): LaneNote[] {
  if (!current) return [];
  const want = label ? labelKey(label) : "";
  const out: LaneNote[] = [];
  for (const e of queryEvents(current, from, to)) {
    if (want && (!e.label || labelKey(e.label) !== want)) continue;
    const key = Math.max(0, Math.min(127, notePitch(e)));
    out.push({ cycle: e.cycle, dur: e.dur, key, vel: e.vel });
  }
  return out;
}

// The C++ side reads strings only, so the result crosses as JSON.
function laneNotesJson(from: number, to: number, label: string): string {
  return JSON.stringify(laneNotes(from, to, label));
}

(globalThis as Record<string, unknown>).st0Strudel = {
  load,
  laneNotes,
  laneNotesJson,
};
