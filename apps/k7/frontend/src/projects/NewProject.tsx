// NewProject.tsx — "New project": the archetype, the name, and the derived folder shown BEFORE
// creating — as AddSong shows the tree before uploading, because here too the name decides
// everything. Two triggers share it: the page's primary button, which also asks WHICH workspace
// when there are several, and a workspace's own row, which already knows. See ../../docs/projects.md.

import { Button } from "@frediverse/ui/button";
import { Folder, FolderPlus, Plus } from "@frediverse/ui/icons";
import type { ProjectShape } from "@studio/song-schema/yaml/projectSchema";
import { useState } from "react";
import { m } from "../paraglide/messages.js";
import { NameFormDialog, useNameSubmit } from "./NameForm";
import { projectFolderName } from "./projectName";
import { ShapePicker } from "./ShapePicker";

export function NewProject({
  /** Why it is impossible, or "" — a file service not answering is one. */
  blocked,
  workspaces,
  primary = false,
  onCreate,
}: {
  blocked: string;
  /** Where it may land: one name on a workspace's row, every eligible one on the page's button. */
  workspaces: string[];
  /** The page's call to action rather than a row's quiet one. */
  primary?: boolean;
  /** Returns when done; `onStep` narrates the wait, cloning taking tens of seconds and a silent screen looking frozen. */
  onCreate: (
    workspace: string,
    folder: string,
    onStep: (s: string) => void,
    shape: ProjectShape,
  ) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [shape, setShape] = useState<ProjectShape>("arrangement");
  const [chosen, setChosen] = useState<string | null>(null);
  const { busy, step, error, run } = useNameSubmit();

  // A workspace that left the list while the dialog was shut falls back to the first.
  const workspace =
    chosen && workspaces.includes(chosen) ? chosen : (workspaces[0] ?? null);
  // With nowhere to put it, the page's button says so instead of opening on nothing.
  const why =
    blocked || (workspaces.length ? "" : m["project.needWorkspace"]());

  // One suffix is left, and this is it: every shape lives in a `.k7` folder.
  const { folder, error: badName } = projectFolderName(name, "k7");

  const submit = () => {
    if (!folder || !workspace) return;
    run(
      (onStep) => onCreate(workspace, folder, onStep, shape),
      () => {
        setOpen(false);
        setName("");
      },
    );
  };

  return (
    <>
      {primary ? (
        <Button
          size="sm"
          disabled={Boolean(why)}
          title={why || m["project.newHintAny"]()}
          onClick={() => setOpen(true)}
        >
          <Plus className="h-4 w-4" /> {m["project.new"]()}
        </Button>
      ) : (
        <Button
          variant="ghost"
          size="xs"
          disabled={Boolean(why)}
          title={why || m["project.newHint"]()}
          aria-label={m["project.newHint"]()}
          onClick={() => setOpen(true)}
        >
          <FolderPlus className="h-3.5 w-3.5" />
          {/* On a phone the row's glyph is enough: the name needs the width more. */}
          <span className="hidden sm:inline">{m["project.new"]()}</span>
        </Button>
      )}

      <NameFormDialog
        open={open}
        onClose={() => setOpen(false)}
        title={m["project.newTitle"]()}
        description={m["project.newBody"]()}
        before={
          <>
            {workspaces.length > 1 && (
              <WorkspacePicker
                workspaces={workspaces}
                workspace={workspace}
                onWorkspace={setChosen}
                busy={busy}
              />
            )}
            {/* The archetype decides the TEMPLATE written in the folder; the suffix is not a choice, there being only one. */}
            <ShapePicker shape={shape} onShape={setShape} busy={busy} />
          </>
        }
        placeholder={m["project.namePlaceholder"]()}
        name={name}
        onName={setName}
        onSubmit={submit}
        busy={busy}
        step={step}
        error={error}
        badName={badName}
        preview={folder && workspace ? `${workspace}/${folder}` : folder}
        submit={m["common.create"]()}
        canSubmit={Boolean(folder && workspace)}
      />
    </>
  );
}

/** Which workspace the project lands in, drawn like the archetypes: a handful of names, all visible. */
function WorkspacePicker({
  workspaces,
  workspace,
  onWorkspace,
  busy,
}: {
  workspaces: string[];
  workspace: string | null;
  onWorkspace: (name: string) => void;
  busy: boolean;
}) {
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="pb-2 text-muted-foreground text-xs">
        {m["project.inWorkspace"]()}
      </legend>
      <div className="flex flex-wrap items-center gap-2">
        {workspaces.map((w) => (
          <Button
            key={w}
            type="button"
            size="sm"
            variant={w === workspace ? "default" : "secondary"}
            aria-pressed={w === workspace}
            disabled={busy}
            onClick={() => onWorkspace(w)}
          >
            <Folder className="h-3.5 w-3.5" />
            {w}
          </Button>
        ))}
      </div>
    </fieldset>
  );
}
