// The workspace sidebar, on two tabs: the PROJECT you have open, and the shared module
// LIBRARIES it can name. The tree itself — expansion, right-click menu, inline prompts, file
// drops — is @frediverse/ui/file-tree, shared with calepin; this file is only what is l8's:
// pinned files, the "open project" button, and the module-folder actions.
// Why the second tab exists: apps/l8/frontend/docs/sharedModules.md.

import {
  type DroppedFile,
  FileTree as Tree,
  type TreeAction,
  type TreeTarget,
} from "@frediverse/ui/file-tree";
import { cn } from "@frediverse/ui/lib/utils";
import {
  Boxes,
  File,
  FileAudio,
  Folder,
  FolderOpen,
  Library,
  Pin,
  Play,
  X,
} from "lucide-react";
import {
  type Ref,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import { acceptsFileDrop, dragPayload } from "../fileDrop";
import { librariesOwned, withoutPaths } from "../libraryTree";
import type { FileNode } from "../types";

/**
 * The two actions that live nowhere else — the pins are this component's localStorage and the
 * OS pickers are its two hidden inputs. Exposed so `ui pin` and `file upload` can reach them:
 * every action the tree offers is a command, and these are the ones no route and no parent hold.
 */
export interface FileTreeHandle {
  /** Pin a path to the top of the tree, or unpin it if it is already there. Answers the new state. */
  togglePin: (path: string) => boolean;
  /** Open the OS file picker; what is chosen is uploaded into `dir`, as a drop would be. */
  pickFiles: (dir: string) => void;
  /** The same, for a whole folder — a separate input, because `webkitdirectory` is a property of it. */
  pickFolder: (dir: string) => void;
}

// A drag carrying OS files — the only kind we accept. The decision lives in fileDrop.ts, pure and tested.
const dragHasFiles = (e: React.DragEvent): boolean =>
  acceptsFileDrop(dragPayload(e));

/** The generic module file a module folder is recognised BY, and opened at. */
const MODULE_FILE = /^module\.ya?ml$/i;

/**
 * A module is a folder that HOLDS a `module.yaml`, and the tree draws it as one row.
 *
 * Recognised by its contents rather than by its path. The shape used to be read off the path
 * — `…/modules/<category>/<name>` against a hard-coded category list — which missed a shared
 * library, where a module sits one folder deeper (`_modules/<type>/<category>/<leaf>`), and
 * would miss any category the list had not been told about. The file is the definition; asking
 * for it cannot drift from what the loader does.
 */
function moduleFileIn(node: FileNode): string | null {
  if (!node.dir) return null;
  return node.children?.find((c) => MODULE_FILE.test(c.name))?.name ?? null;
}

/**
 * The tree with every module folded into a single row, plus the module file each one opens at.
 *
 * The three files a module is are its DEFINITION, not contents to browse — you edit a module,
 * and the builder is what edits all three. Leaving them as rows offered three ways into one
 * screen and invited a drop into a folder whose shape the loader decides.
 */
function foldModules(nodes: FileNode[]): {
  tree: FileNode[];
  modules: Map<string, string>;
} {
  const modules = new Map<string, string>();
  const walk = (ns: FileNode[]): FileNode[] =>
    ns.map((n) => {
      const file = moduleFileIn(n);
      if (file) {
        modules.set(n.path, file);
        // `dir` and `children` both dropped: the shared tree decides "leaf" from those alone,
        // and a leaf is what draws no chevron and reports a click through onOpen.
        const { dir: _dir, children: _children, ...leaf } = n;
        return leaf as FileNode;
      }
      return n.children ? { ...n, children: walk(n.children) } : n;
    });
  return { tree: walk(nodes), modules };
}

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
  onOpenModule,
  onOpenProject,
  onUpload,
  onRename,
  onMove,
  onDelete,
  onCreateProjectFile,
  onCreateFolder,
  onCloneModule,
  onCreateNode,
  libraries,
  onOpenLibraryModule,
  ref,
}: {
  tree: FileNode[];
  activePath: string | null;
  activeProject: string | null;
  // The song's name, part of the pins' localStorage key: activeProject is "." for a lone project, too ambiguous.
  projectName?: string | null;
  // Where a drop onto empty space lands — the active project, or the workspace root when none is open.
  rootDir: string;
  onOpen: (path: string) => void;
  /** A module row was clicked — the path is its `module.yaml`, which is what the builder takes.
   *  Absent and a module simply opens nothing, since its files are no longer rows. */
  onOpenModule?: (moduleFile: string) => void;
  onOpenProject: (path: string) => void;
  // Drop local files into `dir` (a workspace-relative folder), FOLDERS included — each file carries the path
  // it sat at, because a module is a folder of three. EditorTab does the upload.
  onUpload: (dir: string, files: DroppedFile[]) => void;
  // Right-click actions on an entry, wired by EditorTab; the menu only appears when both are provided.
  onRename?: (path: string, newName: string) => void;
  // Drag a row onto a folder. Omit and rows aren't draggable at all — the shared tree decides that from this prop.
  onMove?: (path: string, toDir: string) => void;
  onDelete?: (path: string, isDir: boolean) => void;
  onCreateProjectFile?: (dir: string, name: string) => void;
  // Make an empty folder inside `dir`.
  onCreateFolder?: (dir: string, name: string) => void;
  onCloneModule?: (path: string, newName: string) => void;
  // Add an <node>.yaml to a module folder (it inherits that folder's module.yaml).
  onCreateNode?: (path: string, node: string) => void;
  /**
   * The shared libraries as tree rows — one namespace row each (`@st0`), the catalogue under
   * it. Empty when the submodule is not mounted; ABSENT for a shell that offers no such tab at
   * all, which is what makes the tab bar disappear rather than show a dead one.
   */
  libraries?: FileNode[];
  /** A module row in a LIBRARY was clicked. The same path space as every other row here — the
   *  libraries are a folder in the workspace — but a different callback, because what the
   *  builder does with it differs: it opens read-only (see ../libraryTree.ts). */
  onOpenLibraryModule?: (moduleFile: string) => void;
  ref?: Ref<FileTreeHandle>;
}) {
  // Which of the two trees is on screen. Client-only and not URL state: it is disclosure — the
  // same sidebar showing one of two things — and nothing else in the shell depends on it.
  const [tab, setTab] = useState<"project" | "libraries">("project");

  // Pinned files: client-only state in localStorage per project, re-loaded on a project switch so pins can't cross.
  const pinKey = `l8:pins:${projectName || activeProject || "."}`;
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
  // Answers the state it left the path in, so a command can say which of the two it just did.
  const togglePin = (path: string): boolean => {
    const next = pins.includes(path)
      ? pins.filter((p) => p !== path)
      : [...pins, path];
    setPins(next);
    try {
      localStorage.setItem(pinKey, JSON.stringify(next));
    } catch {
      /* storage full / unavailable — the pin just won't survive a reload */
    }
    return next.includes(path);
  };
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
  // Two inputs, because `webkitdirectory` is a property of the INPUT and not of the click: one asks for files,
  // the other for a folder, and a browser draws them as two different dialogs.
  const pickRef = useRef<HTMLInputElement>(null);
  const pickDirRef = useRef<HTMLInputElement>(null);
  const pickInto = useRef<string>(rootDir);
  const pick = (dir: string, input: HTMLInputElement | null) => {
    pickInto.current = dir;
    // Cleared first: picking the SAME files twice fires no `change` otherwise, so the second attempt would look ignored.
    if (input) input.value = "";
    input?.click();
  };
  const pickFiles = (dir: string) => pick(dir, pickRef.current);
  const pickFolder = (dir: string) => pick(dir, pickDirRef.current);

  // The three the right-click menu offers and nothing else can: they are this component's own state.
  // Rebuilt on every render, which is what it costs to keep `togglePin` reading the CURRENT pins
  // — the three are plain closures over this render's state, and a ref assignment is free.
  useImperativeHandle(
    ref,
    (): FileTreeHandle => ({
      togglePin,
      pickFiles,
      pickFolder,
    }),
  );

  // A pick, in the shape a drop already arrives in. `webkitRelativePath` carries the folder for a directory
  // pick and is "" otherwise, which is exactly the difference between the two inputs above.
  const uploadPicked = (input: HTMLInputElement) => {
    const files = Array.from(input.files ?? []).map((file) => ({
      path: file.webkitRelativePath || file.name,
      file,
    }));
    if (files.length) onUpload(pickInto.current, files);
    input.value = ""; // so the same pick can be repeated
  };

  // Folded before anything reads it: `modules` is then the only thing that knows a row is a
  // module, because the node no longer says `dir` and the path never did say it reliably.
  // Every module folder the Libraries tab has taken over is dropped from THIS one. Shown twice
  // they would be two ways into one module — one that opens the builder, one that browses its
  // files — and which folder a module lives in is the loader's business rather than somewhere
  // to drop files by hand. The list comes from the same place the tab is built from, so a level
  // cannot appear in both or vanish from both (see ../libraryTree.ts).
  const { tree: folded, modules } = useMemo(
    () => foldModules(withoutPaths(tree, librariesOwned(activeProject))),
    [tree, activeProject],
  );
  const isModule = (path: string) => modules.has(path);

  // The same fold over the LIBRARIES, so a shared module is one row that opens the builder
  // exactly as a project one is. Folded here rather than where the rows are built, so the two
  // trees cannot come to disagree about what a module looks like (see libraryTree.ts).
  const lib = useMemo(
    () => (libraries?.length ? foldModules(libraries) : null),
    [libraries],
  );

  const menuEnabled = !!onRename && !!onDelete;
  // `t.dir` is false on a module row now, so the folded set answers instead.
  const isModuleTarget = (t: TreeTarget<FileNode>) =>
    !t.root && isModule(t.path);
  // Both "New node…" and "Clone module…" resolve the module inside the ACTIVE PROJECT, so neither reaches a
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
      key: "upload-folder",
      label: "Upload a folder…",
      when: (t) => t.dir && !isShared(t.path),
      run: (t) => pickFolder(t.path),
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
      key: "new-node",
      label: "New node…",
      when: (t) => isLocalModuleTarget(t) && !!onCreateNode,
      prompt: {
        placeholder: "node-name",
        submit: "Create",
        // The node names the FILE and, with the module, the chain ref — so show what the chain will say.
        hint: (t, value) => (
          <>
            Node of {t.name}, used as{" "}
            <span className="text-foreground">
              {t.name}:{value.trim() || "…"}
            </span>
          </>
        ),
      },
      run: (t, node) => onCreateNode?.(t.path, node),
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
      // A module is a DIRECTORY on disk that the tree draws as a leaf, so `t.dir` alone would
      // send it down the single-file route and leave the folder behind.
      run: (t) => onDelete?.(t.path, t.dir || isModule(t.path)),
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
      {/* The two pickers. Hidden rather than styled: they exist to be clicked programmatically, and
          `multiple` is the whole point — the upload path has always taken a batch, only the drag could
          produce one. `webkitRelativePath` is what a folder pick fills in, and it is empty for a plain
          file pick, so ONE mapping serves both. */}
      <input
        ref={pickRef}
        type="file"
        multiple
        className="hidden"
        onChange={(e) => uploadPicked(e.target)}
      />
      <input
        ref={pickDirRef}
        type="file"
        multiple
        // @ts-expect-error — the directory picker is prefixed and absent from React's typings.
        webkitdirectory=""
        directory=""
        className="hidden"
        onChange={(e) => uploadPicked(e.target)}
      />

      {/* Two trees, one sidebar. Drawn only for a shell that has libraries to show — the tab
          bar is the affordance, so one lonely tab would be a control that decides nothing. */}
      {libraries !== undefined && (
        <div className="mb-1 flex shrink-0 items-center gap-1 border-b border-border/60 pb-1">
          {(
            [
              ["project", projectName ?? "Project", Folder],
              ["libraries", "Libraries", Library],
            ] as const
          ).map(([id, label, Icon]) => (
            <button
              key={id}
              type="button"
              onClick={() => setTab(id)}
              className={cn(
                "flex items-center gap-1 rounded px-2 py-0.5 text-xs",
                tab === id
                  ? "bg-secondary text-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              <Icon className="h-3.5 w-3.5 shrink-0" />
              <span className="max-w-28 truncate">{label}</span>
            </button>
          ))}
        </div>
      )}

      {/* The LIBRARIES: read-only rows over somebody else's catalogue. No actions at all — not
          a menu with everything greyed out — because nothing here is this project's to rename,
          move or delete. Opening a module is the one thing the tab is for, and the builder it
          opens says the rest. */}
      {tab === "libraries" ? (
        !lib ? (
          // No level has a module folder yet — not even the project's own. Ordinary for a
          // project that names only what the engine provides.
          <p className="p-2 text-xs text-muted-foreground">
            no module libraries this project can reach
          </p>
        ) : (
          <Tree<FileNode>
            nodes={lib.tree}
            activePath={activePath}
            // The NEAREST namespace row, open on arrival: a tab whose rows are all closed
            // folders says nothing about what is behind them, and the project's own modules
            // are what somebody opening this is most often after.
            reveal={lib.tree[0]?.path ?? null}
            isDisabled={isBinary}
            onOpen={(node) => {
              const file = lib.modules.get(node.path);
              if (file) onOpenLibraryModule?.(`${node.path}/${file}`);
            }}
            icon={(node, open) =>
              lib.modules.has(node.path) ? (
                <Boxes className="h-4 w-4 shrink-0" />
              ) : open ? (
                <FolderOpen className="h-4 w-4 shrink-0" />
              ) : (
                <Folder className="h-4 w-4 shrink-0" />
              )
            }
          />
        )
      ) : (
        <Tree<FileNode>
          nodes={folded}
          activePath={activePath}
          reveal={activeProject}
          rootPath={rootDir}
          rootLabel={projectName ?? rootDir}
          header={header}
          actions={actions}
          acceptsFileDrop={dragHasFiles}
          isDisabled={isBinary}
          // A module opens the BUILDER, on the panel — the screen that edits all three of its
          // files. Everything else opens as text, as before.
          onOpen={(node) => {
            const file = modules.get(node.path);
            if (file) onOpenModule?.(`${node.path}/${file}`);
            else onOpen(node.path);
          }}
          onDropTree={onUpload}
          onMove={onMove}
          icon={(node, open) =>
            isModule(node.path) ? (
              <Boxes className="h-4 w-4 shrink-0" />
            ) : node.dir ? (
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
      )}
    </>
  );
}
