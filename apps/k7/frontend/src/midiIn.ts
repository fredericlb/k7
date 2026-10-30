// midiIn.ts — which MIDI device records into a lane, and which instruments a keyboard plays directly:
// the midi-in nodes wired to them in the graph. Pure, off the graph document, so the rules are tests.
// The one thing a reader would get wrong: no node is not "any device", it is no MIDI at all (packages/song/docs/midiIn.md).

import type { WebGraph } from "./types";

/** The label of the midi-in node feeding `track` ("" any device), or null when none is wired to it. */
export function midiInDeviceFor(g: WebGraph, track: string): string | null {
  for (const c of Object.values(g.chains)) {
    if (!c.out?.some((o) => o.to === track)) continue;
    const step = c.use.find((s) => s.device !== undefined);
    if (step) return step.device ?? "";
  }
  return null;
}

/** Every lane a midi-in node is wired to — the lanes that arm in the BROWSER even before they hold a sequence. */
export function midiInLanes(g: WebGraph): Set<string> {
  const out = new Set<string>();
  for (const c of Object.values(g.chains))
    if (c.use.some((s) => s.device !== undefined))
      for (const o of c.out ?? []) out.add(o.to);
  return out;
}

/** An instrument a keyboard is wired straight into, no lane between: the engine track it plays and the node's label. */
export interface PlayedTarget {
  track: string;
  /** The midi-in node's label, "" any device. */
  device: string;
}

/** Every instrument a midi-in node feeds directly — played live whatever is armed, never recorded (packages/song/docs/midiIn.md). */
export function midiInPlayed(g: WebGraph): PlayedTarget[] {
  const lanes = new Set(g.tracks ?? []);
  const out: PlayedTarget[] = [];
  for (const c of Object.values(g.chains)) {
    const step = c.use.find((s) => s.device !== undefined);
    if (!step) continue;
    for (const o of c.out ?? []) {
      // `piano#midi` names a port of the piano; the track is the piano's.
      const to = o.to.split("#")[0] ?? o.to;
      if (lanes.has(to)) continue;
      // The engine runs that instrument as the track of the run it starts, named after that run.
      const run = Object.entries(g.chains).find(
        ([, r]) => r.use[0]?.module === to,
      )?.[0];
      out.push({ track: run ?? to, device: step.device ?? "" });
    }
  }
  return out;
}
