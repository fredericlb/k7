// projectMode.ts — whether an l8 project is an `arrangement` (a song placed in time) or `live`
// (a graph, and no timeline at all). Read from project.yaml's root `project_type`, and
// `arrangement` when it says nothing. Which APP opens the folder is projectType.ts's separate
// question — the two are deliberately not in one file. Rationale: docs/projectMode.md.

import { loadProjectRoot } from "./loader";
import {
  DEFAULT_PROJECT_MODE,
  MODE_FOR_SHAPE,
  PROJECT_MODES,
  PROJECT_SHAPES,
  type ProjectMode,
  type ProjectShape,
} from "./yaml/projectSchema";

export type { ProjectMode, ProjectShape };
export { DEFAULT_PROJECT_MODE, MODE_FOR_SHAPE, PROJECT_MODES, PROJECT_SHAPES };

/**
 * The mode the folder at `dir` declares, or `arrangement` when it declares nothing.
 *
 * Absence is the ANSWER and not a missing value: every song written before `live` existed is an
 * arrangement, and none of them says so. That is the same shape `projectTypeOf` gives the
 * dialect, for the same reason — a default that has to hold for folders nobody will revisit.
 *
 * Unreadable headers answer the default rather than throwing: a `project.yaml` that will not
 * parse is the compile's error to report, with a line number, and a view asking "which shape is
 * this" should not be the surface that raises it.
 */
export function projectModeOf(dir: string): ProjectMode {
  try {
    const declared = loadProjectRoot(dir).project_type;
    return declared ?? DEFAULT_PROJECT_MODE;
  } catch {
    return DEFAULT_PROJECT_MODE;
  }
}

// `hasTimeline(mode)` was here, and nothing but its own test ever called it. It is gone with the
// question it answered: whether a project draws an arrangement is what its `surfaces/` folder
// says now, not what its mode says. See docs/surfaces.md.
