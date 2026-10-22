// timelineSchema.ts — a TIMELINE file (timelines/<id>.k7x): lanes of events, placed whole as one
// event on another lane. What a reader gets wrong: its lanes are not the project's lanes — they
// have no module, no plugin, no routing; what they hold plays through the lane the timeline is
// placed on, and its `pictures:` draw on the song's picture lane of their name
// (packages/song/docs/timelines.md).

import { z } from "zod";
import { PlacementSchema, TIMECODE } from "./placementSchema";
import { VideoPlacementSchema } from "./videoPlacementSchema";

const LANE_NAME = z
  .string()
  .regex(/^[^>\s]+$/, "a lane name has no space and no '>'");

/** A timeline's own lane: a name and its events, nothing that sounds. */
export const TimelineLaneSchema = z
  .object({
    lane: LANE_NAME,
    events: z.array(PlacementSchema).optional(),
    // Silences the whole lane wherever the timeline is placed.
    disabled: z.boolean().optional(),
    color: z.string().optional(),
  })
  .strict();

/** A timeline's PICTURE lane: shots in seconds from the timeline's start, and no frame of its own. */
export const TimelinePictureSchema = z
  .object({
    lane: LANE_NAME,
    events: z.array(VideoPlacementSchema).optional(),
    // Hides the whole lane wherever the timeline is placed.
    disabled: z.boolean().optional(),
    color: z.string().optional(),
  })
  .strict();

export const TimelineSchema = z
  .object({
    // A DURATION ("8:0" is eight bars); absent, the content's end rounded up to the bar.
    length: z
      .string()
      .regex(TIMECODE, "expected a duration like 8:0 — eight bars")
      .optional(),
    lanes: z.array(TimelineLaneSchema),
    pictures: z.array(TimelinePictureSchema).optional(),
  })
  .strict()
  // Two lanes of one name, sound or picture, would be one address for two lists of events.
  .superRefine((t, ctx) => {
    const seen = new Set<string>();
    const check =
      (key: "lanes" | "pictures") => (l: { lane: string }, i: number) => {
        if (seen.has(l.lane))
          ctx.addIssue({
            code: "custom",
            message: `lane '${l.lane}' is named twice`,
            path: [key, i, "lane"],
          });
        seen.add(l.lane);
      };
    t.lanes.forEach(check("lanes"));
    t.pictures?.forEach(check("pictures"));
  });

export type TimelineFile = z.infer<typeof TimelineSchema>;
export type TimelinePicture = z.infer<typeof TimelinePictureSchema>;
