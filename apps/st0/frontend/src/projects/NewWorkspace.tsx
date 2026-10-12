// NewWorkspace.tsx — a workspace of one's own, made on the server. It holds nothing yet,
// deliberately: which archetype the first project takes is a question the editor asks on the
// empty workspace, where the answer is about to be looked at. See ../../docs/projects.md.

import { Button } from "@frediverse/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@frediverse/ui/dialog";
import { HardDrive, Loader2 } from "@frediverse/ui/icons";
import { Input } from "@frediverse/ui/input";
import { useState } from "react";
import { m } from "../paraglide/messages.js";
import { workspaceFolderName } from "./projectName";

export function NewWorkspace({
  /** Why it is impossible, or "" — a file service not answering is one. */
  blocked,
  onCreate,
}: {
  blocked: string;
  onCreate: (workspace: string, onStep: (s: string) => void) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState("");
  const [error, setError] = useState("");

  const { folder, error: badName } = workspaceFolderName(name);

  const submit = () => {
    if (!folder || busy) return;
    setBusy(true);
    setError("");
    setStep("");
    void onCreate(folder, setStep)
      .then(() => {
        setOpen(false);
        setName("");
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => {
        setBusy(false);
        setStep("");
      });
  };

  return (
    <>
      <Button
        size="sm"
        disabled={Boolean(blocked)}
        title={blocked || m["ws.newHint"]()}
        onClick={() => setOpen(true)}
      >
        <HardDrive className="mr-1 h-4 w-4" /> {m["ws.new"]()}
      </Button>

      <Dialog open={open} onOpenChange={(o) => !busy && setOpen(o)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{m["ws.newTitle"]()}</DialogTitle>
            <DialogDescription>{m["ws.newBody"]()}</DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-3">
            <Input
              autoFocus
              placeholder={m["ws.namePlaceholder"]()}
              value={name}
              disabled={busy}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && submit()}
            />

            {/* The folder, before confirming: a refused name says so here rather than after a round trip. */}
            <p className="font-mono text-xs text-muted-foreground">
              {badName ? (
                <span className="text-destructive">{badName}</span>
              ) : (
                folder || " "
              )}
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
          </div>

          <DialogFooter>
            <Button
              variant="secondary"
              disabled={busy}
              onClick={() => setOpen(false)}
            >
              {m["common.cancel"]()}
            </Button>
            <Button disabled={busy || !folder} onClick={submit}>
              {busy && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
              {m["common.create"]()}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
