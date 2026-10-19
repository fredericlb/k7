// surfaceFile.ts — read a `surfaces/<name>.k7x`. Browser-safe (no fs), for the same reason
// mixViewFile.ts is: the app that DRAWS a surface is the one that has to resolve its mapping.
// Full rationale: docs/surfaces.md.

import type { Diagnostic } from "@studio/web-protocol";
import { parseK7xWith, readK7x } from "./k7xIssues";
import type { ModuleIssue } from "./moduleFile";
import {
  SURFACE_LAYOUTS,
  SURFACE_TYPES,
  type Surface,
  SurfaceSchema,
} from "./surfaceSchema";

/** The folder a project keeps its surfaces in. OPTIONAL — most projects have none. */
export const SURFACES_DIR = "surfaces";

/** One surface as a reader gets it, its id being its FILENAME — a WIRE shape, see docs/surfaceFiles.md. */
export interface ProjectSurface {
  id: string;
  /** Project-relative, for a diagnostic the editor can match against its tree. */
  file: string;
  surface: Surface;
}

/** Every surface a project declares, plus whatever would not read. */
export interface ProjectSurfaces {
  surfaces: ProjectSurface[];
  diagnostics: Diagnostic[];
}

export interface ParsedSurface {
  value: Surface | null;
  issues: ModuleIssue[];
}

/** Parse one surface file's k7x text; an EMPTY one is an error, unlike `views/mix.k7x` (docs/surfaceFiles.md). */
export function parseSurface(text: string): ParsedSurface {
  const read = readK7x(text);
  if (!read.doc) return { value: null, issues: read.issues };
  if (Object.keys(read.data).length === 0)
    return {
      value: null,
      issues: [
        {
          path: "",
          // Both lists spelled from the enums rather than by hand, so the message cannot go stale (docs/surfaceFiles.md).
          message: `a surface file says what it is: \`type\` (${SURFACE_TYPES.join(", ")}) and \`layout\` (${SURFACE_LAYOUTS.join(", ")}). This one is empty.`,
        },
      ],
    };
  return parseK7xWith(SurfaceSchema, text);
}
