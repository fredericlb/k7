// curveConditions.ts — WHEN a curve runs, as the stretches of song time it is sampled over: from a
// moment, until one, between two, or from its node's events — and a curve with several runs while ANY
// holds. Each stretch says where its curve's own time starts: the stretch itself when the condition
// retriggers it, the song's start (or the first event) when it carries on. Outside every stretch the
// bake writes nothing, so the engine holds the value at the nearest edge. See docs/curves.md, "Conditions".

import type { CurveCondition } from "@studio/graph-model";
import { parsePosition } from "@studio/song-schema/timecode";

/** One stretch a curve runs over, in beats: `[from, to]`, its own time counted from `origin`. */
export interface CurveRun {
  from: number;
  to: number;
  origin: number;
}

/** The one event a node announces today: a note-on, however it is spelt ("Note On", "noteOn", "note-on"). */
export const isNoteOnEvent = (name: string): boolean =>
  name.toLowerCase().replace(/[^a-z]/g, "") === "noteon";

/** The stretches a song-time curve (an oscillator, a drawn one) runs over, any condition sufficing — none is the whole song. */
export function curveRuns(
  conds: readonly CurveCondition[] | undefined,
  end: number,
  triggers: readonly number[],
  num: number,
  den: number,
): CurveRun[] {
  if (!conds?.length) return [{ from: 0, to: end, origin: 0 }];
  const all = conds
    .flatMap((c) => runsOf(c, end, triggers, num, den))
    .sort((a, b) => a.from - b.from);
  const out: CurveRun[] = [];
  for (const r of all) {
    const last = out[out.length - 1];
    if (!last || r.from > last.to) out.push({ ...r });
    // A run that RESTARTS the curve takes over where it starts; the one it cut keeps nothing after it.
    else if (
      r.origin === r.from &&
      r.from > last.from &&
      r.origin !== last.origin
    ) {
      const to = Math.max(r.to, last.to);
      last.to = r.from;
      out.push({ ...r, to });
    }
    // …one that carries on simply widens the stretch already running.
    else last.to = Math.max(last.to, r.to);
  }
  return out;
}

/** One condition's stretches. */
function runsOf(
  cond: CurveCondition,
  end: number,
  triggers: readonly number[],
  num: number,
  den: number,
): CurveRun[] {
  const at = (tc: string) => parsePosition(tc, num, den);
  const again = !!cond.retrigger;
  switch (cond.type) {
    case "start": {
      const t = at(cond.at);
      return t < end ? [{ from: t, to: end, origin: again ? t : 0 }] : [];
    }
    case "end":
      return [{ from: 0, to: at(cond.at), origin: 0 }];
    case "between": {
      const s = at(cond.start);
      const e = at(cond.end);
      return e > s ? [{ from: s, to: e, origin: again ? s : 0 }] : [];
    }
    case "event": {
      // An event the node does not announce never comes: the curve never starts.
      if (!isNoteOnEvent(cond.event) || !triggers.length) return [];
      const ts = [...triggers].sort((a, b) => a - b);
      if (!again)
        return [{ from: ts[0], to: Math.max(end, ts[0]), origin: ts[0] }];
      return ts.map((t, i) => ({
        from: t,
        to: i + 1 < ts.length ? ts[i + 1] : Math.max(end, t),
        origin: t,
      }));
    }
  }
}

/** One firing of an envelope: when, where its condition's window cuts it, and whether it may cut one running. */
export interface EnvelopeFire {
  at: number;
  stop?: number;
  retrigger: boolean;
}

/** An envelope's firings under its conditions, pooled — any condition's note-ons fire it, each cut where ITS window ends. */
export function envelopeFires(
  conds: readonly CurveCondition[] | undefined,
  noteOns: readonly number[],
  num: number,
  den: number,
): EnvelopeFire[] {
  // No condition is what an envelope always did: every note-on fires it, cutting the one running.
  if (!conds?.length) return noteOns.map((at) => ({ at, retrigger: true }));
  const fires = conds.flatMap((c) => firesOf(c, noteOns, num, den));
  // Two conditions firing at one beat are one firing: the longer window, and retriggering if either does.
  const byBeat = new Map<number, EnvelopeFire>();
  for (const f of fires) {
    const was = byBeat.get(f.at);
    if (!was) byBeat.set(f.at, { ...f });
    else {
      was.retrigger ||= f.retrigger;
      was.stop =
        was.stop === undefined || f.stop === undefined
          ? undefined
          : Math.max(was.stop, f.stop);
    }
  }
  return [...byBeat.values()].sort((a, b) => a.at - b.at);
}

/** One condition's firings. */
function firesOf(
  cond: CurveCondition,
  noteOns: readonly number[],
  num: number,
  den: number,
): EnvelopeFire[] {
  const at = (tc: string) => parsePosition(tc, num, den);
  const retrigger = !!cond.retrigger;
  if (cond.type === "event")
    return isNoteOnEvent(cond.event)
      ? noteOns.map((t) => ({ at: t, retrigger }))
      : [];
  const from =
    cond.type === "start"
      ? at(cond.at)
      : cond.type === "between"
        ? at(cond.start)
        : 0;
  const stop =
    cond.type === "end"
      ? at(cond.at)
      : cond.type === "between"
        ? at(cond.end)
        : undefined;
  const inside = noteOns.filter(
    (t) => t >= from && (stop === undefined || t < stop),
  );
  // Retriggered, it also fires the moment the condition comes true — the window's opening.
  const ats =
    retrigger && from > 0 ? [from, ...inside.filter((t) => t > from)] : inside;
  return ats.map((t) => ({ at: t, stop, retrigger }));
}
