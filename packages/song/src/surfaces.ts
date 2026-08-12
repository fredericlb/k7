// surfaces.ts — the OPTIONAL `surfaces/` folder of an l8 project, read off the disk: one file
// per special view the editor should draw. Node-side; the parser itself is browser-safe
// (yaml/surfaceFile.ts), so an app can read one out of the file service without this.
// Full rationale: docs/surfaces.md.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Diagnostic } from "./loader";
import { entityFiles } from "./yaml/moduleIO";
import {
  type ProjectSurface,
  type ProjectSurfaces,
  parseSurface,
  SURFACES_DIR,
} from "./yaml/surfaceFile";

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

/** Just the diagnostics, for the array `workspace.ts` assembles beside the other checkers. */
export function surfaceIssues(dir: string): Diagnostic[] {
  return projectSurfaces(dir).diagnostics;
}
