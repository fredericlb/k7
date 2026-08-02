// The workspace sidebar. The tree itself — expansion, right-click menu, inline
// prompts, file drops — is @frediverse/ui/file-tree, shared with calepin; this
// file is only what is lanes's: pinned files, the "open project" button, and
// the module-folder actions.

import {
  FileTree as Tree,
  type TreeAction,
  type TreeTarget,
} from "@frediverse/ui/file-tree";
import { cn } from "@frediverse/ui/lib/utils";
import {
  File,
  FileAudio,
  Folder,
  FolderOpen,
  Pin,
  Play,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { acceptsFileDrop, dragPayload } from "../fileDrop";
import type { FileNode } from "../types";

// A drag carrying OS files — the only kind we accept. The decision lives in fileDrop.ts, pure and tested.
const dragHasFiles = (e: React.DragEvent): boolean =>
  acceptsFileDrop(dragPayload(e));

// Check if a path looks like a module folder: [...]/modules/<category>/<name>
const MODULE_CATEGORIES = new Set([
  "io",
  "instruments",
  "audio",
  "transformers",
  "midi",
  "video_effects",
  "video_transitions",
]);
const isModuleFolder = (path: string): boolean => {
  const parts = path.split("/");
  return (
    parts.length >= 3 &&
    parts[parts.length - 3] === "modules" &&
    MODULE_CATEGORIES.has(parts[parts.length - 2])
  );
};

/**
 * Is this path inside the workspace's shared module library?
 *
 * `_modules` backs every project in the workspace, so it is read-only here — `module populate` rebuilds it and
 * is the only thing that writes to it. Editing a module in it saves a project-local COPY instead (see
 * moduleFork.ts on the server); everything else is simply not offered, which is why these actions disappear
 * rather than failing on the way back. Mirrors isInSharedModules — the server enforces, this only explains.
 */
const isShared = (path: string): boolean =>
  path.split("/").some((seg) => seg === "_modules");

// A .wav can't open in the editor, but it still wants Rename/Delete.
const isBinary = (node: FileNode): boolean => node.kind === "binary";

export function FileTree({
  tree,
  activePath,
  activeProject,
  projectName,
  rootDir,
  onOpen,
  onOpenProject,
  onUpload,
  onRename,
  onMove,
  onDelete,
  onCreateProjectFile,
  onCreateFolder,
  onCloneModule,
  onCreateModuleInstance,
}: {
  tree: FileNode[];
  activePath: string | null;
  activeProject: string | null;
  // The song's name, part of the pins' localStorage key: activeProject is "." for a lone project, too ambiguous.
  projectName?: string | null;
  // Where a drop onto empty space lands — the active project, or the workspace root when none is open.
  rootDir: string;
  onOpen: (path: string) => void;
  onOpenProject: (path: string) => void;
  // Drop local files into `dir` (a workspace-relative folder). EditorTab does the upload.
  onUpload: (dir: string, files: File[]) => void;
  // Right-click actions on an entry, wired by EditorTab; the menu only appears when both are provided.
  onRename?: (path: string, newName: string) => void;
  // Drag a row onto a folder. Omit and rows aren't draggable at all — the shared tree decides that from this prop.
  onMove?: (path: string, toDir: string) => void;
  onDelete?: (path: string, isDir: boolean) => void;
  onCreateProjectFile?: (dir: string, name: string) => void;
  // Make an empty folder inside `dir`.
  onCreateFolder?: (dir: string, name: string) => void;
  onCloneModule?: (path: string, newName: string) => void;
  // Add an <instance>.yaml to a module folder (it inherits that folder's module.yaml).
  onCreateModuleInstance?: (path: string, instance: string) => void;
}) {
  // Pinned files: client-only state in localStorage per project, re-loaded on a project switch so pins can't cross.
  const pinKey = `lanes:pins:${projectName || activeProject || "."}`;
  const [pins, setPins] = useState<string[]>([]);
  useEffect(() => {
    let list: unknown = [];
    try {
      const raw = localStorage.getItem(pinKey);
      list = raw ? JSON.parse(raw) : [];
    } catch {
      list = [];
    }
    setPins(
      Array.isArray(list)
        ? list.filter((p): p is string => typeof p === "string")
        : [],
    );
  }, [pinKey]);
  const togglePin = (path: string) =>
    setPins((prev) => {
      const next = prev.includes(path)
        ? prev.filter((p) => p !== path)
        : [...prev, path];
      try {
        localStorage.setItem(pinKey, JSON.stringify(next));
      } catch {
        /* storage full / unavailable — the pin just won't survive a reload */
      }
      return next;
    });
  const isPinned = (path: string) => pins.includes(path);
  // Every openable path: a pin shows only once its file is present, which gates clicks on the tree having loaded.
  const treeFiles = useMemo(() => {
    const s = new Set<string>();
    const walk = (ns: FileNode[]) => {
      for (const n of ns)
        if (n.dir) {
          if (n.children) walk(n.children);
        } else s.add(n.path);
    };
    walk(tree);
    return s;
  }, [tree]);
  const shownPins = pins.filter((p) => treeFiles.has(p));

  // The file PICKER — the same upload as a drag. Worth a second way in: drag-and-drop fails silently when it fails.
  const pickRef = useRef<HTMLInputElement>(null);
  const pickInto = useRef<string>(rootDir);
  const pickFiles = (dir: string) => {
    pickInto.current = dir;
    // Cleared first: picking the SAME files twice fires no `change` otherwise, so the second attempt would look ignored.
    if (pickRef.current) pickRef.current.value = "";
    pickRef.current?.click();
  };

  const menuEnabled = !!onRename && !!onDelete;
  const isModuleTarget = (t: TreeTarget<FileNode>) =>
    t.dir && !t.root && isModuleFolder(t.path);
  // Both "New instance…" and "Clone module…" resolve the module inside the ACTIVE PROJECT, so neither reaches a
  // shared one. Editing a shared module is what copies it into the project (see moduleFork.ts).
  const isLocalModuleTarget = (t: TreeTarget<FileNode>) =>
    isModuleTarget(t) && !isShared(t.path);

  const actions: TreeAction<FileNode>[] = [
    {
      key: "upload",
      label: "Upload files…",
      when: (t) => t.dir && !isShared(t.path),
      run: (t) => pickFiles(t.path),
    },
    {
      key: "new-file",
      label: "New file…",
      when: (t) =>
        t.dir && !t.root && !isShared(t.path) && !!onCreateProjectFile,
      prompt: {
        placeholder: "filename.yaml",
        initial: () => "untitled.yaml",
        submit: "Create",
      },
      run: (t, name) => onCreateProjectFile?.(t.path, name),
    },
    {
      key: "new-folder",
      label: "New folder…",
      // Same reach as "New file…": inside a folder, never at the root, where a loose entry would sit among the
      // projects rather than in one.
      when: (t) => t.dir && !t.root && !isShared(t.path) && !!onCreateFolder,
      prompt: {
        placeholder: "folder-name",
        submit: "Create",
        hint: (t, value) => `${t.path}/${value.trim() || "…"}`,
      },
      run: (t, name) => onCreateFolder?.(t.path, name),
    },
    {
      key: "new-instance",
      label: "New instance…",
      when: (t) => isLocalModuleTarget(t) && !!onCreateModuleInstance,
      prompt: {
        placeholder: "instance-name",
        submit: "Create",
        // The instance names the FILE and, with the module, the chain ref — so show what the chain will say.
        hint: (t, value) => (
          <>
            Instance of {t.name}, used as{" "}
            <span className="text-foreground">
              {t.name}:{value.trim() || "…"}
            </span>
          </>
        ),
      },
      run: (t, instance) => onCreateModuleInstance?.(t.path, instance),
    },
    {
      key: "clone-module",
      label: "Clone module…",
      when: (t) => isLocalModuleTarget(t) && !!onCloneModule,
      prompt: {
        placeholder: "newName",
        initial: (t) => t.name,
        submit: "Clone",
        hint: (t) => `Clone as: ${t.path.split("/").slice(0, -1).join("/")}/`,
      },
      run: (t, name) => onCloneModule?.(t.path, name),
    },
    {
      key: "pin",
      label: (t) => (isPinned(t.path) ? "Unpin" : "Pin to top"),
      when: (t) => !t.dir && !!t.node && !isBinary(t.node),
      run: (t) => togglePin(t.path),
    },
    {
      key: "copy-path",
      label: "Copy path",
      run: (t) => {
        navigator.clipboard.writeText(t.path);
      },
    },
    {
      key: "rename",
      label: "Rename…",
      when: (t) => menuEnabled && !t.root && !isShared(t.path),
      prompt: { initial: (t) => t.name, submit: "Rename" },
      run: (t, name) => {
        if (name !== t.name) onRename?.(t.path, name);
      },
    },
    {
      key: "delete",
      label: "Delete",
      danger: true,
      when: (t) => menuEnabled && !t.root && !isShared(t.path),
      run: (t) => onDelete?.(t.path, t.dir),
    },
  ];

  // Pinned shortcuts — hoisted above the tree so a deep file is one click away.
  const header = shownPins.length > 0 && (
    <div className="mb-1 border-b border-border/60 pb-1">
      {shownPins.map((p) => (
        <div
          key={p}
          className={cn(
            "group flex items-center pr-1",
            activePath === p && "bg-secondary",
          )}
          style={{ paddingLeft: 8 }}
        >
          <button
            type="button"
            onClick={() => onOpen(p)}
            title={p}
            className={cn(
              "flex min-w-0 flex-1 items-center gap-1 py-0.5 text-left text-sm",
              activePath === p
                ? "text-foreground"
                : "text-foreground/80 hover:text-foreground",
            )}
          >
            <Pin className="h-3.5 w-3.5 shrink-0 text-primary" />
            {/* Folder + filename (the last two path segments), so two pinned files with
                the same name — a common shape here (several tracks/*.yaml) — are told
                apart. The full path is the tooltip. */}
            <span className="truncate">{p.split("/").slice(-2).join("/")}</span>
          </button>
          <button
            type="button"
            onClick={() => togglePin(p)}
            title="unpin"
            aria-label={`unpin ${p.split("/").pop()}`}
            className="shrink-0 rounded p-0.5 text-muted-foreground/50 opacity-0 hover:text-foreground group-hover:opacity-100"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      ))}
    </div>
  );

  return (
    <>
      {/* The picker behind "Upload files…". Hidden rather than styled: it exists to be
          clicked programmatically, and `multiple` is the whole point — the upload path
          has always taken a batch, only the drag could produce one. */}
      <input
        ref={pickRef}
        type="file"
        multiple
        className="hidden"
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          if (files.length) onUpload(pickInto.current, files);
          e.target.value = ""; // so the same pick can be repeated
        }}
      />
      <Tree<FileNode>
        nodes={tree}
        activePath={activePath}
        reveal={activeProject}
        rootPath={rootDir}
        rootLabel={projectName ?? rootDir}
        header={header}
        actions={actions}
        acceptsFileDrop={dragHasFiles}
        isDisabled={isBinary}
        onOpen={(node) => onOpen(node.path)}
        onDropFiles={onUpload}
        onMove={onMove}
        icon={(node, open) =>
          node.dir ? (
            open ? (
              <FolderOpen className="h-4 w-4 shrink-0" />
            ) : (
              <Folder className="h-4 w-4 shrink-0" />
            )
          ) : isBinary(node) ? (
            <FileAudio className="h-4 w-4 shrink-0" />
          ) : (
            <File className="h-4 w-4 shrink-0" />
          )
        }
        rowEnd={(node) =>
          node.project ? (
            <button
              type="button"
              title={
                activeProject === node.path
                  ? "active project"
                  : "open project — start the engine here"
              }
              onClick={() => onOpenProject(node.path)}
              className={cn(
                "shrink-0 rounded p-0.5",
                activeProject === node.path
                  ? "text-emerald-500"
                  : "text-muted-foreground/60 hover:text-foreground",
              )}
            >
              <Play
                className="h-3.5 w-3.5"
                fill={activeProject === node.path ? "currentColor" : "none"}
              />
            </button>
          ) : null
        }
      />
    </>
  );
}
