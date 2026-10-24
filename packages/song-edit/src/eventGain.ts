// eventGain.ts — one audio event's own trim, `gain:` in dB on its placement, ±6. Rounded to a tenth of a dB, since
// a slider's every pixel is not a level anyone chose, and deleted at 0, which is unity and the default.
// See docs/eventGain.md.

import {
  findPlacementAt,
  setPlacementField,
} from "@studio/song-schema/yaml/trackFile";
import { songTempo } from "./songTempo";
import { editTrackStruct } from "./trackMix";

/** The trim an event may carry, either way: a balance between takes, not a fader. */
export const EVENT_GAIN_MAX_DB = 6;

/** `db` as the file keeps it: clamped, to a tenth of a dB, and undefined for unity. */
export function eventGainValue(db: number): number | undefined {
  const c = Math.max(-EVENT_GAIN_MAX_DB, Math.min(EVENT_GAIN_MAX_DB, db));
  const r = Math.round(c * 10) / 10;
  return r === 0 ? undefined : r;
}

/** Write the trim of the placement at `fromBeats`; false when no event sits there. */
export function setTrackPlacementGain(
  dir: string,
  id: string,
  fromBeats: number,
  num: number,
  den: number,
  db: number,
): boolean {
  let hit = false;
  const tempo = songTempo(dir);
  editTrackStruct(
    dir,
    id,
    (doc) => {
      const i = findPlacementAt(doc, fromBeats, num, den, tempo);
      if (i < 0) return;
      hit = true;
      setPlacementField(doc, i, "gain", eventGainValue(db));
    },
    "set an event's gain",
  );
  return hit;
}
