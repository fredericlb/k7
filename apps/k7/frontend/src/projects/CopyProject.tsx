// CopyProject.tsx — the dialog that picks where a copy lands, opened from the row's ⋮ menu.
// See ../../docs/projects.md.

import { Copy, Folder } from "@frediverse/ui/icons";
import type { AccountWorkspace } from "@studio/web-protocol";
import type { ProjectApp } from "@studio/web-protocol/projects";
import { useState } from "react";
import { m } from "../paraglide/messages.js";
import { NameFormDialog, useNameSubmit } from "./NameForm";
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
  /** Where it may land — every OTHER workspace of the account that holds several projects. */
  targets: AccountWorkspace[];
  onCopy: (
    to: AccountWorkspace,
    folder: string,
    onStep: (s: string) => void,
  ) => Promise<void>;
}) {
  const [to, setTo] = useState<AccountWorkspace | null>(null);
  const [name, setName] = useState(label);
  const { busy, step, error, run } = useNameSubmit();

  const { folder, error: badName } = projectFolderName(name, app);

  const submit = () => {
    if (!folder || !to) return;
    run((onStep) => onCopy(to, folder, onStep), onClose);
  };

  return (
    <NameFormDialog
      open={open}
      onClose={onClose}
      title={m["project.copyTitle"]({ label })}
      description={m["project.copyBody"]()}
      before={
        <>
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
                <Folder className="h-4 w-4 shrink-0 text-muted-foreground" />
                <span className="truncate">{w.name}</span>
              </button>
            ))}
          </div>
        </>
      }
      autoFocus={false}
      placeholder={m["project.copyNamePlaceholder"]()}
      name={name}
      onName={setName}
      onSubmit={submit}
      busy={busy}
      step={step}
      error={error}
      badName={badName}
      preview={folder && to ? `${to.name} / ${folder}` : ""}
      submit={
        <>
          <Copy className="mr-1 h-3.5 w-3.5" /> {m["project.copy"]()}
        </>
      }
      canSubmit={Boolean(folder && to)}
    />
  );
}
