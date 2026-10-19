// pictureKeys.ts — `picture key` and `picture unkey`: one keyframe of a shot's animation at a
// time. The time is a TIMELINE time like every `picture …` verb's, so a key is set where the
// playhead is; the file stores it from the shot's own start, which is what lets it travel with
// the shot. See packages/song-video/docs/animation.md.

import type { K7Scope } from "@studio/k7x/document";
import {
  ANIMATED_PROPS,
  type AnimatedProp,
  EASES,
  type Ease,
} from "@studio/song-schema/keyframes";
import {
  removeVideoKeyAt,
  setVideoKeyAt,
} from "@studio/song-schema/yaml/videoKeys";
import type { VideoPlacement } from "@studio/song-schema/yaml/videoTrackFile";
import type { CommandHost, SidHandler } from "../commands.ts";
import { put, seconds, target } from "./picture.ts";

// The property word, or a refusal naming the five there are.
function propOf(word: string | undefined, h: CommandHost): AnimatedProp | null {
  if (word && (ANIMATED_PROPS as readonly string[]).includes(word))
    return word as AnimatedProp;
  h.refuse([
    `'${word ?? ""}' is not something a shot animates — ${ANIMATED_PROPS.join(", ")}`,
  ]);
  return null;
}

export const PICTURE_KEY_VERBS: Record<string, SidHandler> = {
  /** `picture key <lane> <at> <prop> <when> <value> [ease]` — one key, `when` on the timeline. */
  "picture.key": (a, h) => {
    const t = target(a, h, "key", "<prop> <when> <value> [ease]");
    if (!t) return;
    const [propArg, whenArg, valueArg, easeArg] = t.rest;
    const prop = propOf(propArg, h);
    if (!prop) return;
    const when = seconds(whenArg, h);
    if (when === null) return;
    const value = Number(valueArg);
    if (valueArg === undefined || !Number.isFinite(value)) {
      h.refuse([`'${valueArg ?? ""}' is not a number — ${prop} takes one`]);
      return;
    }
    if (
      easeArg !== undefined &&
      !(EASES as readonly string[]).includes(easeArg)
    ) {
      h.refuse([`'${easeArg}' is not an ease — ${EASES.join(", ")}`]);
      return;
    }
    const shot = t.list[t.index] as VideoPlacement;
    const ease = (easeArg as Ease | undefined) ?? "linear";
    const key = (doc: K7Scope) =>
      setVideoKeyAt(doc, t.index, prop, when - shot.start, value, ease);
    if (!put(t.abs, key, h, "key")) return;
    h.log([
      `${t.rel}: ${shot.ref || "activation"} ${prop} = ${value} at ${when}s (${Math.round((when - shot.start) * 1000) / 1000}s into the shot)`,
    ]);
    return h.reload();
  },

  /** `picture unkey <lane> <at> <prop> <when>` — the key `picture key` set there. */
  "picture.unkey": (a, h) => {
    const t = target(a, h, "unkey", "<prop> <when>");
    if (!t) return;
    const [propArg, whenArg] = t.rest;
    const prop = propOf(propArg, h);
    if (!prop) return;
    const when = seconds(whenArg, h);
    if (when === null) return;
    const shot = t.list[t.index] as VideoPlacement;
    const unkey = (doc: K7Scope) =>
      removeVideoKeyAt(doc, t.index, prop, when - shot.start);
    const none = `${t.rel}: no ${prop} key at ${when}s on the shot at ${t.at}s`;
    if (!put(t.abs, unkey, h, "unkey", none)) return;
    h.log([`${t.rel}: ${shot.ref || "activation"} − ${prop} key at ${when}s`]);
    return h.reload();
  },
};
