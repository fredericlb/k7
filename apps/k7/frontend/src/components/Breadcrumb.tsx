// Breadcrumb.tsx — the global view's file navigation in one ROW, replacing the tree rather
// than summarising it: every segment is a menu of that directory, so any file is reachable
// from any other. A tree shows everything at once and costs a pane; in the global view the
// pane is what we don't have. Same /api/tree the FileTree uses, so they can't disagree.

import { ChevronDown, ChevronRight, Play } from "@frediverse/ui/icons";
import { useEffect, useMemo, useRef, useState } from "react";
import type { FileNode } from "../types";

// A directory's children ("" is the root), walking by segment: two folders can share a basename.
export function childrenOf(tree: FileNode[], dir: string): FileNode[] {
  if (!dir) return tree;
  let nodes = tree;
  for (const part of dir.split("/")) {
    const hit = nodes.find((n) => n.dir && n.name === part);
    if (!hit) return [];
    nodes = hit.children ?? [];
  }
  return nodes;
}

// Every directory prefix, shallowest first — the segments that get a menu; the file's is the last one repeated.
export function dirPrefixes(path: string): string[] {
  const parts = path.split("/").slice(0, -1);
  return ["", ...parts.map((_, i) => parts.slice(0, i + 1).join("/"))];
}

/** A workspace-relative path in the TREE's own space, or null when it is outside it — mixing the two is what made every menu answer 'empty'. */
export function underRoot(path: string, root: string): string | null {
  if (!root) return path;
  if (path === root) return "";
  return path.startsWith(`${root}/`) ? path.slice(root.length + 1) : null;
}

export function Breadcrumb({
  tree,
  path,
  root,
  rootLabel,
  activeProject,
  onOpen,
  onOpenProject,
}: {
  tree: FileNode[];
  path: string | null; // the open file, workspace-relative
  /** Where `tree` is rooted, workspace-relative — "" when it is the workspace itself. */
  root: string;
  rootLabel: string;
  activeProject: string | null;
  onOpen: (path: string) => void;
  onOpenProject: (path: string) => void;
}) {
  // Which directory's menu is open. This is also how drilling works: picking a folder moves the menu onto it.
  const [menu, setMenu] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  // Close on an outside click. Pointerdown, not click, so the menu is gone before a click on something behind it lands.
  useEffect(() => {
    if (menu === null) return;
    const onDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setMenu(null);
    };
    window.addEventListener("pointerdown", onDown);
    return () => window.removeEventListener("pointerdown", onDown);
  }, [menu]);

  // A file opened elsewhere moves the breadcrumb under us, and a menu left open would describe the old path.
  useEffect(() => setMenu(null), [path]);

  // In the tree's space from here down; a file OUTSIDE it keeps its own path, so its segments draw with honestly empty menus.
  const rel = useMemo(
    () => (path === null ? null : (underRoot(path, root) ?? path)),
    [path, root],
  );
  const parts = useMemo(() => (rel ? rel.split("/") : []), [rel]);
  const prefixes = useMemo(() => (rel ? dirPrefixes(rel) : [""]), [rel]);

  const entries = menu === null ? [] : childrenOf(tree, menu);

  return (
    <div ref={ref} className="relative flex min-w-0 items-center text-xs">
      <Segment
        label={rootLabel}
        open={menu === ""}
        onClick={() => setMenu(menu === "" ? null : "")}
      />
      {parts.map((part, i) => {
        // The last part is the file, the rest folders: a folder's menu is its contents, a file's its parent's.
        const isFile = i === parts.length - 1;
        const dir = isFile ? prefixes[prefixes.length - 1] : prefixes[i + 1];
        return (
          <div key={`${part}-${i}`} className="flex min-w-0 items-center">
            <ChevronRight className="h-3 w-3 shrink-0 text-faint" />
            <Segment
              label={part}
              file={isFile}
              open={menu === dir && (isFile || menu !== "")}
              onClick={() => setMenu(menu === dir ? null : dir)}
            />
          </div>
        );
      })}
      {!path && (
        <span className="ml-2 truncate text-muted-foreground">
          no file open
        </span>
      )}

      {menu !== null && (
        <div className="absolute left-0 top-full z-20 mt-1 max-h-72 min-w-48 overflow-auto rounded border border-border bg-popover p-1 shadow-lg">
          {entries.length === 0 && (
            <div className="px-2 py-1 text-muted-foreground">empty</div>
          )}
          {entries.map((n) => {
            const isActiveProject = n.project && activeProject === n.path;
            return (
              <div key={n.path} className="flex items-center">
                <button
                  onClick={() => {
                    // A folder drills in and a file is the destination; `n.path` is workspace-relative, where a menu key is in the tree's space.
                    if (n.dir) setMenu(underRoot(n.path, root) ?? n.path);
                    else {
                      onOpen(n.path);
                      setMenu(null);
                    }
                  }}
                  // Compared in the WORKSPACE's space, like `activeProject` below: both props arrive that way, and only the menu keys moved.
                  className={`flex min-w-0 flex-1 items-center gap-1.5 truncate rounded px-2 py-1 text-left font-mono hover:bg-accent ${
                    n.path === path ? "bg-accent" : ""
                  }`}
                >
                  {n.dir ? (
                    <ChevronRight className="h-3 w-3 shrink-0 text-muted-foreground" />
                  ) : (
                    <span className="w-3 shrink-0" />
                  )}
                  <span className="truncate">{n.name}</span>
                </button>
                {n.project && (
                  // The same affordance as the file tree's: a project folder can be opened from here, not only drilled into.
                  <button
                    title={
                      isActiveProject
                        ? "active project"
                        : "open project — start the engine here"
                    }
                    onClick={() => {
                      onOpenProject(n.path);
                      setMenu(null);
                    }}
                    className={`shrink-0 rounded p-1 ${
                      isActiveProject
                        ? "text-emerald-500"
                        : "text-faint hover:text-foreground"
                    }`}
                  >
                    <Play
                      className="h-3 w-3"
                      fill={isActiveProject ? "currentColor" : "none"}
                    />
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function Segment({
  label,
  file,
  open,
  onClick,
}: {
  label: string;
  file?: boolean;
  open: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      aria-expanded={open}
      className={`flex min-w-0 items-center gap-0.5 rounded px-1.5 py-0.5 font-mono hover:bg-accent ${
        file ? "text-foreground" : "text-muted-foreground"
      } ${open ? "bg-accent" : ""}`}
    >
      <span className="truncate">{label}</span>
      <ChevronDown className="h-3 w-3 shrink-0 opacity-50" />
    </button>
  );
}
