// NewProject.tsx — "Nouveau projet" inside a repository's block: the archetype, the name, and the
// derived folder shown BEFORE creating — as AddSong shows the tree before uploading, because here
// too the name decides everything. See ../../docs/projects.md.

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
import type { ProjectShape } from "@studio/song-schema/yaml/projectSchema";
import { FolderPlus, Loader2 } from "lucide-react";
import { useState } from "react";
import { m } from "../paraglide/messages.js";
import { projectFolderName } from "./projectName";
import { SHAPES } from "./shapes";

export function NewProject({
  /** Why it is impossible, or "" — an offline machine is the ordinary state. */
  blocked,
  onCreate,
}: {
  blocked: string;
  /** Returns when done; `onStep` narrates the wait, cloning taking tens of seconds and a silent screen looking frozen. */
  onCreate: (
    folder: string,
    onStep: (s: string) => void,
    shape: ProjectShape,
  ) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [shape, setShape] = useState<ProjectShape>("arrangement");
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState("");
  const [error, setError] = useState("");

  // One suffix is left, and this is it: every shape lives in a `.st0` folder.
  const { folder, error: badName } = projectFolderName(name, "st0");

  const submit = () => {
    if (!folder || busy) return;
    setBusy(true);
    setError("");
    setStep("");
    void onCreate(folder, setStep, shape)
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
        variant="secondary"
        size="xs"
        disabled={Boolean(blocked)}
        title={blocked || m["project.newHint"]()}
        onClick={() => setOpen(true)}
      >
        <FolderPlus className="mr-1 h-3.5 w-3.5" /> Nouveau projet
      </Button>

      <Dialog open={open} onOpenChange={(o) => !busy && setOpen(o)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{m["project.newTitle"]()}</DialogTitle>
            <DialogDescription>{m["project.newBody"]()}</DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-3">
            {/* The archetype decides the TEMPLATE written in the folder; the suffix is not a choice, there being only one. */}
            <div className="flex items-center gap-2">
              {SHAPES.map((sh) => (
                <Button
                  key={sh.id}
                  type="button"
                  size="sm"
                  variant={shape === sh.id ? "default" : "secondary"}
                  disabled={busy}
                  onClick={() => setShape(sh.id)}
                >
                  {sh.label()}
                </Button>
              ))}
            </div>
            <span className="text-xs text-muted-foreground">
              {SHAPES.find((sh) => sh.id === shape)?.what()}
            </span>

            <Input
              autoFocus
              placeholder={m["project.namePlaceholder"]()}
              value={name}
              disabled={busy}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && submit()}
            />

            {/* What will actually be created, before confirming: a refused name says so here rather than after a round trip. */}
            <p className="font-mono text-xs text-muted-foreground">
              {badName ? (
                <span className="text-destructive">{badName}</span>
              ) : folder ? (
                folder
              ) : (
                " "
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
