// strudel.ts — evaluate Strudel (TidalCycles' JS port) pattern files and query them
// over a cycle window into timed events, for patternClock.ts to stream onto engine
// tracks. Pinned to @strudel/* 1.1.x: 1.2+ pulls in a browser-only synth
// (@kabelsalat/web) that won't load headless in Node.

/// <reference path="./strudel-shims.d.ts" />
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
// @ts-ignore — @strudel/* ship no types; shimmed for this package, ignored so others can compile it too.
import { evalScope, noteToMidi } from "@strudel/core";
// @ts-ignore
import { evaluate } from "@strudel/transpiler";
import { loadLanes } from "./loader";
import type { Lane } from "./trackModule";

// A track that declares itself the destination of one of a pattern's lanes.
export interface StrudelLane {
  track: string; // the declaring track's id — a real, chainable, mixable track
  label: string; // the lane it claims: the track's name, defaulting to its id
  // No `contentType`: a lane is not typed, so how an event reads is the EVENT's business — a
  // sound that resolves to a sample is a sample, anything else is a waveform, and each leaves by
  // the lane's matching output. See patternClock's resolve() and docs/trackModules.md.
}

// A pattern file and everything the project declares about it.
export interface StrudelLink {
  path: string; // absolute
  lanes: StrudelLane[]; // the tracks fed by this file, by declaration order (id)
  // Where this file's UNDECLARED lanes hang: the group they join and the scope keying their ids, so two patterns
  // can both have an unclaimed "lead".
  group: string; // shared by every declaring track ('' if none, or if they differ)
  key: string; // a stable id fragment for this file (its slugged basename)
}

// The pattern files this project actually plays — a .strudel no track links to is
// IGNORED (algo/ is a library you pick from). Several tracks may claim different lanes
// of one file, so it yields ONE link carrying all of them; a link pointing nowhere is
// kept, so loading reports the miss rather than silently playing nothing.
export function strudelPatterns(dir: string): StrudelLink[] {
  let tracks: Record<string, Lane>;
  try {
    tracks = loadLanes(dir) ?? {};
  } catch {
    return []; // a project that doesn't evaluate has no patterns to play yet
  }
  const groupOf: Record<string, string> = {};
  for (const [id, t] of Object.entries(tracks))
    if (t.type === "group") for (const m of t.tracks) groupOf[m] = id;

  const byPath = new Map<string, StrudelLink>();
  for (const [track, t] of Object.entries(tracks).sort(([a], [b]) =>
    a.localeCompare(b),
  )) {
    if (t.type !== "strudel" || !t.strudel || t.disabled) continue;
    const path = resolve(dir, t.strudel);
    const link = byPath.get(path) ?? {
      path,
      lanes: [],
      group: groupOf[track] ?? "",
      key: patternKey(path),
    };
    // Undeclared lanes can only hang under a group the whole file agrees on.
    if (link.lanes.length && link.group !== (groupOf[track] ?? ""))
      link.group = "";
    link.lanes.push({
      track,
      // The lane's name is its node file's, so the label and the id are one string.
      label: track,
    });
    byPath.set(path, link);
  }
  return [...byPath.values()];
}

// An id fragment scoping the live tracks a pattern mints — the basename is enough, since links are deduped by path.
function patternKey(path: string): string {
  const base = path.replace(/^.*[\\/]/, "").replace(/\.strudel$/, "");
  return (
    base
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "pattern"
  );
}

// Register the pattern functions + the mini-notation string parser once, lazily.
let scopeReady: Promise<unknown> | null = null;
function ensureScope(): Promise<unknown> {
  // @ts-ignore — dynamic import of the untyped @strudel/* packages
  return (scopeReady ??= evalScope(
    import("@strudel/core"),
    import("@strudel/mini"),
  ));
}

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

export interface StrudelPattern {
  path: string;
  orbits: number[]; // the orbits this pattern uses (discovered by sampling)
  query(fromCycle: number, toCycle: number): StrudelEvent[];
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

// Load + evaluate a .strudel file into a queryable pattern; throws on a bad file (querying a valid one never throws).
export async function loadPattern(path: string): Promise<StrudelPattern> {
  await ensureScope();
  const code = readFileSync(path, "utf8");
  const { pattern } = await evaluate(code);

  const query = (from: number, to: number): StrudelEvent[] => {
    const out: StrudelEvent[] = [];
    let haps: any[];
    try {
      haps = pattern.queryArc(from, to);
    } catch {
      return out; // a query that blows up (rare) yields nothing rather than crashing the clock
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
        vel: Math.max(
          0,
          Math.min(1, typeof v.gain === "number" ? v.gain : 0.9),
        ),
        orbit: typeof v.orbit === "number" ? Math.round(v.orbit) : 0,
        note,
        n,
        s,
        label,
      });
    }
    return out;
  };

  const orbits = [...new Set(query(0, 8).map((e) => e.orbit))];
  if (!orbits.length) orbits.push(0);
  return { path, orbits, query };
}
