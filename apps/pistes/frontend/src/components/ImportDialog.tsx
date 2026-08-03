// ImportDialog.tsx — the "import this .dawproject?" flow in two phases: the yes/no, then
// (once `log` arrives) the import log — counts and any warnings the mapper raised — so a
// lossy import is seen before the project opens. The server runs the same code
// `pistes import` does; App owns the async and the resulting open.

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
import { m } from "../paraglide/messages.js";

export function ImportDialog({
  path,
  busy,
  error,
  log,
  onConfirm,
  onOpen,
  onCancel,
}: {
  path: string | null; // the .dawproject to import, or null when closed
  busy: boolean;
  error: string | null;
  log: string[] | null; // the import log once it's done — switches to the log view
  onConfirm: () => void; // run the import (phase 1)
  onOpen: () => void; // open the imported project (phase 2)
  onCancel: () => void;
}) {
  const name = path ? (path.split(/[/\\]/).pop() ?? path) : "";
  const done = log !== null;
  return (
    <Dialog
      open={!!path}
      // No outside-click or Esc dismissal mid-import: the request is running and its result is about to open.
      onOpenChange={(o) => {
        if (!o && !busy) onCancel();
      }}
    >
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{m["import.title"]()}</DialogTitle>
          <DialogDescription>{m["import.body"]({ name })}</DialogDescription>
        </DialogHeader>
        {error && (
          <code className="block max-w-full overflow-x-auto rounded bg-muted px-2 py-1 text-xs text-red-400">
            {error}
          </code>
        )}
        {done && (
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
        )}
        <DialogFooter>
          <Button variant="secondary" onClick={onCancel} disabled={busy}>
            {done ? m["import.close"]() : m["import.cancel"]()}
          </Button>
          {done ? (
            <Button onClick={onOpen}>{m["import.open"]()}</Button>
          ) : (
            <Button onClick={onConfirm} disabled={busy}>
              {busy && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
              {busy ? m["import.importing"]() : m["import.confirm"]()}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
