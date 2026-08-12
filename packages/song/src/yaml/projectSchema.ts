// projectSchema.ts — project.yaml's shape, in Zod. Two tiers: `project: {…}` (the
// song's own settings) plus `trackOrder`/`markers` as root siblings — mixing the tiers
// up is what once put `libraries_from` at the top level doing nothing. `markers` keys
// are quoted timecodes (unquoted, "5:1:1" is 18061 under YAML 1.1 — see trackFile.ts).

import type { ProjectMode } from "@studio/engine-protocol/project";
import type { ProjectApp } from "@studio/web-protocol/projects";
import { z } from "zod";
import { TIMECODE } from "./placementSchema";

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
    /**
     * This project is the MODULE BENCH, and a save aimed at a `@mediatek` module writes
     * THROUGH to the catalogue instead of forking a copy into the project.
     *
     * Exactly one project carries it, and it is generated (`scaffoldBench.ts`) rather than
     * authored. It lives in the settings tier because it is a fact about what this project IS,
     * like `type` beside it — and it is in the SCHEMA rather than a stray key because this
     * object is `.strict()`: an undeclared marker would make the bench a project that will not
     * open. Everywhere else this is absent and a shared module forks, which is the rule
     * (`packages/song/docs/moduleFork.md`).
     */
    mediatekBench: z.boolean().optional(),
    // DEAD, and still accepted: a project sees the workspace's `_modules`/`_library` and the
    // médiathèque because of where they are (sharedFolders.ts), so nothing reads these. Kept
    // in the schema because every song already written carries them and refusing the key
    // would turn a working project into one that will not open; `deadProjectFields` reports
    // them as a warning instead, naming the lines to delete.
    modules_from: z.array(z.string()).optional(),
    libraries_from: z.array(z.string()).optional(),
    // DEAD in the same sense, and it has been dead through two moves: `video: true` gated a
    // fourth pane when l8 first drew picture. What draws the frame now is a `surfaces/` file
    // (docs/surfaces.md), and what says a song HAS picture is `video_tracks/` existing — a
    // boolean that agreed with neither would just be a third answer. Kept because every song
    // that ever had picture carries the line.
    video: z.boolean().optional(),
    // PICTURE's, and read only by the picture compile — the frame its lanes draw into and their
    // draw order, bottom first. They sit in the SHARED settings tier because one schema
    // validates every dialect (the loader has no type to branch on when it reads the header),
    // and a song is where they belong: `loadVideoProject` is a second compile of the same
    // folder, not a second kind of project. See packages/song/docs/picture.md.
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

/**
 * What a project's files are FOR — an l8 project, or z0's blind test.
 *
 * The SAME set as `ProjectApp`, and not a second list that happens to agree. `projectTypeOf`
 * answers step 1 with `projectApp(basename(dir))`, so the two are already one question asked
 * once; restating the members here is what let them drift, and z0 arriving on one side and not
 * the other is exactly how that showed up — as an assignability error forty lines away, in a
 * function that had not changed.
 *
 * `satisfies` pins every member as a real app; the line below pins the other direction, so
 * widening `ProjectApp` fails HERE, by name, instead of somewhere downstream.
 */
export const PROJECT_TYPES = [
  "l8",
  "z0",
] as const satisfies readonly ProjectApp[];
export type ProjectType = ProjectApp;

/** Compile-time exhaustiveness: an app missing from the list above makes this `never`. */
type _EveryAppIsAType =
  Exclude<ProjectApp, (typeof PROJECT_TYPES)[number]> extends never
    ? true
    : never;
const _everyAppIsAType: _EveryAppIsAType = true;
void _everyAppIsAType;

/**
 * What an l8 project is WORKED as — a song arranged in time, or a rig that is only a graph.
 *
 * A SECOND axis, orthogonal to `type` above: that one says which app opens the folder, this one
 * says which of l8's two shapes the folder has. The two never substitute for each other — every
 * value here is legal in an `.l8` folder and in no other dialect.
 *
 * `arrangement` is every song ever written here, which is why the key is optional and its absence
 * means `arrangement`. A required key would turn every existing project into one that will not
 * open, and this object's parent is `.strict()`.
 *
 * `live` is a project with **no timeline**: nothing is placed in time, so there is no arrangement
 * to scroll and l8 draws the chains graph alone. The module bench is the generated example
 * (`scaffoldBench.ts`) — apps/st0/docs/banc.md already describes exactly that shape, down to
 * "pas un morceau": a track, a chain, an output, and nothing arranged.
 *
 * Named `ProjectMode` in TypeScript and `project_type` in YAML, deliberately. `ProjectType` is
 * taken above by the dialect and two types of that name would be read as one; `project_type` is
 * what this is called from the outside — the project's type, within l8. Full rationale:
 * docs/projectMode.md.
 */
export const PROJECT_MODES = [
  "arrangement",
  "live",
] as const satisfies readonly ProjectMode[];
export type { ProjectMode };

/** Compile-time exhaustiveness: a mode missing from the list above makes this `never`. */
type _EveryModeIsListed =
  Exclude<ProjectMode, (typeof PROJECT_MODES)[number]> extends never
    ? true
    : never;
const _everyModeIsListed: _EveryModeIsListed = true;
void _everyModeIsListed;

/** What a folder that says nothing is: every project written before `live` existed. */
export const DEFAULT_PROJECT_MODE: ProjectMode = "arrangement";

/**
 * What you can ASK FOR when creating a project — which is not the same list as `PROJECT_MODES`.
 *
 * A mode is what a folder IS, and there are two: with an arrangement, or without. A shape is
 * what a scaffold WRITES, and there are three, because two different folders are both `live`:
 *
 * | shape | mode | and what makes it that shape |
 * |---|---|---|
 * | `audio` | `arrangement` | a lane, a synth, a pattern, a timeline surface, a lane of picture |
 * | `live` | `live` | the same signal path with the arrangement taken out |
 * | `set` | `live` | two decks meeting at a crossfade, `songs.yaml`, a `turntables` surface |
 *
 * So a set is not a fourth kind of project and not a third mode: it is a rig that declares a
 * desk and carries a set list. Which is exactly why `.m9` stopped needing to be a folder
 * suffix, and why nothing had to be invented to let l8 open one — see docs/setProject.md.
 *
 * The distinction is worth two names because the collapse is what went wrong before: while
 * "which app opens this" and "which shape is it" were one field, st0 sent `type: "audio"` and
 * got an l8 song written inside a `.m9` folder.
 */
export const PROJECT_SHAPES = ["audio", "live", "set"] as const;
export type ProjectShape = (typeof PROJECT_SHAPES)[number];

/** The mode a shape's folder declares. Two of the three are `live`; that is the point. */
export const MODE_FOR_SHAPE: Record<ProjectShape, ProjectMode> = {
  audio: "arrangement",
  live: "live",
  set: "live",
};

/**
 * v1's marker key: a WALL-CLOCK position — `90`, `12.5`, `1:30`, `1:30.5`.
 *
 * A superset of TIMECODE where it overlaps, which is the point: `"90"` and `"1:30"` are legal
 * under both, and the DIALECT decides what they mean — bar 90 in a song, ninety seconds in a
 * cut. Only the decimal part is new, and it is exactly what a musical timecode cannot say.
 * Quoted for the same YAML 1.1 sexagesimal reason every other timecode here is (trackFile.ts).
 */
export const WALL_CLOCK = /^[0-9]+(\.[0-9]+)?$|^[0-9]+:[0-5][0-9](\.[0-9]+)?$/;

/** What `markers:` accepts across every dialect — one schema validates them all (see viewport above). */
const MARKER_KEY = new RegExp(`${TIMECODE.source}|${WALL_CLOCK.source}`);

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
    // A ROOT sibling for the SAME reason `type` is, and it is the same kind of fact: which
    // entities the folder is allowed to hold. A live project has no arrangement, so this is not
    // one of the song's settings any more than the dialect is — putting it in `project:` beside
    // `tempo` would say it were a knob on a song rather than what the folder is.
    project_type: z.enum(PROJECT_MODES).optional(),
    trackOrder: z.array(z.string()).optional(), // tracks' order, bottom-first — a root sibling, read as root.trackOrder
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

export type ProjectSettings = z.infer<typeof ProjectSettingsSchema>;
export type ProjectFile = z.infer<typeof ProjectFileSchema>;

/** settings.yaml — project-level preferences, a flat file of its own. */
export const SettingsSchema = z.looseObject({
  metronome: z.boolean().optional(),
  count_in: z.number().int().min(0).optional(),
});

export type Settings = z.infer<typeof SettingsSchema>;
