// uiFile.ts — reading one module's `ui.k7x` panel. Same shape as moduleFile.ts's parseModule (Zod, in-process,
// with the line and column of the offending key), against UiFileSchema instead of ModuleSchema.

import { parseK7xWith } from "./k7xIssues";
import type { ModuleIssue } from "./moduleFile";
import { type UiFile, UiFileSchema } from "./moduleSchema";

export interface ParsedUiFile {
  /** The validated panel. Null when `issues` is non-empty. */
  value: UiFile | null;
  issues: ModuleIssue[];
}

/** Parse + validate one UI file's k7x text. */
export function parseUiFile(text: string): ParsedUiFile {
  return parseK7xWith(UiFileSchema, text);
}

/** parseUiFile's answer for data already read; undefined on an issue, which parseUiFile's text path locates. */
export function parseUiData(raw: unknown): ParsedUiFile | undefined {
  const result = UiFileSchema.safeParse(raw ?? {});
  return result.success ? { value: result.data, issues: [] } : undefined;
}
