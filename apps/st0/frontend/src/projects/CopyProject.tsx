// CopyProject.tsx — the dialog that picks where a copy lands, opened from the row's ⋮ menu. The
// DESTINATION is what decides whether anything is pushed, so each row says which of the two it is
// before the click rather than after. See ../../docs/projects.md.

import { Badge } from "@frediverse/ui/badge";
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
import type { MachineWorkspace } from "@studio/web-protocol";
import type { ProjectApp } from "@studio/web-protocol/projects";
import { Copy, FolderGit2, HardDrive, Loader2 } from "lucide-react";
import { useState } from "react";
import { m } from "../paraglide/messages.js";
import { projectFolderName } from "./projectName";

export function CopyProject({
  open,
  onClose,
  path,
  label,
  /** The source's app: the copy keeps the suffix, or another application would claim it. */
  app,
  targets,
  onCopy,
}: {
  /** Driven from the row's menu, which is what registers the gesture — see ProjectMenu.tsx. */
  open: boolean;
  onClose: () => void;
  path: string;
  label: string;
  app: ProjectApp;
  /** Where it may land — every OTHER workspace on this machine that holds several projects. */
  targets: MachineWorkspace[];
  onCopy: (
    to: MachineWorkspace,
    folder: string,
    onStep: (s: string) => void,
  ) => Promise<void>;
}) {
  const [to, setTo] = useState<MachineWorkspace | null>(null);
  const [name, setName] = useState(label);
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState("");
  const [error, setError] = useState("");

  const { folder, error: badName } = projectFolderName(name, app);

  const submit = () => {
    if (!folder || !to || busy) return;
    setBusy(true);
    setError("");
    setStep("");
    void onCopy(to, folder, setStep)
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
          <DialogTitle>{m["project.copyTitle"]({ label })}</DialogTitle>
          <DialogDescription>{m["project.copyBody"]()}</DialogDescription>
        </DialogHeader>

        <p className="rounded bg-muted px-3 py-2 font-mono text-xs">{path}</p>

        <div className="flex max-h-48 flex-col gap-1 overflow-auto">
          {targets.map((w) => (
            <button
              key={w.name}
              type="button"
              disabled={busy}
              className={`flex items-center gap-2 rounded px-2 py-1 text-left text-sm ${
                to?.name === w.name ? "bg-accent" : "hover:bg-accent/50"
              }`}
              onClick={() => setTo(w)}
            >
              {w.origin ? (
                <FolderGit2 className="h-4 w-4 shrink-0 text-muted-foreground" />
              ) : (
                <HardDrive className="h-4 w-4 shrink-0 text-muted-foreground" />
              )}
              <span className="truncate">{w.name}</span>
              {/* The one thing that changes what the copy DOES, said per row. */}
              <Badge variant={w.origin ? "tag" : "default"}>
                {w.origin
                  ? m["project.copyCommitPush"]()
                  : m["project.copyCommitOnly"]()}
              </Badge>
            </button>
          ))}
        </div>

        <Input
          placeholder={m["project.copyNamePlaceholder"]()}
          value={name}
          disabled={busy}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submit()}
        />

        {/* What will actually be created, before confirming — as in NewProject, the name decides everything. */}
        <p className="font-mono text-xs text-muted-foreground">
          {badName ? (
            <span className="text-destructive">{badName}</span>
          ) : folder && to ? (
            `${to.name} / ${folder}`
          ) : (
            " "
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

        <DialogFooter>
          <Button variant="secondary" disabled={busy} onClick={onClose}>
            {m["common.cancel"]()}
          </Button>
          <Button disabled={busy || !folder || !to} onClick={submit}>
            {busy && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
            <Copy className="mr-1 h-3.5 w-3.5" /> {m["project.copy"]()}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
