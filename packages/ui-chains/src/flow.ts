// flow.ts — HOW HARD a cable ripples: one number in 0..1 per cable, and the three ways of
// arriving at it, one per kind of signal. Pure, so the mapping the cables are drawn with is the
// mapping under test. See docs/wobble.md.
//
// A cable used to be live or not, and every live one rippled the same. It says more than that
// now: the ripple is what the wire is CARRYING.

/** Nothing is going through — the cable hangs still. */
export const STILL = 0;

/** The quietest sound that still moves a cable. Below it the wire is dead, not merely faint. */
export const FLOW_FLOOR_DB = -80;

/**
 * An audio level in dB → 0..1, linear IN DECIBELS because that is what a level is: a fader's
 * markings are evenly spaced in dB, and mapping the amplitude instead would leave everything
 * below -20 indistinguishable from silence.
 *
 * `-80` is a hair above nothing rather than nothing itself: a wire at the floor should look
 * alive but barely, which "no ripple at all" does not say.
 */
export function audioFlow(db: number): number {
  if (!Number.isFinite(db) || db <= FLOW_FLOOR_DB) return STILL;
  const t = (db - FLOW_FLOOR_DB) / -FLOW_FLOOR_DB;
  return t > 1 ? 1 : t;
}

/**
 * A MIDI cable's load → 0..1: the velocities SOUNDING now against the busiest moment that track
 * ever has. The same shape the timeline paints a sequence block with (apps/k7's activity.ts),
 * and for the same reason — a part's own peak is what should reach full strength, since "loud
 * for this part" is the only reading a listener has.
 */
export function midiFlow(load: number, peak: number): number {
  if (!(load > 0) || !(peak > 0)) return STILL;
  const t = load / peak;
  return t > 1 ? 1 : t;
}

/**
 * A video cable's, which is BINARY: a lane is putting a picture on screen or it is not. Nothing
 * meters a frame, and "how much picture" is not a quantity — a dark shot is still a shot.
 */
export function videoFlow(showing: boolean): number {
  return showing ? 1 : STILL;
}

/** What one node puts on each kind of wire leaving it — the seed the walk carries downstream. */
export interface NodeFlow {
  audio: number;
  midi: number;
  video: number;
}

export const NO_FLOW: NodeFlow = { audio: STILL, midi: STILL, video: STILL };

/** What a cable of this kind takes from the node feeding it. `event` follows the notes it is. */
export function flowOf(
  seed: NodeFlow,
  signal: "audio" | "midi" | "video" | "event" | undefined,
): number {
  if (signal === "video") return seed.video;
  if (signal === "midi" || signal === "event") return seed.midi;
  return seed.audio;
}

/** What one lane is putting out, for the seed map — the three measures, gathered per lane. */
export interface LaneSource {
  /** Its OUTPUT level in dB, as the engine meters it. Absent = nothing to meter. */
  db?: number;
  /** Its notes sounding now, and the busiest they ever get — see noteLoad.ts. */
  notes?: { load: number; peak: number };
  /** Whether it is putting a picture on screen. */
  showing?: boolean;
}

/**
 * The seed each lane contributes, by lane id. Lanes that put out NOTHING are left out, so the
 * walk starts nowhere for them and their cables hang still.
 *
 * A lane offers all three numbers at once and the cable picks: one seed, read differently by an
 * audio wire and a MIDI wire, is what lets a sequences lane ripple its notes into an instrument
 * and the instrument's meter out the other side.
 */
export function seedFlows(
  lanes: Readonly<Record<string, LaneSource>>,
): Map<string, NodeFlow> {
  const out = new Map<string, NodeFlow>();
  for (const id in lanes) {
    const l = lanes[id];
    const f: NodeFlow = {
      audio: l.db === undefined ? STILL : audioFlow(l.db),
      midi: l.notes ? midiFlow(l.notes.load, l.notes.peak) : STILL,
      video: videoFlow(l.showing === true),
    };
    if (f.audio > STILL || f.midi > STILL || f.video > STILL) out.set(id, f);
  }
  return out;
}

/** Do two seed maps say the same? The guard that keeps a meter frame from re-walking the graph. */
export function seedsEq(
  a: ReadonlyMap<string, NodeFlow>,
  b: ReadonlyMap<string, NodeFlow>,
): boolean {
  if (a === b) return true;
  if (a.size !== b.size) return false;
  for (const [id, x] of a) {
    const y = b.get(id);
    if (!y || x.audio !== y.audio || x.midi !== y.midi || x.video !== y.video)
      return false;
  }
  return true;
}
