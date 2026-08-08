// Studio.tsx — v1's shell: the transport in the header, the Cut view (viewport over timeline)
// and the Édition view (the files behind it). Which view is showing is URL state (routes.ts),
// so a link to one survives a reload. See ../../docs/views.md.
//
// This component owns every WRITE. The timeline reports a finished drag and the editor reports
// a save; both land here, go through the file service, and come back as a recompiled document —
// so the picture on screen is always the compiler's answer and never the drag's guess.

import { FileTree, type TreeNode } from "@frediverse/ui/file-tree";
import { showToast, Toaster } from "@studio/project-shell/toast";
import { setVideoPlacementField } from "@studio/song/yaml/videoTrackFile";
import { formatClock } from "@studio/ui-timeline/ticks";
import type {
  FileNode,
  GitStatus,
  Hints,
  WebVideoProject,
} from "@studio/web-protocol";
import {
  DoorOpen,
  Film,
  GitBranch,
  Loader2,
  Pause,
  Pencil,
  Play,
  RefreshCw,
  SkipBack,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "./api";
import { DEFAULT_VIEW, type RouteState, type ViewId } from "./routes";
import { sceneOf } from "./scene";
import { useTransport } from "./transport";
import { useViewRoute } from "./useViewRoute";
import { EditView } from "./views/EditView";
import { type ClipEdit, Timeline } from "./views/Timeline";
import { Viewport } from "./views/Viewport";

const VIEWS: { id: ViewId; label: string; icon: typeof Pencil }[] = [
  { id: "cut", label: "Montage", icon: Film },
  { id: "edit", label: "Édition", icon: Pencil },
];

/** How often the cheap change token is asked for. The document hangs off it. */
const POLL_MS = 1500;

/**
 * `m:ss.mm`, the transport readout — finer than the ruler's, because it is a position and not
 * a scale, which is what the `step` argument says.
 *
 * The package's, not a second spelling of it: this app printed `0:05.00` here and `0:05` in
 * its own ruler, from two functions that disagreed only about how many decimals they felt
 * like. The shared one also handles a negative position, which this did not.
 */
const clock = (s: number): string => formatClock(s, 0.01);

export function Studio({
  project,
  quit,
}: {
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

  const [doc, setDoc] = useState<WebVideoProject | null>(null);
  const [tree, setTree] = useState<FileNode[]>([]);
  const [hints, setHints] = useState<Hints | null>(null);
  const [git, setGit] = useState<GitStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [rev, setRev] = useState("");
  const [editReload, setEditReload] = useState(0);

  const transport = useTransport(doc?.duration ?? 0);

  const reload = useCallback(async () => {
    try {
      setTree(await api.tree());
      // Allowed to fail on its own: a project that will not compile still has files to edit,
      // and losing the tree with it would leave nothing to fix it WITH. The compile's message
      // is shown instead of the picture, which is the only place it can be acted on.
      try {
        setDoc(await api.videoDoc());
        setError(null);
      } catch (e) {
        setDoc(null);
        setError((e as Error).message);
      }
      try {
        setHints(await api.hints());
      } catch {
        /* completions are a nicety; the editor works without them */
      }
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

  // Space toggles the transport, anywhere but in a field. The one global shortcut: v1 has no
  // command bar yet, and a cut you cannot start without reaching for the mouse is unusable.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== "Space" || e.ctrlKey || e.metaKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (
        t &&
        (t.tagName === "INPUT" ||
          t.tagName === "TEXTAREA" ||
          t.isContentEditable)
      )
        return;
      e.preventDefault();
      transport.toggle();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [transport]);

  // The scene the renderer draws. Rebuilt only when the DOCUMENT changes — not on every
  // playhead frame, which would tear the GL context down sixty times a second.
  const scene = useMemo(() => (doc ? sceneOf(doc) : null), [doc]);

  /**
   * Apply a finished timeline drag to the lane's own file.
   *
   * A surgical text rewrite of the YAML, not a re-serialisation: these files carry the
   * comments that document the format, and a round trip through the parser would delete every
   * one of them. `setVideoPlacementField` edits by REF for the same reason it does in the
   * editor — a placement that moved in the file between render and drop is still the one the
   * user grabbed.
   */
  const applyEdit = useCallback(
    async (e: ClipEdit) => {
      const path = `${project === "." ? "" : `${project}/`}video_tracks/${e.track}.yaml`;
      try {
        const { content } = await api.read(path);
        const next = setVideoPlacementField(content, e.ref, e.field, e.value);
        if (next === content) return; // no such placement — nothing to say, nothing to write
        await api.write(path, next);
        setEditReload((k) => k + 1);
        await reload();
      } catch (err) {
        showToast({ message: (err as Error).message, variant: "error" });
      }
    },
    [project, reload],
  );

  /** Show/hide a lane — `mute:` on a video track, which means hidden. A whole-file rewrite is
   *  wrong here for the reason above, so the line is toggled in place. */
  const toggleHidden = useCallback(
    async (trackId: string) => {
      const path = `${project === "." ? "" : `${project}/`}video_tracks/${trackId}.yaml`;
      try {
        const { content } = await api.read(path);
        const has = /^mute:\s*(true|false)\s*$/m.exec(content);
        const next = has
          ? content.replace(
              /^mute:\s*(true|false)\s*$/m,
              `mute: ${has[1] === "true" ? "false" : "true"}`,
            )
          : `mute: true\n${content}`;
        await api.write(path, next);
        setEditReload((k) => k + 1);
        await reload();
      } catch (err) {
        showToast({ message: (err as Error).message, variant: "error" });
      }
    },
    [project, reload],
  );

  // `/tree` is ALREADY rooted at the open project — the file service walks `activeProject`,
  // not the workspace root — so paths stay workspace-relative and nothing here re-roots them.
  const nodes = tree as TreeNode[];

  // The readers strip is drawn for a LANE file and nothing else.
  const editingLane = !!file && /video_tracks\/.+\.ya?ml$/.test(file);

  // Which media file each clip ref names — the one thing about a placement that the buffer
  // cannot answer, since `clips/<ref>.yaml` is a different file. Flattened across lanes: a ref
  // is a project-wide name, so two lanes placing it agree by construction.
  const clipSources = useMemo(() => {
    const out: Record<string, string> = {};
    for (const t of doc?.videoTracks ?? [])
      for (const c of t.clips) if (c.src) out[c.id] = c.src;
    return out;
  }, [doc]);

  return (
    <div className="flex h-full flex-col bg-background text-foreground">
      <header className="flex items-center gap-4 border-b px-4 py-2">
        <span className="text-lg font-semibold tracking-tight">v1</span>
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

        {/* The transport. Its own clock, not an engine's — a cut has no audio to agree with. */}
        <div className="flex items-center gap-1">
          <button
            type="button"
            className="rounded p-1.5 hover:bg-accent/50"
            title="Retour au début"
            onClick={() => transport.seek(0)}
          >
            <SkipBack className="h-4 w-4" />
          </button>
          <button
            type="button"
            className="rounded p-1.5 hover:bg-accent/50"
            title="Lecture / pause (Espace)"
            onClick={() => transport.toggle()}
          >
            {transport.playing ? (
              <Pause className="h-4 w-4" />
            ) : (
              <Play className="h-4 w-4" />
            )}
          </button>
          <span className="ml-1 font-mono text-xs tabular-nums text-muted-foreground">
            {clock(transport.playhead)}
            {doc ? ` / ${clock(doc.duration)}` : ""}
          </span>
        </div>

        <div className="ml-auto flex items-center gap-3 text-xs">
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
        <code className="shrink-0 whitespace-pre-wrap bg-muted px-4 py-1 text-xs text-red-400">
          {error}
        </code>
      )}

      <div className="flex min-h-0 flex-1">
        {/* No tree on Montage: the viewport wants the width, and picking a file is what
            Édition is for. */}
        {view === "edit" && (
          <aside className="w-60 shrink-0 overflow-auto border-r p-2">
            <FileTree
              nodes={nodes}
              rootPath=""
              rootLabel={project === "." ? "MONTAGE" : project.split("/").pop()}
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

        {view === "cut" && (
          // Viewport over timeline, the two halves of one screen: what is on frame, and where
          // that frame is. Nothing splits them because nothing else competes for the width.
          <div className="flex min-h-0 min-w-0 flex-1 flex-col">
            <div className="min-h-0 flex-1">
              <Viewport scene={scene} clock={transport.clock} />
            </div>
            <div className="h-64 shrink-0 border-t border-border">
              {doc && (
                <Timeline
                  project={doc}
                  playhead={transport.playhead}
                  onSeek={transport.seek}
                  selected={selected}
                  onSelect={setSelected}
                  onEdit={(e) => void applyEdit(e)}
                  onToggleHidden={(id) => void toggleHidden(id)}
                />
              )}
            </div>
          </div>
        )}

        {view === "edit" && (
          <EditView
            path={file}
            hints={hints}
            readersFor={editingLane}
            sources={clipSources}
            onSaved={() => void reload()}
            reloadKey={editReload}
          />
        )}
      </div>

      <footer className="flex shrink-0 items-center gap-3 border-t px-3 py-1 text-xs text-muted-foreground">
        <span>
          {doc
            ? `${doc.videoTracks.length} piste(s) · ${doc.viewport[0]}×${doc.viewport[1]} · ${doc.fps}fps`
            : "—"}
        </span>
        {!rev && <Loader2 className="h-3 w-3 animate-spin" />}
      </footer>

      <Toaster />
    </div>
  );
}
