// DemoBanner.tsx — the line under the header while the open project is a bundled DEMO: the file
// service overwrites demos on its next start, edits and all, so this says it before anything is
// lost and offers the copy that keeps them. See ../../docs/projects.md, "Demos".

import { Button } from "@frediverse/ui/button";
import { Copy, TriangleAlert } from "@frediverse/ui/icons";
import { parseLaunch } from "@studio/project-shell/launch";
import type { AccountWorkspace } from "@studio/web-protocol";
import {
  isLocal,
  localTarget,
  projectLabel,
} from "@studio/web-protocol/projects";
import { useState } from "react";
import { go } from "../appNav";
import { m } from "../paraglide/messages.js";
import { accountFiles, projectHref } from "../projects/api";
import { CopyProject } from "../projects/CopyProject";
import { type AccountFiles, copyProject } from "../projects/workspaceOps";
import { findAccountFiles } from "../settings/accountFiles";

/** The workspace the address names — the one the demo sits in. */
function addressedWorkspace(): string | null {
  const at = parseLaunch(
    window.location.pathname,
    "k7",
    import.meta.env.BASE_URL,
  );
  return at && isLocal(at.repo)
    ? (localTarget(at.project)?.workspace ?? null)
    : null;
}

export function DemoBanner({ project }: { project: string }) {
  const [files, setFiles] = useState<AccountFiles | null>(null);
  const [targets, setTargets] = useState<AccountWorkspace[]>([]);
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const from = addressedWorkspace();

  // Asked on the click, not on mount: most people reading the line never copy.
  const start = async () => {
    setNote("");
    const f = await findAccountFiles(false);
    if (!f || !from) return setNote(m["demo.noFiles"]());
    const all = await accountFiles.workspaces(f).catch(() => []);
    const t = all.filter((w) => w.name !== from && !w.isSingleProject);
    if (!t.length) return setNote(m["demo.noTarget"]());
    setFiles(f);
    setTargets(t);
    setOpen(true);
  };

  return (
    <div className="flex shrink-0 items-center gap-2 border-b border-amber-500/30 bg-amber-500/10 px-3 py-1 text-amber-600 text-xs dark:text-amber-400">
      <TriangleAlert className="h-3.5 w-3.5 shrink-0" />
      <span className="min-w-0 flex-1 truncate">
        {note || m["demo.banner"]()}
      </span>
      <Button size="xs" variant="secondary" onClick={() => void start()}>
        <Copy className="h-3 w-3" /> {m["demo.copy"]()}
      </Button>
      {files && from && (
        <CopyProject
          open={open}
          onClose={() => setOpen(false)}
          path={project}
          label={projectLabel(project.split("/").pop() ?? project)}
          app="k7"
          targets={targets}
          onCopy={async (to, folder, onStep) => {
            const copied = await copyProject(
              files,
              from,
              project,
              to.name,
              folder,
              onStep,
            );
            // Straight into the copy: what was being edited is what should keep being edited.
            void go(projectHref(to, { path: copied, app: "k7" }));
          }}
        />
      )}
    </div>
  );
}
