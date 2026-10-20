// a11y.ts — what an editor tells assistive technology: its accessible name, and the vim mode it is in.
// The one thing a reader would get wrong: the mode is read from vim's own "vim-mode-change" event, so
// this must sit AFTER vim() in the extension list — before it, there is no vim yet to listen to.
// See packages/ui-editor/docs/a11y.md.

import type { Extension } from "@codemirror/state";
import { EditorView, type Panel, showPanel } from "@codemirror/view";
import { getCM } from "@replit/codemirror-vim";

/** The textbox's accessible name — the file it shows, e.g. `project.k7x — editor`. */
export const editorLabel = (label: string): Extension =>
  EditorView.contentAttributes.of({ "aria-label": label });

/** What vim's mode-change event carries. */
interface ModeChange {
  mode: string;
  subMode?: string;
}

/** The mode as vim's own status line spells it: NORMAL, INSERT, VISUAL, VISUAL LINE, VISUAL BLOCK, REPLACE. */
export function vimModeText(e: ModeChange): string {
  const sub =
    e.subMode === "linewise"
      ? " line"
      : e.subMode === "blockwise"
        ? " block"
        : "";
  return `${e.mode}${sub}`.toUpperCase();
}

/** A one-line panel under the text, `role="status"` named `vim`, holding the current mode. */
export const vimModeStatus = (): Extension => [
  EditorView.baseTheme({
    ".cm-vim-mode": {
      padding: "0 6px",
      fontFamily: "monospace",
      fontSize: "11px",
    },
  }),
  showPanel.of((view): Panel => {
    const dom = document.createElement("div");
    dom.className = "cm-vim-mode";
    dom.setAttribute("role", "status");
    dom.setAttribute("aria-label", "vim");
    const show = (e: ModeChange) => {
      dom.textContent = vimModeText(e);
      dom.dataset.vimMode = e.mode;
    };
    show({ mode: "normal" });
    const listen = (): boolean => {
      const cm = getCM(view);
      cm?.on("vim-mode-change", show);
      return !!cm;
    };
    // Vim's plugin may be built after the panel: one retry once the view is up.
    return { dom, mount: () => void (listen() || queueMicrotask(listen)) };
  }),
];
