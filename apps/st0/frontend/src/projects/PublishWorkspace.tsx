// PublishWorkspace.tsx — the first push of a workspace that has none: the repository URL is
// asked for HERE, becomes `origin`, and is registered with pl8 so `/<dépôt>/<projet>` starts
// resolving. Offered only on a workspace with no repository — a second one is a different act.
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
  /** Resolves with whether pl8 took the register too; the push had already landed either way. */
  onPublish: (
    uri: string,
    onStep: (s: string) => void,
  ) => Promise<{ registered: boolean }>;
}) {
  const [open, setOpen] = useState(false);
  const [uri, setUri] = useState("");
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState("");
  const [warn, setWarn] = useState("");
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
    setWarn("");
    void onPublish(value, setStep)
      .then(({ registered }) => {
        if (registered) {
          setOpen(false);
          setUri("");
          return;
        }
        // The push LANDED. Closing on a success message would hide the half that did not.
        setWarn(
          "Poussé, mais le dépôt n'a pas pu être inscrit — l'adresse courte ne résoudra pas tant que ce n'est pas fait.",
        );
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
            {warn && (
              <p className="rounded border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-amber-400 text-xs">
                {warn}
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
              {warn ? "Fermer" : "Annuler"}
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
