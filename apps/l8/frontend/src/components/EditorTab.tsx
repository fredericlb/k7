// EditorTab.tsx — the project-file editor: a CodeMirror pane with schema-aware completion
// and Save, plus a breadcrumb and (when there's room) a file tree. ONE instance serves
// both layouts — a second would fork the open file, the dirty flag and the undo history.
// Saving does NOT format: the writers emit canonical YAML, and reflowing a hand-edited
// file is exactly what this format was chosen to avoid.

import { redo, redoDepth, undo, undoDepth } from "@codemirror/commands";
import type { EditorView } from "@codemirror/view";
import { Button } from "@frediverse/ui/button";
import type { DroppedFile } from "@frediverse/ui/file-tree";
import { cn } from "@frediverse/ui/lib/utils";
import { showToast } from "@studio/project-shell/toast";
import { parsePosition } from "@studio/song/timecode";
import {
  FileText,
  FolderTree,
  Grid3x3,
  LayoutGrid,
  Piano,
  Save,
  TriangleAlert,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { api } from "../api";
import { useDiskSync } from "../hooks/useDiskSync";
import {
  fileStem,
  isClipFile,
  isModuleFile,
  isRackModuleFile,
  isSeqFile,
  isTrackFile,
  isVideoTrackFile,
  moduleFileOf,
  readScalarField,
} from "../projectPaths";
import type { SeqView } from "../sequenceEdit";
import type {
  Diagnostic,
  FileContent,
  FileNode,
  Hints,
  PreviewReq,
  WebClip,
  WebProject,
} from "../types";
import { useIsMobile } from "../useIsMobile";
import {
  listVideoPlacements,
  setVideoPlacementField,
} from "../videoPlacements";
import { Breadcrumb } from "./Breadcrumb";
import { EditorPane } from "./EditorPane";
import type { EditTarget } from "./EditorPanel";
import { FileTree } from "./FileTree";
import type { MinimapItem } from "./Minimap";
import { SeqGrid } from "./SeqGrid";
import { UploadProgress } from "./UploadProgress";
import type { VideoReader } from "./VideoReadersStrip";

// The handle the shell reaches the editor through: `open` opens a file, `files` is what `file` completes against.
// The `local*` methods expose the live CodeMirror buffer so the shell can arbitrate Ctrl+Z between the
// editor's own keystroke history and the project-wide undo journal — see App.tsx's onKey.
export interface EditorHandle {
  open: (path: string) => void;
  files: () => string[];
  currentFile: () => string | null;
  editorFocused: () => boolean;
  localUndoDepth: () => number;
  localRedoDepth: () => number;
  localUndo: () => boolean;
  localRedo: () => boolean;
}

// The popin's three views of a sequence, in the order they read: the file, then its notes twice.
const SEQ_TABS = [
  { id: "text", label: "Text", icon: FileText, title: "the file itself" },
  {
    id: "roll",
    label: "Roll",
    icon: Piano,
    title: "its notes as a piano roll",
  },
  {
    id: "tracker",
    label: "Tracker",
    icon: Grid3x3,
    title: "its notes as a tracker (arrows move, keys type notes)",
  },
] as const;

// Flatten the tree to openable text paths — binaries can't be shown, which also drops .dawproject archives.
function textFiles(nodes: FileNode[]): string[] {
  const out: string[] = [];
  const walk = (ns: FileNode[]): void => {
    for (const n of ns) {
      if (n.dir) {
        if (n.children) walk(n.children);
      } else if (n.kind !== "binary") out.push(n.path);
    }
  };
  walk(nodes);
  return out;
}

// Which kind of file is open — all of it lives in projectPaths.ts; see its header for the bug that put it there.

// The open file's path relative to the PROJECT (the tree and api speak workspace-relative).
function toProjectRelative(
  filePath: string,
  activeProject: string | null,
): string {
  const p = filePath.replace(/\\/g, "/");
  const ap = (activeProject ?? "").replace(/\\/g, "/").replace(/\/+$/, "");
  return ap && ap !== "." && (p === ap || p.startsWith(`${ap}/`))
    ? p.slice(ap.length + 1)
    : p;
}

// Resolve a gutter source where the COMPILER puts it: a rack's sits beside its file, a clip's at the project root.
function resolveGutterSource(
  source: string,
  filePath: string,
  activeProject: string | null,
): string {
  if (!source || /^([A-Za-z]:[\\/]|[\\/])/.test(source)) return source;
  const projRel = toProjectRelative(filePath, activeProject);
  if (!isRackModuleFile(projRel)) return source;
  const slash = projRel.lastIndexOf("/");
  return slash > 0 ? `${projRel.slice(0, slash)}/${source}` : source;
}

// clips/ holds audio and video: the kind comes off the source extension, read with readScalarField because
// YAML doesn't quote — the old regex demanded `source: "…"` and silently lost every converted clip's waveform.
const VIDEO_EXT = /\.(mp4|mov|m4v|webm|mkv)$/i;
const isAudioClipFile = (text: string): boolean => {
  const src = readScalarField(text, "source");
  return !!src && !VIDEO_EXT.test(src);
};

/**
 * The clip's `from`/`to` as a window to draw over its waveform, or undefined when it trims nothing.
 *
 * Read from the TEXT rather than the compiled clip, so the shading follows what you are typing — the same reason
 * the source is read this way. It reuses the slice-window overlay: a clip's window and a rack slice's are the
 * same picture of the same thing, seconds into one file.
 *
 * `tempo`/`num`/`den` because an edge may be written either way (see AudioClipSchema): a number is seconds, a
 * timecode is a POSITION in the file and needs the project's grid to become one. Without this the shading
 * simply never appeared for a timecode, which reads as the field being ignored.
 */
function clipWindow(
  text: string,
  tempo: number,
  num: number,
  den: number,
): { symbol: string; from: number; to: number }[] | undefined {
  const edge = (field: string): number | null => {
    const raw = readScalarField(text, field);
    if (raw == null || raw === "") return null;
    const n = Number(raw);
    if (Number.isFinite(n)) return n >= 0 ? n : null; // already seconds
    try {
      return (parsePosition(raw, num, den) * 60) / tempo;
    } catch {
      return null; // half-typed timecode — draw nothing rather than jump about
    }
  };
  const from = edge("from");
  const to = edge("to");
  if (from == null && to == null) return undefined;
  // An unwritten edge is the file's own — `to` is filled in by the view, which is the only place the duration is
  // known. A backwards pair is refused by the schema; here it would just draw nothing, so it is left to say so.
  return [
    { symbol: "clip", from: from ?? 0, to: to ?? Number.POSITIVE_INFINITY },
  ];
}

// The rack module a sequence names via use_rack, so a slice rack can dock its source waveform.
const findUseRack = (text: string): string | null =>
  readScalarField(text, "use_rack");

const EMPTY_HINTS: Hints = {
  baseModules: [],
  ioSinks: [],
  modules: [],
  tracks: [],
  channels: [],
  clips: [],
  videoTracks: [],
  sequences: [],
  chains: [],
  moduleAssets: {},
  paramsByBase: {},
  paramMetaByBase: {},
  racks: {},
  keywords: [],
  pluginNames: {},
  paths: {},
  projectRoot: "",
  media: {},
};

export function EditorTab({
  active,
  showTree,
  popin,
  reloadKey,
  activeProject,
  projectName,
  vimMode,
  onOpenProject,
  onImportProject,
  onChanged,
  setStatus,
  onEditTarget,
  onOpenItem,
  onOpenBuilder,
  diagnostics,
  ref,
}: {
  active: boolean;
  // Render the file-tree sidebar. On whenever the editor pane is on screen in the layout, and
  // OFF in the popin — that one is a single file a command already named. See docs/shell.md.
  showTree: boolean;
  // Popped out over the shell, on one file a command named. The mirror of `showTree` today, but
  // not the same question — this one asks "is this a glance at one thing", and it is what puts a
  // sequence's grids on tabs here and nowhere else.
  popin: boolean;
  reloadKey: number;
  activeProject: string | null;
  // The whole project's load findings; the editor draws the open file's inline. Refreshed by App's 2s vet poll.
  diagnostics: Diagnostic[];
  projectName: string | null; // the song's name — `activeProject` is "." for a lone project
  // Vim mode is a global preference living in App, toggled from the settings screen; here it only drives EditorPane.
  vimMode: boolean;
  onOpenProject: (path: string) => void;
  onImportProject: (path: string) => void; // a .dawproject or .als was clicked
  onChanged: () => void;
  setStatus: (s: string) => void;
  onEditTarget: (t: EditTarget | null) => void; // the open sequence, for the Editor panel
  onOpenItem: (item: MinimapItem | null) => void; // the open clip/track, for the minimap
  // Open the shared module builder over the shell, on the MODULE file of the trio — plus which of the three
  // was clicked, so its code pane opens on the file the click pointed at.
  onOpenBuilder: (path: string, pane: "module" | "panel" | "presets") => void;
  ref?: React.Ref<EditorHandle>;
}) {
  const [tree, setTree] = useState<FileNode[]>([]);
  // Mobile only: the tree is a drawer over the editor, closed by default — the editor is the point of this pane.
  const isMobile = useIsMobile();
  const [treeOpen, setTreeOpen] = useState(false);
  const [hints, setHints] = useState<Hints>(EMPTY_HINTS);
  const [file, setFile] = useState<FileContent | null>(null);
  // The live CodeMirror view, forwarded by EditorPane — read for the Ctrl+Z arbitration below.
  const cmViewRef = useRef<EditorView | null>(null);
  const [dirty, setDirty] = useState(false);
  // Which tab of a sequence is open in the POPIN — its text, or one of the two note grids.
  // Only there: fullscreened, this pane is the text editor and the grids have their own home
  // in the main view (`sequence edit roll|tracker`, see docs/noteGrids.md).
  const [tab, setTab] = useState<"text" | SeqView>("text");
  // The audio clip this clips/*.yaml links to: it docks at the bottom of the CODE pane, not the shared panel.
  const [audioClip, setAudioClip] = useState<{
    project: WebProject;
    clip: WebClip;
    // Span the whole source, not the placed region — what a clips/*.yaml shows (see WaveformView).
    whole?: boolean;
    // Slice-rack windows to overlay on the waveform, when the open sequence's use_rack is a slice rack.
    sliceRanges?: { symbol: string; from: number; to: number }[];
  } | null>(null);
  // When the OPEN file is a slice-rack module.yaml: its source, driving inline per-symbol waveform editors.
  const [sliceRack, setSliceRack] = useState<{ source: string } | null>(null);
  // The last sound auditioned from a gutter ▶, docked under the editor until dismissed or the file changes.
  const [preview, setPreview] = useState<{
    project: WebProject;
    clip: WebClip;
    sliceRanges?: { symbol: string; from: number; to: number }[];
  } | null>(null);
  // The per-placement video readers for an open video_tracks/*.yaml — see components/VideoReadersStrip.tsx.
  const [videoReaders, setVideoReaders] = useState<VideoReader[] | null>(null);

  // Point the minimap at the open file's entity: a clip or sequence highlights a clip, a track file a track.
  useEffect(() => {
    const p = (file?.path ?? "").replace(/\\/g, "/");
    const stem = fileStem(p);
    const item: MinimapItem | null =
      !file || file.binary
        ? null
        : isClipFile(p) || isSeqFile(p)
          ? { kind: "clip", id: stem }
          : isTrackFile(p)
            ? { kind: "track", id: stem }
            : null;
    onOpenItem(item);
  }, [file, onOpenItem]);

  // A new file — drop the previous preview so a stale waveform doesn't linger.
  useEffect(() => {
    setPreview(null);
  }, [file?.path]);

  // Build one reader per placement, re-running on every buffer change so the strip follows typing and Set From/To.
  useEffect(() => {
    const path = (file?.path ?? "").replace(/\\/g, "/");
    if (!file || file.binary || !isVideoTrackFile(path)) {
      setVideoReaders(null);
      return;
    }
    const placements = listVideoPlacements(file.content);
    if (!placements.length) {
      setVideoReaders([]);
      return;
    }
    let cancelled = false;
    void api
      .projectDoc()
      .then((proj) => {
        if (cancelled) return;
        const byId = new Map<string, string>();
        for (const t of proj.videoTracks)
          for (const c of t.clips) if (c.src) byId.set(c.id, c.src);
        const readers: VideoReader[] = placements.map((p) => ({
          ref: p.ref,
          src: byId.get(p.ref) ?? "",
          sourceFrom: p.sourceFrom,
          length: p.length,
        }));
        setVideoReaders(readers);
      })
      .catch(() => {
        if (!cancelled) setVideoReaders([]);
      });
    return () => {
      cancelled = true;
    };
  }, [file, hints]);

  // Audition from a gutter ▶: play it AND fetch a waveform to dock. Playback happens regardless of the fetch.
  const previewSound = useCallback(
    async (req: PreviewReq) => {
      try {
        const proj = await api.projectDoc();
        const root = (hints.projectRoot || "").replace(/[\\/]+$/, "");
        const abs = (rel: string) =>
          root ? [root, ...rel.split(/[\\/]/)].filter(Boolean).join("/") : rel;
        const base = (rel: string) => rel.split(/[\\/]/).pop() || rel;
        if (req.kind === "clip") {
          setPreview({
            project: proj,
            clip: {
              id: req.clip,
              type: "audio",
              name: req.clip,
              start: 0,
              length: 0,
              notes: [],
            },
          });
        } else {
          const id = abs(req.source);
          const clip: WebClip = {
            id,
            type: "audio",
            name: base(req.source),
            start: 0,
            length: 0,
            notes: [],
          };
          setPreview({
            project: proj,
            clip,
            sliceRanges:
              req.kind === "slice"
                ? [{ symbol: "▶", from: req.from, to: req.to }]
                : undefined,
          });
        }
      } catch {
        /* the sound still played; only the waveform preview is unavailable */
      }
    },
    [hints.projectRoot],
  );

  // A gutter ▶ handler with a STABLE identity: an inline arrow would reconfigure CodeMirror on every keystroke.
  const filePath = file?.path ?? "";

  /**
   * A sequence opens on its NOTES. In the popin, the roll is what you came for — a command sent
   * the editor here naming this sequence, and its text is one tab away.
   *
   * Keyed on the PATH, so each newly opened file is answered for what it is rather than
   * inheriting the last one's tab. The cost is that opening a second sequence while you were in
   * Tracker returns you to Roll; "the first view is the roll" is the rule that asks for it.
   *
   * A LAYOUT effect, so the swap lands before the paint: with a passive one the text editor
   * shows for a frame and is replaced, which reads as a flicker on every sequence you open.
   */
  useLayoutEffect(() => {
    setTab(filePath && isSeqFile(filePath) ? "roll" : "text");
  }, [filePath]);

  // The open file's findings, matched by the project-relative path the loader reports; memoized so typing is cheap.
  const fileDiagnostics = useMemo<Diagnostic[]>(() => {
    if (!filePath) return [];
    const rel = toProjectRelative(filePath, activeProject);
    return diagnostics.filter((d) => d.file === rel);
  }, [diagnostics, filePath, activeProject]);
  const handlePreview = useCallback(
    (req: PreviewReq) => {
      // A rack's source is a filename beside the module file — resolve it project-relative so both ends find it.
      const r: PreviewReq =
        req.kind === "clip"
          ? req
          : {
              ...req,
              source: resolveGutterSource(req.source, filePath, activeProject),
            };
      void api.preview(r).catch((e) => {
        setStatus(`preview error: ${(e as Error).message}`);
      });
      // A slice-rack file already shows every slice inline, so auditioning shouldn't also dock a redundant waveform.
      if (!sliceRack) void previewSound(r);
    },
    [previewSound, setStatus, filePath, activeProject, sliceRack],
  );

  // Feed the shared Editor panel the SOURCE behind the open file, so the bottom pane shows what you're looking at.
  useEffect(() => {
    if (!active) return;
    if (!file || file.binary) {
      onEditTarget(null);
      setAudioClip(null);
      setSliceRack(null);
      return;
    }
    const p = file.path.replace(/\\/g, "/");
    let cancelled = false;
    const stem = fileStem(p);

    // Inline slice editors, set idempotently: a fresh {source} each keystroke would reconfigure the whole editor.
    let inlineSliceSource: string | null = null;
    if (isRackModuleFile(p)) {
      const mod =
        p
          .replace(/\/module\.ya?ml$/i, "")
          .split("/")
          .pop() ?? "";
      const rk = hints.racks[mod];
      if (rk?.rackType === "slice" && rk.source) inlineSliceSource = rk.source;
    }
    setSliceRack((prev) =>
      (prev?.source ?? null) === inlineSliceSource
        ? prev
        : inlineSliceSource
          ? { source: inlineSliceSource }
          : null,
    );

    if (isSeqFile(p)) {
      // A sequence driving a SLICE rack docks that rack's source waveform, with each symbol's [from,to] drawn on it.
      const useRack = findUseRack(file.content);
      const rack = useRack ? hints.racks[useRack] : undefined;
      if (rack && rack.rackType === "slice" && rack.source) {
        const source = rack.source;
        const ranges = rack.symbols
          .filter((s) => s.from != null && s.to != null)
          .map((s) => ({ symbol: s.symbol, from: s.from!, to: s.to! }));
        void api
          .projectDoc()
          .then((proj) => {
            if (cancelled) return;
            const clip: WebClip = {
              id: source,
              type: "audio",
              name: source,
              start: 0,
              length: 0,
              notes: [],
            };
            setAudioClip({ project: proj, clip, sliceRanges: ranges });
            onEditTarget(null);
          })
          .catch(() => {
            if (!cancelled) {
              setAudioClip(null);
              onEditTarget({ kind: "seq", path: p, content: file.content });
            }
          });
        return () => {
          cancelled = true;
        };
      }
      // Otherwise: notes are inline in the sequence file — hand the panel the content.
      setAudioClip(null);
      onEditTarget({ kind: "seq", path: p, content: file.content });
      return;
    }

    if (isClipFile(p)) {
      // The clip as the engine sees it. A placed clip keeps its real start/length; an unplaced one previews at bar 1.
      const audio = isAudioClipFile(file.content);
      void api
        .projectDoc()
        .then((proj) => {
          if (cancelled) return;
          const placed = proj.tracks
            .flatMap((t) => t.clips)
            .find((c) => c.id === stem);
          const clip: WebClip | null =
            placed ??
            (audio
              ? {
                  id: stem,
                  type: "audio",
                  name: stem,
                  start: 0,
                  length: 0,
                  notes: [],
                }
              : null); // a video clip (or no source) — no waveform to show
          if (clip && clip.type === "audio") {
            // Audio docks in THIS pane, not the shared panel — clear any panel target so the two can't both claim it.
            // `whole`: the file you have open IS the material, so the strip fits the source end to end rather than
            // the span some track placed it with — which is the only way `from`/`to` can be read against it.
            setAudioClip({
              project: proj,
              clip,
              whole: true,
              sliceRanges: clipWindow(
                file.content,
                proj.tempo || 120,
                proj.timeSigNumerator || 4,
                proj.timeSigDenominator || 4,
              ),
            });
            onEditTarget(null);
          } else if (clip) {
            // A MIDI clip placed on a track → its piano roll in the bottom panel.
            setAudioClip(null);
            onEditTarget({ kind: "clip", project: proj, clip });
          } else {
            setAudioClip(null);
            onEditTarget(null);
          }
        })
        .catch(() => {
          if (!cancelled) {
            setAudioClip(null);
            onEditTarget(null);
          }
        });
      return () => {
        cancelled = true;
      };
    }

    if (isRackModuleFile(p)) {
      // A SLICE-rack module.yaml gets INLINE editors instead of the docked strip; here we only make sure it is off.
      setAudioClip(null);
      onEditTarget(null);
      return;
    }

    setAudioClip(null);
    onEditTarget(null);
  }, [active, file, hints, onEditTarget]);

  const refresh = useCallback(async () => {
    try {
      const [t, h] = await Promise.all([api.tree(), api.hints()]);
      setTree(t);
      setHints(h);
    } catch (e) {
      setStatus(`load error: ${(e as Error).message}`);
    }
  }, [setStatus]);
  // Refresh on mount and whenever a command elsewhere may have changed the files.
  useEffect(() => {
    void refresh();
  }, [refresh, reloadKey]);

  const open = useCallback(
    async (path: string) => {
      const posix = path.replace(/\\/g, "/").toLowerCase();
      // A .dawproject is a ZIP and a .als gzip — offer to import either rather than decoding bytes as text.
      if (posix.endsWith(".dawproject") || posix.endsWith(".als")) {
        onImportProject(path);
        return;
      }
      try {
        const f = await api.read(path);
        // Never open a binary: the tree disables them, but the breadcrumb reaches here too, so guard centrally.
        if (f.binary) {
          setStatus(`${path} — binary file, not shown`);
          return;
        }
        setFile(f);
        setDirty(false);
        setStatus(path);
      } catch (e) {
        setStatus(`open error: ${(e as Error).message}`);
      }
    },
    [setStatus, onImportProject],
  );

  // Rename in place, refresh, and re-point the open file if it (or its folder) moved; onChanged repaints the rest.
  const renameEntry = useCallback(
    async (path: string, newName: string) => {
      try {
        const { path: newPath } = await api.renameFile(path, newName);
        await refresh();
        const cur = file?.path;
        if (cur === path) void open(newPath);
        else if (cur && cur.startsWith(`${path}/`))
          void open(newPath + cur.slice(path.length));
        onChanged();
        setStatus(`renamed to ${newPath}`);
      } catch (e) {
        setStatus(`rename failed: ${(e as Error).message}`);
      }
    },
    [file?.path, refresh, open, onChanged, setStatus],
  );

  // Drag a row onto a folder. The same follow-the-open-file dance as a rename, and for the same reason: the
  // editor holds a PATH, and a move invalidates it whether the file itself moved or an ancestor did.
  const moveEntry = useCallback(
    async (path: string, toDir: string) => {
      try {
        const { path: newPath } = await api.moveFile(path, toDir);
        await refresh();
        const cur = file?.path;
        if (cur === path) void open(newPath);
        else if (cur && cur.startsWith(`${path}/`))
          void open(newPath + cur.slice(path.length));
        onChanged();
        setStatus(`moved to ${newPath}`);
      } catch (e) {
        setStatus(`move failed: ${(e as Error).message}`);
      }
    },
    [file?.path, refresh, open, onChanged, setStatus],
  );

  // Delete: recycle the entry (reversible), refresh, and close the open file if it lived under it.
  const deleteEntry = useCallback(
    async (path: string, isDir: boolean) => {
      if (
        !window.confirm(
          `Delete ${isDir ? "folder" : "file"} "${path}"? It moves to the recycle bin.`,
        )
      )
        return;
      try {
        await api.deleteFile(path);
        await refresh();
        const cur = file?.path;
        if (cur === path || (cur && cur.startsWith(`${path}/`))) {
          setFile(null);
          onEditTarget(null);
        }
        onChanged();
        setStatus(`deleted ${path} (recycled)`);
      } catch (e) {
        setStatus(`delete failed: ${(e as Error).message}`);
      }
    },
    [file?.path, refresh, onChanged, onEditTarget, setStatus],
  );

  // Right-click New file: create an empty project file inside the target folder.
  const createProjectFile = useCallback(
    async (dir: string, name: string) => {
      const rel = `${dir}/${name}`;
      // EMPTY — a YAML file needs nothing, and pre-filling one would only be something to delete.
      const body = "";
      try {
        await api.write(rel, body);
        await refresh();
        void open(rel);
        onChanged();
        setStatus(`created ${rel}`);
      } catch (e) {
        setStatus(`create failed: ${(e as Error).message}`);
      }
    },
    [refresh, open, onChanged, setStatus],
  );

  // Right-click New folder: an empty folder inside the target. Nothing to open afterwards — unlike a new file,
  // there is no content to put a cursor in — so it just refreshes and says where it landed.
  const createFolder = useCallback(
    async (dir: string, name: string) => {
      try {
        const { path } = await api.createFolder(dir, name);
        await refresh();
        onChanged();
        setStatus(`created ${path}/`);
      } catch (e) {
        setStatus(`new folder failed: ${(e as Error).message}`);
      }
    },
    [refresh, onChanged, setStatus],
  );

  // Right-click Clone module: copy a module folder in the same category.
  const cloneModuleEntry = useCallback(
    async (path: string, newName: string) => {
      try {
        const { path: newPath } = await api.cloneModule(path, newName);
        await refresh();
        void open(newPath);
        onChanged();
        setStatus(`cloned to ${newPath}`);
      } catch (e) {
        setStatus(`clone failed: ${(e as Error).message}`);
      }
    },
    [refresh, open, onChanged, setStatus],
  );

  // New instance: add an <instance>.yaml and open it — the point of an instance is to state what it overrides.
  const createModuleInstanceEntry = useCallback(
    async (path: string, instance: string) => {
      try {
        const { path: newPath } = await api.createModuleInstance(
          path,
          instance,
        );
        await refresh();
        void open(newPath);
        onChanged();
        setStatus(`created ${newPath}`);
      } catch (e) {
        setStatus(`new instance failed: ${(e as Error).message}`);
      }
    },
    [refresh, open, onChanged, setStatus],
  );

  // Expose the opener and file list to the shell, scoped to the ACTIVE project rather than the whole workspace.
  useImperativeHandle(
    ref,
    (): EditorHandle => ({
      open,
      files: () => {
        const all = textFiles(tree);
        if (!activeProject || activeProject === ".") return all;
        const prefix = `${activeProject.replace(/\\/g, "/").replace(/\/+$/, "")}/`;
        return all.filter((p) => p.replace(/\\/g, "/").startsWith(prefix));
      },
      currentFile: () => file?.path ?? null,
      editorFocused: () => !!cmViewRef.current?.hasFocus,
      localUndoDepth: () =>
        cmViewRef.current ? undoDepth(cmViewRef.current.state) : 0,
      localRedoDepth: () =>
        cmViewRef.current ? redoDepth(cmViewRef.current.state) : 0,
      localUndo: () => (cmViewRef.current ? undo(cmViewRef.current) : false),
      localRedo: () => (cmViewRef.current ? redo(cmViewRef.current) : false),
    }),
    [open, tree, activeProject, file?.path],
  );

  // Set From / Set To surgically rewrite the placement's field in the OPEN buffer; the author saves.
  const setVideoFrom = useCallback(
    (ref: string, t: number) => {
      if (!file) return;
      const next = setVideoPlacementField(
        file.content,
        ref,
        "source_from",
        Math.max(0, t),
      );
      if (next === file.content) return;
      setFile({ ...file, content: next });
      setDirty(true);
    },
    [file],
  );
  const setVideoTo = useCallback(
    (ref: string, t: number) => {
      if (!file) return;
      // length is the OUT-point relative to source_from; clamp to >=0.
      const placements = listVideoPlacements(file.content);
      const p = placements.find((x) => x.ref === ref);
      const from = p?.sourceFrom ?? 0;
      const length = Math.max(0, t - from);
      const next = setVideoPlacementField(file.content, ref, "length", length);
      if (next === file.content) return;
      setFile({ ...file, content: next });
      setDirty(true);
    },
    [file],
  );

  // The open file follows disk: every command here rewrites YAML, so a buffer read once and never again is a
  // snapshot of the past that the next Save writes back over everything since. Clean buffers refresh silently;
  // a dirty one asks, because only the person knows which of the two versions matters.
  const diskSync = useDiskSync({
    path: file && !file.binary ? file.path : null,
    content: file && !file.binary ? file.content : null,
    dirty,
    onAdopt: useCallback((text: string) => {
      setFile((f) => (f ? { ...f, content: text } : f));
      setDirty(false);
    }, []),
    onClean: useCallback(() => setDirty(false), []),
    reloadKey,
  });

  const save = useCallback(async () => {
    if (!file || file.binary) return;
    try {
      const { forked } = await api.write(file.path, file.content);
      // A file in the shared `_modules` library isn't written: the module is copied into the project and the
      // chains follow. Open the copy, so what's on screen is the file that now holds the edit.
      if (forked) {
        setDirty(false);
        await refresh();
        void open(forked.path);
        onChanged();
        setStatus(
          `${forked.ref} is shared — saved a project copy as ${forked.module}` +
            (forked.chains.length
              ? `, and repointed ${forked.chains.join(", ")}`
              : ""),
        );
        return;
      }
      // fmt is a plain re-read now (the writers emit canonical YAML): the on-disk text becomes the buffer.
      const formatted = await api.fmt(file.path);
      setFile(formatted);
      setDirty(false);
      setStatus(`saved ${file.path}`);
      await refresh(); // a new/edited entity updates the tree + completions
      onChanged(); // the arrangement / graph may have changed
    } catch (e) {
      setStatus(`save error: ${(e as Error).message}`);
    }
  }, [file, refresh, open, onChanged, setStatus]);

  // Drop OS files onto the tree: upload each into the dropped folder, sequentially, skipping existing names.
  const [uploadState, setUploadState] = useState<{
    fileName: string;
    loaded: number;
    total: number;
    done: number;
    count: number;
  } | null>(null);

  // `files` carry the path they sat at, so a dropped FOLDER lands as a folder — a module is three files in
  // one, and a flat list could not say that (see the shared tree's lib/droppedEntries.ts).
  const uploadFiles = useCallback(
    async (dir: string, files: DroppedFile[]) => {
      if (!files.length) return;
      // Pre-read all ArrayBuffers so total byte count is known upfront.
      const entries = await Promise.all(
        files.map(async ({ path, file }) => ({
          name: path,
          bytes: await file.arrayBuffer(),
          size: file.size,
        })),
      );
      const totalBytes = entries.reduce((s, e) => s + e.size, 0);
      let loadedSoFar = 0;
      let added = 0;
      let skipped = 0;
      setUploadState({
        fileName: entries[0].name,
        loaded: 0,
        total: totalBytes,
        done: 0,
        count: entries.length,
      });
      for (let i = 0; i < entries.length; i++) {
        const { name, bytes, size } = entries[i];
        // Track this file's starting offset in the cumulative total.
        const fileOffset = loadedSoFar;
        try {
          await api.uploadWithProgress(dir, name, bytes, (loaded) => {
            setUploadState((prev) =>
              prev
                ? {
                    ...prev,
                    loaded: fileOffset + loaded,
                    fileName: name,
                    done: i,
                  }
                : prev,
            );
          });
          loadedSoFar += size;
          added++;
        } catch (e) {
          loadedSoFar += size; // count skipped files toward total so the bar completes
          const err = e as Error & { status?: number };
          if (err.status === 409) skipped++;
          else {
            setUploadState(null);
            setStatus(`upload error: ${name} — ${err.message}`);
            showToast({
              message: `upload failed: ${name}`,
              variant: "error",
            });
            return;
          }
        }
      }
      setUploadState(null);
      await refresh(); // the new files join the tree + completions
      onChanged(); // a dropped clip/asset may change the project
      const into = dir === "." ? "workspace root" : dir;
      const msg =
        `uploaded ${added} file${added === 1 ? "" : "s"} to ${into}` +
        (skipped ? ` — skipped ${skipped} already there` : "");
      setStatus(msg);
      if (added > 0) showToast({ message: msg, variant: "success" });
    },
    [refresh, onChanged, setStatus],
  );

  const editable = !!file && !file.binary;
  // The grid tabs only make sense on a sequence file (they show its notes).
  const isSeq = !!file && isSeqFile(file.path);
  // Which grid is showing, or null for the text. Everything else — a fullscreen pane, a file
  // with no notes in it, a binary — falls back to the editor without the tabs deciding.
  const grid = popin && isSeq && editable && tab !== "text" ? tab : null;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-2 border-b border-border px-3 py-1.5">
        <Breadcrumb
          tree={tree}
          path={file?.path ?? null}
          // In a workspace the folder name IS the project; alone, only the song knows what it is called.
          rootLabel={
            (activeProject && activeProject !== "."
              ? activeProject.split("/").pop()
              : projectName) || "project"
          }
          activeProject={activeProject}
          onOpen={open}
          onOpenProject={onOpenProject}
        />
        <div className="flex-1" />
        {/* A sequence in the POPIN gets its three views as tabs — text and the two grids as
            peers. A popin is opened BY a command that named this sequence, so it is the one
            place where "look at its notes" is the likely next thing; the fullscreen pane is
            the text editor, and the main view is where a grid gets room. */}
        {popin && isSeq && (
          <div
            role="tablist"
            aria-label="sequence views"
            className="flex items-center gap-0.5 rounded-md border border-border p-0.5"
          >
            {SEQ_TABS.map((t) => (
              <button
                key={t.id}
                type="button"
                role="tab"
                aria-selected={tab === t.id}
                title={t.title}
                className={cn(
                  "flex items-center gap-1 rounded px-2 py-1 text-xs transition-colors",
                  tab === t.id
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:bg-accent hover:text-foreground",
                )}
                onClick={() => setTab(t.id)}
              >
                <t.icon className="h-3.5 w-3.5" />
                {t.label}
              </button>
            ))}
          </div>
        )}
        {/* A module is the one file with a second editor worth offering: the builder draws its panel.
            A BUTTON and not a redirected click — opening `module.yaml` must still open its text, which is
            the editing path a shared module forks through. */}
        {file && isModuleFile(file.path) && (
          <Button
            size="sm"
            variant="secondary"
            title="open this module in the builder — its panel, its presets"
            onClick={() =>
              onOpenBuilder(
                moduleFileOf(file.path),
                /ui\.ya?ml$/i.test(file.path)
                  ? "panel"
                  : /presets\.ya?ml$/i.test(file.path)
                    ? "presets"
                    : "module",
              )
            }
          >
            <LayoutGrid className="mr-1 h-4 w-4" />
            Builder
          </Button>
        )}
        <Button size="sm" onClick={save} disabled={!editable || !dirty}>
          <Save className="mr-1 h-4 w-4" />
          Save{dirty ? " *" : ""}
        </Button>
      </div>
      {/* The file moved under an edit in progress. Both versions are real work, so this states the choice and
          waits — it does not pick, and it does not disappear on its own. */}
      {diskSync.conflict !== null && (
        <div className="flex flex-wrap items-center gap-2 border-b border-amber-500/40 bg-amber-500/10 px-3 py-1.5 text-xs">
          <TriangleAlert className="h-4 w-4 shrink-0 text-amber-500" />
          <span className="min-w-0 flex-1">
            This file changed on disk while you were editing it. Your unsaved
            changes and the new version are different.
          </span>
          <Button size="sm" variant="secondary" onClick={diskSync.keepEditing}>
            Continue editing
          </Button>
          <Button size="sm" onClick={diskSync.takeDisk}>
            Update
          </Button>
        </div>
      )}
      <div className="relative flex min-h-0 flex-1">
        {/* Same reasoning as the chains list: 256px of tree beside a phone's screen
            leaves nothing to edit in. It becomes a drawer over the editor, opened from
            a corner button and closed by picking a file. */}
        {showTree && isMobile && (
          <button
            type="button"
            onClick={() => setTreeOpen((o) => !o)}
            aria-expanded={treeOpen}
            className="absolute left-2 top-2 z-30 flex items-center gap-1 rounded border border-border bg-card/90 px-2 py-1 text-xs shadow"
          >
            <FolderTree className="h-3.5 w-3.5" />
            files
          </button>
        )}
        {showTree && (!isMobile || treeOpen) && (
          <aside
            className={cn(
              "flex flex-col overflow-hidden border-r border-border",
              isMobile
                ? "absolute inset-y-0 left-0 z-20 w-64 bg-card shadow-xl"
                : "w-64 shrink-0 bg-card/40",
            )}
          >
            <FileTree
              tree={tree}
              activePath={file?.path ?? null}
              activeProject={activeProject}
              projectName={projectName}
              rootDir={activeProject ?? "."}
              onOpen={(path) => {
                open(path);
                if (isMobile) setTreeOpen(false);
              }}
              // A module row opens the BUILDER on its panel — its three files are no longer rows,
              // and the builder is the one screen that edits all three.
              onOpenModule={(moduleFile) => {
                onOpenBuilder(moduleFile, "panel");
                if (isMobile) setTreeOpen(false);
              }}
              onOpenProject={onOpenProject}
              onUpload={uploadFiles}
              onRename={renameEntry}
              onMove={moveEntry}
              onDelete={deleteEntry}
              onCreateProjectFile={createProjectFile}
              onCreateFolder={createFolder}
              onCloneModule={cloneModuleEntry}
              onCreateModuleInstance={createModuleInstanceEntry}
            />
            <UploadProgress
              fileName={uploadState?.fileName ?? null}
              loaded={uploadState?.loaded ?? 0}
              total={uploadState?.total ?? 0}
              done={uploadState?.done ?? 0}
              count={uploadState?.count ?? 0}
              active={uploadState !== null}
            />
          </aside>
        )}
        <main className="min-w-0 flex-1 overflow-hidden">
          {/* A grid edit lands in the SAME buffer a keystroke does — dirty flag, Save button and
              all — so switching tabs mid-edit shows the text you just drew, and one Save writes
              whichever way you made the change. */}
          {grid && file ? (
            <SeqGrid
              view={grid}
              content={file.content}
              racks={hints.racks}
              resetKey={file.path}
              onChange={(v) => {
                setFile({ ...file, content: v });
                setDirty(true);
              }}
            />
          ) : (
            <EditorPane
              file={file}
              onEditorView={(v) => {
                cmViewRef.current = v;
              }}
              hints={hints}
              vimMode={vimMode}
              audioClip={audioClip}
              preview={preview}
              onClosePreview={() => setPreview(null)}
              onChange={(v) => {
                if (file) {
                  setFile({ ...file, content: v });
                  setDirty(true);
                }
              }}
              onSave={save}
              onOpenEntity={open}
              onPreview={handlePreview}
              // A slice-rack module.yaml → inline per-symbol waveform editors in the code.
              sliceRack={sliceRack}
              // The open file's load errors, drawn inline as squiggles.
              diagnostics={fileDiagnostics}
              // An open video_tracks/*.yaml → per-placement <video> readers with Set From / Set To buttons.
              videoReaders={videoReaders}
              onVideoSetFrom={setVideoFrom}
              onVideoSetTo={setVideoTo}
              onCloseVideoReaders={() => setVideoReaders(null)}
            />
          )}
        </main>
      </div>
    </div>
  );
}
