// surfaceFile.ts — read a `surfaces/<name>.yaml`. Browser-safe (no fs), for the same reason
// mixViewFile.ts is: the app that DRAWS a surface is the one that has to resolve its mapping.
// Full rationale: docs/surfaces.md.

import type { Diagnostic } from "@studio/web-protocol";
import { LineCounter, parseDocument } from "yaml";
import type { ModuleIssue } from "./moduleFile";
import {
  SURFACE_LAYOUTS,
  SURFACE_TYPES,
  type Surface,
  SurfaceSchema,
} from "./surfaceSchema";

// YAML 1.2, as every other file here pins it: a scalar shaped like `5:1:1` stays a string. A
// param name is arbitrary text and must not be reinterpreted on the way in.
const OPTS = { version: "1.2" as const };

/** The folder a project keeps its surfaces in. OPTIONAL — most projects have none. */
export const SURFACES_DIR = "surfaces";

/**
 * One surface as a reader gets it: its id is its FILENAME, as every flat entity folder here.
 *
 * Declared in this browser-safe file rather than beside the disk walk that produces it, because
 * it is a WIRE shape — the editor receives it over `/surfaces` and never opens the folder. The
 * Node side imports it back, so the two cannot describe the same payload differently.
 */
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

/**
 * Parse one surface file.
 *
 * An empty file is an ERROR here, which is where this parts company with `views/mix.yaml`. An
 * empty desk map is a desk with nothing bound yet — a real state every project starts in. An
 * empty surface file is a surface that does not say what it is, and the editor would have
 * nothing to draw: `type` and `layout` are the whole of what makes it one.
 */
export function parseSurface(text: string): ParsedSurface {
  const lines = new LineCounter();
  const doc = parseDocument(text, { ...OPTS, lineCounter: lines });
  const issues: ModuleIssue[] = [];
  for (const e of doc.errors) {
    const pos = lines.linePos(e.pos[0]);
    issues.push({ path: "", message: e.message, line: pos.line, col: pos.col });
  }
  if (issues.length) return { value: null, issues };

  const raw = doc.toJS();
  if (raw === null || raw === undefined)
    return {
      value: null,
      issues: [
        {
          path: "",
          // Both lists spelled from the enums rather than by hand: this one said "timeline,
          // turntables" for as long as it took two more kinds to arrive, which is a message
          // telling somebody the word they just wrote does not exist.
          message: `a surface file says what it is: \`type:\` (${SURFACE_TYPES.join(", ")}) and \`layout:\` (${SURFACE_LAYOUTS.join(", ")}). This one is empty.`,
        },
      ],
    };
  if (typeof raw !== "object" || Array.isArray(raw))
    return {
      value: null,
      issues: [
        {
          path: "",
          message:
            "a surface is a mapping with `type`, `layout` and an optional `mapping`, not a list.",
        },
      ],
    };

  const result = SurfaceSchema.safeParse(raw);
  if (!result.success) {
    for (const issue of result.error.issues) {
      // `.strict()` reports an unknown key on the OBJECT, so the offending name is in `keys`
      // rather than in the path — the same unwrapping `parseMixView` does, and what makes the
      // message land on the line somebody typed instead of on the file.
      const keys = (issue as { keys?: string[] }).keys;
      const path = [...issue.path, ...(keys?.length ? [keys[0]] : [])];
      issues.push({ path: path.map(String).join("."), message: issue.message });
    }
    return { value: null, issues };
  }
  return { value: result.data, issues: [] };
}
