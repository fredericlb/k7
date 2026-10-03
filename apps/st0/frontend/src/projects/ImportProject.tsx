// ImportProject.tsx — a foreign project dropped on a workspace row: the name it lands under, then
// the import LOG, because a translation is lossy and what was lost has to be read before the
// project opens. The name is asked BEFORE the upload: the bytes are big and the folder is what a
// person will look for afterwards.
// See packages/translator/docs/import.md and ../../docs/projects.md.

import { Button } from "@frediverse/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@frediverse/ui/dialog";
import { Loader2 } from "@frediverse/ui/icons";
import { Input } from "@frediverse/ui/input";
import { useState } from "react";
import { m } from "../paraglide/messages.js";
import { droppedStem, projectFolderName } from "./projectName";

/** What a drop hands over: the file itself, and the workspace it landed on. */
export interface DroppedProject {
  file: File;
  workspace: string;
}

export function ImportProject({
  dropped,
  onImport,
  onOpen,
  onClose,
}: {
  /** The drop being asked about, or null when the popin is closed. */
  dropped: DroppedProject | null;
  /** Run it. Resolves with the import log — the lines the mapper wrote. */
  onImport: (folder: string) => Promise<string[]>;
  /** Open what was just written; only offered once there is one. */
  onOpen: () => void;
  onClose: () => void;
}) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [log, setLog] = useState<string[] | null>(null);

  // A new drop starts blank however the last one closed; reset on arrival so the closing fade keeps its content.
  const [shown, setShown] = useState(dropped);
  if (dropped !== shown) {
    setShown(dropped);
    if (dropped) {
      setName("");
      setError("");
      setLog(null);
    }
  }

  // Typed or not, the folder follows `project new`'s rules — one suffix, and the same refusals.
  const { folder, error: badName } = projectFolderName(
    name || droppedStem(dropped?.file.name ?? ""),
    "st0",
  );

  const submit = () => {
    if (!folder || busy) return;
    setBusy(true);
    setError("");
    void onImport(folder)
      .then(setLog)
      .catch((e: Error) => setError(e.message))
      .finally(() => setBusy(false));
  };

  const done = log !== null;
  return (
    <Dialog
      open={!!dropped}
      // Not dismissable mid-import: the request is running and its result is a folder on disk.
      onOpenChange={(o) => {
        if (!o && !busy) onClose();
      }}
    >
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{m["importDrop.title"]()}</DialogTitle>
          <DialogDescription>
            {m["importDrop.body"]({
              file: dropped?.file.name ?? "",
              workspace: dropped?.workspace ?? "",
            })}
          </DialogDescription>
        </DialogHeader>

        {done ? (
          // The log, and nothing else: what came across and what did not is the whole answer here.
          <div className="max-h-60 overflow-y-auto rounded bg-muted px-2 py-1.5 font-mono text-xs">
            {log.map((line, i) => (
              <div
                key={i}
                className={
                  line.startsWith("warning:")
                    ? "text-amber-500"
                    : "text-muted-foreground"
                }
              >
                {line}
              </div>
            ))}
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            <Input
              autoFocus
              placeholder={droppedStem(dropped?.file.name ?? "")}
              value={name}
              disabled={busy}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && submit()}
            />
            {/* The folder that will be created, before confirming — a refused name says so here. */}
            <p className="font-mono text-xs text-muted-foreground">
              {badName ? (
                <span className="text-destructive">{badName}</span>
              ) : (
                folder
              )}
            </p>
            {busy && (
              <p className="text-xs text-muted-foreground">
                <Loader2 className="mr-1 inline h-3 w-3 animate-spin" />
                {m["importDrop.working"]()}
              </p>
            )}
          </div>
        )}

        {error && (
          <p className="rounded border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
            {error}
          </p>
        )}

        <DialogFooter>
          <Button variant="secondary" disabled={busy} onClick={onClose}>
            {done ? m["common.close"]() : m["common.cancel"]()}
          </Button>
          {done ? (
            <Button onClick={onOpen}>{m["importDrop.open"]()}</Button>
          ) : (
            <Button disabled={busy || !folder} onClick={submit}>
              {busy && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
              {m["importDrop.run"]()}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
