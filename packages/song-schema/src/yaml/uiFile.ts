// uiFile.ts — reading one module's `ui.yaml` panel. Same shape as moduleFile.ts's parseModule (Zod, in-process,
// with the line and column of the offending key), against UiFileSchema instead of ModuleSchema.

import { LineCounter, parseDocument } from "yaml";
import type { ModuleIssue } from "./moduleFile";
import { type UiFile, UiFileSchema } from "./moduleSchema";

const PARSE_OPTIONS = { version: "1.2" as const, strict: false };

export interface ParsedUiFile {
  /** The validated panel. Null when `issues` is non-empty. */
  value: UiFile | null;
  issues: ModuleIssue[];
}

/** Parse + validate one UI file. */
export function parseUiFile(text: string): ParsedUiFile {
  const lines = new LineCounter();
  const doc = parseDocument(text, { ...PARSE_OPTIONS, lineCounter: lines });
  const issues: ModuleIssue[] = [];
  for (const e of doc.errors) {
    const pos = lines.linePos(e.pos[0]);
    issues.push({ path: "", message: e.message, line: pos.line, col: pos.col });
  }
  if (issues.length) return { value: null, issues };

  const result = UiFileSchema.safeParse(doc.toJS({ maxAliasCount: 100 }) ?? {});
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
