// projectSchema.ts — project.yaml's shape, in Zod. Two tiers: `project: {…}` (the
// song's own settings) plus `trackOrder`/`markers` as root siblings — mixing the tiers
// up is what once put `libraries_from` at the top level doing nothing. `markers` keys
// are quoted timecodes (unquoted, "5:1:1" is 18061 under YAML 1.1 — see trackFile.ts).

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
     * This project is the MODULE BENCH, and a save aimed at a `@st0` module writes
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
    // DEAD in the same sense, and accepted for the same reason. What draws the frame is a
    // `surfaces/` file (docs/surfaces.md), and what says a song HAS picture is `video_tracks/`
    // existing — a boolean agreeing with neither would just be a third answer.
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
 * The ARCHETYPES — what you can ask for when creating a project.
 *
 * Each is named after the SURFACE it opens on, because that is the whole of what is being chosen:
 *
 * | archetype | the surfaces it writes, and what fills them |
 * |---|---|
 * | `arrangement` | `timeline` — a lane, a synth, a pattern |
 * | `mix` | `turntables` — two decks meeting at a crossfade, an empty `songs.yaml` |
 * | `video` | `timeline` + `viewport` — the arrangement, plus a lane of picture |
 *
 * This used to be one of TWO lists. Beside it was `PROJECT_MODES` — `arrangement` or `live`,
 * `project.yaml`'s `project_type`, what a folder said it WAS — and a `MODE_FOR_SHAPE` table
 * relating them. Both are gone. The mode's last two jobs, closing the layout down when there is
 * no timeline and silencing the warning about one, are `surfaces/` questions and are answered
 * there now: a project draws what it DECLARES (docs/surfaces.md). A second field saying almost
 * the same thing could only ever drift from it — a folder declaring a timeline while calling
 * itself `live` was a legal state nothing could resolve.
 *
 * So there is one list, and it names archetypes rather than kinds of folder: every project is an
 * `.l8` folder that opens in l8, and what differs is the screen it asks for.
 *
 * **`mix` writes a SET**, and that pair of names is the one mismatch here. `mix` is what you ASK
 * for, named like its two neighbours; a set is what lands on disk — `songs.yaml`, decks, a desk
 * — and docs/setProject.md is its page. One word cannot be right for both audiences.
 */
export const PROJECT_SHAPES = ["arrangement", "mix", "video"] as const;
export type ProjectShape = (typeof PROJECT_SHAPES)[number];

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
    /**
     * Accepted and IGNORED — the one remnant of `project_type`.
     *
     * Nothing reads it. What a project draws is what its `surfaces/` folder says, and the mode
     * that used to answer that is gone (see `PROJECT_SHAPES` above). The line stays in the schema
     * because this object is `.strict()` and every set, rig and bench already on disk carries it:
     * dropping the key outright would turn a notion we stopped needing into a folder that no
     * longer opens, which is a worse trade than one dead line.
     *
     * Not an enum any more, deliberately. Refusing a typo in a field nobody consults would be a
     * compile error about nothing. Delete the line from a project.yaml whenever you next edit it.
     */
    project_type: z.string().optional(),
    trackOrder: z.array(z.string()).optional(), // tracks' order, bottom-first — a root sibling, read as root.trackOrder
    // The soloed lanes, by id — solo as PROJECT STATE, several at once: any entry silences
    // every lane not listed (the engine's applySoloMute resolves it across the mixer). A root
    // sibling like `trackOrder`: a list of lane ids about the mixer, not one of the song's
    // settings. Absent or empty, nobody is soloed. A group's id solos its members.
    soloed: z.array(z.string()).optional(),
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

export type ProjectFile = z.infer<typeof ProjectFileSchema>;

/** settings.yaml — project-level preferences, a flat file of its own. */
export const SettingsSchema = z.looseObject({
  metronome: z.boolean().optional(),
  count_in: z.number().int().min(0).optional(),
});

export type Settings = z.infer<typeof SettingsSchema>;
