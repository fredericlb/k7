// ImportWorkspace.tsx — bringing a repository back: it is cloned onto
// the machine, which is what makes it APPEAR — this list only shows what the machine holds.
// The URI is validated HERE with the servers' own rule, so a paste that git could never be
// handed is refused before a round trip. See ../../docs/projects.md.

import { Button } from "@frediverse/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@frediverse/ui/dialog";
import { Download, Loader2 } from "@frediverse/ui/icons";
import { Input } from "@frediverse/ui/input";
import { isSshGitUri } from "@studio/git-repos/uri";
import { useState } from "react";
import { m } from "../paraglide/messages.js";

export function ImportWorkspace({
  blocked,
  /** Git's own progress while it clones — a silent thirty-second wait reads as a frozen screen. */
  step,
  onImport,
}: {
  blocked: string;
  step: string | null;
  onImport: (uri: string) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [uri, setUri] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const value = uri.trim();
  // Empty is not "wrong" — it is a field nobody has typed in yet, and it says nothing.
  const bad = value && !isSshGitUri(value) ? m["ws.sshOnly"]() : "";

  const submit = () => {
    if (!value || bad || busy) return;
    setBusy(true);
    setError("");
    void onImport(value)
      .then(() => {
        setOpen(false);
        setUri("");
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setBusy(false));
  };

  return (
    <>
      <Button
        variant="secondary"
        size="sm"
        disabled={Boolean(blocked)}
        title={blocked || m["ws.importHint"]()}
        onClick={() => setOpen(true)}
      >
        <Download className="mr-1 h-4 w-4" /> {m["ws.import"]()}
      </Button>

      <Dialog open={open} onOpenChange={(o) => !busy && setOpen(o)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{m["ws.importTitle"]()}</DialogTitle>
            <DialogDescription>{m["ws.importBody"]()}</DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-3">
            <Input
              autoFocus
              placeholder={m["ws.uriPlaceholder"]()}
              value={uri}
              disabled={busy}
              onChange={(e) => setUri(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && submit()}
            />
            {bad && <p className="text-destructive text-xs">{bad}</p>}
            {busy && (
              <p className="text-xs text-muted-foreground">
                <Loader2 className="mr-1 inline h-3 w-3 animate-spin" />
                {step || m["ws.cloning"]()}
              </p>
            )}
            {error && (
              <code className="max-w-full overflow-x-auto rounded bg-muted px-2 py-1 text-red-400 text-xs">
                {error}
              </code>
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
            <Button disabled={busy || !value || Boolean(bad)} onClick={submit}>
              {busy && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
              {m["ws.import"]()}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
