// surfaces.ts — the OPTIONAL `surfaces/` folder of an st0 project, read off the disk: one file
// per special view the editor should draw. Node-side; the parser itself is browser-safe
// (yaml/surfaceFile.ts), so an app can read one out of the file service without this.
// Full rationale: docs/surfaces.md.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  type ProjectSurface,
  type ProjectSurfaces,
  parseSurface,
  SURFACES_DIR,
} from "@studio/song-schema/yaml/surfaceFile";
import {
  SURFACE_LAYOUTS_BY_TYPE,
  SURFACE_MAPPING_SKELETON,
  SURFACE_TYPES,
  type SurfaceType,
} from "@studio/song-schema/yaml/surfaceSchema";
import type { Diagnostic } from "./loader";
import { ensureVideoRun } from "./videoOutputs";
import { entityFiles } from "./yaml/moduleIO";

// The shapes are the WIRE's, declared beside the browser-safe parser and imported back here, so
// the side that walks the disk and the side that receives the payload cannot drift.
export type { ProjectSurface, ProjectSurfaces };

/**
 * Every surface a project declares, in filename order, plus what would not read.
 *
 * The folder is OPTIONAL and its absence is not a diagnostic: almost no project has one, and a
 * missing optional folder is the ordinary case rather than something to report. `entityFiles`
 * already answers "nothing here" for a folder that is not there.
 *
 * A file that does not PARSE is reported and skipped, never guessed at. A surface is a screen
 * the editor draws from a declaration; half a declaration would be a screen with no way to
 * tell what it was supposed to be, which is the failure this repo keeps paying for.
 */
export function projectSurfaces(dir: string): ProjectSurfaces {
  const surfaces: ProjectSurface[] = [];
  const diagnostics: Diagnostic[] = [];
  for (const { id, file } of entityFiles(
    join(dir, SURFACES_DIR),
    SURFACES_DIR,
  )) {
    const rel = file.rel.replace(/^\/+/, "");
    let text: string;
    try {
      text = readFileSync(file.path, "utf8");
    } catch (e) {
      diagnostics.push({
        file: rel,
        line: 1,
        col: 1,
        severity: "error",
        message: `surface '${id}' could not be read: ${(e as Error).message}`,
      });
      continue;
    }
    const { value, issues } = parseSurface(text);
    for (const issue of issues)
      diagnostics.push({
        file: rel,
        line: issue.line ?? 1,
        col: issue.col ?? 1,
        severity: "error",
        message: issue.path ? `${issue.path}: ${issue.message}` : issue.message,
      });
    if (value) surfaces.push({ id, file: rel, surface: value });
  }
  return { surfaces, diagnostics };
}

/**
 * Scaffold `surfaces/<id>.yaml` and return its project-relative path.
 *
 * **The layout is DERIVED, never asked for.** `SURFACE_LAYOUTS_BY_TYPE` already says which one
 * each type can be drawn in, and every type has exactly one today — so a `layout` argument could
 * only ever be right or refused by the schema a moment later. Deriving it means the file this
 * writes is one the parser accepts by construction, which is the whole job of a scaffold.
 *
 * The id defaults to the type, because that is what a project usually has one of. It stays an
 * argument for the case the docs use — `surfaces/desk.yaml` reads better than `turntables.yaml`
 * on a set, and the id is the filename you open and read.
 *
 * Two refusals, and they are different:
 *
 * - the FILE exists — the ordinary "that name is taken", as every other scaffold here answers;
 * - a `split` surface of this type is already declared. Only one can be drawn: `App.tsx` takes
 *   the FIRST of each and the pane ring has one slot for it, so a second is a file that changes
 *   nothing and shows nothing — the shape of thing that gets edited for an hour before anyone
 *   works out it was never on screen.
 *
 * That second refusal now covers EVERY type, the desk included. A `view` surface used to be
 * exempt — each got its own header button, so a warm-up desk beside the main one was a real
 * arrangement — and nothing draws in `view` any more. The `layout === "split"` test below is
 * therefore always true today; it is kept because it is the reason for the rule rather than a
 * restatement of the type list, and it is what a future `view` would be measured against.
 */
export function createSurfaceFile(
  dir: string,
  type: SurfaceType,
  id: string = type,
): string {
  // Kept although the type says so: this is reached from a command line, where the word is a
  // string until `isSurfaceType` has looked at it, and a caller that skipped that check would
  // otherwise write a file the parser refuses.
  if (!(SURFACE_TYPES as readonly string[]).includes(type))
    throw new Error(
      `unknown surface type '${type}' — ${SURFACE_TYPES.join(", ")}`,
    );
  // The filename IS the id, exactly as it is for a curve and every other flat entity folder.
  if (!/^[A-Za-z0-9_-]+$/.test(id))
    throw new Error(
      `invalid surface name '${id}' — letters, digits, '_' and '-' only`,
    );
  const layout = SURFACE_LAYOUTS_BY_TYPE[type][0];
  const rel = `${SURFACES_DIR}/${id}.yaml`;
  if (existsSync(join(dir, rel)))
    throw new Error(`surface '${id}' already exists (${rel})`);
  if (layout === "split") {
    const taken = projectSurfaces(dir).surfaces.find(
      (s) => s.surface.type === type && s.surface.layout === "split",
    );
    if (taken)
      throw new Error(
        `this project already declares a ${type} surface (${taken.file}), and only one is drawn`,
      );
  }
  mkdirSync(join(dir, SURFACES_DIR), { recursive: true });
  writeFileSync(
    join(dir, rel),
    `type: ${type}\nlayout: ${layout}\n${mappingSkeleton(type)}`,
    "utf8",
  );
  // A viewport brings the picture's two outputs with it. Here rather than left to the open path
  // so the graph gains them in the same breath as the surface: `project surface new viewport`
  // then reads back a project whose frame has somewhere to leave by. See docs/videoOutputs.md.
  if (type === "viewport") ensureVideoRun(dir);
  return rel;
}

/**
 * Every component of a type, listed with a `null` and a note on what it wants.
 *
 * ```yaml
 * mapping:
 *   crossfade: null    # un module crossfade, param Mix
 *   deckA.tempo: null  # un module tempo
 * ```
 *
 * `null` and not a comment, and that is the whole design: a commented line is not something a
 * parser will ever tell you that you got wrong, where a key that is THERE is validated the
 * moment you fill it in. Absent and null mean the same thing downstream — `unmappedControls`
 * reports both — so the skeleton costs nothing and answers the question a bare `mapping:` leaves
 * open, which is what the ids even are.
 *
 * **Duplicated on purpose, and held to the original by a test.** `docs/surfaces.md` says
 * `@studio/song` does not know what a `crossfade` is, and that is still true: this list is
 * `@studio/ui-turntables`' vocabulary written out, because that package reaches
 * `@studio/engine-browser` through `deck.ts` and cannot be imported by a scaffold that runs in a
 * CLI. What the boundary was protecting against is the copy going STALE, so
 * `ui-turntables/mapping.test.ts` holds this to `MIX_CONTROLS` and fails when the desk grows a
 * control this does not offer. The rule survives; only its enforcement moved.
 */
function mappingSkeleton(type: SurfaceType): string {
  const rows = SURFACE_MAPPING_SKELETON[type];
  if (!rows.length) return "";
  return `mapping:\n${rows
    .map(([id, wants]) => `  ${id}: null # ${wants}\n`)
    .join("")}`;
}

/**
 * Just the diagnostics, for the array `workspace.ts` assembles beside the other checkers — plus
 * the two about a surface that is NOT there.
 *
 * A project holding arranged MATERIAL and declaring no `timeline` surface opens onto the
 * graph alone: its clips are on disk, its lanes compile, and nothing draws them. That is the
 * one absence worth a sentence, because every other symptom of it reads as "the app is
 * broken" rather than "this project has not said it wants an arrangement".
 *
 * A WARNING and not an error: the project is valid, it opens, and the editor you would add
 * the file in is inside it. A mix and a bare rig are silent, and `hasMaterial` is what makes
 * them so: they hold nothing a timeline would have drawn. `project_type: live` used to answer
 * this, and answered it worse -- a second declaration, free to disagree with the folder it
 * described.
 *
 * The picture has the SAME failure and gets the same sentence: a folder with `video_tracks/` and
 * no `viewport` surface compiles its lanes, draws them on the timeline, and composites them
 * nowhere. The lanes being visible is exactly what makes this one worth saying — the project
 * looks like it is working.
 */
/**
 * Whether this folder holds anything the timeline would have drawn: a clip, a sequence, or a
 * lane of picture.
 *
 * Cheap on purpose, like `isVideoProject` beside it: three `existsSync` calls, no parse. A folder
 * is asked what it HOLDS rather than what it calls itself, which is the whole point of the mode
 * going away -- the two could disagree, and only one of them was ever true.
 *
 * Picture counts because picture is drawn on the SAME timeline as the sound (packages/song-video/docs/picture.md).
 * A folder with `video_tracks/` and no timeline surface has both absences at once and is told
 * about both, which is what "can be missing BOTH" pins.
 *
 * Material and not placement, deliberately. Reading every lane for an `events:` key would be
 * the exact answer and would cost a load of the whole nodes/ folder on a path that runs beside
 * the other diagnostics. An entity folder gives the same answer for every project anyone writes,
 * and differs only for one somebody emptied out -- which warns about a timeline they can delete
 * rather than staying silent about one they need.
 */
/**
 * Whether `dir` carries picture at all — the cheap check a caller makes before compiling.
 *
 * It lives here rather than beside the compiler it guards (`@studio/song-video`) because it is a
 * folder probe and nothing more: asking it must not cost the reader the video document model.
 * That is also what keeps this package from depending on the one that compiles a picture.
 */
export function isVideoProject(dir: string): boolean {
  return existsSync(resolve(dir, "video_tracks"));
}

function hasMaterial(dir: string): boolean {
  const abs = resolve(dir);
  return (
    existsSync(join(abs, "clips")) ||
    existsSync(join(abs, "sequences")) ||
    isVideoProject(abs)
  );
}

/**
 * The surfaces whose `mapping` names `module`, by id — empty for almost every project.
 *
 * Asked before a node is RENAMED. A mapping is the only place outside `graph.yaml` where a node's
 * name is a reference, and nothing here writes one back: a desk pointing at a name that has moved
 * loses the knob silently, with a screen that draws and a control that does nothing. So the
 * rename declines instead, and says which file is holding the name.
 *
 * A surface that would not parse contributes nothing, deliberately. It is already reported by
 * `surfaceIssues`, and a file the reader cannot understand is not evidence that a name is free.
 */
export function surfacesNaming(dir: string, module: string): string[] {
  return projectSurfaces(dir)
    .surfaces.filter(({ surface }) =>
      Object.values(surface.mapping ?? {}).some((b) => b?.module === module),
    )
    .map((s) => s.id);
}

export function surfaceIssues(dir: string): Diagnostic[] {
  const { surfaces, diagnostics } = projectSurfaces(dir);
  const declares = (type: string) =>
    surfaces.some((s) => s.surface.type === type);
  if (hasMaterial(dir) && !declares("timeline"))
    diagnostics.push({
      file: `${SURFACES_DIR}/`,
      line: 1,
      col: 1,
      severity: "warning",
      // Names the COMMAND rather than the file to write. It used to spell the two lines out,
      // which meant reading a diagnostic, opening a folder that may not exist, and typing a
      // pair the schema is about to check — for a file whose whole content is derivable from
      // the word `timeline`.
      message:
        `this project is an arrangement and declares no timeline, so nothing draws its lanes — ` +
        `run \`project surface new timeline\` (packages/song/docs/surfaces.md)`,
    });
  if (isVideoProject(dir) && !declares("viewport"))
    diagnostics.push({
      file: `${SURFACES_DIR}/`,
      line: 1,
      col: 1,
      severity: "warning",
      message:
        `this project has video lanes and declares no viewport, so nothing composites them — ` +
        `run \`project surface new viewport\` (packages/song/docs/surfaces.md)`,
    });
  return diagnostics;
}
