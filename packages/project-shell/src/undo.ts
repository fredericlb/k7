// undo.ts — the client half of the project-wide undo/redo journal, shared by every app that
// mounts this shell. runUndo/runRedo call the file-service, gate a process step behind a
// confirm dialog, then toast which action was reverted and navigate the editor to it. Each app
// supplies how it opens a file, toasts, confirms, and refetches — the network + UX flow lives
// here once.

import type { UndoResult } from "@studio/web-protocol";
import { projectApi } from "./project.ts";

export interface HistoryDeps {
  openFile: (path: string) => void; // switch the editor to a workspace-relative path
  notify: (message: string, variant?: "success" | "error") => void;
  // Ask before a process step (which restores a bounced audio file); resolve true to proceed.
  confirmProcess: (files: string[], label: string) => Promise<boolean>;
  currentFile?: () => string | null; // the file the editor shows, to avoid a needless navigate
  onApplied?: () => void; // let the app refetch after a change (bump reloadKey / poke a poll)
  strings?: HistoryStrings; // the app's wording; English when absent
  flush?: () => Promise<unknown>; // write every pane's pending text first: a pending autosave would land over the step
}

/** What the toasts say: the ACTION undone, since a file path tells nobody what came back. */
export interface HistoryStrings {
  undone: (what: string) => string;
  redone: (what: string) => string;
  nothingToUndo: string;
  nothingToRedo: string;
}

const ENGLISH: HistoryStrings = {
  undone: (what) => `Undone: ${what}`,
  redone: (what) => `Redone: ${what}`,
  nothingToUndo: "Nothing to undo",
  nothingToRedo: "Nothing to redo",
};

async function run(
  call: (confirm?: boolean) => Promise<UndoResult>,
  redo: boolean,
  deps: HistoryDeps,
): Promise<void> {
  const s = deps.strings ?? ENGLISH;
  try {
    // A failed flush leaves its text held and the stale-base check guards it; the step still runs.
    await deps.flush?.().catch(() => false);
    let r = await call();
    if (r.needsConfirm) {
      const ok = await deps.confirmProcess(r.files ?? [], r.label ?? "");
      if (!ok) return;
      r = await call(true);
    }
    // Said rather than silent: a key that does nothing reads as a key that is broken.
    if (!r.applied && !r.needsConfirm)
      return deps.notify(redo ? s.nothingToRedo : s.nothingToUndo);
    if (!r.applied) return;
    const files = r.files ?? [];
    const first = files[0];
    if (first && deps.currentFile?.() !== first) deps.openFile(first);
    deps.onApplied?.();
    const what = r.label || first || "";
    deps.notify(redo ? s.redone(what) : s.undone(what));
  } catch (e) {
    deps.notify((e as Error).message, "error");
  }
}

export const runUndo = (deps: HistoryDeps): Promise<void> =>
  run(projectApi.undo, false, deps);
export const runRedo = (deps: HistoryDeps): Promise<void> =>
  run(projectApi.redo, true, deps);
