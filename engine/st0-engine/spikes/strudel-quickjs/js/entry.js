// entry.js — the Strudel surface the engine would call, shared verbatim by Node (golden) and QuickJS.
// The hap → event mapping is a copy of packages/song-strudel/src/strudel.ts `query`, so both sides are judged by it.

import { evalScope } from "@strudel/core";
import * as core from "@strudel/core";
import * as mini from "@strudel/mini";
import { evaluate } from "@strudel/transpiler";

let scopeReady = null;
let current = null;

// Registers the pattern functions + mini-notation once; in a bundle the dynamic imports become resolved promises.
function ensureScope() {
  scopeReady ??= evalScope(Promise.resolve(core), Promise.resolve(mini));
  return scopeReady;
}

// Evaluates one pattern source and keeps it as the current pattern.
async function load(code) {
  await ensureScope();
  const { pattern } = await evaluate(code);
  current = pattern;
  return true;
}

// One window of the current pattern, as the events patternClock.ts consumes.
function query(from, to) {
  const out = [];
  if (!current) return out;
  let haps;
  try {
    haps = current.queryArc(from, to);
  } catch {
    return out;
  }
  for (const h of haps) {
    if (!h.whole) continue;
    const hasOnset =
      typeof h.hasOnset === "function"
        ? h.hasOnset()
        : h.whole.begin.valueOf() >= from;
    if (!hasOnset) continue;
    const v = h.value ?? {};
    const note =
      typeof v.note === "number" || typeof v.note === "string"
        ? v.note
        : undefined;
    const n = typeof v.n === "number" ? v.n : undefined;
    const s = typeof v.s === "string" ? v.s : undefined;
    if (note === undefined && n === undefined && s === undefined) continue;
    const label =
      typeof v.label === "string" && v.label.trim() ? v.label.trim() : undefined;
    const begin = h.whole.begin.valueOf();
    const end = h.whole.end.valueOf();
    out.push({
      cycle: begin,
      dur: Math.max(0.01, end - begin),
      vel: Math.max(0, Math.min(1, typeof v.gain === "number" ? v.gain : 0.9)),
      orbit: typeof v.orbit === "number" ? Math.round(v.orbit) : 0,
      note,
      n,
      s,
      label,
    });
  }
  return out;
}

// The C++ side reads strings only, so the query result crosses as JSON.
function queryJson(from, to) {
  return JSON.stringify(query(from, to));
}

globalThis.strudelSpike = { load, query, queryJson };
