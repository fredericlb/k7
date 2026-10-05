// LibraryDiffDialog.tsx — the libraries-changed bar's "show diff": an admin's edit clone of each
// changed library, drawn by the SAME read-only tree and diff viewer as the home page draws a
// workspace with (`ChangedTree`), one library at a time. Nothing here writes.
// See ../../docs/sharedModules.md.

import { Button } from "@frediverse/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@frediverse/ui/dialog";
import type { FileNode } from "@studio/web-protocol";
import { useEffect, useMemo, useState } from "react";
import { api } from "../api";
import { m } from "../paraglide/messages.js";
import { ChangedTree } from "../projects/RepoTree";
import type { TreeSource } from "../projects/workspaceFiles";

/** One edited library, read through the file service's library-edits routes. */
const librarySource = (library: string): TreeSource => ({
  key: `library:${library}`,
  changes: async () => (await api.libraryEditFiles(library)).changes,
  diff: (path) => api.libraryEditDiff(library, path),
  read: (path) => api.libraryEditRead(library, path),
});

export function LibraryDiffDialog({
  libraries,
  open,
  onOpenChange,
}: {
  /** The libraries holding changes, by name. */
  libraries: string[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [picked, setPicked] = useState<string | null>(null);
  const library =
    picked && libraries.includes(picked) ? picked : (libraries[0] ?? null);
  const source = useMemo(
    () => (library ? librarySource(library) : null),
    [library],
  );
  const [nodes, setNodes] = useState<FileNode[] | null>(null);

  useEffect(() => {
    setNodes(null);
    if (!open || !library) return;
    let stop = false;
    void api
      .libraryEditFiles(library)
      .then((r) => !stop && setNodes(r.nodes))
      .catch(() => !stop && setNodes([]));
    return () => {
      stop = true;
    };
  }, [open, library]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[85vh] max-w-6xl flex-col gap-0 p-0 sm:max-w-6xl">
        <DialogHeader className="border-b px-4 py-3">
          <DialogTitle>{m["libedits.diffTitle"]()}</DialogTitle>
          {libraries.length > 1 && (
            <div className="flex flex-wrap gap-1 pt-2">
              {libraries.map((l) => (
                <Button
                  key={l}
                  size="sm"
                  variant={l === library ? "secondary" : "ghost"}
                  onClick={() => setPicked(l)}
                >
                  @{l}
                </Button>
              ))}
            </div>
          )}
        </DialogHeader>
        <div className="flex min-h-0 flex-1 flex-col">
          <ChangedTree source={source} nodes={nodes} />
        </div>
      </DialogContent>
    </Dialog>
  );
}
