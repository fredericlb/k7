// RepoTree.tsx — a workspace's tree as the file service holds it, with an "Ouvrir dans st0" button on
// every folder that is a project, and the file a click picks drawn read-only beside it. What git has
// not committed is blue, and drawn as its diff. Read-only: what is written in a project is written
// once it is open. See ../../docs/projects.md.

import { Button } from "@frediverse/ui/button";
import {
  ArrowLeft,
  ArrowRight,
  ChevronDown,
  ChevronRight,
  File,
  Folder,
  FolderGit2,
  Loader2,
} from "@frediverse/ui/icons";
import type {
  AccountWorkspace,
  FileNode,
  GitChange,
} from "@studio/web-protocol";
import type { ProjectApp } from "@studio/web-protocol/projects";
import { sortNodes } from "@studio/web-protocol/tree";
import { useEffect, useMemo, useRef, useState } from "react";
import { m } from "../paraglide/messages.js";
import type { AccountFiles } from "./api";
import { type Changed, changedOf, slash, withChanges } from "./changedTree";
import { FileViewer } from "./FileViewer";
import { workspaceFiles } from "./workspaceFiles";

/** `git status` is local and cheap: often enough that a save elsewhere turns its file blue. */
const CHANGES_MS = 5000;

const CHANGED = "text-sky-500";

interface RowProps {
  node: FileNode;
  depth: number;
  open: Set<string>;
  onToggle: (path: string) => void;
  projectHref: (path: string, app: ProjectApp) => string;
  changed: Changed;
  selected: string | null;
  onSelect: (path: string) => void;
}

function Row(props: RowProps) {
  const {
    node,
    depth,
    open,
    onToggle,
    projectHref,
    changed,
    selected,
    onSelect,
  } = props;
  const isOpen = open.has(node.path);
  const pad = { paddingLeft: `${depth * 14 + 8}px` };
  const key = slash(node.path);
  if (!node.dir) {
    const code = changed.codes.get(key);
    const gone = code?.includes("D");
    return (
      <button
        type="button"
        className={`flex w-full items-center gap-2 py-0.5 pr-2 text-left text-sm hover:bg-accent/50 ${
          key === selected ? "bg-accent" : ""
        } ${code ? CHANGED : "text-muted-foreground"}`}
        style={pad}
        onClick={() => onSelect(key)}
        title={code ? `${node.path} — ${code.trim()}` : node.path}
      >
        <File className="h-3.5 w-3.5 shrink-0 opacity-60" />
        <span
          className={`min-w-0 flex-1 truncate ${gone ? "line-through" : ""}`}
        >
          {node.name}
        </span>
        {code && (
          <span className="shrink-0 font-mono text-xs">{code.trim()}</span>
        )}
      </button>
    );
  }
  return (
    <>
      <div
        className={`flex items-center gap-2 py-0.5 pr-2 text-sm ${
          changed.dirs.has(key) ? CHANGED : ""
        }`}
        style={pad}
      >
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
        {/* An ANCHOR, not a router link: the project is the router's basename, so leaving for it is a whole-page navigation. */}
        {node.app && (
          <Button size="sm" variant="secondary" asChild>
            <a href={projectHref(node.path, node.app)}>
              <ArrowRight className="h-3.5 w-3.5" /> Ouvrir dans {node.app}
            </a>
          </Button>
        )}
      </div>
      {isOpen &&
        node.children?.map((c) => (
          <Row key={c.path} {...props} node={c} depth={depth + 1} />
        ))}
    </>
  );
}

/** The uncommitted paths of one workspace, re-read on a timer while the tree is shown. */
function useChanges(
  files: AccountFiles | null,
  workspace: string,
): GitChange[] {
  const [changes, setChanges] = useState<GitChange[]>([]);
  useEffect(() => {
    setChanges([]);
    if (!files) return;
    let stop = false;
    const read = () =>
      workspaceFiles
        .changes(files, workspace)
        .then((c) => !stop && setChanges(c))
        // A workspace git cannot read is drawn uncoloured rather than as an error.
        .catch(() => undefined);
    void read();
    const t = setInterval(read, CHANGES_MS);
    return () => {
      stop = true;
      clearInterval(t);
    };
  }, [files, workspace]);
  return changes;
}

export function RepoTree({
  workspace,
  files,
  nodes,
  onBack,
  projectHref,
}: {
  workspace: AccountWorkspace;
  /** The file service the viewer reads through; null draws the tree with nothing to open. */
  files: AccountFiles | null;
  /** null until the file service has answered — that is not an empty workspace. */
  nodes: FileNode[] | null;
  onBack: () => void;
  /** A project's address, not the act of opening it: the row makes it a real link. */
  projectHref: (path: string, app: ProjectApp) => string;
}) {
  const changes = useChanges(files, workspace.name);
  const changed = useMemo(() => changedOf(changes), [changes]);
  // Reading order, at every level: folders first, then by name.
  const rows = useMemo(
    () => (nodes ? sortNodes(withChanges(nodes, changes)) : null),
    [nodes, changes],
  );
  const [selected, setSelected] = useState<string | null>(null);
  // The folders open at the start: the first level is enough, and a workspace opening fully collapsed hides what anybody comes here for.
  const [open, setOpen] = useState<Set<string>>(new Set());
  // Once per workspace, when the tree arrives: after that the folds are the person's own, including the ones they closed again.
  const seeded = useRef<string | null>(null);
  useEffect(() => {
    if (!rows || seeded.current === workspace.name) return;
    seeded.current = workspace.name;
    setSelected(null);
    setOpen(new Set(rows.filter((n) => n.dir).map((n) => n.path)));
  }, [rows, workspace.name]);
  const toggle = (path: string) =>
    setOpen((s) => {
      const next = new Set(s);
      if (!next.delete(path)) next.add(path);
      return next;
    });

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-2 border-b px-6 py-2">
        <Button variant="ghost" size="sm" onClick={onBack}>
          <ArrowLeft className="h-4 w-4" /> Projets
        </Button>
        <span className="truncate font-medium">{workspace.name}</span>
        <span className="truncate text-xs text-muted-foreground">
          {workspace.origin ?? m["repos.hereOnly"]()}
        </span>
      </div>

      <div className="flex min-h-0 flex-1 flex-col md:flex-row">
        <div className="max-h-[40vh] min-h-0 shrink-0 overflow-auto border-b py-2 md:max-h-none md:w-80 md:border-r md:border-b-0">
          {rows === null ? (
            <div className="flex items-center justify-center gap-2 p-8 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              {m["repos.reading"]()}
            </div>
          ) : rows.length === 0 ? (
            <div className="p-8 text-center text-sm text-muted-foreground">
              {m["repos.emptyWorkspace"]()}
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
                changed={changed}
                selected={selected}
                onSelect={setSelected}
              />
            ))
          )}
        </div>
        <div className="min-h-0 min-w-0 flex-1">
          {selected && files ? (
            <FileViewer
              files={files}
              workspace={workspace.name}
              path={selected}
              code={changed.codes.get(selected)}
            />
          ) : (
            <div className="p-8 text-center text-sm text-muted-foreground">
              {m["repos.pickFile"]()}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
