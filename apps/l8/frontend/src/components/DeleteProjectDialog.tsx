// DeleteProjectDialog.tsx — the "delete this project?" confirmation. Deleting unloads the
// project from the engine and moves its folder to _recycle_bin: reversible, but it can no
// longer be started. Just the yes/no — App owns the async and the refresh.

import { Button } from "@frediverse/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@frediverse/ui/dialog";
import { Loader2 } from "lucide-react";

export function DeleteProjectDialog({
  path,
  busy,
  error,
  onConfirm,
  onCancel,
}: {
  path: string | null; // the project to delete (workspace-relative), or null when closed
  busy: boolean;
  error: string | null;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const name = path ? (path.split(/[/\\]/).pop() ?? path) : "";
  return (
    <Dialog
      open={!!path}
      // Don't let an outside click or Esc dismiss mid-delete — the move is already running.
      onOpenChange={(o) => {
        if (!o && !busy) onCancel();
      }}
    >
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Delete project “{name}”?</DialogTitle>
          <DialogDescription>
            It will be unloaded from the engine and moved to the workspace’s
            recycle bin. It can’t be started from there, but the files are kept
            so you can restore them manually.
          </DialogDescription>
        </DialogHeader>
        {error && (
          <code className="block max-w-full overflow-x-auto rounded bg-muted px-2 py-1 text-xs text-red-400">
            {error}
          </code>
        )}
        <DialogFooter>
          <Button variant="secondary" onClick={onCancel} disabled={busy}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={onConfirm} disabled={busy}>
            {busy && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
            {busy ? "Deleting…" : "Delete"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
