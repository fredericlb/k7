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
import type { WebGraph, WebProject } from "./types";

/** One note reaching a rack, in ARRANGEMENT beats: when it starts, when it stops, which key. */
export interface Hit {
  from: number;
  to: number;
  key: number;
}

/**
 * The shortest a pad stays lit, in beats.
 *
 * A drum hit is often written a thirty-second long, and a pad lit for 30 ms at 20 frames a second
 * is a pad that flashes on some passes and not others. This is a floor on the DISPLAY, not on the
 * note: what is played is untouched.
 */
export const MIN_FLASH_BEATS = 0.25;

/**
 * Every note reaching each rack node, keyed by module — computed once per project + graph.
 *
 * A rack hears what the lane feeding its CHAIN plays: `graph.chains[chain].from` is that lane, and
 * its clips carry the notes. Precomputed because the alternative is walking every clip of every
 * lane on every frame, twenty times a second, for a picture.
 *
 * Only MIDI material counts — an audio clip has no notes and contributes none.
 */
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
    // Which modules of this chain are racks. A chain may hold several — two kits in series is
    // odd but sayable — and each hears the same lane.
    const racks = chain.use.filter((s) => s.rack?.length);
    if (!racks.length) continue;
    const hits: Hit[] = [];
    for (const c of lane.clips)
      for (const nt of c.notes)
        hits.push({
          from: c.start + nt.time,
          to: c.start + nt.time + Math.max(nt.duration, MIN_FLASH_BEATS),
          key: nt.key,
        });
    if (!hits.length) continue;
    // Keyed by MODULE and not by chain: a pad knows which module it is drawn on, and a module
    // shared by two chains hears both. `chainName` is only how we got here.
    void chainName;
    for (const s of racks) out[s.module] = [...(out[s.module] ?? []), ...hits];
  }
  /**
   * Sorted AFTER the merge, and that is the bug this line fixes rather than a tidiness.
   *
   * Each chain's own hits used to be sorted before being concatenated, which is not the same
   * thing: a module reached from TWO chains ended up with two sorted runs back to back, so the
   * whole array was unsorted. `litAt` stops at the first note that has not begun — so it stopped
   * at the end of the first run and never saw the second chain's notes at all.
   */
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

/**
 * The keys sounding at `beat`.
 *
 * `maxSpan` is the longest note in the list, and passing it is what makes this cost the number of
 * notes AROUND the playhead rather than the number BEFORE it. Without it the walk ran from index 0
 * every frame, so a five-minute lane of sixteenths cost ~2400 comparisons per rack, twenty times a
 * second, and the cost grew as the song played — the comment here used to say "a few hundred at
 * worst", which is true of a pattern and not of an arrangement.
 *
 * The bound is exact rather than a heuristic: a note sounding at `beat` has `to > beat` and
 * `to - from <= maxSpan`, so `from > beat - maxSpan`. Anything earlier cannot still be ringing.
 * Absent, it defaults to Infinity and this is the old full walk — which is what the tests use.
 */
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

/**
 * The store the pads subscribe to.
 *
 * Per MODULE, so a kit firing re-renders that kit's pads and nothing else, and the listener set is
 * only poked when that module's sounding keys actually CHANGED — a playhead moving through silence
 * notifies nobody, twenty times a second.
 */
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

/**
 * The store, wired to the engine's frames — what both graph hosts mount.
 *
 * `engineStore.subscribe` and NOT `useEngineState`: a selector here would re-render the component
 * holding the graph twenty times a second, which is exactly what the external-store pattern is
 * here to avoid. Only a pad whose own note changed re-renders, through its own subscription.
 *
 * The notes are recomputed only when the project or the graph changes; a frame costs one walk of
 * the hits per rack, which is a few hundred comparisons on a busy song.
 */
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
