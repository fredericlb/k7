// projectSchema.ts — project.yaml's shape, in Zod. Two tiers: `project: {…}` (the
// song's own settings) plus `trackOrder`/`markers` as root siblings — mixing the tiers
// up is what once put `libraries_from` at the top level doing nothing. `markers` keys
// are quoted timecodes (unquoted, "5:1:1" is 18061 under YAML 1.1 — see trackFile.ts).

import { METRONOME_MIN } from "@studio/engine-protocol/build";
import { z } from "zod";
import { TIMECODE } from "./placementSchema";

/**
 * The master fader's range, in dB.
 *
 * +12 because the engine applies this with a gain of its OWN (`MasterGainPlugin`), dB straight to
 * a linear factor with no fader curve in the way. It used to stop at +6, which was never a policy:
 * Tracktion's `decibelsToVolumeFaderPosition` is `exp((dB - 6) / 20)` clamped to [0, 1], so +6 was
 * the top of THEIR fader and every value above it set the same position — silently. A master trim
 * is the one place that ceiling is a limitation rather than a shape, since a mix built with
 * headroom sits far below full scale and asking for +12 there is ordinary.
 *
 * -100 is still where the app calls silence, which is where that same curve reaches zero.
 *
 * Exported so the schema and the `project master` verb cannot come to disagree — a command that
 * accepted what the file refuses would write a project that will not load. The engine's own
 * parameter is wider still (±, to +24), so widening this again is a one-line change here.
 */
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
    /**
     * The song's OUTPUT level, in dB — the one fader after everything else.
     *
     * A fact about the mix rather than about this machine, which is why it is here and not in
     * settings.yaml beside the metronome: it moves playback, `--render` and a freeze together, and
     * it travels in a share. A monitoring level that only changed what you hear in this room would
     * be a different field in a different file.
     *
     * Absent means UNITY, and unity is never written. Until this existed the engine pinned the
     * master to 0 dB outright — a fader no surface drew and nothing could reach (EditBuilder.cpp).
     *
     * Its range is MASTER_MIN_DB..MASTER_MAX_DB, and the ceiling is real rather than borrowed: the
     * engine applies this with a gain of its own, so +12 plays +12. See docs/masterVolume.md.
     */
    masterVolume: z.number().min(MASTER_MIN_DB).max(MASTER_MAX_DB).optional(),
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
 * `.st0` folder that opens in st0, and what differs is the screen it asks for.
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
    /**
     * DEAD, and still accepted — the folder's SUFFIX is the only thing that says which app
     * opens a project now.
     *
     * It existed to name the DIALECT for the one case the name could not: a repository that IS
     * the project, with no suffix to read. That question had an answer worth asking while there
     * were two dialects `@studio/song` compiled (`.st0` and the old `.m9`); there is one, and a
     * folder saying nothing is it. Nothing branched on the answer even then — the only reader
     * left was the diagnostic that compared this line against the folder's name.
     *
     * Not an enum any more, and not dropped: this object is `.strict()`, so refusing the key
     * would turn every project already carrying it into one that will not open. Same trade as
     * `project_type` below, and `deadProjectFields` names the line to delete rather than leaving
     * "accepted" to mean "silently ignored".
     */
    type: z.string().optional(),
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
  /**
   * How loud the click is, 0.2 … 1. NOT a way to silence it — `metronome: false` is that, and the
   * range says so: Tracktion clamps its click gain to those two bounds (`Edit::setClickTrackVolume`),
   * so a 0 written here would come back as 0.2 and the file would state a level the engine does
   * not play. Refused at the schema rather than clamped, for the reason a pad effect's `1` is:
   * a value that means something other than what it says is worse than an error.
   */
  metronome_level: z.number().min(METRONOME_MIN).max(1).optional(),
  count_in: z.number().int().min(0).optional(),
});

export type Settings = z.infer<typeof SettingsSchema>;
