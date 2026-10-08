// crossfade.ts — `event crossfade <track> <atA> <atB> <length>`: the timeline's crossfade tool. The
// two events are made to overlap by `length` out of material neither plays yet, and each fades over
// it; 0 takes the two fades away and leaves the overlap. A comped event's seams are crossfaded in its
// takes view instead (`event comp fade`). See packages/song/docs/takes.md.

import { loadAudioClipDoc } from "@studio/song/project";
import { type CrossfadeSide, planCrossfade } from "@studio/song-edit/crossfade";
import {
  moveTrackPlacement,
  setTrackPlacementFade,
  setTrackPlacementWindow,
} from "@studio/song-edit/trackMix";
import { materialRefOf } from "@studio/song-schema/placementId";
import {
  beatsToPosition,
  parseDuration,
  parsePosition,
} from "@studio/song-schema/timecode";
import { wavSeconds } from "@studio/take-render/wavLength";
import type { CommandHost, SidHandler } from "../commands.ts";
import { splitWords } from "./shared.ts";

export const CROSSFADE_VERBS: Record<string, SidHandler> = {
  "event.crossfade": crossfadeCommand,
};

async function crossfadeCommand(a: string, h: CommandHost): Promise<void> {
  const parts = splitWords(a);
  if (parts.length !== 4) {
    h.refuse([
      "usage: event crossfade <track> <atA> <atB> <length>",
      "       (the two events' starts, the length a duration — 0 removes the crossfade)",
    ]);
    return;
  }
  const [trackArg, atA, atB, lengthTc] = parts;
  const p = h.project();
  const track = p.tracks.find((t) => t.id === trackArg || t.name === trackArg);
  if (!track) {
    h.refuse([`no track "${trackArg}"`]);
    return;
  }
  const num = p.timeSigNumerator;
  const den = p.timeSigDenominator;
  let aBeats: number;
  let bBeats: number;
  let length: number;
  try {
    aBeats = parsePosition(atA, num, den);
    bBeats = parsePosition(atB, num, den);
    length = parseDuration(lengthTc, num, den);
  } catch (e) {
    h.refuse([`bad timecode: ${(e as Error).message}`]);
    return;
  }
  const at = (beats: number) =>
    track.clips.find((c) => Math.abs(c.start - beats) < 1e-6);
  const ca = at(aBeats);
  const cb = at(bBeats);
  if (!ca || !cb || ca === cb) {
    h.refuse([`no two events on '${track.id}' at ${atA} and ${atB}`]);
    return;
  }
  if (ca.type !== "audio" || cb.type !== "audio") {
    h.refuse(["a crossfade is between two AUDIO events — notes do not fade"]);
    return;
  }
  // A comped event is several clips: its seams are crossfaded in the takes view, its edges by hand.
  if (ca.comp || cb.comp || ca.event?.takes || cb.event?.takes) {
    h.refuse([
      "one of these events has takes — crossfade its seams in its takes view (event comp fade)",
    ]);
    return;
  }
  const dir = h.songPath;
  try {
    if (!(length > 0)) {
      setTrackPlacementFade(dir, track.id, aBeats, num, den, "fadeOut", 0);
      setTrackPlacementFade(dir, track.id, bBeats, num, den, "fadeIn", 0);
      h.log([`${track.id}: no crossfade between ${atA} and ${atB}`]);
      await h.reload();
      return;
    }
    const grid = { tempo: p.tempo, num, den };
    const side = (c: typeof ca): CrossfadeSide & { file: number } => {
      const mat = loadAudioClipDoc(dir, materialRefOf(c.id), grid);
      const file = wavSeconds(c.source) ?? 0;
      return {
        start: c.start,
        length: c.length,
        from: c.sourceFrom ?? 0,
        to: c.sourceTo,
        matFrom: mat?.sourceFrom ?? 0,
        matTo: mat?.sourceTo ?? (file > 0 ? file : null),
        file,
      };
    };
    const sa = side(ca);
    const sb = side(cb);
    const plan = planCrossfade(sa, sb, length, p.tempo);
    if (!plan) {
      h.refuse([
        "neither event has material to overlap with — open one's window first",
      ]);
      return;
    }
    if (plan.aTo !== undefined)
      setTrackPlacementWindow(
        dir,
        track.id,
        aBeats,
        num,
        den,
        { from: sa.from, to: plan.aTo },
        sa.file,
      );
    let bAt = bBeats;
    if (Math.abs(plan.bStart - bBeats) > 1e-9) {
      moveTrackPlacement(
        dir,
        track.id,
        bBeats,
        beatsToPosition(plan.bStart, num, den),
        num,
        den,
      );
      bAt = plan.bStart;
      setTrackPlacementWindow(
        dir,
        track.id,
        bAt,
        num,
        den,
        { from: plan.bFrom, to: sb.to ?? sb.file },
        sb.file,
      );
    }
    setTrackPlacementFade(
      dir,
      track.id,
      aBeats,
      num,
      den,
      "fadeOut",
      plan.length,
    );
    setTrackPlacementFade(dir, track.id, bAt, num, den, "fadeIn", plan.length);
    h.log([
      `${track.id}: crossfade of ${plan.length.toFixed(2)} beat(s) between ${atA} and ${beatsToPosition(bAt, num, den)}`,
    ]);
    await h.reload();
  } catch (e) {
    h.refuse([`event crossfade failed: ${(e as Error).message}`]);
  }
}
