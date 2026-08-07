// Studio.tsx — m9's shell: the project's file tree down the side, three views in the middle,
// and the repository's git in the header. Which view is showing is URL state (routes.ts), so a
// link to one survives a reload. See ../../docs/views.md.

import { redo, redoDepth, undo, undoDepth } from "@codemirror/commands";
import type { EditorView } from "@codemirror/view";
import { Button } from "@frediverse/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@frediverse/ui/dialog";
import { FileTree, type TreeNode } from "@frediverse/ui/file-tree";
import type { RankedEngine } from "@studio/engine-browser/probe";
import type { WebGraph } from "@studio/graph-model";
import { showToast, Toaster } from "@studio/project-shell/toast";
import { type HistoryDeps, runRedo, runUndo } from "@studio/project-shell/undo";
import type {
  FileNode,
  GitStatus,
  Hints,
  PublicEngine,
} from "@studio/web-protocol";
import { formatLatency } from "@studio/web-protocol/quality";
import {
  DoorOpen,
  GitBranch,
  Loader2,
  Pencil,
  Plug,
  RefreshCw,
  SlidersHorizontal,
  Workflow,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "./api";
import { DEFAULT_VIEW, type RouteState, type ViewId } from "./routes";
import { useViewRoute } from "./useViewRoute";
import { EditView } from "./views/EditView";
import { GraphView } from "./views/GraphView";
import { MixView } from "./views/MixView";

const VIEWS: { id: ViewId; label: string; icon: typeof Pencil }[] = [
  { id: "mix", label: "Mix", icon: SlidersHorizontal },
  { id: "edit", label: "Édition", icon: Pencil },
  { id: "graph", label: "Graphe", icon: Workflow },
];

/** How often the cheap change token is asked for. The expensive derivations hang off it. */
const POLL_MS = 1500;

export function Studio({
  engine,
  project,
  quit,
}: {
  engine: RankedEngine<PublicEngine>;
  /** The project this app was opened on, workspace-relative. */
  project: string;
  quit: () => void;
}) {
  const [view, setView] = useState<ViewId>(DEFAULT_VIEW);
  const [file, setFile] = useState<string | null>(null);
  useViewRoute(
    { view, file } as RouteState,
    useCallback((next: RouteState) => {
      setView(next.view);
      setFile(next.file);
    }, []),
  );

  // Undo/redo wiring. The live editor view (for Ctrl+Z arbitration), a re-read token so an
  // undo of the OPEN file shows through, and the confirm gate for a process step.
  const cmViewRef = useRef<EditorView | null>(null);
  const [editReload, setEditReload] = useState(0);
  const [undoConfirm, setUndoConfirm] = useState<{
    files: string[];
    label: string;
    resolve: (ok: boolean) => void;
  } | null>(null);
  const historyDeps = useMemo<HistoryDeps>(
    () => ({
      openFile: (p) => {
        setView("edit");
        setFile(p);
      },
      notify: (message, variant) => showToast({ message, variant }),
      confirmProcess: (files, label) =>
        new Promise<boolean>((resolve) =>
          setUndoConfirm({ files, label, resolve }),
        ),
      currentFile: () => file,
      onApplied: () => setEditReload((k) => k + 1),
    }),
    [file],
  );

  const [tree, setTree] = useState<FileNode[]>([]);
  const [graph, setGraph] = useState<WebGraph | null>(null);
  const [hints, setHints] = useState<Hints | null>(null);
  const [git, setGit] = useState<GitStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  // The token the derived views were last built from. Poll the token, refetch only on a move.
  const [rev, setRev] = useState("");

  const reload = useCallback(async () => {
    try {
      setTree(await api.tree());
      // Allowed to fail on its own: a project that will not compile still has files to edit,
      // and losing the tree with it would leave nothing to fix it WITH.
      try {
        setGraph(await api.graph());
        setHints(await api.hints());
      } catch {
        setGraph(null);
      }
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    let stop = false;
    const tick = async () => {
      try {
        const { rev: next } = await api.revision();
        if (stop || next === rev) return;
        setRev(next);
        await reload();
      } catch (e) {
        if (!stop) setError((e as Error).message);
      }
    };
    void tick();
    const t = setInterval(() => void tick(), POLL_MS);
    return () => {
      stop = true;
      clearInterval(t);
    };
  }, [rev, reload]);

  // It fetches from the remote, so it is asked for rarely — the same ten minutes l8 uses.
  useEffect(() => {
    const ask = () =>
      void api
        .gitStatus()
        .then(setGit)
        .catch(() => {});
    ask();
    const t = setInterval(ask, 10 * 60 * 1000);
    return () => clearInterval(t);
  }, []);

  // Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y — the project-wide undo/redo journal. Captured so it runs
  // before CodeMirror's keymap: while the focused editor has keystroke history it wins, then
  // the same key walks the journal. m9 has no command bar, so this is its only global shortcut.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (undoConfirm) return; // don't stack a second confirm
      if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
      const key = e.key.toLowerCase();
      if (key !== "z" && key !== "y") return;
      const isRedo = key === "y" || (key === "z" && e.shiftKey);
      const v = cmViewRef.current;
      if (view === "edit" && v?.hasFocus) {
        // Spend the buffer's own history first; once empty, fall through to the journal.
        const depth = isRedo ? redoDepth(v.state) : undoDepth(v.state);
        if (depth > 0) {
          e.preventDefault();
          e.stopPropagation();
          if (isRedo) redo(v);
          else undo(v);
          return;
        }
      } else {
        const t = e.target as HTMLElement | null;
        if (
          t &&
          (t.tagName === "INPUT" ||
            t.tagName === "TEXTAREA" ||
            t.isContentEditable)
        )
          return; // a plain input keeps native undo
      }
      e.preventDefault();
      e.stopPropagation();
      void (isRedo ? runRedo(historyDeps) : runUndo(historyDeps));
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [historyDeps, view, undoConfirm]);

  // `/tree` is ALREADY rooted at the open project — the file service walks `activeProject`,
  // not the workspace root (workspace.ts `tree()`), and l8 draws what it returns as it comes.
  //
  // This used to search the reply for a node named `<project>` and draw its children, which
  // was right when the route returned the whole workspace and became silently wrong when it
  // stopped: the project's own files are the TOP level now, so the search matched nothing and
  // the Édition view drew an empty tree for every project. Nothing failed — `?? []` is a
  // perfectly good empty tree — which is why it survived a typecheck and 21 tests.
  //
  // Paths stay workspace-relative (`set.m9/tracks/deckA.yaml`), which is what `read`/`write`
  // want, so nothing below has to re-root them.
  const nodes = tree as TreeNode[];

  return (
    <div className="flex h-full flex-col bg-background text-foreground">
      <header className="flex items-center gap-4 border-b px-4 py-2">
        <span className="text-lg font-semibold tracking-tight">m9</span>
        <span className="truncate text-xs text-muted-foreground">
          {project === "." ? "le dépôt" : project}
        </span>
        <nav className="flex items-center gap-1">
          {VIEWS.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              type="button"
              onClick={() => setView(id)}
              className={`flex items-center gap-2 rounded-md px-3 py-1.5 text-sm ${
                view === id
                  ? "bg-accent text-accent-foreground"
                  : "text-muted-foreground hover:bg-accent/50"
              }`}
            >
              <Icon className="h-4 w-4" />
              <span>{label}</span>
            </button>
          ))}
        </nav>

        <div className="ml-auto flex items-center gap-3 text-xs">
          {/* Ahead/behind on the WHOLE repository — a workspace is one clone, so this needs
              no project. Commit and pull are the two verbs a set actually needs. */}
          {git?.tracked && (
            <span className="flex items-center gap-1 text-muted-foreground">
              <GitBranch className="h-3.5 w-3.5" />
              {git.ahead ? `↑${git.ahead}` : ""}
              {git.behind ? `↓${git.behind}` : ""}
              {!git.ahead && !git.behind ? "à jour" : ""}
            </span>
          )}
          <button
            type="button"
            className="flex items-center gap-1 rounded px-2 py-1 hover:bg-accent/50"
            title="Récupérer les nouveautés du dépôt"
            onClick={() =>
              void api
                .gitPull()
                .then(() => reload())
                .catch((e: Error) => setError(e.message))
            }
          >
            <RefreshCw className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            className="flex items-center gap-1 rounded px-2 py-1 hover:bg-accent/50"
            title="Retour aux projets"
            onClick={quit}
          >
            <DoorOpen className="h-3.5 w-3.5" />
          </button>
        </div>
      </header>

      {error && (
        <code className="shrink-0 bg-muted px-4 py-1 text-xs text-red-400">
          {error}
        </code>
      )}

      <div className="flex min-h-0 flex-1">
        {/* No tree on Mix. It is not that Mix ignores the project — it plays this project's
            set list — but that the desk wants the width: two decks, the set between them, and
            the crossfader across the bottom. Editing the files is what Édition is for. */}
        {view !== "mix" && (
          <aside className="w-60 shrink-0 overflow-auto border-r p-2">
            <FileTree
              nodes={nodes}
              rootPath=""
              rootLabel={project === "." ? "PROJET" : project.split("/").pop()}
              activePath={file}
              reveal={file}
              onOpen={(n) => {
                if (!n.dir) {
                  setView("edit");
                  setFile(n.path);
                }
              }}
            />
          </aside>
        )}

        {/* The graph goes to Mix as well as to Graphe: the desk's bindings name modules by
            the chains' own names, and the graph is where a name becomes a plugin id. */}
        {view === "mix" && (
          <MixView engine={engine} project={project} graph={graph} />
        )}
        {view === "edit" && (
          <EditView
            path={file}
            hints={hints}
            onSaved={() => void reload()}
            onEditorView={(v) => {
              cmViewRef.current = v;
            }}
            reloadKey={editReload}
          />
        )}
        {view === "graph" && <GraphView graph={graph} />}
      </div>

      {/* The status bar. Which machine plays, and how good the link to it is — Q1/Q2/Q3 off a
          MEASURED latency. l8 and the médiathèque show the same line: it describes the
          session, not this screen. */}
      <footer className="flex shrink-0 items-center gap-3 border-t px-3 py-1 text-xs text-muted-foreground">
        <span className="flex min-w-0 items-center gap-1.5">
          <Plug className="h-3.5 w-3.5 shrink-0" />
          <span className="truncate">
            {engine.engine.hostname || engine.engine.id.slice(0, 8)}
          </span>
        </span>
        <span
          className={`whitespace-nowrap font-mono tabular-nums ${
            engine.latency?.quality === "Q1"
              ? "text-emerald-500"
              : engine.latency?.quality === "Q3"
                ? "text-amber-500"
                : ""
          }`}
        >
          {engine.latency ? formatLatency(engine.latency) : "latence inconnue"}
        </span>
        {!rev && <Loader2 className="h-3 w-3 animate-spin" />}
      </footer>

      {/* Confirm before undoing a process step — it restores a bounced audio file. */}
      <Dialog
        open={!!undoConfirm}
        onOpenChange={(o) => {
          if (!o && undoConfirm) {
            undoConfirm.resolve(false);
            setUndoConfirm(null);
          }
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Annuler le process ?</DialogTitle>
            <DialogDescription>
              {undoConfirm
                ? `${undoConfirm.files.join(", ") || undoConfirm.label} — le fichier bouncé sera restauré à son état précédent.`
                : ""}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="secondary"
              onClick={() => {
                undoConfirm?.resolve(false);
                setUndoConfirm(null);
              }}
            >
              Annuler
            </Button>
            <Button
              onClick={() => {
                undoConfirm?.resolve(true);
                setUndoConfirm(null);
              }}
            >
              Confirmer
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Toasts naming the file an undo/redo reverted. */}
      <Toaster />
    </div>
  );
}
