// PublishWorkspace.tsx — the first push of a workspace that has none: the repository URL is
// asked for HERE and becomes `origin`. Offered only on a workspace with no repository — a
// second one is a different act. Opened from the row's ⋮ (WorkspaceMenu). See ../../docs/projects.md.

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
import { isSshGitUri } from "@studio/git-repos/uri";
import { useState } from "react";
import { m } from "../paraglide/messages.js";

export function PublishWorkspace({
  open,
  onClose,
  workspace,
  onPublish,
}: {
  open: boolean;
  onClose: () => void;
  workspace: string;
  onPublish: (uri: string, onStep: (s: string) => void) => Promise<void>;
}) {
  const setOpen = (o: boolean) => !o && onClose();
  const [uri, setUri] = useState("");
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState("");
  const [error, setError] = useState("");

  const value = uri.trim();
  const bad = value && !isSshGitUri(value) ? m["ws.sshOnly"]() : "";

  const submit = () => {
    if (!value || bad || busy) return;
    setBusy(true);
    setError("");
    void onPublish(value, setStep)
      .then(() => {
        setOpen(false);
        setUri("");
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => {
        setBusy(false);
        setStep("");
      });
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !busy && setOpen(o)}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{m["ws.publishTitle"]({ workspace })}</DialogTitle>
          <DialogDescription>{m["ws.publishBody"]()}</DialogDescription>
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
              {step || m["ws.publishing"]()}
            </p>
          )}
          {/* git's own words: "Permission denied (publickey)" is the whole answer, and ours would be worse. */}
          {error && (
            <code className="max-w-full overflow-x-auto whitespace-pre-wrap rounded bg-muted px-2 py-1 text-red-400 text-xs">
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
            {m["ws.publish"]()}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
