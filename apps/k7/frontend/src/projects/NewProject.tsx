// NewProject.tsx — "New project" inside a workspace's block: the archetype, the name, and the
// derived folder shown BEFORE creating — as AddSong shows the tree before uploading, because here
// too the name decides everything. See ../../docs/projects.md.

import { Button } from "@frediverse/ui/button";
import { FolderPlus } from "@frediverse/ui/icons";
import type { ProjectShape } from "@studio/song-schema/yaml/projectSchema";
import { useState } from "react";
import { m } from "../paraglide/messages.js";
import { NameFormDialog, useNameSubmit } from "./NameForm";
import { projectFolderName } from "./projectName";
import { ShapePicker } from "./ShapePicker";

export function NewProject({
  /** Why it is impossible, or "" — a file service not answering is one. */
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
  const { busy, step, error, run } = useNameSubmit();

  // One suffix is left, and this is it: every shape lives in a `.k7` folder.
  const { folder, error: badName } = projectFolderName(name, "k7");

  const submit = () => {
    if (!folder) return;
    run(
      (onStep) => onCreate(folder, onStep, shape),
      () => {
        setOpen(false);
        setName("");
      },
    );
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
        <FolderPlus className="mr-1 h-3.5 w-3.5" /> {m["project.new"]()}
      </Button>

      <NameFormDialog
        open={open}
        onClose={() => setOpen(false)}
        title={m["project.newTitle"]()}
        description={m["project.newBody"]()}
        // The archetype decides the TEMPLATE written in the folder; the suffix is not a choice, there being only one.
        before={<ShapePicker shape={shape} onShape={setShape} busy={busy} />}
        placeholder={m["project.namePlaceholder"]()}
        name={name}
        onName={setName}
        onSubmit={submit}
        busy={busy}
        step={step}
        error={error}
        badName={badName}
        preview={folder}
        submit={m["common.create"]()}
        canSubmit={Boolean(folder)}
      />
    </>
  );
}
