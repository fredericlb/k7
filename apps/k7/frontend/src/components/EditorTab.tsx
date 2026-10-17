// EditorTab.tsx — the project-file editor: a CodeMirror pane with schema-aware completion,
// a breadcrumb and (when there's room) a file tree. ONE instance serves both layouts — a
// second would fork the open file, its unsaved text and the undo history. There is no Save
// button: the buffer is written as soon as it is a document the compiler could read
// (packages/ui-editor/docs/autosave.md). Saving does NOT format either — the writers emit
// canonical YAML, and reflowing a hand-edited file is what this format was chosen to avoid.

import { redo, redoDepth, undo, undoDepth } from "@codemirror/commands";
import { Transaction } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import type { DroppedFile } from "@frediverse/ui/file-tree";
import { FolderTree } from "@frediverse/ui/icons";
import { cn } from "@frediverse/ui/lib/utils";
import { askConfirm } from "@studio/project-shell/ask";
import { showToast } from "@studio/project-shell/toast";
import { LIBRARIES_DIR } from "@studio/song-schema/moduleTypes";
import {
  listVideoPlacements,
  setVideoPlacementField,
} from "@studio/song-schema/yaml/videoTrackFile";
import { recallBuffer, useAutosave } from "@studio/ui-editor/autosave";
import type { LintItem } from "@studio/ui-editor/lint";
import { InputChannelBar } from "@studio/ui-module-builder/input-channels";
import { setChannelIn } from "@studio/ui-module-builder/module-ui";
import type { ModuleLibrary } from "@studio/web-protocol";
import {
  useCallback,
  useDeferredValue,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { api } from "../api";
import { NO_READS, readBuffer } from "../bufferReads";
import { chainOps, filterOps, processLine } from "../clipOps";
import { clipWindowBand, setClipWindowText } from "../clipWindowText";
import {
  allEntries,
  findUseRack,
  gridOf,
  isAudioClipFile,
  resolveGutterSource,
  textFiles,
} from "../editorPaths";
import { useDiskSync } from "../hooks/useDiskSync";
import { useDocPerRevision } from "../hooks/useDocPerRevision";
import type { SetStatus } from "../hooks/useLogs";
import { type LibraryAssemblyRow, libraryOfPath } from "../libraryTree";
import { moduleBehind } from "../moduleBehind";
import { m } from "../paraglide/messages.js";
import {
  fileStem,
  inActiveProject,
  isClipFile,
  isSeqFile,
  isTrackFile,
  isVideoTrackFile,
  norm,
  projectDir,
  rackKeyOf,
  readScalarField,
  toProjectRelative,
} from "../projectPaths";
import { movedTheTree, movedTheVocabulary, type Reload } from "../reloadScope";
import type { SeqView } from "../sequenceEdit";
import { type EditFocus, keepIfSame } from "../shellEquality";
import { rackSliceRanges, setSliceWindow } from "../sliceSymbols";
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
import { ConflictBanner } from "./ConflictsPanel";
import { EditorPane } from "./EditorPane";
import { DiskConflictBar, EditorToolbar } from "./EditorToolbar";
import { FileTree, type FileTreeHandle } from "./FileTree";
import { LibraryUpgrades } from "./LibraryUpgrades";
import type { MinimapItem } from "./Minimap";
import { ModuleSidePane } from "./ModuleSidePane";
import { SeqGrid } from "./SeqGrid";
import { UploadProgress } from "./UploadProgress";
import { type VideoReader, VideoReadersStrip } from "./VideoReadersStrip";

// The handle the shell reaches the editor through: `open` opens a file, `files` completes `file`, and the `local*` methods expose the buffer's own history.
export interface EditorHandle {
  /** Read a file into the pane, answering whether it LANDED — a caller that reveals the pane must not pop one open over a refused read. */
  open: (path: string) => Promise<boolean>;
  files: () => string[];
  currentFile: () => string | null;
  editorFocused: () => boolean;
  localUndoDepth: () => number;
  localRedoDepth: () => number;
  localUndo: () => boolean;
  localRedo: () => boolean;
  // The tree's right-click menu, as the shell can reach it: each of these is the SAME callback the menu item runs.
  entries: () => string[];
  createFile: (dir: string, name: string) => void;
  createFolder: (dir: string, name: string) => void;
  rename: (path: string, newName: string) => void;
  move: (path: string, toDir: string) => void;
  remove: (path: string, isDir: boolean) => void;
  // The two the SIDEBAR holds — `null`/`false` means it is not on screen, which the caller reports rather than pretending it happened.
  togglePin: (path: string) => boolean | null;
  pickUpload: (dir: string, folder: boolean) => boolean;
  /** Is this path a folder? `file …` has to tell "into which" from "which", and only the tree knows. */
  isDir: (path: string) => boolean;
  /** Re-read the module LIBRARIES — on the handle, because the other writer of one is the module builder upstairs. */
  refreshLibraries: () => void;
}

// The hints before the first answer: every list empty, so completion offers nothing rather than failing.
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
  reload,
  activeProject,
  projectName,
  vimMode,
  onOpenProject,
  onImportProject,
  onChanged,
  command,
  engineLevel,
  setStatus,
  onEditTarget,
  onOpenItem,
  onOpenBuilder,
  onOpenLibraryModule,
  onOpenChain,
  onOpenAssembly,
  chainsBuilder,
  moduleBuilder,
  diagnostics,
  videoSources,
  inputDevices,
  onRegroupInputs,
  ref,
}: {
  active: boolean;
  // Render the file-tree sidebar: on whenever the editor pane is in the layout, OFF in the popin — see docs/shell.md.
  showTree: boolean;
  // Popped out over the shell on one file — not the same question as `showTree`: this asks 'is this a glance at one thing'.
  popin: boolean;
  /** The shell's 'something changed', and what — this pane is the reason the list exists (see reloadScope.ts). */
  reload: Reload;
  activeProject: string | null;
  // The whole project's load findings; the editor draws the open file's inline. Refreshed by App's 2s vet poll.
  diagnostics: Diagnostic[];
  projectName: string | null; // the song's name — `activeProject` is "." for a lone project
  // Vim mode is a global preference living in App, toggled from the settings screen; here it only drives EditorPane.
  vimMode: boolean;
  onOpenProject: (path: string) => void;
  onImportProject: (path: string) => void; // a .dawproject or .als was clicked
  onChanged: () => void;
  /** Run a command line through the shell — the SAME path the palette takes, and what refreshes the open file afterwards. */
  command: (line: string) => void | Promise<void>;
  /** The library level the engine's machine runs (1 from an older supervisor); undefined with no engine. */
  engineLevel?: number;
  setStatus: SetStatus;
  onEditTarget: (t: EditFocus | null) => void; // the open sequence by path, never its text — see shellEquality.ts
  onOpenItem: (item: MinimapItem | null) => void; // the open clip/track, for the minimap
  // Open the shared module builder on the MODULE file of the trio, plus which of the three was clicked.
  onOpenBuilder: (path: string, pane: "module" | "panel") => void;
  // …and the same builder over a SHARED module, from the Libraries tab — its own callback, the path being in another space (../library.ts).
  onOpenLibraryModule: (moduleFile: string) => void;
  /** A chain row of the Libraries tab was opened — its ref, for the chains builder. */
  onOpenChain: (ref: string, node?: string) => void;
  /** An assembly template was opened from the Libraries tab: its `assembly.yaml`, and its folder. */
  onOpenAssembly: (file: string, folder: string) => void;
  /** The chains builder, when one is open — rendered in the editor's own place. */
  chainsBuilder?: React.ReactNode;
  /** The module builder, drawn in the same place — beside the tree, never over it. */
  moduleBuilder?: React.ReactNode;
  /** Each picture clip ref → the media file it names, from the COMPILED document: only the compiler has read `clips/<ref>.yaml`. */
  videoSources: Record<string, string>;
  // The interface's inputs, for the channel strip an `io: in` file gets under its text — see ui-module-builder/docs/inputChannels.md.
  inputDevices: { name: string; channels: number[] }[];
  onRegroupInputs?: (channel: number, stereo: boolean) => void;
  ref?: React.Ref<EditorHandle>;
}) {
  // Everything that only needs 'something happened' still keys off the counter, derived here rather than passed beside the token.
  const reloadKey = reload.key;
  const [tree, setTree] = useState<FileNode[]>([]);
  // Mobile only: the tree is a drawer over the editor, closed by default — the editor is the point of this pane.
  const isMobile = useIsMobile();
  const [treeOpen, setTreeOpen] = useState(false);
  const [hints, setHints] = useState<Hints>(EMPTY_HINTS);
  const [file, setFile] = useState<FileContent | null>(null);
  // The live CodeMirror view, forwarded by EditorPane — read for the Ctrl+Z arbitration below.
  const cmViewRef = useRef<EditorView | null>(null);
  // The sidebar, for the two actions it alone holds — the pins and the OS file pickers.
  const treeRef = useRef<FileTreeHandle>(null);
  /** The module libraries, fetched beside the tree and refreshed with it — NOT read out of `tree`, which is the project's own files. */
  const [libraries, setLibraries] = useState<ModuleLibrary[]>([]);
  /** The library CHAINS, fetched and refreshed exactly as the module levels are — same repo. */
  const [libChains, setLibChains] = useState<{ ref: string; path: string }[]>(
    [],
  );
  /** …and its ASSEMBLY templates, the third family, for the same tab. */
  const [libAssemblies, setLibAssemblies] = useState<LibraryAssemblyRow[]>([]);
  /** The Process menu on a clip file: which chain is running, and what is typed in its search — the list itself is `libChains`. */
  const [processing, setProcessing] = useState(false);
  const [opSearch, setOpSearch] = useState("");
  // What is on disk for the open file; dirty is derived from it and the buffer, never a flag that could disagree.
  const [saved, setSaved] = useState("");
  const dirty = !!file && !file.binary && file.content !== saved;
  // Which tab of a sequence is open in the POPIN — only there: fullscreened, the note grids have their own home.
  const [tab, setTab] = useState<"text" | SeqView>("text");
  // The readers strip, shown for a lane file until dismissed — per-session and per-pane, a dock over the text.
  const [strip, setStrip] = useState(true);
  // The audio clip this clips/*.yaml links to: it docks at the bottom of the CODE pane, not the shared panel.
  const [audioClip, setAudioClip] = useState<{
    project: WebProject;
    clip: WebClip;
    // Span the whole source, not the placed region — what a clips/*.yaml shows (see WaveformView).
    whole?: boolean;
    // Slice-rack windows to overlay on the waveform; `hollow` is the clip band of a file that trims nothing.
    sliceRanges?: {
      symbol: string;
      from: number;
      to: number;
      color?: string;
      hollow?: boolean;
    }[];
    // What the strip's ▶ sends: a clip file names its CLIP, a rack's dock the plain SOURCE it shares, which has no window.
    play?: PreviewReq;
  } | null>(null);
  // The last sound auditioned from a gutter ▶, docked under the editor until dismissed or the file changes.
  const [preview, setPreview] = useState<{
    project: WebProject;
    clip: WebClip;
    sliceRanges?: {
      symbol: string;
      from: number;
      to: number;
      hollow?: boolean;
    }[];
    // The request that opened it, kept so the strip's ▶ can play it again — a source preview's id is a PATH, not a clip name.
    play: PreviewReq;
  } | null>(null);

  // Point the minimap at the open file's entity: a clip or sequence highlights a clip, a track file a track.
  useEffect(() => {
    const p = norm(file?.path ?? "");
    const stem = fileStem(p);
    const item: MinimapItem | null =
      // A file of ANOTHER project in this workspace points at nothing here: the minimap draws the
      // one the engine holds, and its ids are that project's — projectPaths.ts.
      !file || file.binary || !inActiveProject(p, activeProject)
        ? null
        : isClipFile(p) || isSeqFile(p)
          ? { kind: "clip", id: stem }
          : isTrackFile(p)
            ? { kind: "track", id: stem }
            : null;
    onOpenItem(item);
  }, [file, onOpenItem, activeProject]);

  // A new file — drop the previous preview so a stale waveform doesn't linger.
  useEffect(() => {
    setPreview(null);
  }, [file?.path]);

  // One compile per change token: the effect below re-runs on every keystroke, and the doc does not move with one.
  const projectDoc = useDocPerRevision();

  // Audition from a gutter ▶: play it AND fetch a waveform to dock. Playback happens regardless of the fetch.
  const previewSound = useCallback(
    async (req: PreviewReq) => {
      try {
        const proj = await projectDoc();
        const root = (hints.projectRoot || "").replace(/[\\/]+$/, "");
        // ALREADY-absolute stays untouched: prefixing the root onto one built a path nothing could ever stat.
        const abs = (rel: string) =>
          !root || /^([A-Za-z]:[\\/]|[\\/])/.test(rel)
            ? rel
            : [root, ...rel.split(/[\\/]/)].filter(Boolean).join("/");
        const base = (rel: string) => rel.split(/[\\/]/).pop() || rel;
        if (req.kind === "clip") {
          setPreview({
            project: proj,
            play: req,
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
            // The RESOLVED request — `handlePreview` rewrites a rack's relative source before playing it, and the raw one would miss.
            play: req,
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
    [hints.projectRoot, projectDoc],
  );

  // A gutter ▶ handler with a STABLE identity: an inline arrow would reconfigure CodeMirror on every keystroke.
  const filePath = file?.path ?? "";

  /** A sequence opens on its NOTES, keyed on the PATH — a LAYOUT effect, so the swap lands before the paint. */
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
        setStatus(
          m["status.editor.previewFailed"]({ message: (e as Error).message }),
          "error",
        );
      });
      void previewSound(r);
    },
    [previewSound, setStatus, filePath, activeProject],
  );

  /** The waveform strip's ▶ — send the request the strip already carries and nothing else: no second resolve, no preview sound. */
  const playStrip = useCallback(
    async (req: PreviewReq) => {
      try {
        const { start, length } = await api.preview(req);
        return { start, length };
      } catch (e) {
        setStatus(
          m["status.editor.previewFailed"]({ message: (e as Error).message }),
          "error",
        );
        return null; // no sound, so no playhead: the strip draws nothing rather than a lie
      }
    },
    [setStatus],
  );

  // Feed the shared Editor panel the SOURCE behind the open file, so the bottom pane shows what you're looking at.
  useEffect(() => {
    if (!active) return;
    if (!file || file.binary) {
      onEditTarget(null);
      setAudioClip(null);
      return;
    }
    const p = norm(file.path);
    let cancelled = false;
    const stem = fileStem(p);

    // Same rule as the minimap: a clip of another project would be looked up in THIS project's
    // compiled doc, and answer with the wrong thing or with nothing at all.
    if (!inActiveProject(p, activeProject)) {
      setAudioClip(null);
      onEditTarget(null);
      return;
    }

    if (isSeqFile(p)) {
      // A sequence driving a SLICE rack docks that rack's source waveform, with each symbol's [from,to] drawn on it.
      const useRack = findUseRack(file.content);
      const rack = useRack ? hints.racks[useRack] : undefined;
      if (rack && rack.rackType === "slice" && rack.source) {
        const source = rack.source;
        const ranges = rackSliceRanges(rack.symbols);
        void projectDoc()
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
            // The rack's shared SOURCE, whole: a slice rack's windows belong to its symbols, and the file itself declares none.
            setAudioClip({
              project: proj,
              clip,
              sliceRanges: ranges,
              play: { kind: "source", source },
            });
            onEditTarget(null);
          })
          .catch(() => {
            if (!cancelled) {
              setAudioClip(null);
              onEditTarget({ kind: "seq", path: p });
            }
          });
        return () => {
          cancelled = true;
        };
      }
      // Otherwise: notes are inline in the sequence file — name it, and a keystroke leaves the shell still.
      setAudioClip(null);
      onEditTarget({ kind: "seq", path: p });
      return;
    }

    if (isClipFile(p)) {
      // The clip as the engine sees it. A placed clip keeps its real start/length; an unplaced one previews at bar 1.
      const audio = isAudioClipFile(file.content);
      void projectDoc()
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
            // Audio docks in THIS pane, not the shared panel, and `whole`: the file you have open IS the material.
            setAudioClip({
              project: proj,
              clip,
              whole: true,
              // The CLIP, not its source: the file's own `from`/`to` are what ▶ must honour, and the service resolves them from this id.
              play: { kind: "clip", clip: clip.id },
              // Editable: this buffer IS the clip file, so the band's edges are handles even when it trims nothing.
              sliceRanges: clipWindowBand(file.content, gridOf(proj), true),
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

    /** A SLICE RACK docks the SOURCE waveform with every symbol's window in its own colour (sliceSymbols.ts); `rackKeyOf` answers for both spellings. */
    const nodeKey = rackKeyOf(p);
    const nodeRack = nodeKey ? hints.racks[nodeKey] : undefined;
    if (nodeRack?.rackType === "slice" && nodeRack.source) {
      // In the popin SPLIT the module pane docks this same picture, and the module's is the editable one — once is enough.
      if (popin && moduleBehind(file.content, hints, p) != null) {
        setAudioClip(null);
        onEditTarget(null);
        return;
      }
      const source = nodeRack.source;
      const ranges = rackSliceRanges(nodeRack.symbols);
      void projectDoc()
        .then((proj) => {
          if (cancelled) return;
          setAudioClip({
            project: proj,
            clip: {
              id: source,
              type: "audio",
              name: source,
              start: 0,
              length: 0,
              notes: [],
            },
            sliceRanges: ranges,
          });
          onEditTarget(null);
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

    setAudioClip(null);
    onEditTarget(null);
  }, [active, file, hints, onEditTarget, popin, projectDoc]);

  /** The LIBRARIES — asked when they can have MOVED rather than when anything moved: on mount, and by the two acts that write there. */
  const refreshLibraries = useCallback(async () => {
    try {
      const [l, c, a] = await Promise.all([
        api.moduleLibraries(),
        api.libraryChains(),
        // Tolerated rather than required: the templates are a row of the tab, and must not cost it the modules.
        api.libraryAssemblies().catch(() => ({ assemblies: [] })),
      ]);
      setLibraries(l.libraries);
      setLibChains(c.chains);
      setLibAssemblies(a.assemblies);
    } catch (e) {
      setStatus(
        m["status.editor.loadFailed"]({ message: (e as Error).message }),
        "error",
      );
    }
  }, [setStatus]);

  /** The project's own tree and vocabulary — what a command CAN have changed; `want` is for the one caller that knows better. */
  const refresh = useCallback(
    async (want = { tree: true, hints: true }) => {
      try {
        const [t, h] = await Promise.all([
          want.tree ? api.tree() : null,
          want.hints ? api.hints() : null,
        ]);
        // An unchanged answer keeps its object: a new `hints` rebuilds every CodeMirror extension that reads it.
        if (t) setTree(keepIfSame(t));
        if (h) setHints(keepIfSame(h));
      } catch (e) {
        setStatus(
          m["status.editor.loadFailed"]({ message: (e as Error).message }),
          "error",
        );
      }
    },
    [setStatus],
  );
  /** …and after a command, only the half of it that can have moved — the predicates and their one limit are in `reloadScope.ts`. */
  useEffect(() => {
    const want = {
      tree: movedTheTree(reload),
      hints: movedTheVocabulary(reload),
    };
    if (want.tree || want.hints) void refresh(want);
  }, [refresh, reload]);
  useEffect(() => {
    void refreshLibraries();
  }, [refreshLibraries]);

  // Which open is the latest: two quick clicks race, and the older answer must not land over the newer file.
  const openSeq = useRef(0);
  const open = useCallback(
    async (path: string): Promise<boolean> => {
      const seq = ++openSeq.current;
      const posix = norm(path).toLowerCase();
      // A .dawproject and an Ableton project's .zip are ZIPs, a .als gzip — offer to import rather than decode bytes as text.
      if (
        posix.endsWith(".dawproject") ||
        posix.endsWith(".als") ||
        posix.endsWith(".zip")
      ) {
        onImportProject(path);
        return false; // an import is not a file in the pane, so nothing should be revealed for it
      }
      try {
        const f = await api.read(path);
        if (seq !== openSeq.current) return false;
        // Never open a binary: the tree disables them, but the breadcrumb reaches here too, so guard centrally.
        if (f.binary) {
          setStatus(m["status.editor.binaryFile"]({ path }));
          return false;
        }
        // An edit that could never be written outlived the pane showing it: give it back rather than the disk copy.
        const kept = recallBuffer(path);
        setFile(kept == null ? f : { ...f, content: kept });
        setSaved(f.content);
        setStatus(path);
        return true;
      } catch (e) {
        setStatus(
          m["status.editor.openFailed"]({ message: (e as Error).message }),
          "error",
        );
        return false;
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
        setStatus(m["status.editor.renamed"]({ path: newPath }));
      } catch (e) {
        setStatus(
          m["status.editor.renameFailed"]({ message: (e as Error).message }),
          "error",
        );
      }
    },
    [file?.path, refresh, open, onChanged, setStatus],
  );

  // Drag a row onto a folder — the same follow-the-open-file dance as a rename, since the editor holds a PATH.
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
        setStatus(m["status.editor.moved"]({ path: newPath }));
      } catch (e) {
        setStatus(
          m["status.editor.moveFailed"]({ message: (e as Error).message }),
          "error",
        );
      }
    },
    [file?.path, refresh, open, onChanged, setStatus],
  );

  // Delete: recycle the entry (reversible), refresh, and close the open file if it lived under it.
  const deleteEntry = useCallback(
    async (path: string, isDir: boolean) => {
      const agreed = await askConfirm({
        title: m["ed.deleteTitle"]({
          kind: isDir ? m["ed.folderWord"]() : m["ed.fileWord"](),
          path,
        }),
        body: m["ed.trashBody"](),
        confirmLabel: m["project.delete"](),
        danger: true,
      });
      if (!agreed) return;
      try {
        await api.deleteFile(path);
        await refresh();
        const cur = file?.path;
        if (cur === path || (cur && cur.startsWith(`${path}/`))) {
          setFile(null);
          onEditTarget(null);
        }
        onChanged();
        setStatus(m["status.editor.deleted"]({ path }));
      } catch (e) {
        setStatus(
          m["status.editor.deleteFailed"]({ message: (e as Error).message }),
          "error",
        );
      }
    },
    [file?.path, refresh, onChanged, onEditTarget, setStatus],
  );

  // A library change is live as soon as it is written: this only redraws the tab.
  const afterLibraryChange = useCallback(async () => {
    await refreshLibraries();
  }, [refreshLibraries]);

  const renameLibraryEntry = useCallback(
    async (path: string, newName: string) => {
      try {
        const { path: newPath, repointed } = await api.renameFile(
          path,
          newName,
        );
        await afterLibraryChange();
        // A module's ref is its path: the songs naming it were repointed too (packages/song/docs/moduleMove.md).
        if (repointed?.length) {
          await refresh();
          onChanged();
          setStatus(
            m["status.editor.renamedRepointed"]({
              path: newPath,
              count: repointed.length,
            }),
          );
        }
      } catch (e) {
        setStatus(
          m["status.editor.renameFailed"]({ message: (e as Error).message }),
          "error",
        );
      }
    },
    [afterLibraryChange, refresh, onChanged, setStatus],
  );

  const deleteLibraryEntry = useCallback(
    async (path: string, isDir: boolean) => {
      const library = libraryOfPath(path) ?? "";
      const agreed = await askConfirm({
        title: m["ed.deleteTitle"]({
          kind: isDir ? m["ed.folderWord"]() : m["ed.fileWord"](),
          path,
        }),
        body: m["ed.libraryDeleteBody"]({ library }),
        confirmLabel: m["project.delete"](),
        danger: true,
      });
      if (!agreed) return;
      try {
        await api.deleteFile(path);
        await afterLibraryChange();
      } catch (e) {
        setStatus(
          m["status.editor.deleteFailed"]({ message: (e as Error).message }),
          "error",
        );
      }
    },
    [afterLibraryChange, setStatus],
  );

  // A module dragged to another folder of its library: moved, and its refs repointed here.
  const moveLibraryModule = useCallback(
    async (path: string, toDir: string) => {
      try {
        const { from, to, repointed } = await api.moveLibraryModule(
          path,
          toDir,
        );
        await afterLibraryChange();
        await refresh();
        onChanged();
        setStatus(
          repointed.length
            ? m["status.editor.movedRepointed"]({
                from,
                to,
                count: repointed.length,
              })
            : m["status.editor.movedUnnamed"]({ from, to }),
        );
      } catch (e) {
        showToast({
          message: m["status.editor.moveFailed"]({
            message: (e as Error).message,
          }),
          variant: "error",
        });
      }
    },
    [afterLibraryChange, refresh, onChanged, setStatus],
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
        setStatus(m["status.editor.created"]({ path: rel }));
      } catch (e) {
        setStatus(
          m["status.editor.createFailed"]({ message: (e as Error).message }),
          "error",
        );
      }
    },
    [refresh, open, onChanged, setStatus],
  );

  // Right-click New folder: an empty folder inside the target, with nothing to open afterwards.
  const createFolder = useCallback(
    async (dir: string, name: string) => {
      try {
        const { path } = await api.createFolder(dir, name);
        await refresh();
        onChanged();
        setStatus(m["status.editor.folderCreated"]({ path }));
      } catch (e) {
        setStatus(
          m["status.editor.folderFailed"]({ message: (e as Error).message }),
          "error",
        );
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
        setStatus(m["status.editor.cloned"]({ path: newPath }));
      } catch (e) {
        setStatus(
          m["status.editor.cloneFailed"]({ message: (e as Error).message }),
          "error",
        );
      }
    },
    [refresh, open, onChanged, setStatus],
  );

  // New node: add an <node>.yaml and open it — the point of a node is to state what it overrides.
  const createNodeEntry = useCallback(
    async (path: string) => {
      try {
        const { path: newPath } = await api.createNode(path);
        await refresh();
        void open(newPath);
        onChanged();
        setStatus(m["status.editor.created"]({ path: newPath }));
      } catch (e) {
        setStatus(
          m["status.editor.nodeFailed"]({ message: (e as Error).message }),
          "error",
        );
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
        const ap = projectDir(activeProject);
        if (!ap) return all;
        return all.filter((p) => norm(p).startsWith(`${ap}/`));
      },
      currentFile: () => file?.path ?? null,
      editorFocused: () => !!cmViewRef.current?.hasFocus,
      localUndoDepth: () =>
        cmViewRef.current ? undoDepth(cmViewRef.current.state) : 0,
      localRedoDepth: () =>
        cmViewRef.current ? redoDepth(cmViewRef.current.state) : 0,
      localUndo: () => (cmViewRef.current ? undo(cmViewRef.current) : false),
      localRedo: () => (cmViewRef.current ? redo(cmViewRef.current) : false),
      // Unscoped, unlike `files` above: refusing a path here would be a second, quieter rule than the service's.
      entries: () => allEntries(tree).map((e) => e.path),
      isDir: (path) => !!allEntries(tree).find((e) => e.path === path)?.dir,
      refreshLibraries: () => void refreshLibraries(),
      createFile: createProjectFile,
      createFolder,
      rename: renameEntry,
      move: moveEntry,
      remove: deleteEntry,
      // Through the tree, because the pins and the two file inputs are its own — see FileTreeHandle.
      togglePin: (path) => treeRef.current?.togglePin(path) ?? null,
      pickUpload: (dir, folder) => {
        const t = treeRef.current;
        if (!t) return false;
        if (folder) t.pickFolder(dir);
        else t.pickFiles(dir);
        return true;
      },
    }),
    [
      open,
      tree,
      activeProject,
      file?.path,
      createProjectFile,
      createFolder,
      renameEntry,
      moveEntry,
      deleteEntry,
    ],
  );

  // The open file follows disk: clean buffers refresh silently, a dirty one asks, because only the person knows which version matters.
  const diskSync = useDiskSync({
    path: file && !file.binary ? file.path : null,
    content: file && !file.binary ? file.content : null,
    dirty,
    saved,
    onAdopt: useCallback((text: string) => {
      // Into the view OUTSIDE its undo history first: Ctrl+Z must not take back a write that was not this buffer's.
      const v = cmViewRef.current;
      if (v?.dom.isConnected && v.state.doc.toString() !== text)
        v.dispatch({
          changes: { from: 0, to: v.state.doc.length, insert: text },
          annotations: Transaction.addToHistory.of(false),
        });
      setFile((f) => (f ? { ...f, content: text } : f));
      setSaved(text);
    }, []),
    onClean: useCallback(
      () =>
        setFile((f) => {
          if (f) setSaved(f.content);
          return f;
        }),
      [],
    ),
    reloadKey,
  });

  // The write autosave performs; it does NOT re-read afterwards, a re-read under a moved cursor being what useDiskSync exists to stop.
  const write = useCallback(
    async (text: string) => {
      const path = file?.path;
      if (!path) return;
      const { forked } = await api.write(path, text);
      setSaved(text);
      // A file in the shared `_modules` library is not written: the module is copied into the project, so open the copy.
      if (forked) {
        // …and the fork LANDED in the project's own `modules/`, which is a library level too.
        await Promise.all([refresh(), refreshLibraries()]);
        void open(forked.path);
        onChanged();
        setStatus(
          forked.chains.length
            ? m["status.editor.forkedRepointed"]({
                ref: forked.ref,
                module: forked.module,
                chains: forked.chains.join(", "),
              })
            : m["status.editor.forked"]({
                ref: forked.ref,
                module: forked.module,
              }),
        );
        return;
      }
      setStatus(m["status.editor.saved"]({ path }));
      // The reload re-reads the tree and the completions too: a second `refresh()` here fetched both twice per save.
      onChanged();
    },
    [file?.path, refresh, open, onChanged, setStatus],
  );

  const autosave = useAutosave({
    path: file && !file.binary ? file.path : null,
    text: file?.content ?? "",
    saved,
    write,
    // Not while the disk's version is being asked about: a write now would answer the question for the person.
    enabled: diskSync.conflict === null,
  });
  // The bar is where this pane already says what it did, and a failed write is what the badge is too small to explain.
  useEffect(() => {
    if (autosave.status === "error" && autosave.reason)
      setStatus(
        m["status.editor.saveFailed"]({ reason: autosave.reason }),
        "error",
      );
  }, [autosave.status, autosave.reason, setStatus]);

  // Drop OS files onto the tree: upload each into the dropped folder, sequentially, skipping existing names.
  const [uploadState, setUploadState] = useState<{
    fileName: string;
    loaded: number;
    total: number;
    done: number;
    count: number;
  } | null>(null);

  // `files` carry the path they sat at, so a dropped FOLDER lands as a folder (see the shared tree's lib/droppedEntries.ts).
  const uploadFiles = useCallback(
    async (dir: string, files: DroppedFile[]) => {
      if (!files.length) return;
      // The files as they are, streamed from disk by the upload: their sizes give the total without reading them.
      const entries = files.map(({ path, file }) => ({
        name: path,
        bytes: file as Blob,
        size: file.size,
      }));
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
            setStatus(
              m["status.editor.uploadFailed"]({ name, message: err.message }),
              "error",
            );
            showToast({
              message: m["status.editor.uploadFailedShort"]({ name }),
              variant: "error",
            });
            return;
          }
        }
      }
      setUploadState(null);
      await refresh(); // the new files join the tree + completions
      // A sound dropped into a LIBRARY lists under the Libraries tab, which reads its own route.
      if (dir.startsWith(`${LIBRARIES_DIR}/`)) void refreshLibraries();
      onChanged(); // a dropped clip/asset may change the project
      const uploaded =
        dir === "."
          ? m["status.editor.uploadedRoot"]({ count: added })
          : m["status.editor.uploaded"]({ count: added, dir });
      const msg = skipped
        ? m["status.editor.uploadedSkipped"]({ uploaded, skipped })
        : uploaded;
      setStatus(msg);
      if (added > 0) showToast({ message: msg, variant: "success" });
    },
    [refresh, refreshLibraries, onChanged, setStatus],
  );

  /** What the gutter draws: the project's load findings for this file, plus what autosave found in the BUFFER — two moments, two sources. */
  const lintItems = useMemo<LintItem[]>(
    () => [
      ...fileDiagnostics,
      ...autosave.issues.map((i) => ({
        line: i.line ?? 1,
        col: i.col ?? 1,
        message: i.path ? `${i.path}: ${i.message}` : i.message,
      })),
    ],
    [fileDiagnostics, autosave.issues],
  );

  // The buffer's derived reads (slices, input, channels) trail the keystroke: deferred, one parse, gated by what the text can hold.
  const readFile = useDeferredValue(file);
  const reads = useMemo(
    () =>
      !readFile || readFile.binary
        ? NO_READS
        : readBuffer(readFile.content, readFile.path),
    [readFile],
  );
  // Is the open file an INPUT? Read off the buffer, so a node just pointed at `@meta/IN` grows its channel strip as you type.
  const inputIo = reads.io;

  const readers = useMemo<VideoReader[]>(() => {
    if (
      !strip ||
      !readFile ||
      readFile.binary ||
      !isVideoTrackFile(readFile.path)
    )
      return [];
    return listVideoPlacements(readFile.content).flatMap((p) => {
      const src = videoSources[p.ref];
      return src
        ? [{ ref: p.ref, src, sourceFrom: p.sourceFrom, length: p.length }]
        : [];
    });
  }, [strip, readFile, videoSources]);

  // A reader's button edits the same buffer a keystroke does, so autosave writes it the same way.
  const setPlacement = useCallback(
    (ref: string, field: "source_from" | "length", value: number) =>
      setFile((f) =>
        f && !f.binary
          ? {
              ...f,
              content: setVideoPlacementField(f.content, ref, field, value),
            }
          : f,
      ),
    [],
  );

  const editable = !!file && !file.binary;
  // The grid tabs only make sense on a sequence file (they show its notes).
  const isSeq = !!file && isSeqFile(file.path);
  // Which grid is showing, or null for the text — everything else falls back to the editor without the tabs deciding.
  const grid = popin && isSeq && editable && tab !== "text" ? tab : null;

  /** The MODULE behind the open file when the popin shows an INSTANCE — read from the BUFFER and resolved as a ctrl-click does (moduleBehind.ts). */
  const moduleSide =
    popin && file && !file.binary && !grid
      ? moduleBehind(file.content, hints, file.path)
      : null;

  // Whether the docked slicer's drags have anything of THIS buffer's to write: the symbols must live in the open file.
  const canSliceEdit = editable && reads.slices;

  /** The library's chains as `clip process` names them, filtered by what is typed. */
  const clipOps = useMemo(
    () => filterOps(chainOps(libChains), opSearch),
    [libChains, opSearch],
  );

  /** Run one chain over the open clip, serialised through `processing`; the ref is the file's STEM, the only name the verb knows. */
  const runProcess = useCallback(
    async (chain: string) => {
      if (!file || processing) return;
      setProcessing(true);
      try {
        await command(processLine(fileStem(file.path), chain));
      } finally {
        setProcessing(false);
      }
    },
    [file, processing, command],
  );
  /** A CLIP file's own band is draggable too, by the same machinery — one overlay, one gesture, told apart by the band's symbol. */
  const canWindowEdit = useMemo(
    () => !!file && !file.binary && isClipFile(file.path),
    [file],
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <EditorToolbar
        tree={tree}
        file={file}
        activeProject={activeProject}
        projectName={projectName}
        onOpen={open}
        onOpenProject={onOpenProject}
        seqTabs={popin && isSeq}
        tab={tab}
        onTab={setTab}
        onOpenBuilder={onOpenBuilder}
        processing={processing}
        opSearch={opSearch}
        onOpSearch={setOpSearch}
        clipOps={clipOps}
        onProcess={(c) => void runProcess(c)}
        autosave={autosave}
      />
      {diskSync.conflict !== null && (
        <DiskConflictBar
          onKeep={diskSync.keepEditing}
          onTake={diskSync.takeDisk}
        />
      )}
      <div className="relative flex min-h-0 flex-1">
        {/* 256px of tree beside a phone's screen leaves nothing to edit in, so it becomes a drawer closed by picking a file. */}
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
            <LibraryUpgrades
              levels={libraries}
              engineLevel={engineLevel}
              onUpgrade={async (ns, version) => {
                await command(`library upgrade ${ns} ${version}`);
                await refreshLibraries();
              }}
            />
            <FileTree
              ref={treeRef}
              tree={tree}
              activePath={file?.path ?? null}
              activeProject={activeProject}
              projectName={projectName}
              rootDir={activeProject ?? "."}
              onOpen={(path) => {
                open(path);
                if (isMobile) setTreeOpen(false);
              }}
              // A module row opens the BUILDER on its panel — its three files are not rows of their own.
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
              onCreateNode={createNodeEntry}
              levels={libraries}
              chains={libChains}
              onOpenChain={onOpenChain}
              assemblies={libAssemblies}
              onOpenAssembly={onOpenAssembly}
              onCreateModule={async (root, rel) => {
                try {
                  const { path } = await api.createModule(root, rel);
                  // Both halves: `root` IS a library level, so this is one of the two acts that can move that list.
                  await Promise.all([refresh(), refreshLibraries()]);
                  // Straight into the builder: making a module and then hunting for its row is two acts where somebody meant one.
                  onOpenLibraryModule(path);
                } catch (e) {
                  setStatus((e as Error).message, "error");
                }
              }}
              onRenameLibraryEntry={renameLibraryEntry}
              onDeleteLibraryEntry={deleteLibraryEntry}
              onMoveLibraryModule={moveLibraryModule}
              onOpenLibraryModule={(moduleFile) => {
                onOpenLibraryModule(moduleFile);
                if (isMobile) setTreeOpen(false);
              }}
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
        <main className="relative flex min-w-0 flex-1 flex-col overflow-hidden">
          {/* The chains builder takes the EDITOR's place beside the file tree, absolute inside this main so nothing unmounts (docs/chainsBuilder.md). */}
          {chainsBuilder}
          {/* …and so does the module builder: the tree stays beside it, to open the next module from (../../docs/moduleBuilder.md). */}
          {moduleBuilder ? (
            <div className="absolute inset-0 z-30 bg-background">
              {moduleBuilder}
            </div>
          ) : null}
          {/* The open file's sync conflicts, named over the text they are about (docs/conflicts.md). */}
          <ConflictBanner file={file?.path ?? null} />
          <div className="min-h-0 flex-1">
            {/* A grid edit lands in the SAME buffer a keystroke does, so switching tabs mid-edit shows the text you just drew. */}
            {grid && file ? (
              <SeqGrid
                view={grid}
                content={file.content}
                racks={hints.racks}
                resetKey={file.path}
                onChange={(v) => setFile({ ...file, content: v })}
              />
            ) : (
              // The wrapper is ALWAYS this flex row, so toggling the module pane cannot remount the main editor.
              <div className="flex h-full min-h-0">
                <div className="min-w-0 flex-1">
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
                      if (file) setFile({ ...file, content: v });
                    }}
                    onSave={autosave.flush}
                    onOpenEntity={open}
                    onPreview={handlePreview}
                    onPlayStrip={playStrip}
                    /** The dock's edge drags — a rack symbol's window, or the clip's own; both rewrite the OPEN BUFFER rather than run a verb. */
                    onSliceEdit={
                      canSliceEdit || canWindowEdit
                        ? (symbol, from, to) => {
                            if (!file || file.binary) return;
                            const next =
                              symbol === "clip" && canWindowEdit
                                ? setClipWindowText(
                                    file.content,
                                    from,
                                    to,
                                    gridOf(audioClip?.project),
                                  )
                                : setSliceWindow(
                                    file.content,
                                    symbol,
                                    from,
                                    to,
                                  );
                            if (next != null)
                              setFile({ ...file, content: next });
                          }
                        : undefined
                    }
                    // The open file's load errors, drawn inline as squiggles.
                    diagnostics={lintItems}
                  />
                </div>
                {/* The instance's MODULE, editable beside it and keyed by path, so extending something else builds a fresh buffer. */}
                {moduleSide && (
                  <ModuleSidePane
                    key={moduleSide}
                    path={moduleSide}
                    refName={
                      readScalarField(file?.content ?? "", "extends") ?? ""
                    }
                    hints={hints}
                    vimMode={vimMode}
                    setStatus={setStatus}
                    onChanged={onChanged}
                  />
                )}
              </div>
            )}
          </div>
          {/* An input's socket, docked under its text and writing the same buffer; `ioOf` reads the extends too, which almost every real input relies on. */}
          {file && inputIo === "in" && (
            <InputChannelBar
              key={file.path}
              devices={inputDevices}
              channels={reads.channels}
              readOnly={false}
              onPick={(chs) =>
                setFile({ ...file, content: setChannelIn(file.content, chs) })
              }
              onRegroup={onRegroupInputs}
            />
          )}
          {/* A picture lane's readers, docked under its text: the in-point of a shot is a FRAME you recognise, not a number. */}
          {readers.length > 0 && (
            <div className="h-52 shrink-0 border-t border-border">
              <VideoReadersStrip
                readers={readers}
                onSetFrom={(ref, t) => setPlacement(ref, "source_from", t)}
                // 'To' is an END and the file stores an EXTENT — the subtraction belongs beside the only place that knows both numbers.
                onSetTo={(ref, t) => {
                  const p = listVideoPlacements(
                    file && !file.binary ? file.content : "",
                  ).find((x) => x.ref === ref);
                  setPlacement(
                    ref,
                    "length",
                    Math.max(0, t - (p?.sourceFrom ?? 0)),
                  );
                }}
                onClose={() => setStrip(false)}
              />
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
