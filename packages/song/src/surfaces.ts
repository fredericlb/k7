// surfaces.ts â€” the OPTIONAL `surfaces/` folder of an l8 project, read off the disk: one file
// per special view the editor should draw. Node-side; the parser itself is browser-safe
// (yaml/surfaceFile.ts), so an app can read one out of the file service without this.
// Full rationale: docs/surfaces.md.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Diagnostic } from "./loader";
import { projectModeOf } from "./projectMode";
import { isVideoProject } from "./videoProject";
import { entityFiles } from "./yaml/moduleIO";
import {
  type ProjectSurface,
  type ProjectSurfaces,
  parseSurface,
  SURFACES_DIR,
} from "./yaml/surfaceFile";
import {
  SURFACE_LAYOUTS_BY_TYPE,
  SURFACE_MAPPING_SKELETON,
  SURFACE_TYPES,
  type SurfaceType,
} from "./yaml/surfaceSchema";

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
 * each type can be drawn in, and every type has exactly one today â€” so a `layout` argument could
 * only ever be right or refused by the schema a moment later. Deriving it means the file this
 * writes is one the parser accepts by construction, which is the whole job of a scaffold.
 *
 * The id defaults to the type, because that is what a project usually has one of. It stays an
 * argument for the case the docs use â€” `surfaces/desk.yaml` reads better than `turntables.yaml`
 * on a set, and the id is what the header button and `/surface/<id>` say.
 *
 * Two refusals, and they are different:
 *
 * - the FILE exists â€” the ordinary "that name is taken", as every other scaffold here answers;
 * - a `split` surface of this type is already declared. Only one can be drawn: `App.tsx` takes
 *   the FIRST of each and the pane ring has one slot for it, so a second is a file that changes
 *   nothing and shows nothing â€” the shape of thing that gets edited for an hour before anyone
 *   works out it was never on screen. A `view` surface is not refused: each gets its own header
 *   button, so several are a real arrangement.
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
      `unknown surface type '${type}' â€” ${SURFACE_TYPES.join(", ")}`,
    );
  // The filename IS the id, exactly as it is for a curve and every other flat entity folder.
  if (!/^[A-Za-z0-9_-]+$/.test(id))
    throw new Error(
      `invalid surface name '${id}' â€” letters, digits, '_' and '-' only`,
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
 * moment you fill it in. Absent and null mean the same thing downstream â€” `unmappedControls`
 * reports both â€” so the skeleton costs nothing and answers the question a bare `mapping:` leaves
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
 * Just the diagnostics, for the array `workspace.ts` assembles beside the other checkers â€” plus
 * the two about a surface that is NOT there.
 *
 * An `arrangement` project declaring no `timeline` surface opens onto the graph alone: its clips
 * are on disk, its lanes compile, and nothing draws them. That is the one absence worth a
 * sentence, because every other symptom of it reads as "the app is broken" rather than "this
 * project has not said it wants an arrangement".
 *
 * A WARNING and not an error: the project is valid, it opens, and the editor you would add the
 * file in is inside it. A `live` project is silent â€” a rig has no arrangement to draw, which is
 * what `project_type` says (docs/projectMode.md).
 *
 * The picture has the SAME failure and gets the same sentence: a folder with `video_tracks/` and
 * no `viewport` surface compiles its lanes, draws them on the timeline, and composites them
 * nowhere. The lanes being visible is exactly what makes this one worth saying â€” the project
 * looks like it is working.
 */
export function surfaceIssues(dir: string): Diagnostic[] {
  const { surfaces, diagnostics } = projectSurfaces(dir);
  const declares = (type: string) =>
    surfaces.some((s) => s.surface.type === type);
  if (projectModeOf(dir) !== "live" && !declares("timeline"))
    diagnostics.push({
      file: `${SURFACES_DIR}/`,
      line: 1,
      col: 1,
      severity: "warning",
      // Names the COMMAND rather than the file to write. It used to spell the two lines out,
      // which meant reading a diagnostic, opening a folder that may not exist, and typing a
      // pair the schema is about to check â€” for a file whose whole content is derivable from
      // the word `timeline`.
      message:
        `this project is an arrangement and declares no timeline, so nothing draws its lanes â€” ` +
        `run \`project surface new timeline\` (packages/song/docs/surfaces.md)`,
    });
  if (isVideoProject(dir) && !declares("viewport"))
    diagnostics.push({
      file: `${SURFACES_DIR}/`,
      line: 1,
      col: 1,
      severity: "warning",
      message:
        `this project has video lanes and declares no viewport, so nothing composites them â€” ` +
        `run \`project surface new viewport\` (packages/song/docs/surfaces.md)`,
    });
  return diagnostics;
}
