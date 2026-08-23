// mixViewFile.ts — read `views/mix.yaml`. Browser-safe (no fs), because the app that DRAWS the
// desk is the one that has to resolve the bindings. Full rationale: docs/viewBindings.md.

import { LineCounter, parseDocument } from "yaml";
import { type MixView, MixViewSchema } from "./mixViewSchema";
import type { ModuleIssue } from "./moduleFile";

// YAML 1.2 for the reason every other file here pins it: a scalar shaped like `5:1:1` stays a string.
const OPTS = { version: "1.2" as const };

/** The folder a project keeps its per-view files in, and the Mix desk's own. */
export const VIEWS_DIR = "views";
export const MIX_VIEW_BASE = "mix";

export interface ParsedMixView {
  value: MixView | null;
  issues: ModuleIssue[];
}

export function parseMixView(text: string): ParsedMixView {
  const lines = new LineCounter();
  const doc = parseDocument(text, { ...OPTS, lineCounter: lines });
  const issues: ModuleIssue[] = [];
  for (const e of doc.errors) {
    const pos = lines.linePos(e.pos[0]);
    issues.push({ path: "", message: e.message, line: pos.line, col: pos.col });
  }
  if (issues.length) return { value: null, issues };

  const raw = doc.toJS() ?? {};
  // An empty file is a desk with nothing bound, the state every project starts in (docs/deskFiles.md).
  if (raw === null || raw === undefined) return { value: {}, issues: [] };
  if (typeof raw !== "object" || Array.isArray(raw))
    return {
      value: null,
      issues: [
        {
          path: "",
          message:
            "views/mix.yaml is a mapping of control id -> { module, param }, not a list.",
        },
      ],
    };

  const result = MixViewSchema.safeParse(raw);
  if (!result.success) {
    for (const issue of result.error.issues) {
      const keys = (issue as { keys?: string[] }).keys;
      const path = [...issue.path, ...(keys?.length ? [keys[0]] : [])];
      issues.push({ path: path.map(String).join("."), message: issue.message });
    }
    return { value: null, issues };
  }
  return { value: result.data, issues: [] };
}
