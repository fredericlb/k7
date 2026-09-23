// FirstProject.tsx — the wizard a workspace with nothing in it opens on. A workspace is created
// empty on purpose (NewWorkspace.tsx): the archetype decides what the screen will LOOK like, so
// it is asked here, where the answer is about to be looked at, rather than in a dialog on a list.
// Not a dialog either — there is nothing behind it to dismiss it onto.
// See ../../docs/projects.md and packages/project-shell/docs/launch.md.

import { Button } from "@frediverse/ui/button";
import { FolderPlus, Loader2 } from "@frediverse/ui/icons";
import { Input } from "@frediverse/ui/input";
import { projectApi } from "@studio/project-shell/project";
import type { ProjectShape } from "@studio/song-schema/yaml/projectSchema";
import { useState } from "react";
import { m } from "../paraglide/messages.js";
import { projectFolderName } from "./projectName";
import { SHAPES } from "./shapes";

export function FirstProject({
  workspace,
  /** Re-runs the gate's whole resolve, so what opens is what the machine now holds. */
  onCreated,
}: {
  workspace: string;
  onCreated: () => void;
}) {
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
    void (async () => {
      setStep(m["project.creating"]({ folder }));
      await projectApi.createProject(shape, folder);
      setStep("premier commit…");
      // `/git/commit` and not `project commit`: it acts on the whole repo and needs no active
      // project, which there still is not. A push has nowhere to go on a workspace with no
      // repository and that is not a failure — only a commit that did not happen is worth a
      // line, and the editor opens either way.
      const r = await projectApi.gitCommit(`new project ${folder}`);
      if (r.nothingToCommit)
        console.warn(`[first project] ${folder}: nothing to commit`);
      onCreated();
    })().catch((e: Error) => {
      setError(e.message);
      setBusy(false);
      setStep("");
    });
  };

  return (
    <div className="flex h-full items-center justify-center bg-background p-8 text-foreground">
      <div className="flex w-full max-w-lg flex-col gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="flex items-center gap-2 font-semibold text-lg">
            <FolderPlus className="h-5 w-5" />{" "}
            {m["project.firstTitle"]({ workspace })}
          </h1>
          <p className="text-muted-foreground text-sm">
            {m["project.firstBody"]()}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
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
        <span className="text-muted-foreground text-xs">
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

        {/* What will actually be created, before confirming — as on the projects page. */}
        <p className="font-mono text-muted-foreground text-xs">
          {badName ? (
            <span className="text-destructive">{badName}</span>
          ) : (
            folder || " "
          )}
        </p>

        {step && (
          <p className="text-muted-foreground text-xs">
            <Loader2 className="mr-1 inline h-3 w-3 animate-spin" />
            {step}
          </p>
        )}
        {error && (
          <code className="max-w-full overflow-x-auto whitespace-pre-wrap rounded bg-muted px-2 py-1 text-red-400 text-xs">
            {error}
          </code>
        )}

        <div className="flex justify-end">
          <Button disabled={busy || !folder} onClick={submit}>
            {busy && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
            {m["common.create"]()}
          </Button>
        </div>
      </div>
    </div>
  );
}
