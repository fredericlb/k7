// events.ts — a pattern's haps → timed events, their pitch, and the label a lane is matched by.
// No `node:` import on purpose: the engine bundles THIS file (engineEntry.ts), so Node and the engine read one mapping.

/// <reference path="./strudel-shims.d.ts" />
// @ts-ignore — @strudel/* ship no types; shimmed for this package, ignored so others can compile it too.
import { noteToMidi } from "@strudel/core";

// A raw pattern event. HOW it plays is the caller's call — `s` may be a waveform, a module, or a sample name.
export interface StrudelEvent {
  cycle: number; // onset, in cycles (absolute along the pattern timeline)
  dur: number; // duration, in cycles
  vel: number; // 0..1 (gain)
  orbit: number; // Strudel/Tidal orbit
  note?: number | string; // explicit pitch (name or MIDI number)
  n?: number; // scale degree / sample-variant index
  s?: string; // sound: synth waveform, project instrument, or sample name
  label?: string; // `.label("kick")` — names the track these events land on
}

// A query's ends are snapped to this grid, in cycles: about a microsecond at a second per cycle, under one sample.
const QUERY_GRID = 1 << 20;

// A double as an EXACT fraction on that grid, as text, which Fraction.js parses without its Farey search (docs/patternPlugin.md).
const onGrid = (x: number): string => `${Math.round(x * QUERY_GRID)}/${QUERY_GRID}`;

// The events whose onset lies in [from, to) cycles; a query that throws yields nothing rather than crashing a clock.
export function queryEvents(
  // biome-ignore lint/suspicious/noExplicitAny: a Strudel pattern is untyped
  pattern: any,
  from: number,
  to: number,
): StrudelEvent[] {
  const out: StrudelEvent[] = [];
  // biome-ignore lint/suspicious/noExplicitAny: haps are untyped
  let haps: any[];
  try {
    haps = pattern.queryArc(onGrid(from), onGrid(to));
  } catch {
    return out;
  }
  for (const h of haps) {
    if (!h.whole) continue; // a continuous/analog fragment — no discrete onset
    const hasOnset =
      typeof h.hasOnset === "function"
        ? h.hasOnset()
        : h.whole.begin.valueOf() >= from;
    if (!hasOnset) continue; // a note that started before this window — don't re-trigger it
    const v = (h.value ?? {}) as Record<string, unknown>;
    const note =
      typeof v.note === "number" || typeof v.note === "string"
        ? (v.note as number | string)
        : undefined;
    const n = typeof v.n === "number" ? v.n : undefined;
    const s = typeof v.s === "string" ? v.s : undefined;
    if (note === undefined && n === undefined && s === undefined) continue; // a control-only hap — no sound
    const label =
      typeof v.label === "string" && v.label.trim()
        ? v.label.trim()
        : undefined;
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

// A pattern's `.label(...)` -> the id fragment keying its track; the `lbl-` prefix keeps it out of orbit ids.
export function labelKey(label: string): string {
  const slug = label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return `lbl-${slug || "x"}`;
}

// A GM-ish drum map for common Dirt names, giving a fallback pitch when a sound resolves to nothing.
const DRUM: Record<string, number> = {
  bd: 36,
  kick: 36,
  sn: 38,
  sd: 38,
  snare: 38,
  cp: 39,
  clap: 39,
  hh: 42,
  hc: 42,
  ho: 46,
  oh: 46,
  rim: 37,
  lt: 45,
  mt: 47,
  ht: 50,
  cy: 49,
  cr: 49,
  ride: 51,
  tom: 45,
};
function hashPitch(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return 48 + (Math.abs(h) % 25); // c3..c5
}

// A hap's explicit pitch -> MIDI note: `note` wins, else `n` as a semitone offset from middle C, else null.
export function hapPitch(note?: number | string, n?: number): number | null {
  if (typeof note === "number") return Math.round(note);
  if (typeof note === "string") {
    const m = noteToMidi(note);
    return Number.isFinite(m) ? Math.round(m) : null;
  }
  if (typeof n === "number") return 60 + Math.round(n);
  return null;
}

// A deterministic pitch for a sound name with no explicit pitch (drum map, else hash).
export function fallbackPitch(name: string): number {
  return DRUM[name] ?? hashPitch(name);
}

// The pitch an event plays at when it is a NOTE — the rule every note-playing route shares.
export function notePitch(e: StrudelEvent): number {
  return hapPitch(e.note, e.n) ?? (e.s ? fallbackPitch(e.s) : 60);
}
