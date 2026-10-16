// RenameProject.tsx — the dialog behind the row's ⋮ menu: a project's folder renamed in place.
// The SUFFIX is not part of the question — it says which app opens the folder, so it is kept
// whatever is typed. See ../../docs/projects.md.

import { PenLine } from "@frediverse/ui/icons";
import type { ProjectApp } from "@studio/web-protocol/projects";
import { useState } from "react";
import { m } from "../paraglide/messages.js";
import { NameFormDialog, useNameSubmit } from "./NameForm";
import { projectFolderName } from "./projectName";

export function RenameProject({
  open,
  onClose,
  path,
  label,
  /** The project's app: the new folder keeps its suffix, or another application would claim it. */
  app,
  onRename,
}: {
  /** Driven from the row's menu, which is what registers the gesture — see ProjectMenu.tsx. */
  open: boolean;
  onClose: () => void;
  path: string;
  label: string;
  app: ProjectApp;
  onRename: (folder: string, onStep: (s: string) => void) => Promise<void>;
}) {
  const [name, setName] = useState(label);
  const { busy, step, error, run } = useNameSubmit();

  const { folder, error: badName } = projectFolderName(name, app);
  // Renaming a thing to what it is called is not an edit: said here rather than refused by the file service.
  const same = folder === path.split("/").pop();

  const submit = () => {
    if (!folder || same) return;
    run((onStep) => onRename(folder, onStep), onClose);
  };

  return (
    <NameFormDialog
      open={open}
      onClose={onClose}
      title={m["project.renameTitle"]({ label })}
      description={m["project.renameBody"]()}
      before={
        <p className="rounded bg-muted px-3 py-2 font-mono text-xs">{path}</p>
      }
      name={name}
      onName={setName}
      onSubmit={submit}
      busy={busy}
      step={step}
      error={error}
      badName={badName}
      preview={
        same ? (
          <span className="text-muted-foreground">
            {m["project.renameSame"]()}
          </span>
        ) : (
          folder
        )
      }
      // What a rename COSTS, said before it happens: an address is a thing people keep.
      note={
        <p className="text-amber-500 text-xs">{m["project.renameWarning"]()}</p>
      }
      submit={
        <>
          <PenLine className="mr-1 h-3.5 w-3.5" /> {m["project.rename"]()}
        </>
      }
      canSubmit={Boolean(folder) && !same}
    />
  );
}
