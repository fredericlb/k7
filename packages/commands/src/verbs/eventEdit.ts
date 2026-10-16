// eventEdit.ts — reshaping one event: trim to its audible span, resize, split, and the
// consolidate that renders a selection into one take. See docs/verbs.md.

import { DEFAULT_TRIM_DB, trimWindow } from "@studio/audio-probe/trim-gate";
import {
  consolidateSequenceMaterial,
  splitSequenceMaterial,
} from "@studio/song-edit/materialCut";
import {
  resizeTrackPlacement,
  setTrackPlacementWindow,
} from "@studio/song-edit/trackMix";
import { beatsToDuration, parsePosition } from "@studio/song-schema/timecode";
import {
  consolidateAudioMaterial,
  splitAudioMaterial,
} from "@studio/take-render/materialRender";
import type { SidHandler } from "../commands.ts";
import { rendererOf, resolveEvent, splitWords } from "./shared.ts";

export const EVENT_EDIT_VERBS: Record<string, SidHandler> = {
  // --- a clip's onsets: corrections to what the engine detected, kept as a DIFF (song/onsets.ts)

  /** event trim <track> <at> [gate-dB] — cut the silence off both ends of ONE event's WINDOW; docs/verbs.md. */
  "event.trim": async (a, h) => {
    const parts = splitWords(a);
    if (parts.length < 2 || parts.length > 3) {
      h.refuse([
        "usage: event trim <track> <timecode> [gate-dB]  (e.g. event trim vox 24:1 -40)",
      ]);
      return;
    }
    const [trackArg, atTc, gateArg] = parts;
    const gate = gateArg === undefined ? DEFAULT_TRIM_DB : Number(gateArg);
    if (!Number.isFinite(gate) || gate > 0) {
      h.refuse([
        `'${gateArg}' is not a gate in dBFS — a negative number, e.g. -40`,
      ]);
      return;
    }
    const found = resolveEvent(h, trackArg, atTc, true);
    if (!found) return;
    const { track, atBeats, hit, num, den } = found;
    if (!h.clipEnvelope) {
      h.refuse([
        "this host cannot read a clip's envelope — `event trim` needs the engine, which builds it",
      ]);
      return;
    }
    const env = await h.clipEnvelope(hit.id);
    if (!env) {
      h.refuse([
        `${hit.name || hit.id}: no envelope yet — the engine builds it on first read`,
      ]);
      return;
    }
    // The bound is what this EVENT plays; `sourceTo` absent is "to the end of the file", as measured.
    const within = {
      from: hit.sourceFrom ?? 0,
      to: hit.sourceTo && hit.sourceTo > 0 ? hit.sourceTo : env.seconds,
    };
    const win = trimWindow(env.peak, env.seconds, gate, within);
    if (!win) {
      h.refuse([
        `${hit.name || hit.id}: nothing above ${gate} dB in what this event plays — the gate is too high, or the take is silent`,
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
        win,
        env.seconds,
      );
      if (!done) {
        h.refuse([`no event on '${track.id}' at ${atTc}`]);
        return;
      }
    } catch (e) {
      h.refuse([`event trim failed: ${(e as Error).message}`]);
      return;
    }
    h.log([
      `${track.id}: ${hit.name || hit.id} at ${atTc} keeps ${win.from.toFixed(2)}s → ${win.to.toFixed(2)}s of ${env.seconds.toFixed(2)}s (gate ${gate} dB)`,
    ]);
    await h.reload();
  },
  // event resize <track> <timecode> <newStart> <newEnd> — both ends, one edit.
  "event.resize": async (a, h) => {
    const m = /^(\S+)\s+(\S+)\s+(\S+)\s+(\S+)$/.exec(a.trim());
    if (!m) {
      h.refuse([
        "usage: event resize <track> <timecode> <newStart> <newEnd>  (the new END position, not a length)",
      ]);
      return;
    }
    const [, trackArg, atTc, startTc, endTc] = m;
    const found = resolveEvent(h, trackArg, atTc, true);
    if (!found) return;
    const { track, atBeats, hit, num, den, tempo } = found;
    let startBeats: number;
    let endBeats: number;
    try {
      startBeats = parsePosition(startTc, num, den);
      endBeats = parsePosition(endTc, num, den);
    } catch (e) {
      h.refuse([`bad timecode: ${(e as Error).message}`]);
      return;
    }
    // A zero or negative length would still validate, so refuse rather than write an event that plays nothing.
    if (endBeats <= startBeats) {
      h.refuse([`the end (${endTc}) must be after the start (${startTc})`]);
      return;
    }
    try {
      const done = resizeTrackPlacement(
        h.songPath,
        track.id,
        atBeats,
        num,
        den,
        startBeats,
        endBeats,
        tempo,
      );
      if (!done) return h.refuse([`no event on '${track.id}' at ${atTc}`]);
      const span = beatsToDuration(endBeats - startBeats, num, den);
      h.log([
        `${track.id}: ${hit.name || hit.id} -> ${startTc}..${endTc} (${span})` +
          (done.loops > 1 ? ` × ${done.loops}` : ""),
        // The EVENT's own window, clamped inside the material's from/to — packages/song/docs/clipResize.md.
        `  this event only — ${done.material} keeps its own from/to`,
      ]);
      await h.reload();
    } catch (e) {
      h.refuse([`event resize failed: ${(e as Error).message}`]);
    }
  },
  /** event split <track> <timecode> <at> — cut the MATERIAL in two, leaving what was cut on disk; docs/verbs.md. */
  "event.split": async (a, h) => {
    const m = /^(\S+)\s+(\S+)\s+(\S+)$/.exec(a.trim());
    if (!m) {
      h.refuse(["usage: event split <track> <timecode> <at>  (where to cut)"]);
      return;
    }
    const [, trackArg, atTc, cutTc] = m;
    const found = resolveEvent(h, trackArg, atTc, true);
    if (!found) return;
    const { track, atBeats, hit, num, den } = found;
    let cutBeats: number;
    try {
      cutBeats = parsePosition(cutTc, num, den);
    } catch (e) {
      h.refuse([`bad timecode: ${(e as Error).message}`]);
      return;
    }
    try {
      if (hit.type === "audio") {
        const render = rendererOf(h);
        if (!render)
          return h.refuse([
            "event split: no engine to render with — cutting audio means rendering two files",
          ]);
        const done = await splitAudioMaterial(
          render,
          h.songPath,
          h.project(),
          track.id,
          atBeats,
          cutBeats,
          num,
          den,
        );
        if (!done) return h.refuse([`no event on '${track.id}' at ${atTc}`]);
        h.log([
          `${track.id}: ${done.from} split at ${cutTc}, into two rendered clips`,
          `  ${done.head.file} (${+done.head.seconds.toFixed(3)}s) and ${done.tail.file} (${+done.tail.seconds.toFixed(3)}s)`,
          `  '${done.from}' is untouched — another lane may still be playing it`,
        ]);
      } else {
        const done = splitSequenceMaterial(
          h.songPath,
          track.id,
          atBeats,
          cutBeats,
          num,
          den,
        );
        if (!done) return h.refuse([`no event on '${track.id}' at ${atTc}`]);
        h.log([
          `${track.id}: ${done.from} split at ${cutTc}, into two sequences`,
          `  ${done.head.file} (${done.head.notes} notes) and ${done.tail.file} (${done.tail.notes})`,
          `  '${done.from}' is untouched — another lane may still be playing it`,
        ]);
      }
      await h.reload();
    } catch (e) {
      h.refuse([`event split failed: ${(e as Error).message}`]);
    }
  },
  /** selection consolidate <tracks> <from> <to> — one material over a range, ONE lane, gaps survive; docs/verbs.md. */
  "selection.consolidate": async (a, h) => {
    const m = /^(\S+)\s+(\S+)\s+(\S+)$/.exec(a.trim());
    if (!m) {
      h.refuse(["usage: selection consolidate <track> <from> <to>"]);
      return;
    }
    const [, tracksArg, fromTc, toTc] = m;
    const ids = [...new Set(tracksArg.split(",").filter(Boolean))];
    if (ids.length !== 1)
      return h.refuse([
        `selection consolidate takes ONE track — ${ids.length ? ids.join(", ") : "none"} given; a rectangle over several has no single file to write`,
      ]);
    const found = resolveEvent(h, ids[0], fromTc);
    if (!found) return;
    const { track, atBeats: fromBeats, hit, num, den } = found;
    let toBeats: number;
    try {
      toBeats = parsePosition(toTc, num, den);
    } catch (e) {
      h.refuse([`bad timecode: ${(e as Error).message}`]);
      return;
    }
    try {
      if (hit.type === "audio") {
        const render = rendererOf(h);
        if (!render)
          return h.refuse([
            "selection consolidate: no engine to render with — consolidating audio means rendering a file",
          ]);
        const done = await consolidateAudioMaterial(
          render,
          h.songPath,
          h.project(),
          track.id,
          fromBeats,
          toBeats,
          num,
          den,
        );
        if (!done) return h.refuse([`nothing on '${track.id}' in that range`]);
        h.log([
          `${track.id}: ${done.replaced} event(s) consolidated into ${done.written.file}`,
          `  ${+done.written.seconds.toFixed(3)}s rendered from ${done.from.join(", ")}`,
        ]);
      } else {
        const done = consolidateSequenceMaterial(
          h.songPath,
          track.id,
          fromBeats,
          toBeats,
          num,
          den,
        );
        if (!done) return h.refuse([`nothing on '${track.id}' in that range`]);
        h.log([
          `${track.id}: ${done.replaced} event(s) consolidated into ${done.written.file}`,
          `  ${done.written.notes} notes, from ${done.from.join(", ")}`,
        ]);
      }
      await h.reload();
    } catch (e) {
      h.refuse([`selection consolidate failed: ${(e as Error).message}`]);
    }
  },
};
