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
    modules_from: z.array(z.string()).optional(), // folders of modules to inherit, each with a namespace config
    libraries_from: z.array(z.string()).optional(), // shared asset folders (ir/, nam/) — a list, so a song can borrow from several
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

export const ProjectFileSchema = z
  .object({
    project: ProjectSettingsSchema.optional(),
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
