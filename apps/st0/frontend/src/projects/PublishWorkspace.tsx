// PublishWorkspace.tsx — the first push of a workspace that has none: the repository URL is
// asked for HERE and becomes `origin`. Offered only on a workspace with no repository — a
// second one is a different act. See ../../docs/projects.md.

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
import { isSshGitUri } from "@studio/git-repos/uri";
import { Loader2, Upload } from "lucide-react";
import { useState } from "react";

export function PublishWorkspace({
  workspace,
  blocked,
  onPublish,
}: {
  workspace: string;
  blocked: string;
  onPublish: (uri: string, onStep: (s: string) => void) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [uri, setUri] = useState("");
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState("");
  const [error, setError] = useState("");

  const value = uri.trim();
  const bad =
    value && !isSshGitUri(value)
      ? "URI SSH uniquement — git@hôte:utilisateur/depot.git"
      : "";

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
    <>
      <Button
        variant="ghost"
        size="sm"
        disabled={Boolean(blocked)}
        title={blocked || "Publier cet espace de travail dans un dépôt git"}
        onClick={() => setOpen(true)}
      >
        <Upload className="h-4 w-4" />
      </Button>

      <Dialog open={open} onOpenChange={(o) => !busy && setOpen(o)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Publier « {workspace} »</DialogTitle>
            <DialogDescription>
              Le dépôt doit exister et être VIDE. Il devient le dépôt distant de
              cet espace de travail, une fois pour toutes, et tout ce qui est
              committé y est envoyé.
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-3">
            <Input
              autoFocus
              placeholder="git@hôte:utilisateur/depot.git"
              value={uri}
              disabled={busy}
              onChange={(e) => setUri(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && submit()}
            />
            {bad && <p className="text-destructive text-xs">{bad}</p>}
            {busy && (
              <p className="text-xs text-muted-foreground">
                <Loader2 className="mr-1 inline h-3 w-3 animate-spin" />
                {step || "publication…"}
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
              Annuler
            </Button>
            <Button disabled={busy || !value || Boolean(bad)} onClick={submit}>
              {busy && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
              Publier
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
