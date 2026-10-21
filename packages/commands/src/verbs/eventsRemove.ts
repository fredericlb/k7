// eventsRemove.ts — `events remove <json>`: several placements off their tracks in ONE command, so a
// rectangle cleared with Backspace is one Ctrl+Z. The events are NAMED, `{ track, start }`, rather than
// found by a range: the timeline already knows which ones its rectangle holds. See docs/verbs.md.
// One on a lane sounding a picture is not removed but its shot SILENCED (packages/song/docs/videoSound.md).

import { removeTrackPlacement } from "@studio/song-edit/trackMix";
import { parsePosition } from "@studio/song-schema/timecode";
import type { CommandHost, SidHandler } from "../commands.ts";
import {
  shotSoundingAt,
  silenceShots,
  soundingPicture,
} from "./pictureSound.ts";

export const EVENTS_REMOVE_VERBS: Record<string, SidHandler> = {
  "events.remove": (a, h) => removeEvents(a, h),
};

const USAGE =
  'usage: events remove [{"track":"drums","start":"2:1:1"}, …] — the events to take off, by track and start';

async function removeEvents(arg: string, h: CommandHost): Promise<void> {
  let wanted: { track: string; start: string }[];
  try {
    const raw = JSON.parse(arg.trim());
    if (!Array.isArray(raw) || !raw.length) throw new Error("an empty list");
    wanted = raw.map((e) => ({
      track: String(e.track),
      start: String(e.start),
    }));
  } catch {
    h.refuse([USAGE]);
    return;
  }
  const p = h.project();
  const num = p.timeSigNumerator;
  const den = p.timeSigDenominator;
  // Every event checked against the compiled project FIRST: a clear refusal beats a partial write.
  const hits: { track: string; at: number; tc: string }[] = [];
  const silenced: Exclude<ReturnType<typeof shotSoundingAt>, string>[] = [];
  for (const w of wanted) {
    const t = p.tracks.find((x) => x.id === w.track || x.name === w.track);
    if (!t) {
      h.refuse([`no track "${w.track}"`]);
      return;
    }
    let at: number;
    try {
      at = parsePosition(w.start, num, den);
    } catch (e) {
      h.refuse([`bad timecode: ${(e as Error).message}`]);
      return;
    }
    if (!t.clips.some((c) => Math.abs(c.start - at) < 1e-6)) {
      h.refuse([`no event on '${t.id}' at ${w.start}`]);
      return;
    }
    const picture = soundingPicture(h.songPath, t.id);
    if (picture) {
      const shot = shotSoundingAt(h, picture, at);
      if (typeof shot === "string") return h.refuse([shot]);
      silenced.push(shot);
    } else hits.push({ track: t.id, at, tc: w.start });
  }
  try {
    let removed = 0;
    for (const x of hits)
      if (removeTrackPlacement(h.songPath, x.track, x.at, num, den)) removed++;
    if (silenced.length && !silenceShots(h, silenced)) return;
    const lanes = [...new Set(hits.map((x) => x.track))];
    h.log([
      ...(hits.length
        ? [
            `removed ${removed} event${removed === 1 ? "" : "s"} from ${lanes.join(", ")}`,
          ]
        : []),
      ...(silenced.length
        ? [
            `silenced ${silenced.map((s) => s.ref).join(", ")} — the shots stay in the picture`,
          ]
        : []),
    ]);
    await h.reload();
  } catch (e) {
    h.refuse([`events remove failed: ${(e as Error).message}`]);
  }
}
