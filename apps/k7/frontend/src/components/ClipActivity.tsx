// ClipActivity.tsx — a timeline event block's FILL, with the content's activity running
// through it: opacity 50% where the clip is quiet, 100% where it is loud, changing along the
// block. The mapping itself is pure and lives in src/activity.ts; this layer fetches what it
// needs and paints. It replaces the block's flat background, masked or (no data yet) at 70%.

import { cn } from "@frediverse/ui/lib/utils";
import { categoryShade } from "@studio/song-schema/trackColor";
import { memo, useMemo } from "react";
import { activityMask, audioActivity, midiActivity } from "../activity";
import type { EnvelopeProject } from "../clipEnvelope";
import type { WebClip } from "../types";
import { useClipWaveform } from "./ClipContent";

/** What a track the compile has not coloured yet is drawn in: the `other` category's shade (trackColor.ts). */
export const UNCOLOURED = categoryShade("other", 0, 1);

/** Memoised for the reason ClipContent is: one per clip, re-rendered by everything the timeline does, while its inputs barely move. */
export const ClipActivity = memo(function ClipActivity({
  clip,
  spanBeats,
  color,
  project,
  pending = false,
}: {
  clip: WebClip;
  // The beats the block draws — a length-0 clip draws NATURAL wide, and the activity must cover what is drawn.
  spanBeats: number;
  color?: string; // the track's colour; absent until a compile gives one, which draws UNCOLOURED
  project: EnvelopeProject; // part of the envelope's identity — see src/clipEnvelope.ts
  /** A resize in hand: the fill goes grey until the release, the activity drawn being the OLD extent's. */
  pending?: boolean;
}) {
  // Audio reads the event's envelope, already windowed to its from/to and normalised against that window's own loudest point.
  const wf = useClipWaveform(clip.type === "audio" ? clip : null, project);
  const mask = useMemo(() => {
    const alphas =
      clip.type === "midi"
        ? midiActivity(
            clip.notes,
            spanBeats,
            // ~2 buckets per beat, bounded: enough to see a bar's shape, cheap as a style string.
            Math.max(8, Math.min(96, Math.round(spanBeats * 2))),
            clip.loopStart,
            clip.loopEnd,
          )
        : wf?.peak?.length
          ? audioActivity(wf.peak, 96)
          : [];
    return alphas.length ? activityMask(alphas) : null;
  }, [clip, spanBeats, wf]);
  return (
    <div
      className={cn(
        "absolute inset-0 -z-10 transition-[filter]",
        pending && "grayscale",
      )}
      style={{
        // No colour yet (before a compile has given one) is the category scheme's own "other" grey, not a hue of its own.
        background: color ?? UNCOLOURED,
        // No envelope (yet, or ever): the flat 70% the blocks always wore, so nothing flashes.
        ...(mask
          ? { WebkitMaskImage: mask, maskImage: mask }
          : { opacity: 0.7 }),
      }}
    />
  );
});
