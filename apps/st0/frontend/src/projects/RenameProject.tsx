// RenameProject.tsx — the dialog behind the row's ⋮ menu: a project's folder renamed in place,
// then committed and pushed. The SUFFIX is not part of the question — it says which app opens the
// folder, so it is kept whatever is typed. See ../../docs/projects.md.

import { Button } from "@frediverse/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@frediverse/ui/dialog";
import { Input } from "@frediverse/ui/input";
import type { ProjectApp } from "@studio/web-protocol/projects";
import { Loader2, PenLine } from "lucide-react";
import { useState } from "react";
import { m } from "../paraglide/messages.js";
import { projectFolderName } from "./projectName";

export function RenameProject({
  open,
  onClose,
  path,
  label,
  /** The project's app: the new folder keeps its suffix, or another application would claim it. */
  app,
  onRename,
}: {
  /** Driven from the row's menu, which is what registers the gesture — see ProjectMenu.tsx. */
  open: boolean;
  onClose: () => void;
  path: string;
  label: string;
  app: ProjectApp;
  onRename: (folder: string, onStep: (s: string) => void) => Promise<void>;
}) {
  const [name, setName] = useState(label);
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState("");
  const [error, setError] = useState("");

  const { folder, error: badName } = projectFolderName(name, app);
  // Renaming a thing to what it is called is not an edit: said here rather than refused by the machine.
  const same = folder === path.split("/").pop();

  const submit = () => {
    if (!folder || same || busy) return;
    setBusy(true);
    setError("");
    void onRename(folder, setStep)
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
          <DialogTitle>{m["project.renameTitle"]({ label })}</DialogTitle>
          <DialogDescription>{m["project.renameBody"]()}</DialogDescription>
        </DialogHeader>

        <p className="rounded bg-muted px-3 py-2 font-mono text-xs">{path}</p>

        <Input
          autoFocus
          value={name}
          disabled={busy}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submit()}
        />

        {/* The folder as it will be, suffix included — the same line NewProject and CopyProject draw. */}
        <p className="font-mono text-muted-foreground text-xs">
          {badName ? (
            <span className="text-destructive">{badName}</span>
          ) : same ? (
            <span className="text-muted-foreground">
              {m["project.renameSame"]()}
            </span>
          ) : (
            folder || " "
          )}
        </p>

        {/* What a rename COSTS, said before it happens: an address is a thing people keep. */}
        <p className="text-amber-500 text-xs">{m["project.renameWarning"]()}</p>

        {step && (
          <p className="text-muted-foreground text-xs">
            <Loader2 className="mr-1 inline h-3 w-3 animate-spin" />
            {step}
          </p>
        )}
        {error && (
          <p className="rounded border border-destructive/40 bg-destructive/10 px-3 py-2 text-destructive text-xs">
            {error}
          </p>
        )}

        <DialogFooter>
          <Button variant="secondary" disabled={busy} onClick={onClose}>
            {m["common.cancel"]()}
          </Button>
          <Button disabled={busy || !folder || same} onClick={submit}>
            {busy && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
            <PenLine className="mr-1 h-3.5 w-3.5" /> {m["project.rename"]()}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
