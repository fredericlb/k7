// EditSharedModuleDialog.tsx — the "you are about to edit a shared module" confirmation. The
// médiathèque's copy is the only copy: nothing forks here, so this is the one moment between
// reading a shared module and changing it for everyone. Just the yes/no — App owns the unlock.

import { Button } from "@frediverse/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@frediverse/ui/dialog";
import { Pencil } from "@frediverse/ui/icons";
import { libraryModuleRef } from "../libraryTree";

export function EditSharedModuleDialog({
  path,
  onConfirm,
  onCancel,
}: {
  /** The library file the builder is open on, or null when the dialog is closed. */
  path: string | null;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  // The REF and not the path: it is what a chain writes, so it is the name somebody will recognise from the songs this reaches.
  const ref = path ? (libraryModuleRef(path) ?? path) : "";
  return (
    <Dialog open={!!path} onOpenChange={(o) => !o && onCancel()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Edit the shared module “{ref}”?</DialogTitle>
          <DialogDescription>
            This module lives in the media library, not in this project. Saving
            writes straight into the catalogue — there is no copy to fall back
            on — so every song that names it will sound different the next time
            it is opened.
          </DialogDescription>
        </DialogHeader>
        {/* What happens the moment you say yes, spelt out: with no Save button, confirming is not deciding later. */}
        <p className="text-xs text-muted-foreground">
          There is no Save button here. From now on each file is written as soon
          as it reads as a document, exactly as the project's own files are.
        </p>
        <DialogFooter>
          <Button variant="secondary" onClick={onCancel}>
            Keep reading
          </Button>
          <Button onClick={onConfirm}>
            <Pencil className="mr-1 h-4 w-4" /> Edit the shared module
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
