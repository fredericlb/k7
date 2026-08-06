// projectSchema.ts — project.yaml's shape, in Zod. Two tiers: `project: {…}` (the
// song's own settings) plus `trackOrder`/`markers` as root siblings — mixing the tiers
// up is what once put `libraries_from` at the top level doing nothing. `markers` keys
// are quoted timecodes (unquoted, "5:1:1" is 18061 under YAML 1.1 — see trackFile.ts).

import { z } from "zod";
import { TIMECODE } from "./trackSchema";

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
    // DEAD, and still accepted: a project sees the workspace's `_modules`/`_library` and the
    // médiathèque because of where they are (sharedFolders.ts), so nothing reads these. Kept
    // in the schema because every song already written carries them and refusing the key
    // would turn a working project into one that will not open; `deadProjectFields` reports
    // them as a warning instead, naming the lines to delete.
    modules_from: z.array(z.string()).optional(),
    libraries_from: z.array(z.string()).optional(),
    video: z.boolean().optional(),
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
    layers: z.array(z.string()).optional(),
  })
  .strict();

/** What a project's files are FOR — the timeline song l8 opens, or the set m9 opens. */
export const PROJECT_TYPES = ["l8", "m9"] as const;
export type ProjectType = (typeof PROJECT_TYPES)[number];

export const ProjectFileSchema = z
  .object({
    project: ProjectSettingsSchema.optional(),
    // A ROOT sibling and not a `project:` setting, deliberately: the tiers above are the
    // SONG's settings (its tempo, its rate), and this is a fact about the file's dialect —
    // which entities the folder is allowed to hold and which app reads them. Putting it in
    // `project:` is the same mistake `libraries_from` made from the other direction.
    // The folder's SUFFIX stays authoritative (see projectType.ts): this is written down so
    // a reader — and a loader handed an absolute path with no name to read — knows too.
    type: z.enum(PROJECT_TYPES).optional(),
    trackOrder: z.array(z.string()).optional(), // tracks' order, bottom-first — a root sibling, read as root.trackOrder
    markers: z // timeline markers: a timecode -> its label
      .record(
        z.string().regex(TIMECODE, "a marker's key is a timecode like 5:1:1"),
        z.string(),
      )
      .optional(),
  })
  .strict();

export type ProjectSettings = z.infer<typeof ProjectSettingsSchema>;
export type ProjectFile = z.infer<typeof ProjectFileSchema>;

/** settings.yaml — project-level preferences, a flat file of its own. */
export const SettingsSchema = z.looseObject({
  metronome: z.boolean().optional(),
  count_in: z.number().int().min(0).optional(),
});

export type Settings = z.infer<typeof SettingsSchema>;
