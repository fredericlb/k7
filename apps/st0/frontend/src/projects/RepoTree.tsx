// RepoTree.tsx — a workspace's tree as it is on the machine, with an "Ouvrir dans st0" button on
// every folder that is a project. Read-only: what is written in a project is written once it is
// open. See ../../docs/projects.md.

import { Button } from "@frediverse/ui/button";
import type { FileNode, MachineWorkspace } from "@studio/web-protocol";
import type { ProjectApp } from "@studio/web-protocol/projects";
import { sortNodes } from "@studio/web-protocol/tree";
import {
  ArrowLeft,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  File,
  Folder,
  FolderGit2,
  Loader2,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

function Row({
  node,
  depth,
  open,
  onToggle,
  projectHref,
}: {
  node: FileNode;
  depth: number;
  open: Set<string>;
  onToggle: (path: string) => void;
  projectHref: (path: string, app: ProjectApp) => string;
}) {
  const isOpen = open.has(node.path);
  const pad = { paddingLeft: `${depth * 14 + 8}px` };
  if (!node.dir)
    return (
      <div
        className="flex items-center gap-2 py-0.5 text-sm text-muted-foreground"
        style={pad}
      >
        <File className="h-3.5 w-3.5 shrink-0 opacity-60" />
        <span className="truncate">{node.name}</span>
      </div>
    );
  return (
    <>
      <div className="flex items-center gap-2 py-0.5 text-sm" style={pad}>
        <button
          type="button"
          className="flex min-w-0 flex-1 items-center gap-2 text-left hover:text-foreground"
          onClick={() => onToggle(node.path)}
        >
          {isOpen ? (
            <ChevronDown className="h-3.5 w-3.5 shrink-0" />
          ) : (
            <ChevronRight className="h-3.5 w-3.5 shrink-0" />
          )}
          {node.project ? (
            <FolderGit2 className="h-3.5 w-3.5 shrink-0 text-primary" />
          ) : (
            <Folder className="h-3.5 w-3.5 shrink-0 opacity-60" />
          )}
          <span className={node.project ? "truncate font-medium" : "truncate"}>
            {node.name}
          </span>
        </button>
        {/* Le seul départ de tout l'écran : un projet s'ouvre dans SON application, pas ici, et
            c'est le suffixe du dossier qui la nomme (packages/web-protocol/projects.ts). Une
            ancre et un nouvel onglet, pour les raisons de ../../docs/projects.md. */}
        {node.app && (
          <Button size="sm" variant="secondary" asChild>
            <a
              href={projectHref(node.path, node.app)}
              target="_blank"
              rel="noopener"
            >
              <ExternalLink className="h-3.5 w-3.5" /> Ouvrir dans {node.app}
            </a>
          </Button>
        )}
      </div>
      {isOpen &&
        node.children?.map((c) => (
          <Row
            key={c.path}
            node={c}
            depth={depth + 1}
            open={open}
            onToggle={onToggle}
            projectHref={projectHref}
          />
        ))}
    </>
  );
}

export function RepoTree({
  workspace,
  nodes,
  onBack,
  projectHref,
}: {
  workspace: MachineWorkspace;
  /** null until the machine has answered — that is not an empty workspace. */
  nodes: FileNode[] | null;
  onBack: () => void;
  /** A project's address, not the act of opening it: the row makes it a real link. */
  projectHref: (path: string, app: ProjectApp) => string;
}) {
  // Reading order, at every level: folders first, then by name.
  const rows = useMemo(() => (nodes ? sortNodes(nodes) : null), [nodes]);
  // The folders open at the start: the ones to cross to see a project would be the right answer;
  // the first level is enough, and a workspace opening fully collapsed hides behind a click the
  // one thing anybody comes here for.
  const [open, setOpen] = useState<Set<string>>(new Set());
  // Once per workspace, when the tree arrives: after that the folds are the person's own,
  // including the ones they closed again.
  const seeded = useRef<string | null>(null);
  useEffect(() => {
    if (!rows || seeded.current === workspace.name) return;
    seeded.current = workspace.name;
    setOpen(new Set(rows.filter((n) => n.dir).map((n) => n.path)));
  }, [rows, workspace.name]);
  const toggle = (path: string) =>
    setOpen((s) => {
      const next = new Set(s);
      if (!next.delete(path)) next.add(path);
      return next;
    });

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b px-6 py-2">
        <Button variant="ghost" size="sm" onClick={onBack}>
          <ArrowLeft className="h-4 w-4" /> Projets
        </Button>
        <span className="truncate font-medium">{workspace.name}</span>
        <span className="truncate text-xs text-muted-foreground">
          {workspace.origin ?? "sur cette machine seulement"}
        </span>
      </div>

      <div className="min-h-0 flex-1 overflow-auto py-2">
        {rows === null ? (
          <div className="flex items-center justify-center gap-2 p-8 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Lecture de la machine…
          </div>
        ) : rows.length === 0 ? (
          <div className="p-8 text-center text-sm text-muted-foreground">
            Cet espace de travail est vide.
          </div>
        ) : (
          rows.map((n) => (
            <Row
              key={n.path}
              node={n}
              depth={0}
              open={open}
              onToggle={toggle}
              projectHref={projectHref}
            />
          ))
        )}
      </div>
    </div>
  );
}
