// pictureSpeed.ts — `picture speed <lane> <at> <factor>`: how fast a shot's source runs under it.
// Signed: 2 is double speed, 0.5 slow motion, 0 a freeze on `source_from`, −1 backwards from it.
// The shot keeps its place and its length on the timeline; what changes is how much source it
// spends. See packages/song-video/docs/speed.md.

import type { K7Scope } from "@studio/k7x/document";
import {
  setVideoSpeedAt,
  type VideoPlacement,
} from "@studio/song-schema/yaml/videoTrackFile";
import type { SidHandler } from "../commands.ts";
import { put, target } from "./picture.ts";

export const PICTURE_SPEED_VERBS: Record<string, SidHandler> = {
  "picture.speed": (a, h) => {
    const t = target(a, h, "speed", "<factor>");
    if (!t) return;
    const word = t.rest[0];
    const speed = Number(word);
    if (word === undefined || !Number.isFinite(speed)) {
      h.refuse([
        `'${word ?? ""}' is not a speed — 2 is double, 0.5 half, 0 a freeze, -1 backwards`,
      ]);
      return;
    }
    const shot = t.list[t.index] as VideoPlacement;
    if (!shot.ref) {
      h.refuse([
        `the event at ${t.at}s is an ACTIVATION — it has no source to run`,
      ]);
      return;
    }
    // Backwards spends the source BEFORE the in-point, which ends at its first frame.
    if (
      speed < 0 &&
      shot.length > 0 &&
      shot.sourceFrom + shot.length * speed < -5e-4
    ) {
      h.refuse([
        `backwards at ${-speed}× from ${shot.sourceFrom}s, ${shot.ref} runs out of source after ${+(shot.sourceFrom / -speed).toFixed(3)}s — start it later in its source (picture head), or shorten it`,
      ]);
      return;
    }
    const pace = (doc: K7Scope) => {
      setVideoSpeedAt(doc, t.index, speed);
    };
    if (!put(t.abs, pace, h, "speed")) return;
    h.log([
      `${t.rel}: ${shot.ref} at ${t.at}s ${speed === 1 ? "back to its own pace" : speed === 0 ? "frozen on its first frame" : `at ${speed}×`}`,
    ]);
    return h.reload();
  },
};
