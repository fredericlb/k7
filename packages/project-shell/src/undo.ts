// undo.ts — the client half of the project-wide undo/redo journal, shared by every app that
// mounts this shell. runUndo/runRedo call the file-service, gate a process step behind a
// confirm dialog, then toast which file was reverted and navigate the editor to it. Each app
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
}

async function run(
  call: (confirm?: boolean) => Promise<UndoResult>,
  verb: string,
  deps: HistoryDeps,
): Promise<void> {
  try {
    let r = await call();
    if (r.needsConfirm) {
      const ok = await deps.confirmProcess(r.files ?? [], r.label ?? "");
      if (!ok) return;
      r = await call(true);
    }
    if (!r.applied) return; // nothing on the stack, or the confirm was declined server-side
    const files = r.files ?? [];
    const first = files[0];
    if (first && deps.currentFile?.() !== first) deps.openFile(first);
    deps.onApplied?.();
    const extra = files.length > 1 ? ` (+${files.length - 1})` : "";
    deps.notify(`${verb} : ${first ?? r.label ?? ""}${extra}`);
  } catch (e) {
    deps.notify((e as Error).message, "error");
  }
}

export const runUndo = (deps: HistoryDeps): Promise<void> =>
  run(projectApi.undo, "Annulé", deps);
export const runRedo = (deps: HistoryDeps): Promise<void> =>
  run(projectApi.redo, "Rétabli", deps);
