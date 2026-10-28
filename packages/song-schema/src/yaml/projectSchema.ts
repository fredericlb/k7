// projectSchema.ts — project.k7x's shape, in Zod. Two tiers: `project: {…}` (the
// song's own settings) plus `trackOrder`/`markers` as root siblings; both tiers are
// `.strict()`, so a key written at the wrong one refuses to load. `markers` keys
// are timecodes, written as strings.

import { METRONOME_MIN } from "@studio/engine-protocol/build";
import { z } from "zod";
import { TIMECODE } from "./placementSchema";

/** The master fader's range in dB, exported so the schema and `project master` cannot disagree (docs/projectFile.md). */
export const MASTER_MIN_DB = -100;
export const MASTER_MAX_DB = 12;

export const ProjectSettingsSchema = z
  .object({
    uuid: z.string().optional(),
    name: z.string().optional(),
    tempo: z.number().positive().optional(),
    sampleRate: z.number().int().positive().optional(),
    timeSignature: z
      .string()
      .regex(/^[0-9]+\/[0-9]+$/, "expected a time signature like 4/4")
      .optional(),
    // The song's OUTPUT level in dB, absent meaning UNITY — a fact about the MIX (docs/masterVolume.md).
    masterVolume: z.number().min(MASTER_MIN_DB).max(MASTER_MAX_DB).optional(),
    // The summing CONSOLE over the mix: a system folder of a library's `console/` (packages/song/docs/console.md).
    console: z
      .string()
      .regex(
        /^@[^/]+\/console\/[^/]+$/,
        "a console is @<library>/console/<system>",
      )
      .optional(),
    // DEAD and still accepted, since `.strict()` would turn a refusal into a project that will not open.
    modules_from: z.array(z.string()).optional(),
    libraries_from: z.array(z.string()).optional(),
    // DEAD in the same sense: `surfaces/` draws the frame and a picture lane says a song HAS picture.
    video: z.boolean().optional(),
    // PICTURE's, in the SHARED settings tier since one schema validates every dialect (docs/projectFile.md).
    viewport: z
      .union([
        z.tuple([z.number().int().positive(), z.number().int().positive()]),
        z.tuple([
          z.number().int().positive(),
          z.number().int().positive(),
          z.number().int().positive(),
        ]),
      ])
      .optional(),
    // Empty is accepted and read by nothing, as most songs carry it; naming a lane means one its open did not migrate (docs/formatLevel.md).
    layers: z
      .array(z.string())
      .max(0, {
        message:
          "`layers` is gone — the picture draws in the rows' order (`trackOrder`); open the project in k7 to move its picture lanes",
      })
      .optional(),
    // The words the home page files this song under, written by `project tag` (src/projectTags.ts).
    tags: z.array(z.string().min(1)).optional(),
  })
  .strict();

export { PROJECT_SHAPES, type ProjectShape } from "../projectShapes";

/** v1's marker key: a WALL-CLOCK position, a superset of TIMECODE where the two overlap (docs/projectFile.md). */
const WALL_CLOCK = /^[0-9]+(\.[0-9]+)?$|^[0-9]+:[0-5][0-9](\.[0-9]+)?$/;

/** What `markers:` accepts across every dialect — one schema validates them all (see viewport above). */
const MARKER_KEY = new RegExp(`${TIMECODE.source}|${WALL_CLOCK.source}`);

export const ProjectFileSchema = z
  .object({
    // The project FORMAT LEVEL, absent meaning 1; a newer one is refused before this schema runs (docs/formatLevel.md).
    format: z.number().int().min(1).optional(),
    project: ProjectSettingsSchema.optional(),
    // DEAD and still accepted: the folder's SUFFIX says which app opens a project (docs/projectFile.md).
    type: z.string().optional(),
    // Accepted and IGNORED — a free string and not an enum, deliberately (docs/projectFile.md).
    project_type: z.string().optional(),
    trackOrder: z.array(z.string()).optional(), // tracks' order, bottom-first — a root sibling, read as root.trackOrder
    // The soloed lanes by id — solo as PROJECT STATE, several at once (docs/projectFile.md).
    soloed: z.array(z.string()).optional(),
    // …and the HIGHLIGHTED ones, heard 10 dB up on their strip, the fader untouched (song docs/highlight.md).
    highlighted: z.array(z.string()).optional(),
    markers: z // timeline markers: a position -> its label
      .record(
        z
          .string()
          .regex(
            MARKER_KEY,
            "a marker's key is a musical timecode like 5:1:1, or — in a v1 project — a wall-clock position like 1:30.5",
          ),
        z.string(),
      )
      .optional(),
  })
  .strict();

/** settings.k7x — project-level preferences, a flat file of its own. */
export const SettingsSchema = z.looseObject({
  metronome: z.boolean().optional(),
  // How loud the click is, 0.2 … 1 — NOT a way to silence it, and refused rather than clamped (docs/projectFile.md).
  metronome_level: z.number().min(METRONOME_MIN).max(1).optional(),
  count_in: z.number().int().min(0).optional(),
});
