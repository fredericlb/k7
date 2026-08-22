// surfaceSchema.ts — `surfaces/<name>.yaml`'s shape, in Zod: a special VIEW a project asks its
// editor to draw, what kind it is, where it goes, and which module each of its components is
// wired to. The wiring reuses `views/mix.yaml`'s binding, being the same question.
// Full rationale: docs/surfaces.md.

import { z } from "zod";
import { MixViewSchema } from "./mixViewSchema";

/**
 * The kinds of surface there are: m9's desk, the ARRANGEMENT — the timeline — and the FRAME.
 *
 * An ENUM rather than free text, unlike the control ids in the mapping below, and the two are
 * not inconsistent. A control id is the app's vocabulary and grows whenever a panel gains a
 * knob; a surface TYPE is a component that has to exist in the editor, so a folder naming one
 * nothing can draw is a project that will open onto an empty screen with no explanation. That
 * is worth refusing at the schema, by name, with the list of what there is.
 *
 * All three are declared the same way: a song says it wants an arrangement exactly as a set says
 * it wants a desk, or a song with picture says it wants a frame. Nothing is implicit, so a
 * project that draws none of them opens on its graph and is told why. See docs/surfaces.md.
 */
export const SURFACE_TYPES = ["turntables", "timeline", "viewport"] as const;
export type SurfaceType = (typeof SURFACE_TYPES)[number];

/** Is this word one of them? For the places a TYPED string arrives — a command line, a query —
 *  so the narrowing happens once, here, instead of as a cast at each of them. */
export const isSurfaceType = (s: string): s is SurfaceType =>
  (SURFACE_TYPES as readonly string[]).includes(s);

/**
 * Where a surface goes: its own screen off the header (`view`), or a slot in the layout that
 * shares the window with the graph (`split`).
 *
 * Two axes rather than one, deliberately — the same turntables could be a screen or a band under
 * the arrangement, and that is a layout rather than a kind. What each TYPE can actually be drawn
 * in is `SURFACE_LAYOUTS_BY_TYPE` below: the axes stay independent, and which pairs the editor
 * has a component for is a separate, checkable fact.
 *
 * **Nothing draws in `view` today** — the desk was the last one and became a pane. The word stays
 * in the enum on purpose rather than being deleted: it is what lets the pair check below answer a
 * file that still says `layout: view` with "a 'turntables' surface draws in 'split', not in
 * 'view'", which names the fix. Dropped from the enum, the same file would get zod's own "invalid
 * enum value", which names the field and not the remedy.
 */
export const SURFACE_LAYOUTS = ["view", "split"] as const;
export type SurfaceLayout = (typeof SURFACE_LAYOUTS)[number];

/**
 * Which layouts each type can be DRAWN in, today.
 *
 * The pair is checked for the reason `type` is an enum at all: a `turntables` asking for `split`
 * or a `timeline` asking for `view` names something the editor has no component for, and the
 * result is a blank screen with no explanation. Refused here, by name, with the list — rather
 * than discovered on screen.
 *
 * A `split` surface is not a `view` surface drawn smaller. It takes a slot in the layout, is
 * mounted for as long as the project is open (its caret and its zoom stack outlive being hidden),
 * and joins the pane ring — which is the whole of why the two are separate words.
 *
 * `viewport` is `split` for the sharpest version of that reason: it owns a WebGL context and one
 * `<video>` element per layer. As a `view` it would tear both down whenever you looked at
 * something else and rebuild them — with a decoder flush and a visible hitch — whenever you came
 * back. `full` is how the picture gets big, which is the pane ring doing its job.
 *
 * `turntables` was the one `view` — a screen off the header, over the whole window. It is `split`
 * now, for the plainest of the reasons above: a desk is something you work THE GRAPH against, and
 * a screen that covered the graph made "which module is this fader on" a round trip. As a pane it
 * sits over the chains the way the arrangement does, joins the ring, and `full` is how it gets the
 * window when you do want it whole — the same answer the frame already had.
 */
export const SURFACE_LAYOUTS_BY_TYPE: Record<
  SurfaceType,
  readonly SurfaceLayout[]
> = {
  turntables: ["split"],
  timeline: ["split"],
  viewport: ["split"],
};

/**
 * Which components each type has, and what each one wants — `[id, note]`, in the order a
 * scaffolded surface lists them. What `project surface new` writes as `<id>: null # <note>`.
 *
 * `timeline` and `viewport` have none, and that is not an omission: a mapping says which module a
 * component MOVES, and neither has a component that moves one. The arrangement draws the
 * project's own lanes and the frame composites its own layers.
 *
 * **The desk's vocabulary, written out here, and held to the original by a test.** The two notes
 * above say `@studio/song` does not know what a `crossfade` is, and that is still the rule — what
 * it protects against is a copy going STALE. `@studio/ui-turntables` owns the real list
 * (`MIX_CONTROLS`, `REQUIRED_CONTROLS`) and cannot be imported from here in either direction: it
 * reaches `@studio/engine-browser` through `deck.ts`, and this package's node-side half would
 * drag `node:fs` back the other way. So the copy lives in this BROWSER-SAFE module, where that
 * package's own `mapping.test.ts` can import it without pulling the disk in, and fail the day the
 * desk grows a control the scaffold does not offer. The rule survives; its enforcement moved.
 */
export const SURFACE_MAPPING_SKELETON: Record<
  SurfaceType,
  readonly (readonly [string, string])[]
> = {
  timeline: [],
  viewport: [],
  turntables: [
    ["crossfade", "un module crossfade — son param de mélange"],
    ...["A", "B"].flatMap(
      (d) =>
        [
          [
            `deck${d}.tempo`,
            `un module tempo — l'étirement de la platine ${d}`,
          ],
          [`deck${d}.eqLow`, `un module eq — le grave de la platine ${d}`],
          [`deck${d}.eqMid`, "le MÊME module eq — son médium"],
          [`deck${d}.eqHigh`, "le MÊME module eq — son aigu"],
          [
            `deck${d}.filter`,
            `un module filter — le filtre de la platine ${d}`,
          ],
          // The four stem cuts. OFFERED but not REQUIRED, which is the one place these two
          // lists differ: a desk with no stem cut is a complete desk — it was yesterday's —
          // so a set that does not wire them must not be told it is missing something. What a
          // scaffold offers and what a surface must have are two questions, and this is where
          // they stopped having the same answer.
          [
            `deck${d}.stemDrums`,
            `un module stem — la batterie de la platine ${d}`,
          ],
          [`deck${d}.stemBass`, `un module stem — la basse de la platine ${d}`],
          [
            `deck${d}.stemOther`,
            `un module stem — le reste de la platine ${d}`,
          ],
          [
            `deck${d}.stemVocals`,
            `un module stem — la voix de la platine ${d}`,
          ],
        ] as const,
    ),
  ],
};

/**
 * A surface: what to draw, where, and what its components move.
 *
 * `mapping` is `views/mix.yaml`'s map, key for key — control id -> `{ module, param }` — and it
 * is the same map because it is the same question, asked by a surface instead of by m9's desk.
 * Reusing `ViewBindingSchema` is what keeps `module` meaning "the name the CHAINS file uses"
 * in both places; a second shape that happened to agree would drift the first time one grew a
 * field. See docs/viewBindings.md for why a binding cannot live in the module's own
 * `controller.yaml`.
 *
 * It is OPTIONAL, and an absent one is not an error here. Which components a given type needs
 * is the surface's own business — `@studio/song` does not know what a `crossfade` is, exactly
 * as it does not for `views/mix.yaml` — so a missing component is reported by whoever DRAWS
 * the surface, on the component, where it can be read against the thing that is not working.
 * Refusing the file instead would refuse to open a project because one knob is unwired.
 */
export const SurfaceSchema = z
  .object({
    type: z.enum(SURFACE_TYPES),
    layout: z.enum(SURFACE_LAYOUTS),
    /**
     * The playlist this surface draws its songs from — a name under the workspace's
     * `_playlists/`, not a path (see `playlistPathOf`).
     *
     * A `turntables` surface only. It is what the song browser lists: the twelve songs that are
     * to hand tonight, rather than the two hundred and seventy-nine on the volume.
     *
     * **This is where "which songs" lives now**, and `songs.yaml` no longer answers it. The two
     * said the same thing in two files, which is one too many — and the playlist is the better
     * of the two, because it is a document with a screen (st0's cog opens it), it can be shared
     * between sets, and it was already the thing a person had written. What `songs.yaml` keeps
     * is the half a playlist has no place for: this set's CUE points on a song, which belong to
     * the desk that plays it rather than to a list other sets read. See docs/setProject.md.
     *
     * Optional, and an absent one is not an error here — for the reason `mapping` is optional
     * just below. A desk with no playlist draws, and says on the browser that it names none,
     * which is a sentence you can act on; refusing the file would refuse to open the project.
     */
    playlist: z.string().min(1).optional(),
    /**
     * Does this desk SEPARATE a record it is handed unprepared?
     *
     * A `turntables` surface only, and a boolean rather than a chain ref. It named the chain for
     * one afternoon, which asked the project a question that has nothing to do with it: which
     * module separates and which model it wants is one answer for the whole machine, and it lives
     * in `~/.studio/preferences.yaml` where `system stems` puts it. What a SET decides is whether
     * an hour of arithmetic may start because somebody put a record on — and that is worth
     * deciding per set, because a rehearsal rig and a stage rig answer it differently.
     *
     * Absent is false, and false is a state rather than a fault: the desk draws, plays, and says
     * on its greyed knobs that this record was never separated. See
     * packages/ui-turntables/docs/stems.md.
     */
    stems: z.boolean().optional(),
    // `MixViewSchema` itself, not a record built the same way. It was the latter, and the two
    // drifted the first time one of them grew: `null` — a component named and not wired, which
    // is what a scaffolded desk is made of — became legal in one and stayed refused in the other,
    // so the file `project surface new` writes would not load. Exactly the failure the note
    // below predicts, arriving through the schema instead of through the shape.
    mapping: MixViewSchema.optional(),
  })
  .strict()
  // …and the PAIR, which neither enum can see on its own. On `layout`, so the squiggle lands on
  // the line that is wrong rather than on the file.
  .superRefine((s, ctx) => {
    const allowed = SURFACE_LAYOUTS_BY_TYPE[s.type];
    if (allowed && !allowed.includes(s.layout))
      ctx.addIssue({
        code: "custom",
        path: ["layout"],
        message: `a '${s.type}' surface draws in ${allowed.map((l) => `'${l}'`).join(" or ")}, not in '${s.layout}'`,
      });
    // A playlist on a surface with no song browser names something nothing will read. Refused
    // rather than ignored, for the reason `.strict()` refuses an unknown key: a field that is
    // accepted and does nothing is worse than one that is turned down, because the person who
    // wrote it goes looking for the effect somewhere else.
    if (s.playlist !== undefined && s.type !== "turntables")
      ctx.addIssue({
        code: "custom",
        path: ["playlist"],
        message: `only a 'turntables' surface reads a playlist — a '${s.type}' draws no song browser`,
      });
    // Same rule, same reason: the separating chain is read when a record goes ON A DECK, and
    // nothing else in this project has one.
    if (s.stems !== undefined && s.type !== "turntables")
      ctx.addIssue({
        code: "custom",
        path: ["stems"],
        message: `only a 'turntables' surface separates a record — a '${s.type}' loads none`,
      });
  });

export type Surface = z.infer<typeof SurfaceSchema>;
