// timelineSchema.ts — a TIMELINE file (timelines/<id>.k7x): lanes of events, placed whole as one
// event on another lane. What a reader gets wrong: its lanes are not the project's lanes — they
// have no module, no plugin, no routing; everything they hold plays through the lane the timeline
// is placed on (packages/song/docs/timelines.md).

import { z } from "zod";
import { PlacementSchema, TIMECODE } from "./placementSchema";

/** A timeline's own lane: a name and its events, nothing that sounds. */
export const TimelineLaneSchema = z
  .object({
    lane: z.string().regex(/^[^>\s]+$/, "a lane name has no space and no '>'"),
    events: z.array(PlacementSchema).optional(),
    // Silences the whole lane wherever the timeline is placed.
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
  })
  .strict()
  // Two lanes of one name would be one address for two lists of events.
  .superRefine((t, ctx) => {
    const seen = new Set<string>();
    t.lanes.forEach((l, i) => {
      if (seen.has(l.lane))
        ctx.addIssue({
          code: "custom",
          message: `lane '${l.lane}' is named twice`,
          path: ["lanes", i, "lane"],
        });
      seen.add(l.lane);
    });
  });

export type TimelineFile = z.infer<typeof TimelineSchema>;
