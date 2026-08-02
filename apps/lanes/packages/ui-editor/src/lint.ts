// lint.ts — draw the brain's located findings (file, line, col, message) for the OPEN file
// as underlines plus a gutter marker. Nothing here knows what a project file is: a finding
// is a position and a message, underlined from its column to the end of the line. Read
// through a getter, so refreshLint() re-lints without reconfiguring the editor.

import {
  type Diagnostic,
  forceLinting,
  linter,
  lintGutter,
} from "@codemirror/lint";
import type { Extension } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";

// A located finding for the open file, 1-based. `severity` defaults to "error" (red); "warning" draws amber.
export interface LintItem {
  line: number;
  col: number;
  message: string;
  severity?: "error" | "warning";
}

// `getItems` is read fresh each pass, so the caller keeps a ref current and calls refreshLint when a vet lands.
export function lint(getItems: () => LintItem[]): Extension {
  return [
    lintGutter(),
    linter(
      (view) => {
        const doc = view.state.doc;
        const out: Diagnostic[] = [];
        for (const it of getItems()) {
          if (it.line < 1 || it.line > doc.lines) continue;
          const line = doc.line(it.line);
          const from = Math.min(line.to, line.from + Math.max(0, it.col - 1));
          // Span the rest of the line; guarantee at least one char so an error at the very end still shows a mark.
          const to = Math.min(doc.length, Math.max(from + 1, line.to));
          out.push({
            from,
            to,
            severity: it.severity ?? "error",
            message: it.message,
          });
        }
        return out;
      },
      { delay: 150 },
    ),
  ];
}

// Re-run the linter now: a fresh vet arrived but the document didn't change, so it wouldn't otherwise fire.
export function refreshLint(view: EditorView): void {
  forceLinting(view);
}
