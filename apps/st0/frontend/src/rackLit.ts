// rackLit.ts — which rack sounds are firing right now, DERIVED rather than observed.
//
// The engine reports no notes: its live frame is transport, playhead, meters and armed tracks,
// and nothing about a sampler's voices. But the browser holds the arrangement and the playhead at
// the same time, so "which note is sounding" is a question it can answer itself. See
// packages/song/docs/racks.md for what that costs — live MIDI and strudel lanes light nothing,
// because their notes were never written down.

import { useEngineStoreOrNull } from "@studio/engine-browser/store";
import type { RackLitStore } from "@studio/ui-chains-react";
import { useEffect, useMemo } from "react";
import { clipLoop } from "./clipLoop";
import type { WebClip, WebGraph, WebNote, WebProject } from "./types";

/** One note reaching a rack, in ARRANGEMENT beats: when it starts, when it stops, which key. */
export interface Hit {
  from: number;
  to: number;
  key: number;
}

/** The shortest a pad stays lit, in beats — a floor on the DISPLAY, not on the note, so a thirty-second hit does not flicker. */
export const MIN_FLASH_BEATS = 0.25;

/** One clip's notes in arrangement beats — a LOOPED event tiles its window's notes across its placed length, as the engine plays them. */
function clipHits(c: WebClip, out: Hit[]): void {
  const hit = (at: number, nt: WebNote): void => {
    out.push({
      from: c.start + at,
      to: c.start + at + Math.max(nt.duration, MIN_FLASH_BEATS),
      key: nt.key,
    });
  };
  const loop = clipLoop(c);
  if (!loop) {
    for (const nt of c.notes) hit(nt.time, nt);
    return;
  }
  const win = c.notes.filter((n) => n.time >= loop.from && n.time < loop.to);
  const span = c.length > 0 ? c.length : loop.win;
  for (let k = 0; k < loop.passes; k++)
    for (const nt of win) {
      const at = nt.time - loop.from + k * loop.win;
      // A pass cut short by the placed length plays only the notes that start inside it.
      if (at < span) hit(at, nt);
    }
}

/** Every note reaching each rack node, keyed by module and computed once per project + graph — only MIDI material counts. */
export function rackHits(
  project: WebProject | null,
  graph: WebGraph | null,
): Record<string, Hit[]> {
  const out: Record<string, Hit[]> = {};
  if (!project || !graph) return out;
  const byLane = new Map(project.tracks.map((t) => [t.id, t]));
  for (const [chainName, chain] of Object.entries(graph.chains)) {
    const lane = chain.from ? byLane.get(chain.from) : undefined;
    if (!lane) continue;
    // Which modules of this chain are racks: a chain may hold several, and each hears the same lane.
    const racks = chain.use.filter((s) => s.rack?.length);
    if (!racks.length) continue;
    const hits: Hit[] = [];
    for (const c of lane.clips) clipHits(c, hits);
    if (!hits.length) continue;
    // Keyed by MODULE and not by chain: a pad knows which module it is drawn on, and one shared by two chains hears both.
    void chainName;
    for (const s of racks) out[s.module] = [...(out[s.module] ?? []), ...hits];
  }
  /** Sorted AFTER the merge: per-chain sorting left two sorted runs back to back, and `litAt` stopped at the end of the first. */
  for (const hits of Object.values(out)) hits.sort((a, b) => a.from - b.from);
  return out;
}

/** The longest a note sounds, per module — what bounds `litAt`'s scan. See its note. */
export function maxSpans(hits: Record<string, Hit[]>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [module, hs] of Object.entries(hits)) {
    let max = 0;
    for (const h of hs) max = Math.max(max, h.to - h.from);
    out[module] = max;
  }
  return out;
}

/** The first index whose note has NOT begun by `beat`, in a list sorted by `from`. */
function firstAfter(hits: readonly Hit[], beat: number): number {
  let lo = 0;
  let hi = hits.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (hits[mid].from > beat) hi = mid;
    else lo = mid + 1;
  }
  return lo;
}

/** The keys sounding at `beat` — `maxSpan` is what makes this cost the notes AROUND the playhead rather than every one before it. */
export function litAt(
  hits: readonly Hit[],
  beat: number,
  maxSpan = Number.POSITIVE_INFINITY,
): Set<number> {
  const on = new Set<number>();
  for (let i = firstAfter(hits, beat) - 1; i >= 0; i--) {
    const h = hits[i];
    if (beat - h.from >= maxSpan) break;
    if (h.to > beat) on.add(h.key);
  }
  return on;
}

/** Do two sets say the same thing? What decides whether a module's pads are re-rendered at all. */
function same(a: ReadonlySet<number>, b: ReadonlySet<number>): boolean {
  if (a.size !== b.size) return false;
  for (const v of a) if (!b.has(v)) return false;
  return true;
}

/** The store the pads subscribe to, per MODULE — a playhead moving through silence notifies nobody, twenty times a second. */
export class LiveRackLit implements RackLitStore {
  private lit: Record<string, ReadonlySet<number>> = {};
  private listeners = new Map<string, Set<() => void>>();

  subscribeTo = (module: string, cb: () => void): (() => void) => {
    const set = this.listeners.get(module) ?? new Set();
    set.add(cb);
    this.listeners.set(module, set);
    return () => {
      set.delete(cb);
    };
  };

  isLit = (module: string, note: number): boolean =>
    this.lit[module]?.has(note) ?? false;

  /** Replace the picture. Only the modules whose set moved are told. */
  set = (next: Record<string, ReadonlySet<number>>): void => {
    const names = new Set([...Object.keys(this.lit), ...Object.keys(next)]);
    const changed: string[] = [];
    for (const m of names)
      if (!same(this.lit[m] ?? EMPTY, next[m] ?? EMPTY)) changed.push(m);
    if (!changed.length) return;
    this.lit = next;
    for (const m of changed) for (const cb of this.listeners.get(m) ?? []) cb();
  };
}

const EMPTY: ReadonlySet<number> = new Set<number>();

/** The store, wired to the engine's frames off a RAW subscription: a selector here would re-render the whole graph at frame rate. */
export function useLiveRackLit(
  project: WebProject | null | undefined,
  graph: WebGraph | null | undefined,
): LiveRackLit {
  const engineStore = useEngineStoreOrNull();
  const store = useMemo(() => new LiveRackLit(), []);
  const hits = useMemo(
    () => rackHits(project ?? null, graph ?? null),
    [project, graph],
  );
  // Once per project + graph, never per frame: it is the bound `litAt` scans within.
  const spans = useMemo(() => maxSpans(hits), [hits]);
  const tempo = project?.tempo || 120;
  useEffect(() => {
    const paint = (): void => {
      const beat = ((engineStore?.getSnapshot().playhead ?? 0) * tempo) / 60;
      const next: Record<string, ReadonlySet<number>> = {};
      for (const [module, h] of Object.entries(hits))
        next[module] = litAt(h, beat, spans[module]);
      store.set(next);
    };
    paint(); // the pads must be right before the first frame, not only after one
    return engineStore?.subscribe(paint);
  }, [engineStore, hits, spans, store, tempo]);
  return store;
}
