// The workspace sidebar, on two tabs: the PROJECT you have open, and the shared module
// LIBRARIES it can name. The tree itself — expansion, right-click menu, inline prompts, file
// drops — is @frediverse/ui/file-tree, shared with calepin; this file is only what is k7's:
// pinned files, the "open project" button, and the module-folder actions.
// Why the second tab exists: apps/k7/frontend/docs/sharedModules.md.

import {
  type DroppedFile,
  FileTree as Tree,
  type TreeAction,
  type TreeTarget,
} from "@frediverse/ui/file-tree";
import {
  Boxes,
  File,
  FileAudio,
  Folder,
  FolderOpen,
  Layers,
  Library,
  Pin,
  Play,
  Workflow,
  X,
} from "@frediverse/ui/icons";
import { cn } from "@frediverse/ui/lib/utils";
import { showToast } from "@studio/project-shell/toast";
import {
  isLibraryFileOf,
  LIBRARY_FILE_FAMILIES,
  MODULE_SOURCES_DIR,
} from "@studio/song-schema/moduleTypes";
import type { ModuleLibrary } from "@studio/web-protocol";
import {
  type Ref,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import { acceptsFileDrop, dragPayload } from "../fileDrop";
import {
  fileFolderOf,
  type LibraryAssemblyRow,
  type LibraryChainRow,
  libraryOfPath,
  libraryTree,
  readOnlyPaths,
  rootOf,
} from "../libraryTree";
import { isVideoTrackFile } from "../projectPaths";
import { TrackIcon } from "../trackIcons";
import type { FileNode } from "../types";

/** The two actions that live nowhere else — the pins are this component's localStorage, the OS pickers its two hidden inputs. */
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
const MODULE_FILE = /^module\.(?:ya?ml|k7x)$/i;

/** A module is a folder that HOLDS a `module.yaml`, drawn as one row — recognised by its contents, never by its path. */
function moduleFileIn(node: FileNode): string | null {
  if (!node.dir) return null;
  return node.children?.find((c) => MODULE_FILE.test(c.name))?.name ?? null;
}

/** The tree with every module folded into a single row, plus the module file each opens at — the three files are a DEFINITION, not contents. */
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
        // A rack's audio is CONTENT rather than definition, so `sources/` survives the fold as the row's one child.
        const sources = n.children?.find(
          (c) => c.dir && c.name === MODULE_SOURCES_DIR,
        );
        // `dir` and `children` both dropped: the shared tree decides 'leaf' from those alone.
        const { dir: _dir, children: _children, ...leaf } = n;
        return sources
          ? ({ ...leaf, dir: true, children: [sources] } as FileNode)
          : (leaf as FileNode);
      }
      return n.children ? { ...n, children: walk(n.children) } : n;
    });
  return { tree: walk(nodes), modules };
}

/** Is this path inside the workspace's shared module library? Read-only here — editing one saves a project-local COPY (moduleFork.ts, server side). */
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
  levels,
  chains,
  onOpenChain,
  onOpenLibraryModule,
  assemblies,
  onOpenAssembly,
  onCreateModule,
  onRenameLibraryEntry,
  onDeleteLibraryEntry,
  onMoveLibraryModule,
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
  /** A module row was clicked — the path is its `module.yaml`, which is what the builder takes. */
  onOpenModule?: (moduleFile: string) => void;
  onOpenProject: (path: string) => void;
  // Drop local files into `dir`, FOLDERS included: each carries the path it sat at, a module being a folder of three. EditorTab uploads.
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
  onCreateNode?: (path: string) => void;
  /** The module levels this project can reach, nearest first — the RAW answer, a row's shape carrying neither its level nor its writability. */
  levels?: ModuleLibrary[];
  /** The library's CHAINS, listed in the same tab — one row each, opening the chains builder. */
  chains?: readonly LibraryChainRow[];
  /** A chain row was opened: its ref, for the builder. */
  onOpenChain?: (ref: string, node?: string) => void;
  /** A module row in a LIBRARY was clicked — the same path space, a different callback, since it opens read-only (../libraryTree.ts). */
  onOpenLibraryModule?: (moduleFile: string) => void;
  /** The library's ASSEMBLY templates, under the repository row beside its modules and chains. */
  assemblies?: readonly LibraryAssemblyRow[];
  /** An assembly row was opened: the `assembly.yaml` the builder opens, and its folder. */
  onOpenAssembly?: (file: string, folder: string) => void;
  /** Make an empty module in a library: `root` is the level's path as GIVEN here, `rel` the module's path under it, never built from a name. */
  onCreateModule?: (root: string, rel: string) => void;
  /** Rename or delete an entry of a LIBRARY — live for every account at once, as a Save is. */
  onRenameLibraryEntry?: (path: string, name: string) => void;
  onDeleteLibraryEntry?: (path: string, isDir: boolean) => void;
  /** A module dragged onto another folder of its library; the host moves it and repoints its refs, live for every account. */
  onMoveLibraryModule?: (path: string, toDir: string) => void;
  ref?: Ref<FileTreeHandle>;
}) {
  // Which of the two trees is on screen — client-only and not URL state, being disclosure and nothing else.
  const [tab, setTab] = useState<"project" | "libraries">("project");

  // Pinned files: client-only state in localStorage per project, re-loaded on a project switch so pins can't cross.
  const pinKey = `k7:pins:${projectName || activeProject || "."}`;
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

  // The file PICKER, worth a second way in — two inputs, because `webkitdirectory` is a property of the INPUT and draws a different dialog.
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

  // The three the right-click menu offers and nothing else can, rebuilt every render so `togglePin` reads the CURRENT pins.
  useImperativeHandle(
    ref,
    (): FileTreeHandle => ({
      togglePin,
      pickFiles,
      pickFolder,
    }),
  );

  // A pick, in the shape a drop already arrives in: `webkitRelativePath` carries the folder for a directory pick and is '' otherwise.
  const uploadPicked = (input: HTMLInputElement) => {
    const files = Array.from(input.files ?? []).map((file) => ({
      path: file.webkitRelativePath || file.name,
      file,
    }));
    if (files.length) onUpload(pickInto.current, files);
    input.value = ""; // so the same pick can be repeated
  };

  // Folded before anything reads it — a module lives at `@workspace` or `@k7-core` now, never here.
  const { tree: folded, modules } = useMemo(() => foldModules(tree), [tree]);
  const isModule = (path: string) => modules.has(path);

  // The same fold over the LIBRARIES, so a shared module is one row that opens the builder (see libraryTree.ts).
  const lib = useMemo(() => {
    const rows = libraryTree(levels ?? [], chains ?? [], assemblies ?? []);
    return rows.length ? foldModules(rows) : null;
  }, [levels, chains, assemblies]);
  // An assembly row by its path: a leaf that opens the assembly builder rather than an editor.
  const assemblyByPath = useMemo(
    () => new Map((assemblies ?? []).map((a) => [a.path, a])),
    [assemblies],
  );
  // A chain row by its path, answered before the module lookup — the value is the chain to open, and the node to land on when the row was one.
  const chainByPath = useMemo(() => {
    const m = new Map<string, { ref: string; node?: string }>();
    for (const c of chains ?? []) {
      m.set(c.path, { ref: c.ref });
      for (const n of c.nodes ?? [])
        m.set(`${c.path}/nodes/${n}`, { ref: c.ref, node: n });
    }
    return m;
  }, [chains]);
  // What may not be touched — `@engine`, whose rows are a vocabulary and not files.
  const frozen = useMemo(() => readOnlyPaths(levels ?? []), [levels]);

  /** The Libraries tab's own menu: make a folder, make a module — on any FOLDER of a writable level, named by its path UNDER the clicked row. */
  const libraryActions = useMemo((): TreeAction<FileNode>[] => {
    const all = levels ?? [];
    // `rootOf` already refuses a read-only level, so belonging to a writable one IS the test.
    const writableDir = (t: TreeTarget<FileNode>) =>
      t.dir && !!rootOf(all, t.path);
    // Anything INSIDE a library's families: never the repository row nor `modules/`, `chains/`, `assemblies/` themselves.
    const libraryEntry = (t: TreeTarget<FileNode>) =>
      !t.root &&
      !frozen.has(t.path) &&
      !!libraryOfPath(t.path) &&
      t.path.split("/").filter(Boolean).length >= 4;
    return [
      {
        key: "new-library-folder",
        label: "New folder…",
        when: (t) => !!onCreateFolder && writableDir(t),
        prompt: {
          placeholder: "delay",
          submit: "Create",
          hint: (t, value) => `${t.path}/${value.trim() || "…"}`,
        },
        run: (t, name) => onCreateFolder?.(t.path, name),
      },
      {
        key: "new-module",
        label: "New module…",
        when: (t) => !!onCreateModule && writableDir(t),
        prompt: {
          placeholder: "audio/my-module",
          submit: "Create",
          hint: (t, value) =>
            `${t.path}/${value.trim() || "<type>/<name>"}/module.yaml`,
        },
        run: (t, value) => {
          const root = rootOf(all, t.path);
          if (!root || !value.trim()) return;
          // The path under the LEVEL, which is what the service validates: at least a type folder and a name.
          const under =
            t.path === root.path ? "" : t.path.slice(root.path.length + 1);
          onCreateModule?.(
            root.path,
            `${under ? `${under}/` : ""}${value.trim()}`,
          );
        },
      },
      {
        key: "rename-library-entry",
        label: "Rename…",
        when: (t) => !!onRenameLibraryEntry && libraryEntry(t),
        prompt: {
          initial: (t) => t.name,
          submit: "Rename",
          // A module's name is its REF: say what the rename costs before it is made.
          hint: (t) =>
            lib?.modules.has(t.path)
              ? "Chains naming this module by its old ref will no longer find it"
              : "Published to the library at once",
        },
        run: (t, name) => {
          if (name !== t.name) onRenameLibraryEntry?.(t.path, name);
        },
      },
      {
        key: "delete-library-entry",
        label: "Delete",
        danger: true,
        when: (t) => !!onDeleteLibraryEntry && libraryEntry(t),
        // A module is a folder drawn as a leaf, as in the project tab.
        run: (t) =>
          onDeleteLibraryEntry?.(t.path, t.dir || !!lib?.modules.has(t.path)),
      },
    ];
  }, [
    levels,
    frozen,
    lib,
    onCreateFolder,
    onCreateModule,
    onRenameLibraryEntry,
    onDeleteLibraryEntry,
  ]);

  const menuEnabled = !!onRename && !!onDelete;
  // A module row is a leaf, EXCEPT a rack, which kept its `sources/`; the folded set answers for both.
  const isModuleTarget = (t: TreeTarget<FileNode>) =>
    !t.root && isModule(t.path);
  // A plain folder: a rack's row is one to the shared tree, and must not offer a folder's actions —
  // its contents are the module's, and `sources/` is the row that takes a drop.
  const isPlainDir = (t: TreeTarget<FileNode>) => t.dir && !isModule(t.path);
  // Both resolve the module inside the ACTIVE PROJECT, so neither reaches a shared one (see moduleFork.ts).
  const isLocalModuleTarget = (t: TreeTarget<FileNode>) =>
    isModuleTarget(t) && !isShared(t.path);

  const actions: TreeAction<FileNode>[] = [
    {
      key: "upload",
      label: "Upload files…",
      when: (t) => isPlainDir(t) && !isShared(t.path),
      run: (t) => pickFiles(t.path),
    },
    {
      key: "upload-folder",
      label: "Upload a folder…",
      when: (t) => isPlainDir(t) && !isShared(t.path),
      run: (t) => pickFolder(t.path),
    },
    {
      key: "new-file",
      label: "New file…",
      when: (t) =>
        isPlainDir(t) && !t.root && !isShared(t.path) && !!onCreateProjectFile,
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
      // Same reach as 'New file…': inside a folder, never at the root, where a loose entry would sit among the projects.
      when: (t) =>
        isPlainDir(t) && !t.root && !isShared(t.path) && !!onCreateFolder,
      prompt: {
        placeholder: "folder-name",
        submit: "Create",
        hint: (t, value) => `${t.path}/${value.trim() || "…"}`,
      },
      run: (t, name) => onCreateFolder?.(t.path, name),
    },
    {
      // No prompt, and no ellipsis with it: a node is named `<module>_<n>` by the service (@studio/song's instanceName.ts).
      key: "new-node",
      label: "New node",
      when: (t) => isLocalModuleTarget(t) && !!onCreateNode,
      run: (t) => onCreateNode?.(t.path),
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
      // A module is a DIRECTORY the tree draws as a leaf, so `t.dir` alone would leave the folder behind.
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
            {/* Folder + filename, so two pinned `tracks/*.yaml` are told apart; the full path is the tooltip. */}
            <span className="truncate">{p.split("/").slice(-2).join("/")}</span>
          </button>
          <button
            type="button"
            onClick={() => togglePin(p)}
            title="unpin"
            aria-label={`unpin ${p.split("/").pop()}`}
            className="shrink-0 rounded p-0.5 text-muted-foreground/50 opacity-0 hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100 group-focus-within:opacity-100 [@media(hover:none)]:opacity-100"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      ))}
    </div>
  );

  return (
    <>
      {/* The two pickers, hidden because they are clicked programmatically; `webkitRelativePath` is empty for a file pick, so ONE mapping serves both. */}
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

      {/* Two trees, one sidebar, drawn only for a shell that has libraries: one lonely tab is a control that decides nothing. */}
      {levels !== undefined && (
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

      {/* The LIBRARIES: read-only rows with no actions at all, since nothing here is this project's to rename or delete (docs/sharedModules.md). */}
      {tab === "libraries" ? (
        !lib ? (
          // Only reachable before the first answer has arrived: `@workspace` and `@engine` are always offered once it has.
          <p className="p-2 text-xs text-muted-foreground">
            reading the module libraries…
          </p>
        ) : (
          <Tree<FileNode>
            nodes={lib.tree}
            activePath={activePath}
            /* The one thing this tab writes, on the NAMESPACE row only, in one shape `<type>/<name>` (docs/sharedModules.md). */
            actions={libraryActions}
            // The NEAREST namespace row, open on arrival: a tab of closed folders says nothing about what is behind them.
            reveal={lib.tree[0]?.path ?? null}
            // A read-only level's rows are greyed: they name a plugin the engine reports, with no file behind them to open.
            isDisabled={(n) => isBinary(n) || frozen.has(n.path)}
            // A MODULE row drags onto another folder of its library: a move, its refs following it (packages/song/docs/moduleMove.md).
            onMove={onMoveLibraryModule}
            canMove={(n) =>
              lib.modules.has(n.path) &&
              !!libraryOfPath(n.path) &&
              !frozen.has(n.path)
            }
            // A file dropped on a library's `samples/`, `irs/` or `models/` is UPLOADED there.
            acceptsFileDrop={dragHasFiles}
            onDropTree={(dir, files) => {
              const family = fileFolderOf(dir);
              if (!family)
                return void showToast({
                  message:
                    "drop files on a library's samples/, irs/ or models/ folder",
                  variant: "error",
                });
              const taken = files.filter((f) =>
                isLibraryFileOf(family, f.path),
              );
              if (taken.length < files.length)
                showToast({
                  message: `${files.length - taken.length} file(s) left out — a library's ${family}/ takes ${LIBRARY_FILE_FAMILIES[family].join(", ")}`,
                  variant: "error",
                });
              if (taken.length) onUpload(dir, taken);
            }}
            onOpen={(node) => {
              // A CHAIN first: a chain file, or a folder chain the module lookup below cannot tell from a module.
              const chain = chainByPath.get(node.path);
              if (chain) {
                onOpenChain?.(chain.ref, chain.node);
                return;
              }
              const assembly = assemblyByPath.get(node.path);
              if (assembly) {
                onOpenAssembly?.(assembly.file, assembly.path);
                return;
              }
              const file = lib.modules.get(node.path);
              if (file) onOpenLibraryModule?.(`${node.path}/${file}`);
            }}
            // A chain FOLDER opens on its name while its chevron still folds — see docs/chainsBuilder.md.
            // So does a rack, which kept its `sources/` and is therefore a folder row too.
            opensOnName={(n) =>
              chainByPath.has(n.path) || lib.modules.has(n.path)
            }
            icon={(node, open) =>
              // A chain wears the builder's own glyph, so the row and the screen it opens are recognisably one thing.
              chainByPath.get(node.path)?.node === undefined &&
              chainByPath.has(node.path) ? (
                <Workflow className="h-4 w-4 shrink-0" />
              ) : lib.modules.has(node.path) ? (
                <Boxes className="h-4 w-4 shrink-0" />
              ) : assemblyByPath.has(node.path) ? (
                <Layers className="h-4 w-4 shrink-0" />
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
          // A module opens the BUILDER, on the panel — the screen that edits all three of its files; everything else opens as text.
          onOpen={(node) => {
            const file = modules.get(node.path);
            if (file) onOpenModule?.(`${node.path}/${file}`);
            else onOpen(node.path);
          }}
          // A rack keeps its `sources/`, so its row is a folder: the chevron folds, the name opens the builder.
          opensOnName={(n) => isModule(n.path)}
          onDropTree={onUpload}
          onMove={onMove}
          icon={(node, open) =>
            isModule(node.path) ? (
              <Boxes className="h-4 w-4 shrink-0" />
            ) : // A picture lane wears the camcorder here too: a lane is a lane whichever surface is drawing it.
            isVideoTrackFile(node.path) ? (
              <TrackIcon name="" video className="h-4 w-4 shrink-0" />
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
