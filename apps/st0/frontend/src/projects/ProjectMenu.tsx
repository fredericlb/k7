// ProjectMenu.tsx — the ⋮ at the end of a project's row: copy, rename, delete. One button rather
// than three, because the row is first of all a LINK to the project and the acts on it are rare;
// and the dialogs are mounted HERE, outside the menu, since a Radix menu unmounts its content on
// select and would take a dialog inside it down with it. See ../../docs/projects.md.

import { Button } from "@frediverse/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@frediverse/ui/dropdown-menu";
import type { MachineWorkspace } from "@studio/web-protocol";
import type { ProjectApp } from "@studio/web-protocol/projects";
import { Copy, MoreVertical, PenLine, Trash2 } from "lucide-react";
import { useState } from "react";
import { m } from "../paraglide/messages.js";
import { CopyProject } from "./CopyProject";
import { DeleteProject } from "./DeleteProject";
import { RenameProject } from "./RenameProject";

/** Which of the three is asking; `null` is the menu closed and nothing open. */
type Act = "copy" | "rename" | "delete" | null;

export function ProjectMenu({
  path,
  label,
  app,
  blocked,
  targets,
  onCopy,
  onRename,
  onDelete,
}: {
  path: string;
  label: string;
  app: ProjectApp;
  /** Why nothing here can run — no machine, or one busy. Empty when it can. */
  blocked: string;
  /** Where a copy may land — every OTHER workspace on this machine. */
  targets: MachineWorkspace[];
  onCopy: (
    to: MachineWorkspace,
    folder: string,
    onStep: (s: string) => void,
  ) => Promise<void>;
  onRename: (folder: string, onStep: (s: string) => void) => Promise<void>;
  onDelete: (onStep: (s: string) => void) => Promise<void>;
}) {
  const [act, setAct] = useState<Act>(null);
  // A copy needs somewhere to land, and says so on the row rather than in an empty dialog.
  const noTarget = targets.length ? "" : m["project.copyNone"]();

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon-xs"
            className="shrink-0 text-muted-foreground"
            title={blocked || m["project.menu"]({ label })}
            aria-label={m["project.menu"]({ label })}
            disabled={Boolean(blocked)}
            // The whole row is a link to the project: without this, opening the menu would open it.
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
            }}
          >
            <MoreVertical className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuItem
            className="gap-2 text-xs"
            disabled={Boolean(noTarget)}
            title={noTarget || undefined}
            onSelect={() => setAct("copy")}
          >
            <Copy className="h-3.5 w-3.5 text-muted-foreground" />
            {m["project.copy"]()}
          </DropdownMenuItem>
          <DropdownMenuItem
            className="gap-2 text-xs"
            onSelect={() => setAct("rename")}
          >
            <PenLine className="h-3.5 w-3.5 text-muted-foreground" />
            {m["project.rename"]()}
          </DropdownMenuItem>
          {/* Last, and the only one that reads as danger: a rare destructive act sits apart from the two that keep it. */}
          <DropdownMenuItem
            className="gap-2 text-destructive text-xs"
            onSelect={() => setAct("delete")}
          >
            <Trash2 className="h-3.5 w-3.5" />
            {m["project.delete"]()}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <CopyProject
        open={act === "copy"}
        onClose={() => setAct(null)}
        path={path}
        label={label}
        app={app}
        targets={targets}
        onCopy={onCopy}
      />
      <RenameProject
        open={act === "rename"}
        onClose={() => setAct(null)}
        path={path}
        label={label}
        app={app}
        onRename={onRename}
      />
      <DeleteProject
        open={act === "delete"}
        onClose={() => setAct(null)}
        path={path}
        label={label}
        onDelete={onDelete}
      />
    </>
  );
}
