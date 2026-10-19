// mixViewFile.ts — read `views/mix.k7x`. Browser-safe (no fs), because the app that DRAWS the
// desk is the one that has to resolve the bindings. Full rationale: docs/viewBindings.md.

import { parseK7xWith } from "./k7xIssues";
import { type MixView, MixViewSchema } from "./mixViewSchema";
import type { ModuleIssue } from "./moduleFile";

/** The folder a project keeps its per-view files in, and the Mix desk's own. */
export const VIEWS_DIR = "views";
export const MIX_VIEW_BASE = "mix";

export interface ParsedMixView {
  value: MixView | null;
  issues: ModuleIssue[];
}

/** Parse one desk file's k7x text; an empty file is a desk with nothing bound, the state every project starts in. */
export function parseMixView(text: string): ParsedMixView {
  return parseK7xWith(MixViewSchema, text);
}
