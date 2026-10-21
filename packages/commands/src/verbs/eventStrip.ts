// eventStrip.ts — an event's own strip: fades, window, gain, loop and its points, and the
// mute / warp status flags. See docs/verbs.md.

import {
  EVENT_GAIN_MAX_DB,
  eventGainValue,
  setTrackPlacementGain,
} from "@studio/song-edit/eventGain";
import {
  setTrackPlacementLoop,
  setTrackPlacementLoopPoints,
} from "@studio/song-edit/eventLoop";
import {
  setTrackPlacementDisabled,
  setTrackPlacementFade,
  setTrackPlacementWarp,
  setTrackPlacementWindow,
} from "@studio/song-edit/trackMix";
import { parseDuration } from "@studio/song-schema/timecode";
import { wavSeconds } from "@studio/take-render/wavLength";
import type { CommandHost, SidHandler } from "../commands.ts";
import { resolveEvent, splitWords } from "./shared.ts";

/** `event fadein|fadeout <track> <timecode> <length>` — a POSITION then a DURATION, 0 removes; docs/verbs.md. */
async function fadeCommand(
  a: string,
  h: CommandHost,
  which: "fadeIn" | "fadeOut",
): Promise<void> {
  const verb = which === "fadeIn" ? "event fadein" : "event fadeout";
  const parts = splitWords(a);
  if (parts.length !== 3) {
    h.refuse([
      `usage: ${verb} <track> <timecode> <length>`,
      `       (e.g. ${verb} gtr 2:1:1 0:1 — a length, not a position; 0 removes it)`,
    ]);
    return;
  }
  const [trackArg, atTc, lenTc] = parts;
  const found = resolveEvent(h, trackArg, atTc);
  if (!found) return;
  const { track, atBeats, hit, num, den } = found;
  let beats: number;
  try {
    beats = parseDuration(lenTc, num, den);
  } catch (e) {
    h.refuse([`bad length: ${(e as Error).message}`]);
    return;
  }
  if (beats < 0) {
    h.refuse([`a fade cannot be negative — got ${lenTc}`]);
    return;
  }
  try {
    const done = setTrackPlacementFade(
      h.songPath,
      track.id,
      atBeats,
      num,
      den,
      which,
      beats,
    );
    if (!done) {
      h.refuse([`no event on '${track.id}' at ${atTc}`]);
      return;
    }
    h.log([
      beats > 0
        ? `${track.id}: ${hit.name || hit.id} at ${atTc} ${which === "fadeIn" ? "fades in" : "fades out"} over ${lenTc}`
        : `${track.id}: ${hit.name || hit.id} at ${atTc} no longer ${which === "fadeIn" ? "fades in" : "fades out"}`,
    ]);
    await h.reload();
  } catch (e) {
    h.refuse([`${verb} failed: ${(e as Error).message}`]);
  }
}

/** `event window <track> <at> <from> <to>` — which slice one event plays, in SECONDS of the file; docs/verbs.md. */
async function windowCommand(a: string, h: CommandHost): Promise<void> {
  const parts = splitWords(a);
  if (parts.length !== 4) {
    h.refuse([
      "usage: event window <track> <timecode> <from> <to>",
      "       (from/to in SECONDS of the file, e.g. event window vox 24:1 52.36 69.82)",
    ]);
    return;
  }
  const [trackArg, atTc, fromArg, toArg] = parts;
  const found = resolveEvent(h, trackArg, atTc, true);
  if (!found) return;
  const { track, atBeats, hit, num, den } = found;
  const from = Number(fromArg);
  const to = Number(toArg);
  if (!Number.isFinite(from) || !Number.isFinite(to) || from < 0) {
    h.refuse([
      `'${fromArg} ${toArg}' is not a window in seconds — two numbers, the first not negative`,
    ]);
    return;
  }
  if (!(to > from)) {
    h.refuse([
      `a window has to run forwards — got ${fromArg} to ${toArg}`,
      "nothing was changed: a window of zero length would play nothing at all",
    ]);
    return;
  }
  try {
    const done = setTrackPlacementWindow(
      h.songPath,
      track.id,
      atBeats,
      num,
      den,
      { from, to },
      // The source's own length, so an edge landing on the file's end is cleared rather than written.
      hit.source ? (wavSeconds(hit.source) ?? 0) : 0,
    );
    if (!done) {
      h.refuse([`no event on '${track.id}' at ${atTc}`]);
      return;
    }
    h.log([
      `${track.id}: ${hit.name || hit.id} at ${atTc} plays ${from.toFixed(3)}s → ${to.toFixed(3)}s of its file`,
    ]);
    await h.reload();
  } catch (e) {
    h.refuse([`event window failed: ${(e as Error).message}`]);
  }
}

/** `event gain <track> <at> <dB>` — one AUDIO event's own trim; song-edit docs/eventGain.md. */
async function gainCommand(a: string, h: CommandHost): Promise<void> {
  const parts = splitWords(a);
  if (parts.length !== 3) {
    h.refuse([
      "usage: event gain <track> <timecode> <dB>   (-6 … +6; 0 is unity)",
    ]);
    return;
  }
  const [trackArg, atTc, dbArg] = parts;
  const db = Number(dbArg);
  if (!Number.isFinite(db) || Math.abs(db) > EVENT_GAIN_MAX_DB) {
    h.refuse([
      `'${dbArg}' is not a gain from -${EVENT_GAIN_MAX_DB} to +${EVENT_GAIN_MAX_DB} dB`,
    ]);
    return;
  }
  const found = resolveEvent(h, trackArg, atTc, false, true);
  if (!found) return;
  const { track, atBeats, hit, num, den } = found;
  if (hit.type !== "audio") {
    h.refuse([
      `the event at ${atTc} is MIDI: it shares its lane's instrument, so it has no gain of its own`,
      "its notes' velocities are the way to make it louder or softer",
    ]);
    return;
  }
  try {
    if (!setTrackPlacementGain(h.songPath, track.id, atBeats, num, den, db)) {
      h.refuse([`no event on '${track.id}' at ${atTc}`]);
      return;
    }
    const v = eventGainValue(db);
    h.log([
      `${track.id}: ${hit.name || hit.id} at ${atTc} ${v === undefined ? "at unity" : `trimmed ${v > 0 ? "+" : ""}${v} dB`}`,
    ]);
    await h.reload();
  } catch (e) {
    h.refuse([`event gain failed: ${(e as Error).message}`]);
  }
}

/** `event loop <track> <at> [on|off|toggle]` — whether one event repeats its window; song-edit docs/eventLoop.md. */
async function loopCommand(a: string, h: CommandHost): Promise<void> {
  const m = /^(\S+)\s+(\S+)(?:\s+(\S+))?$/.exec(a.trim());
  if (!m) {
    h.refuse(["usage: event loop <track> <timecode> [on|off|toggle]"]);
    return;
  }
  const [, trackArg, atTc, stateArg] = m;
  const state = (stateArg ?? "toggle").toLowerCase();
  if (!["on", "off", "toggle"].includes(state)) {
    h.refuse([`'${stateArg}' is not on, off or toggle`]);
    return;
  }
  const found = resolveEvent(h, trackArg, atTc, true);
  if (!found) return;
  const { track, atBeats, hit, num, den, tempo } = found;
  const on =
    state === "toggle" ? !((hit.event?.loop ?? 1) > 1) : state === "on";
  try {
    const done = setTrackPlacementLoop(
      h.songPath,
      track.id,
      atBeats,
      num,
      den,
      tempo,
      on,
      // An audio window with no end gets the file's length as one: a repeat needs to know where it starts over.
      hit.source ? (wavSeconds(hit.source) ?? undefined) : undefined,
    );
    if (!done) {
      h.refuse([`no event on '${track.id}' at ${atTc}`]);
      return;
    }
    h.log([
      `${track.id}: ${hit.name || hit.id} at ${atTc} ${done.loops > 1 ? `loops, ${done.loops} passes` : "plays once"}${done.changed ? "" : " (already)"}`,
    ]);
    if (done.changed) await h.reload();
  } catch (e) {
    h.refuse([`event loop failed: ${(e as Error).message}`]);
  }
}

/** `event loop points <track> <at> <from> <to>` — the window an event loops, in its material's unit; song-edit docs/eventLoop.md. */
async function loopPointsCommand(a: string, h: CommandHost): Promise<void> {
  const parts = splitWords(a);
  if (parts.length !== 4) {
    h.refuse([
      "usage: event loop points <track> <timecode> <from> <to>",
      "       (beats into a sequence, seconds into an audio file)",
    ]);
    return;
  }
  const [trackArg, atTc, fromArg, toArg] = parts;
  const from = Number(fromArg);
  const to = Number(toArg);
  if (
    !Number.isFinite(from) ||
    !Number.isFinite(to) ||
    from < 0 ||
    !(to > from)
  ) {
    h.refuse([
      `'${fromArg} ${toArg}' are not loop points — two numbers, running forwards, the first not negative`,
    ]);
    return;
  }
  const found = resolveEvent(h, trackArg, atTc, true);
  if (!found) return;
  const { track, atBeats, hit, num, den, tempo } = found;
  try {
    const done = setTrackPlacementLoopPoints(
      h.songPath,
      track.id,
      atBeats,
      num,
      den,
      tempo,
      from,
      to,
    );
    if (!done) {
      h.refuse([`no event on '${track.id}' at ${atTc}`]);
      return;
    }
    const unit = done.kind === "sequence" ? "b" : "s";
    h.log([
      `${track.id}: ${hit.name || hit.id} at ${atTc} loops ${+done.from.toFixed(3)}${unit} → ${+done.to.toFixed(3)}${unit}${done.loops > 1 ? `, ${done.loops} passes` : ""}`,
    ]);
    await h.reload();
  } catch (e) {
    h.refuse([`event loop points failed: ${(e as Error).message}`]);
  }
}

/** `event status mute|warp <track> <timecode> [on|off|toggle]` — `on` means the NAMED STATE is on; docs/verbs.md. */
async function statusCommand(
  a: string,
  h: CommandHost,
  aspect: "mute" | "warp",
): Promise<void> {
  const verb = `event status ${aspect}`;
  const m = /^(\S+)\s+(\S+)(?:\s+(\S+))?$/.exec(a.trim());
  if (!m) {
    h.refuse([`usage: ${verb} <track> <timecode> [on|off|toggle]`]);
    return;
  }
  const [, trackArg, atTc, stateArg] = m;
  const found = resolveEvent(h, trackArg, atTc, false, aspect === "mute");
  if (!found) return;
  const { track, atBeats, hit, num, den } = found;
  const state = (stateArg ?? "toggle").toLowerCase();
  if (!["on", "off", "toggle"].includes(state)) {
    h.refuse([`'${stateArg}' is not on, off or toggle`]);
    return;
  }
  // The NAMED STATE as it stands; `warpOff` is the FILE's negative spelling, turned here once — docs/verbs.md.
  const now = aspect === "mute" ? !!hit.disabled : hit.warpOff !== true;
  const next = state === "toggle" ? !now : state === "on";
  try {
    // Both writers take the state under its own name, so `next` goes to each unchanged.
    const done =
      aspect === "mute"
        ? setTrackPlacementDisabled(
            h.songPath,
            track.id,
            atBeats,
            num,
            den,
            next,
          )
        : setTrackPlacementWarp(h.songPath, track.id, atBeats, num, den, next);
    if (!done) return h.refuse([`no event on '${track.id}' at ${atTc}`]);
    const said =
      aspect === "mute"
        ? next
          ? "muted"
          : "unmuted"
        : next
          ? "warped — follows the clip's map"
          : "unwarped — plays at its own rate";
    h.log([`${track.id}: ${hit.name || hit.id} at ${atTc} ${said}`]);
    await h.reload();
  } catch (e) {
    h.refuse([`${verb} failed: ${(e as Error).message}`]);
  }
}

export const EVENT_STRIP_VERBS: Record<string, SidHandler> = {
  // A placement is a REFERENCE: `event remove` drops it and the clip in clips/ stays.
  "event.statusMute": (a, h) => statusCommand(a, h, "mute"),
  "event.statusWarp": (a, h) => statusCommand(a, h, "warp"),
  "event.fadeIn": (a, h) => fadeCommand(a, h, "fadeIn"),
  "event.window": windowCommand,
  "event.gain": gainCommand,
  "event.loop": loopCommand,
  "event.loopPoints": loopPointsCommand,
  "event.fadeOut": (a, h) => fadeCommand(a, h, "fadeOut"),
};
