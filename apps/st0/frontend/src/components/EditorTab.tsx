// EditorTab.tsx — the project-file editor: a CodeMirror pane with schema-aware completion,
// a breadcrumb and (when there's room) a file tree. ONE instance serves both layouts — a
// second would fork the open file, its unsaved text and the undo history. There is no Save
// button: the buffer is written as soon as it is a document the compiler could read
// (packages/ui-editor/docs/autosave.md). Saving does NOT format either — the writers emit
// canonical YAML, and reflowing a hand-edited file is what this format was chosen to avoid.

import { redo, redoDepth, undo, undoDepth } from "@codemirror/commands";
import type { EditorView } from "@codemirror/view";
import { Button } from "@frediverse/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@frediverse/ui/dropdown-menu";
import type { DroppedFile } from "@frediverse/ui/file-tree";
import { cn } from "@frediverse/ui/lib/utils";
import { showToast } from "@studio/project-shell/toast";
import {
  listVideoPlacements,
  setVideoPlacementField,
} from "@studio/song/yaml/videoTrackFile";
import { recallBuffer, useAutosave } from "@studio/ui-editor/autosave";
import type { LintItem } from "@studio/ui-editor/lint";
import { InputChannelBar } from "@studio/ui-module-builder/input-channels";
import {
  channelOf,
  ioOf,
  setChannelIn,
} from "@studio/ui-module-builder/module-ui";
import type { ModuleLibrary } from "@studio/web-protocol";
import {
  FileText,
  FolderTree,
  Grid3x3,
  LayoutGrid,
  Loader2,
  Piano,
  TriangleAlert,
  Wand2,
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
import { chainOps, filterOps, processLine } from "../clipOps";
import { clipWindowBand, setClipWindowText } from "../clipWindowText";
import { useDiskSync } from "../hooks/useDiskSync";
import { moduleBehind } from "../moduleBehind";
import {
  fileStem,
  isClipFile,
  isModuleFile,
  isRackModuleFile,
  isSeqFile,
  isTrackFile,
  isVideoTrackFile,
  moduleFileOf,
  rackKeyOf,
  readScalarField,
} from "../projectPaths";
import { movedTheTree, movedTheVocabulary, type Reload } from "../reloadScope";
import type { SeqView } from "../sequenceEdit";
import { rackSliceRanges, scanSlices, setSliceWindow } from "../sliceSymbols";
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
import { Breadcrumb } from "./Breadcrumb";
import type { EditTarget } from "./ClipView";
import { EditorPane } from "./EditorPane";
import { FileTree, type FileTreeHandle } from "./FileTree";
import type { MinimapItem } from "./Minimap";
import { ModuleSidePane } from "./ModuleSidePane";
import { SeqGrid } from "./SeqGrid";
import { UploadProgress } from "./UploadProgress";
import { type VideoReader, VideoReadersStrip } from "./VideoReadersStrip";

// The handle the shell reaches the editor through: `open` opens a file, `files` is what `file` completes against.
// The `local*` methods expose the live CodeMirror buffer so the shell can arbitrate Ctrl+Z between the
// editor's own keystroke history and the project-wide undo journal — see App.tsx's onKey.
export interface EditorHandle {
  /** Read a file into the pane. Answers whether it LANDED — a caller that reveals the pane on the
   *  strength of it must not pop one open over a read that refused (see App's openInEditor). */
  open: (path: string) => Promise<boolean>;
  files: () => string[];
  currentFile: () => string | null;
  editorFocused: () => boolean;
  localUndoDepth: () => number;
  localRedoDepth: () => number;
  localUndo: () => boolean;
  localRedo: () => boolean;
  // The tree's right-click menu, as the shell can reach it: every entry there is a `file …`
  // command, and this is where those land. Each is the SAME callback the menu item runs, so a
  // command and a right-click cannot come to mean different things.
  entries: () => string[];
  createFile: (dir: string, name: string) => void;
  createFolder: (dir: string, name: string) => void;
  rename: (path: string, newName: string) => void;
  move: (path: string, toDir: string) => void;
  remove: (path: string, isDir: boolean) => void;
  // The two the SIDEBAR holds — the pins are its localStorage, the pickers its hidden inputs.
  // `null`/`false` means it is not on screen (a phone with the tree collapsed, the popin
  // editor), which the caller reports rather than pretending the action happened.
  togglePin: (path: string) => boolean | null;
  pickUpload: (dir: string, folder: boolean) => boolean;
  /** Is this path a folder? `file …` has to tell "into which" from "which", and only the tree knows. */
  isDir: (path: string) => boolean;
  /**
   * Re-read the module LIBRARIES — the levels and the chains in them.
   *
   * On the handle because the other writer of a library is outside this pane: the module
   * builder, which the shell opens over the whole app and which PUBLISHES on save. The pane
   * stopped asking for these after every command (they cost 82 ms and a command cannot move
   * them), so the acts that do move them have to say so, and this is how the one upstairs does.
   */
  refreshLibraries: () => void;
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

// EVERY path the tree holds, folders included and binaries kept — what a `file …` command may
// name. `textFiles` above answers a narrower question (what the editor can open) and is the
// vocabulary `ui file` completes against; renaming a .wav is not opening it.
function allEntries(nodes: FileNode[]): { path: string; dir: boolean }[] {
  const out: { path: string; dir: boolean }[] = [];
  const walk = (ns: FileNode[]): void => {
    for (const n of ns) {
      out.push({ path: n.path, dir: !!n.dir });
      if (n.children) walk(n.children);
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

// The rack module a sequence names via use_rack, so a slice rack can dock its source waveform.
const findUseRack = (text: string): string | null =>
  readScalarField(text, "use_rack");

// The grid a clip's window is read and written on — a timecode edge means nothing without it.
// Defaulted rather than optional: an edge spelled in SECONDS needs no grid at all, and refusing to
// draw or move one because the doc had not arrived would be an outage for the commoner spelling.
const gridOf = (p: WebProject | null | undefined) => ({
  tempo: p?.tempo || 120,
  num: p?.timeSigNumerator || 4,
  den: p?.timeSigDenominator || 4,
});

// What the toolbar says where the Save button was. "clean" says nothing: a file that is saved
// is the ordinary state, and a badge for it would be noise on every screen.
const SAVE_LABEL: Record<string, string> = {
  clean: "",
  pending: "edited",
  saving: "saving…",
  held: "not saved",
  error: "save failed",
};

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
  setStatus,
  onEditTarget,
  onOpenItem,
  onOpenBuilder,
  onOpenLibraryModule,
  onOpenChain,
  chainsBuilder,
  diagnostics,
  videoSources,
  inputDevices,
  onRegroupInputs,
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
  /**
   * The shell's "something changed", and what — see `reloadScope.ts`.
   *
   * This pane is the reason the list exists: it holds the two routes that answer about FILES and
   * about NAMES, and it re-asked both after every command in the app.
   */
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
  /**
   * Run a command line through the shell — the SAME path the palette and every key binding take,
   * so what happens here is journalled, undoable and typeable.
   *
   * It is also what refreshes the open file afterwards, and that is not a coincidence to rely on
   * quietly: `runCommand` bumps `reloadKey` when it is done, and this component's `useDiskSync`
   * re-reads the file on that key. A process that rewrites `clips/<ref>.yaml` therefore lands in
   * the buffer without a second path having to exist — and a buffer with unsaved edits is ASKED
   * rather than overwritten, which a bespoke re-read here would have got wrong.
   */
  command: (line: string) => void | Promise<void>;
  setStatus: (s: string) => void;
  onEditTarget: (t: EditTarget | null) => void; // the open sequence, for the Editor panel
  onOpenItem: (item: MinimapItem | null) => void; // the open clip/track, for the minimap
  // Open the shared module builder over the shell, on the MODULE file of the trio — plus which of the three
  // was clicked, so its code pane opens on the file the click pointed at.
  onOpenBuilder: (path: string, pane: "module" | "panel" | "presets") => void;
  // …and the same builder over a SHARED module, from the Libraries tab. Its own callback and not
  // a flag on the one above, because the path is in the médiathèque's space and not the
  // workspace's — and the two spell a module identically (see ../library.ts).
  onOpenLibraryModule: (moduleFile: string) => void;
  /** A chain row of the Libraries tab was opened — its ref, for the chains builder. */
  onOpenChain: (ref: string, node?: string) => void;
  /** The chains builder, when one is open — rendered in the editor's own place. */
  chainsBuilder?: React.ReactNode;
  /**
   * Each picture clip ref → the media file it names, from the COMPILED document.
   *
   * From the compiler and not from the buffer because only the compiler has read
   * `clips/<ref>.yaml` to find out. A ref it has never seen simply gets no reader, which is the
   * honest answer rather than a black rectangle. The times come from the buffer — see `readers`.
   */
  videoSources: Record<string, string>;
  // The interface's inputs, for the channel strip an `io: in` file gets under its text. Here and
  // not only in the builder because an input is usually a NODE — two lines, `extends: "@engine/IN"`
  // and a channel — and nobody opens a builder on those. See ui-module-builder/docs/inputChannels.md.
  inputDevices: { name: string; channels: number[] }[];
  onRegroupInputs?: (channel: number, stereo: boolean) => void;
  ref?: React.Ref<EditorHandle>;
}) {
  // Everything that only needs "something happened" still keys off the counter, and there is one
  // of them — derived here rather than passed beside the token, which would be two props to agree.
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
  /**
   * The module libraries, fetched beside the tree and refreshed with it.
   *
   * NOT read out of `tree` — that one is deliberately the active project's own files, and the
   * two shared levels sit outside it (`packages/file-service/docs/activeProject.md`). Trying to
   * find them in it is why this tab was empty: they were never there.
   */
  const [libraries, setLibraries] = useState<ModuleLibrary[]>([]);
  /** The library CHAINS, fetched and refreshed exactly as the module levels are — same repo. */
  const [libChains, setLibChains] = useState<{ ref: string; path: string }[]>(
    [],
  );
  /**
   * The Process menu on a clip file: which chain is running, and what is typed in its search.
   *
   * The chains themselves are `libChains`, fetched by `refreshLibraries()` — the waveform panel
   * asks `/library-chains` for itself because it opens on its own, whereas this pane has the
   * list in hand and a second request would only be able to disagree with it.
   */
  const [processing, setProcessing] = useState(false);
  const [opSearch, setOpSearch] = useState("");
  // What is on disk for the open file. Dirty is derived from it and the buffer, never a flag:
  // with autosave writing constantly, a flag is one more thing that can disagree with the text.
  const [saved, setSaved] = useState("");
  const dirty = !!file && !file.binary && file.content !== saved;
  // Which tab of a sequence is open in the POPIN — its text, or one of the two note grids.
  // Only there: fullscreened, this pane is the text editor and the grids have their own home
  // in the main view (`sequence edit roll|tracker`, see docs/noteGrids.md).
  const [tab, setTab] = useState<"text" | SeqView>("text");
  // The readers strip, shown for a lane file until dismissed. Per-session and per-pane: it is a
  // dock over the text, not a property of the file.
  const [strip, setStrip] = useState(true);
  // The audio clip this clips/*.yaml links to: it docks at the bottom of the CODE pane, not the shared panel.
  const [audioClip, setAudioClip] = useState<{
    project: WebProject;
    clip: WebClip;
    // Span the whole source, not the placed region — what a clips/*.yaml shows (see WaveformView).
    whole?: boolean;
    // Slice-rack windows to overlay on the waveform — coloured, when they are a rack's slices.
    // `hollow` is the clip band of a file that trims nothing: handles without a wash.
    sliceRanges?: {
      symbol: string;
      from: number;
      to: number;
      color?: string;
      hollow?: boolean;
    }[];
    // What the strip's ▶ sends. A clip file names its CLIP, so the window the file declares is
    // what plays; a rack's dock names the plain SOURCE it shares, which has no window at all.
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
    // The request that opened it, kept so the strip's ▶ can play it again: the `clip` synthesised
    // below cannot be turned back into one — a source preview's id is a PATH, not a clip name.
    play: PreviewReq;
  } | null>(null);

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

  // Audition from a gutter ▶: play it AND fetch a waveform to dock. Playback happens regardless of the fetch.
  const previewSound = useCallback(
    async (req: PreviewReq) => {
      try {
        const proj = await api.projectDoc();
        const root = (hints.projectRoot || "").replace(/[\\/]+$/, "");
        // ALREADY-absolute stays untouched: a ▶ in a pane reached by absolute path (the popin's
        // module side, a ctrl-click) resolves its source absolute, and prefixing the root onto
        // that built `<project>\C:\…` — a stat nothing could ever satisfy.
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
            // The RESOLVED request — `handlePreview` rewrites a rack's relative source
            // project-relative before playing it, and a ▶ resending the raw one would miss.
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
      void previewSound(r);
    },
    [previewSound, setStatus, filePath, activeProject],
  );

  /**
   * The waveform strip's ▶ — send the request the strip already carries, and nothing else.
   *
   * No `resolveGutterSource` here on purpose: a strip's request is the one that was PLAYED (or
   * the clip id of the file you have open), so resolving it again would prefix a rack module's
   * directory twice. And no `previewSound`: the strip is already showing what this plays.
   */
  const playStrip = useCallback(
    async (req: PreviewReq) => {
      try {
        const { start, length } = await api.preview(req);
        return { start, length };
      } catch (e) {
        setStatus(`preview error: ${(e as Error).message}`);
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
    const p = file.path.replace(/\\/g, "/");
    let cancelled = false;
    const stem = fileStem(p);

    if (isSeqFile(p)) {
      // A sequence driving a SLICE rack docks that rack's source waveform, with each symbol's [from,to] drawn on it.
      const useRack = findUseRack(file.content);
      const rack = useRack ? hints.racks[useRack] : undefined;
      if (rack && rack.rackType === "slice" && rack.source) {
        const source = rack.source;
        const ranges = rackSliceRanges(rack.symbols);
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
            // The rack's shared SOURCE, whole: a slice rack's windows belong to its symbols, and
            // the file itself declares none — ▶ here plays the material every symbol cuts from.
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
              // The CLIP, not its source: the file's own `from`/`to` are what ▶ has to honour, and
              // the service resolves them — timecode spelling included — from this id alone.
              play: { kind: "clip", clip: clip.id },
              // Editable: this buffer IS the clip file, so the band's edges are handles even when
              // it trims nothing — otherwise only an already-trimmed clip could be trimmed.
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

    /**
     * A SLICE RACK — the module.yaml itself, or a NODE of one (two lines, `extends` +
     * `type: rack`, the symbols living in the module) — docks the SOURCE waveform with every
     * symbol's window in its own colour: the slicer. It used to be inline waveforms under each
     * symbol line of the module file; one picture with coloured windows replaced them, and the
     * symbol names in the text wear the same hues (sliceSymbols.ts). `rackKeyOf` is what lets
     * one map answer for both spellings of "this file is a rack".
     */
    const nodeKey = rackKeyOf(p);
    const nodeRack = nodeKey ? hints.racks[nodeKey] : undefined;
    if (nodeRack?.rackType === "slice" && nodeRack.source) {
      // In the popin SPLIT the module pane docks this same picture, and the module's is the
      // editable one — once is enough, so the instance side stands down when the split shows.
      if (popin && moduleBehind(file.content, hints, p) != null) {
        setAudioClip(null);
        onEditTarget(null);
        return;
      }
      const source = nodeRack.source;
      const ranges = rackSliceRanges(nodeRack.symbols);
      void api
        .projectDoc()
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
  }, [active, file, hints, onEditTarget, popin]);

  /**
   * The LIBRARIES — the shared module levels and the chains in them.
   *
   * Split off, and the reason is a measurement. These two read the SHARED FOLDERS
   * (`_libraries`, `_modules`) and the project's own `modules/`; the service memoises neither,
   * so each call walks them and builds a tree. On `01.danse.st0` that is 70 ms / 100 KB and
   * 12 ms — and it was being paid on every `reloadKey`, which is after EVERY command in the app.
   * A fader, a mute, a stretch point: none of them can put a module in a library.
   *
   * So this is asked when it can have MOVED rather than when anything moved: on mount, and by the
   * two actions that write there (`createModule` below, and the module builder's save, which the
   * shell reports through the handle). `project pull` is the case this does not cover, and the
   * honest statement of the limit is that a library changed OUTSIDE this tab shows up the next
   * time the pane mounts — the same bargain "many browsers at once" already takes for everything
   * else. What it buys is 82 ms off every command, on the one thread the service has.
   */
  const refreshLibraries = useCallback(async () => {
    try {
      const [l, c] = await Promise.all([
        api.moduleLibraries(),
        api.libraryChains(),
      ]);
      setLibraries(l.libraries);
      setLibChains(c.chains);
    } catch (e) {
      setStatus(`load error: ${(e as Error).message}`);
    }
  }, [setStatus]);

  /**
   * The project's own tree and vocabulary — what a command CAN have changed.
   *
   * `want` is for the one caller that knows better: the reload below, which has the list of files
   * the command wrote. Both by default, because every OTHER caller here has just created, renamed,
   * moved or deleted something and means all of it — a default that is the truth for them rather
   * than a convenience.
   */
  const refresh = useCallback(
    async (want = { tree: true, hints: true }) => {
      try {
        const [t, h] = await Promise.all([
          want.tree ? api.tree() : null,
          want.hints ? api.hints() : null,
        ]);
        if (t) setTree(t);
        if (h) setHints(h);
      } catch (e) {
        setStatus(`load error: ${(e as Error).message}`);
      }
    },
    [setStatus],
  );
  /**
   * …and after a command, only the half of it that can have moved.
   *
   * Measured on `01.danse.st0`: `/tree` is 27 ms / 35 KB and `/hints` is 65 ms / 108 KB, on the
   * one thread everything else queues behind, and this pane asked for both after EVERY command in
   * the app — a fader, a mute, a stretch point. Neither can answer differently for any of those:
   * no file appears, and nothing is named. The predicates and the one limit they leave are in
   * `reloadScope.ts`; a reload that says nothing about its files still asks for both.
   *
   * The libraries' half is on mount alone — see `refreshLibraries` for what that buys and costs.
   */
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

  const open = useCallback(
    async (path: string): Promise<boolean> => {
      const posix = path.replace(/\\/g, "/").toLowerCase();
      // A .dawproject is a ZIP and a .als gzip — offer to import either rather than decoding bytes as text.
      if (posix.endsWith(".dawproject") || posix.endsWith(".als")) {
        onImportProject(path);
        return false; // an import is not a file in the pane, so nothing should be revealed for it
      }
      try {
        const f = await api.read(path);
        // Never open a binary: the tree disables them, but the breadcrumb reaches here too, so guard centrally.
        if (f.binary) {
          setStatus(`${path} — binary file, not shown`);
          return false;
        }
        // An edit that could never be written — it did not compile — outlived the pane showing
        // it. Give it back rather than the disk copy, which is not what the author last typed.
        const kept = recallBuffer(path);
        setFile(kept == null ? f : { ...f, content: kept });
        setSaved(f.content);
        setStatus(path);
        return true;
      } catch (e) {
        setStatus(`open error: ${(e as Error).message}`);
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

  // New node: add an <node>.yaml and open it — the point of a node is to state what it overrides.
  const createNodeEntry = useCallback(
    async (path: string) => {
      try {
        const { path: newPath } = await api.createNode(path);
        await refresh();
        void open(newPath);
        onChanged();
        setStatus(`created ${newPath}`);
      } catch (e) {
        setStatus(`new node failed: ${(e as Error).message}`);
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
      // Unscoped, unlike `files` above: a command may name the workspace root or a sibling
      // project's folder, and refusing it here would be a second, quieter rule than the
      // service's — which is the one that actually decides what may be touched.
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

  // The open file follows disk: every command here rewrites YAML, so a buffer read once and never again is a
  // snapshot of the past that the next Save writes back over everything since. Clean buffers refresh silently;
  // a dirty one asks, because only the person knows which of the two versions matters.
  const diskSync = useDiskSync({
    path: file && !file.binary ? file.path : null,
    content: file && !file.binary ? file.content : null,
    dirty,
    onAdopt: useCallback((text: string) => {
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

  // The write autosave performs. It does NOT re-read the file afterwards the way the Save
  // button did: a write is not a reformat, so what is on disk is the text just sent — and a
  // re-read landing under a cursor that has moved on is the edit-eating useDiskSync exists to
  // stop. That hook still watches the file for changes made anywhere else.
  const write = useCallback(
    async (text: string) => {
      const path = file?.path;
      if (!path) return;
      const { forked } = await api.write(path, text);
      setSaved(text);
      // A file in the shared `_modules` library isn't written: the module is copied into the project and the
      // chains follow. Open the copy, so what's on screen is the file that now holds the edit. The text is
      // identical, so the cursor stays where it was.
      if (forked) {
        // …and the fork LANDED in the project's own `modules/`, which is a library level too.
        await Promise.all([refresh(), refreshLibraries()]);
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
      setStatus(`saved ${path}`);
      await refresh(); // a new/edited entity updates the tree + completions
      onChanged(); // the arrangement / graph may have changed
    },
    [file?.path, refresh, open, onChanged, setStatus],
  );

  const autosave = useAutosave({
    path: file && !file.binary ? file.path : null,
    text: file?.content ?? "",
    saved,
    write,
  });
  // The bar is where this pane already says what it did, and a failed write is the one thing
  // the badge is too small to explain.
  useEffect(() => {
    if (autosave.status === "error" && autosave.reason)
      setStatus(`save error: ${autosave.reason}`);
  }, [autosave.status, autosave.reason, setStatus]);

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

  /**
   * What the gutter draws: the project's load findings for this file, plus what autosave found
   * in the BUFFER.
   *
   * Two sources because they answer at different moments. The server's arrive on a 2s poll and
   * describe what is on disk; autosave's describe the text you are looking at, and are the
   * reason it is not being written — which would otherwise be a sentence in the toolbar with no
   * line attached to it.
   */
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

  /**
   * The readers for an open picture lane — one per placement the BUFFER declares.
   *
   * Two sources, deliberately. The TIMES come from the buffer, because a trim typed a second
   * ago has no compiled form yet and a strip that waited for one would be a step behind every
   * edit. The FILE each ref names comes from the compiled document (`videoSources`), because
   * only the compiler has read `clips/<ref>.yaml` to find out.
   */
  // Is the open file an INPUT? Read off the buffer, so a node that has just been pointed at
  // `@engine/IN` grows its channel strip as you type rather than after a save.
  const inputIo = useMemo(
    () => (!file || file.binary ? null : ioOf(file.content ?? "", file.path)),
    [file],
  );

  const readers = useMemo<VideoReader[]>(() => {
    if (!strip || !file || file.binary || !isVideoTrackFile(file.path))
      return [];
    return listVideoPlacements(file.content).flatMap((p) => {
      const src = videoSources[p.ref];
      return src
        ? [{ ref: p.ref, src, sourceFrom: p.sourceFrom, length: p.length }]
        : [];
    });
  }, [strip, file, videoSources]);

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
  // Which grid is showing, or null for the text. Everything else — a fullscreen pane, a file
  // with no notes in it, a binary — falls back to the editor without the tabs deciding.
  const grid = popin && isSeq && editable && tab !== "text" ? tab : null;

  /**
   * The MODULE behind the open file, when the popin shows an INSTANCE: a node's own file names
   * its per-instance fields, and what those override lives one `extends:` away — so the popin
   * shows both, side by side, both editable. Read from the BUFFER, so retyping the extends line
   * swaps the pane, and resolved exactly as a ctrl-click on it resolves (moduleBehind.ts). A
   * base with no file to edit — `@engine/…`, the `@studio/…` track bases — resolves to nothing
   * and the popin stays one pane. Popin only: the full-screen editor has the tree, and a second
   * file there is one click away rather than a question.
   */
  const moduleSide =
    popin && file && !file.binary && !grid
      ? moduleBehind(file.content, hints, file.path)
      : null;

  // Whether the docked slicer's drags have anything of THIS buffer's to write: the symbols must
  // live in the open file. A node's dock shows the module's slices — read-only here, editable in
  // the pane whose buffer holds them (the popin's module side, or the module file itself).
  const canSliceEdit = useMemo(
    () => !!file && !file.binary && scanSlices(file.content) != null,
    [file],
  );

  /** The library's chains as `clip process` names them, filtered by what is typed. */
  const clipOps = useMemo(
    () => filterOps(chainOps(libChains), opSearch),
    [libChains, opSearch],
  );

  /**
   * Run one chain over the open clip.
   *
   * Serialised through `processing` so a double-click cannot put two renders on one file, and
   * the ref is the file's STEM — `clips/<ref>.yaml` is where the editor found it, and the stem
   * is the only name the verb knows. The reload is `command`'s; see its prop comment.
   */
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
  /**
   * A CLIP file's own band is draggable too, and by the same machinery.
   *
   * The window and a rack slice's are the same picture of the same thing — two seconds into one
   * file — so they are one overlay with one gesture, told apart by the band's symbol. What differs
   * is only which writer the release calls, which is why this is a second flag rather than a
   * second set of handles.
   */
  const canWindowEdit = useMemo(
    () => !!file && !file.binary && isClipFile(file.path),
    [file],
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-2 border-b border-border px-3 py-1.5">
        <Breadcrumb
          tree={tree}
          path={file?.path ?? null}
          // Where `tree` is rooted: `Workspace.tree()` walks from the active project while
          // keeping every path workspace-relative, so the breadcrumb needs BOTH to tell the
          // two spaces apart. "." is a lone-project workspace — the tree is already the root.
          root={activeProject && activeProject !== "." ? activeProject : ""}
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
        {/* The waveform panel's "operations" menu, on the clip's TEXT — every chain the library
            offers, run over this clip. Same list, same verb, same one command (../clipOps.ts):
            editing `from`/`to` by hand and treating the audio are two halves of the same sitting,
            and only one of them used to be reachable from here.

            The refresh the act ends in is `runCommand`'s: it bumps `reloadKey`, and `useDiskSync`
            re-reads the open file on that key — `clip process` repoints `source:` at the render it
            just made, so the buffer has to follow or it would overwrite it on the next save. */}
        {file && isClipFile(file.path) && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                size="sm"
                variant="secondary"
                disabled={processing}
                title="run a library chain over this clip — the render lands beside the source"
              >
                {processing ? (
                  <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                ) : (
                  <Wand2 className="mr-1 h-4 w-4" />
                )}
                Process
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-64 p-1">
              <input
                value={opSearch}
                onChange={(e) => setOpSearch(e.target.value)}
                placeholder="chercher une chaîne…"
                // Not autofocused, for the reason the waveform panel's is not: the menu takes the
                // focus itself, and stealing it back breaks the arrow keys the list is walked with.
                className="mb-1 w-full rounded border bg-transparent px-2 py-1 text-xs outline-none"
              />
              <div className="max-h-64 overflow-auto">
                {clipOps.length === 0 ? (
                  <p className="px-2 py-1 text-xs text-muted-foreground">
                    aucune chaîne
                  </p>
                ) : (
                  clipOps.map((c) => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => void runProcess(c)}
                      className="block w-full truncate rounded px-2 py-1 text-left text-xs hover:bg-muted"
                    >
                      {c}
                    </button>
                  ))
                )}
              </div>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
        {/* Where the Save button was. It says nothing while the file is saved — that is the
            normal state — and stays amber, with the reason, for as long as it is not. */}
        <span
          className={cn(
            "flex min-w-0 shrink items-center gap-1 text-xs",
            autosave.status === "held" || autosave.status === "error"
              ? "text-amber-500"
              : "text-muted-foreground",
          )}
          title={autosave.reason ?? undefined}
        >
          {autosave.status === "saving" && (
            <Loader2 className="h-3 w-3 shrink-0 animate-spin" />
          )}
          <span className="truncate">
            {SAVE_LABEL[autosave.status]}
            {(autosave.status === "held" || autosave.status === "error") &&
            autosave.reason
              ? ` — ${autosave.reason}`
              : ""}
          </span>
        </span>
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
              onCreateNode={createNodeEntry}
              levels={libraries}
              chains={libChains}
              onOpenChain={onOpenChain}
              onCreateModule={async (root, rel) => {
                try {
                  const { path } = await api.createModule(root, rel);
                  // Both halves: `root` IS a library level, so this is one of the two acts that
                  // can move the list `refreshLibraries` otherwise only reads on mount.
                  await Promise.all([refresh(), refreshLibraries()]);
                  // Straight into the builder: making a module and then hunting for the row
                  // you just made is two acts where somebody meant one.
                  onOpenLibraryModule(path);
                } catch (e) {
                  setStatus((e as Error).message);
                }
              }}
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
          {/* The chains builder takes the EDITOR's place — beside the file tree, which is its
              navigation — rather than covering the shell. Absolute inside this main, so the tree
              keeps its width and nothing under it unmounts. */}
          {chainsBuilder}
          <div className="min-h-0 flex-1">
            {/* A grid edit lands in the SAME buffer a keystroke does — so switching tabs mid-edit
                shows the text you just drew, and autosave writes it whichever way you made it. */}
            {grid && file ? (
              <SeqGrid
                view={grid}
                content={file.content}
                racks={hints.racks}
                resetKey={file.path}
                onChange={(v) => setFile({ ...file, content: v })}
              />
            ) : (
              // The wrapper is ALWAYS this flex row, side pane or not, so toggling the module
              // pane cannot remount the main editor — its undo history is the popin's one file.
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
                    /**
                     * The dock's edge drags — a rack symbol's window, or the clip's own.
                     *
                     * Both rewrite the OPEN BUFFER rather than run a verb, which is what makes the
                     * text under the waveform move with the hand: autosave carries it to disk on
                     * its own timer, and one Ctrl+Z undoes the drag like any other edit. `symbol`
                     * is what tells them apart — `clipWindowBand` names its one band "clip".
                     */
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
                {/* The instance's MODULE, editable beside it — see `moduleSide` above. Keyed by
                    path, so extending something else builds a fresh buffer rather than pouring
                    a different file into an old one. */}
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
          {/* An input's socket, docked under its text for the same reason the readers are: which
              preamp a guitar is in is a thing you PICK off the interface, not a number to remember.
              Same buffer as the editor above, so it is visible before it is saved and undoable by
              not saving. Shown for a node that only INHERITS its io — `ioOf` reads the extends and
              the path too, which is what almost every input in a real song relies on. */}
          {file && inputIo === "in" && (
            <InputChannelBar
              key={file.path}
              devices={inputDevices}
              channels={channelOf(file.content)}
              readOnly={false}
              onPick={(chs) =>
                setFile({ ...file, content: setChannelIn(file.content, chs) })
              }
              onRegroup={onRegroupInputs}
            />
          )}
          {/* A picture lane's readers, docked under its text: the in-point of a shot is a FRAME
              you recognise, not a number you can type. Same buffer as the editor above. */}
          {readers.length > 0 && (
            <div className="h-52 shrink-0 border-t border-border">
              <VideoReadersStrip
                readers={readers}
                onSetFrom={(ref, t) => setPlacement(ref, "source_from", t)}
                // "To" is an END, and the file stores an EXTENT — the subtraction belongs here,
                // beside the only place that knows both numbers.
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
