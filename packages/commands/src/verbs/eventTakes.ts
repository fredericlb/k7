// eventTakes.ts — the takes verbs: `event comp` picks which take plays over a span, `event take
// remove` drops one, `event take midi` files a MIDI pass recorded in the takes view. The event is
// found in the LANE FILE by its start, not among the compiled clips: once comped, its first piece
// may be a take starting elsewhere. See packages/song/docs/takes.md.

import {
  addEventTake,
  removeEventTake,
  setEventComp,
  setEventCrossfade,
  writeTakeSequence,
} from "@studio/song-edit/takeEdit";
import {
  beatsToPosition,
  parseDuration,
  parsePosition,
} from "@studio/song-schema/timecode";
import { fileStamp } from "@studio/take-render/recordTake";
import type { CommandHost, SidHandler } from "../commands.ts";
import { splitWords } from "./shared.ts";

export const EVENT_TAKE_VERBS: Record<string, SidHandler> = {
  "event.comp": compCommand,
  "event.take.remove": removeCommand,
  "event.take.midi": midiCommand,
  "event.take.arm": armCommand,
  "event.take.disarm": disarmCommand,
  "event.comp.fade": compFadeCommand,
};

/** The lane and the event's start in beats, or a refusal. */
function eventOf(
  h: CommandHost,
  trackArg: string,
  atTc: string,
): { track: string; at: number; num: number; den: number } | null {
  const p = h.project();
  const track = p.tracks.find((t) => t.id === trackArg || t.name === trackArg);
  if (!track) {
    h.refuse([`no track "${trackArg}"`]);
    return null;
  }
  const num = p.timeSigNumerator;
  const den = p.timeSigDenominator;
  try {
    return { track: track.id, at: parsePosition(atTc, num, den), num, den };
  } catch (e) {
    h.refuse([`bad timecode: ${(e as Error).message}`]);
    return null;
  }
}

/** `event comp <track> <at> <take> <from> <to>` — the event's own material is a take like the others. */
async function compCommand(a: string, h: CommandHost): Promise<void> {
  const parts = splitWords(a);
  if (parts.length !== 5) {
    h.refuse([
      "usage: event comp <track> <at> <take> <from> <to>",
      "       (from/to are song positions, e.g. event comp gtr 5:1 gtr_5.1_261008T101500 6:1 7:3)",
    ]);
    return;
  }
  const [trackArg, atTc, take, from, to] = parts;
  const ev = eventOf(h, trackArg, atTc);
  if (!ev) return;
  try {
    setEventComp(
      h.songPath,
      ev.track,
      ev.at,
      { take, from, to },
      ev.num,
      ev.den,
    );
    h.log([`${ev.track}: ${take} plays ${from} → ${to}`]);
    await h.reload();
  } catch (e) {
    h.refuse([`event comp failed: ${(e as Error).message}`]);
  }
}

/** `event take remove <track> <at> <take>` — its material stays on disk, as a deleted clip's does. */
async function removeCommand(a: string, h: CommandHost): Promise<void> {
  const parts = splitWords(a);
  if (parts.length !== 3) {
    h.refuse(["usage: event take remove <track> <at> <take>"]);
    return;
  }
  const [trackArg, atTc, take] = parts;
  const ev = eventOf(h, trackArg, atTc);
  if (!ev) return;
  try {
    removeEventTake(h.songPath, ev.track, ev.at, take, ev.num, ev.den);
    h.log([`${ev.track}: take ${take} removed`]);
    await h.reload();
  } catch (e) {
    h.refuse([`event take remove failed: ${(e as Error).message}`]);
  }
}

/** What the browser sends when a MIDI take ends: song beats throughout, the punch when there was one. */
interface MidiPass {
  start: number;
  end: number;
  notes: { t: number; d: number; k: number; v?: number }[];
  punch?: { from: number; to: number };
}

/** `event take midi <track> <at> <pass-json>` — the pass as its own sequence, added to the event and comped in. */
async function midiCommand(a: string, h: CommandHost): Promise<void> {
  const parts = splitWords(a);
  if (parts.length !== 3) {
    h.refuse(["usage: event take midi <track> <at> <pass-json>"]);
    return;
  }
  const [trackArg, atTc, json] = parts;
  const ev = eventOf(h, trackArg, atTc);
  if (!ev) return;
  let pass: MidiPass;
  try {
    pass = JSON.parse(json) as MidiPass;
  } catch {
    h.refuse(["event take midi: the pass is not JSON"]);
    return;
  }
  if (!(pass.end > pass.start) || !Array.isArray(pass.notes)) {
    h.refuse(["event take midi: a pass needs a start before its end"]);
    return;
  }
  const { num, den } = ev;
  const pos = (b: number) => beatsToPosition(b, num, den);
  const startTc = pos(pass.start);
  const id = `${ev.track.replace(/[^A-Za-z0-9._-]/g, "-")}_${startTc.split(":").slice(0, 2).join(".")}_${fileStamp()}`;
  // Notes from the take's own first beat, as a sequence counts them.
  const notes = pass.notes
    .filter((n) => n.d > 0 && n.t >= pass.start)
    .map((n) => ({ ...n, t: n.t - pass.start }));
  const from = Math.max(pass.start, pass.punch?.from ?? pass.start);
  const to = Math.min(pass.end, pass.punch?.to ?? pass.end);
  try {
    writeTakeSequence(h.songPath, id, notes, pass.end - pass.start, num, den);
    addEventTake(
      h.songPath,
      ev.track,
      ev.at,
      { ref: id, start: startTc },
      to > from ? { from: pos(from), to: pos(to) } : null,
      num,
      den,
    );
    h.log([`${ev.track}: take ${id}, ${notes.length} note(s)`]);
    await h.reload();
  } catch (e) {
    h.refuse([`event take midi failed: ${(e as Error).message}`]);
  }
}

/** `event take arm <track> <at> <from> [to]` — the next takes go INTO that event, heard over the punch only. */
async function armCommand(a: string, h: CommandHost): Promise<void> {
  const parts = splitWords(a);
  if (parts.length !== 3 && parts.length !== 4) {
    h.refuse([
      "usage: event take arm <track> <at> <from> [to]",
      "       (from/to are song positions: the punch, or from the playhead to the stop)",
    ]);
    return;
  }
  const [trackArg, atTc, fromTc, toTc] = parts;
  const ev = eventOf(h, trackArg, atTc);
  if (!ev) return;
  if (!h.takeArm) {
    h.refuse(["event take arm: takes are recorded through the file service"]);
    return;
  }
  let from: number;
  let to: number | undefined;
  try {
    from = parsePosition(fromTc, ev.num, ev.den);
    to = toTc === undefined ? undefined : parsePosition(toTc, ev.num, ev.den);
  } catch (e) {
    h.refuse([`bad timecode: ${(e as Error).message}`]);
    return;
  }
  if (to !== undefined && to <= from) {
    h.refuse(["event take arm: the punch must end after it starts"]);
    return;
  }
  h.takeArm({
    track: ev.track,
    eventBeats: ev.at,
    punch: to === undefined ? { from } : { from, to },
  });
  h.log([
    `${ev.track}: takes go into the event at ${atTc}, punched ${fromTc} → ${toTc ?? "the stop"}`,
  ]);
}

/** `event take disarm` — recording goes back onto the lane, and the engine hears the whole lane again. */
async function disarmCommand(_a: string, h: CommandHost): Promise<void> {
  h.takeArm?.(null);
  h.log(["takes disarmed: a take lands on its lane again"]);
}

/** `event comp fade <track> <at> <seam> <length>` — a crossfade at one seam of the comp; a length of 0 removes it. */
async function compFadeCommand(a: string, h: CommandHost): Promise<void> {
  const parts = splitWords(a);
  if (parts.length !== 4) {
    h.refuse([
      "usage: event comp fade <track> <at> <seam> <length>",
      "       (seam a song position, length a duration — 0 removes it)",
    ]);
    return;
  }
  const [trackArg, atTc, seam, lengthTc] = parts;
  const ev = eventOf(h, trackArg, atTc);
  if (!ev) return;
  let beats: number;
  try {
    beats = parseDuration(lengthTc, ev.num, ev.den);
    parsePosition(seam, ev.num, ev.den);
  } catch (e) {
    h.refuse([`bad timecode: ${(e as Error).message}`]);
    return;
  }
  try {
    setEventCrossfade(
      h.songPath,
      ev.track,
      ev.at,
      seam,
      beats > 0 ? lengthTc : null,
      ev.num,
      ev.den,
    );
    h.log([
      beats > 0
        ? `${ev.track}: crossfade of ${lengthTc} at ${seam}`
        : `${ev.track}: no crossfade at ${seam}`,
    ]);
    await h.reload();
  } catch (e) {
    h.refuse([`event comp fade failed: ${(e as Error).message}`]);
  }
}
