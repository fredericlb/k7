// DeleteProject.tsx — the confirmation behind the row's ⋮ menu. Naming the project IN the question
// is what makes the confirmation useful: "are you sure?" does not say of what.
// See ../../docs/projects.md.

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
import { useState } from "react";
import { m } from "../paraglide/messages.js";

export function DeleteProject({
  open,
  onClose,
  /** The project's path in the repository — what is deleted, and what the question names. */
  path,
  label,
  onDelete,
}: {
  /** Driven from the row's menu, which is what registers the gesture — see ProjectMenu.tsx. */
  open: boolean;
  onClose: () => void;
  path: string;
  label: string;
  onDelete: (onStep: (s: string) => void) => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState("");
  const [error, setError] = useState("");

  const submit = () => {
    setBusy(true);
    setError("");
    void onDelete(setStep)
      .then(onClose)
      .catch((e: Error) => setError(e.message))
      .finally(() => {
        setBusy(false);
        setStep("");
      });
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !busy && !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{m["project.deleteTitle"]({ label })}</DialogTitle>
          <DialogDescription>{m["project.deleteBody"]()}</DialogDescription>
        </DialogHeader>

        <p className="rounded bg-muted px-3 py-2 font-mono text-xs">{path}</p>
        {/* What git makes recoverable, said without overselling it: history keeps the content, which is not an undo button. */}
        <p className="text-xs text-muted-foreground">
          {m["project.deleteKept"]()}
        </p>

        {step && (
          <p className="text-xs text-muted-foreground">
            <Loader2 className="mr-1 inline h-3 w-3 animate-spin" />
            {step}
          </p>
        )}
        {error && (
          <p className="rounded border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
            {error}
          </p>
        )}

        <DialogFooter>
          <Button variant="secondary" disabled={busy} onClick={onClose}>
            {m["common.cancel"]()}
          </Button>
          <Button variant="destructive" disabled={busy} onClick={submit}>
            {busy && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
            {m["project.delete"]()}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
