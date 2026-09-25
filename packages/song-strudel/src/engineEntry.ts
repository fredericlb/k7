// engineEntry.ts — what the ENGINE calls: bundled by engine/st0-engine/scripts/gen-strudel-bundle.mjs and run in QuickJS.
// Whether an event is a SAMPLE is the engine's to say — it holds the banks — so `s` and `n` travel with every event.

import * as core from "@strudel/core";
import * as mini from "@strudel/mini";
import { evaluate } from "@strudel/transpiler";
import { labelKey, notePitch, queryEvents } from "./events";

// One event of one lane, in cycles; the engine turns cycles into time with the edit's tempo and metre.
export interface LaneEvent {
  cycle: number;
  dur: number;
  key: number; // MIDI 0..127, the pitch it plays at if it turns out to be a NOTE
  vel: number; // 0..1
  s?: string; // the sound name, which the engine tries as a sample first
  n?: number; // the sample variant, when it is one
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

// The lane's events in [from, to) cycles: its own label's, plus — for the catch-all lane — every label no lane claims.
function laneEvents(
  from: number,
  to: number,
  label: string,
  catchAll: boolean,
  claimed: string[],
): LaneEvent[] {
  if (!current) return [];
  const own = labelKey(label);
  const taken = new Set(claimed.map(labelKey));
  const out: LaneEvent[] = [];
  for (const e of queryEvents(current, from, to)) {
    const k = e.label ? labelKey(e.label) : "";
    if (k !== own && !(catchAll && !taken.has(k))) continue;
    const key = Math.max(0, Math.min(127, notePitch(e)));
    out.push({
      cycle: e.cycle,
      dur: e.dur,
      key,
      vel: e.vel,
      ...(e.s ? { s: e.s } : {}),
      ...(e.n !== undefined ? { n: e.n } : {}),
    });
  }
  return out;
}

// The labels the pattern uses in [from, to), as written — what a lane whose label never plays is told.
function labels(from: number, to: number): string[] {
  if (!current) return [];
  const seen = new Set<string>();
  for (const e of queryEvents(current, from, to))
    if (e.label) seen.add(e.label);
  return [...seen];
}

// The C++ side reads strings only, so results cross as JSON, and `claimed` arrives as JSON too.
function laneEventsJson(
  from: number,
  to: number,
  label: string,
  catchAll: boolean,
  claimedJson: string,
): string {
  return JSON.stringify(
    laneEvents(from, to, label, catchAll, JSON.parse(claimedJson || "[]")),
  );
}

function labelsJson(from: number, to: number): string {
  return JSON.stringify(labels(from, to));
}

(globalThis as Record<string, unknown>).st0Strudel = {
  load,
  laneEvents,
  labels,
  laneEventsJson,
  labelsJson,
};
