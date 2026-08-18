// surfaces.ts — the OPTIONAL `surfaces/` folder of an l8 project, read off the disk: one file
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
 * each type can be drawn in, and every type has exactly one today — so a `layout` argument could
 * only ever be right or refused by the schema a moment later. Deriving it means the file this
 * writes is one the parser accepts by construction, which is the whole job of a scaffold.
 *
 * The id defaults to the type, because that is what a project usually has one of. It stays an
 * argument for the case the docs use — `surfaces/desk.yaml` reads better than `turntables.yaml`
 * on a set, and the id is what the header button and `/surface/<id>` say.
 *
 * Two refusals, and they are different:
 *
 * - the FILE exists — the ordinary "that name is taken", as every other scaffold here answers;
 * - a `split` surface of this type is already declared. Only one can be drawn: `App.tsx` takes
 *   the FIRST of each and the pane ring has one slot for it, so a second is a file that changes
 *   nothing and shows nothing — the shape of thing that gets edited for an hour before anyone
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
  // No `mapping:`, deliberately. Which components a type needs is the SURFACE's business —
  // `@studio/song` does not know what a crossfade is (docs/surfaces.md), so a skeleton written
  // here would be this package guessing at another's vocabulary and going stale the day it grew a
  // control. An unmapped desk says so on the desk, next to the knob that does not work.
  writeFileSync(join(dir, rel), `type: ${type}\nlayout: ${layout}\n`, "utf8");
  return rel;
}

/**
 * Just the diagnostics, for the array `workspace.ts` assembles beside the other checkers — plus
 * the two about a surface that is NOT there.
 *
 * An `arrangement` project declaring no `timeline` surface opens onto the graph alone: its clips
 * are on disk, its lanes compile, and nothing draws them. That is the one absence worth a
 * sentence, because every other symptom of it reads as "the app is broken" rather than "this
 * project has not said it wants an arrangement".
 *
 * A WARNING and not an error: the project is valid, it opens, and the editor you would add the
 * file in is inside it. A `live` project is silent — a rig has no arrangement to draw, which is
 * what `project_type` says (docs/projectMode.md).
 *
 * The picture has the SAME failure and gets the same sentence: a folder with `video_tracks/` and
 * no `viewport` surface compiles its lanes, draws them on the timeline, and composites them
 * nowhere. The lanes being visible is exactly what makes this one worth saying — the project
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
      // pair the schema is about to check — for a file whose whole content is derivable from
      // the word `timeline`.
      message:
        `this project is an arrangement and declares no timeline, so nothing draws its lanes — ` +
        `run \`surface new timeline\` (packages/song/docs/surfaces.md)`,
    });
  if (isVideoProject(dir) && !declares("viewport"))
    diagnostics.push({
      file: `${SURFACES_DIR}/`,
      line: 1,
      col: 1,
      severity: "warning",
      message:
        `this project has video lanes and declares no viewport, so nothing composites them — ` +
        `run \`surface new viewport\` (packages/song/docs/surfaces.md)`,
    });
  return diagnostics;
}
