// App.tsx — the st0 web shell: the panes the project DECLARES (editor | timeline over
// chains), the file tree, the command bar, the mixer, the clip editors, the transport
// header, and the Shift-Shift command palette. One layout, and every pane in it stays
// mounted — `full`/`focus` only decide size and keys, so no open file, caret or zoom is
// ever lost. Live engine state goes to an external store, never App state. See docs/shell.md.

import { AppHeader } from "@frediverse/ui/app-header";
import { Badge } from "@frediverse/ui/badge";
import { Button } from "@frediverse/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@frediverse/ui/dialog";
import { FrediverseMark } from "@frediverse/ui/frediverse-mark";
import { cn } from "@frediverse/ui/lib/utils";
import type { EngineUrl } from "@studio/engine-browser";
import { PluginParamsStore } from "@studio/engine-browser/params";
import {
  arrayEq,
  EngineStore,
  EngineStoreProvider,
  useStoreState,
} from "@studio/engine-browser/store";
import type { PresetInfo, TransportAction } from "@studio/engine-protocol";
import { AskHost } from "@studio/project-shell/ask";
import { markActive } from "@studio/project-shell/idle";
// The address of ONE surface, for another device to open — the same module the launch uses, so both spell a project alike (docs/external.md).
import {
  externalUrl,
  parseLaunch,
  projectsUrl,
} from "@studio/project-shell/launch";
import { showToast, Toaster } from "@studio/project-shell/toast";
import { type HistoryDeps, runRedo, runUndo } from "@studio/project-shell/undo";
// The leaf with no `node:fs` in it — a browser may ask what a path names without dragging the loader in.
import { moduleKeyFromPath } from "@studio/song-schema/moduleTypes";
import { ModulePreview } from "@studio/ui-chains-react/module-preview";
import { type BuilderPane, ModuleBuilder } from "@studio/ui-module-builder";
import { AssemblyBuilder } from "@studio/ui-module-builder/assembly";
import {
  type EngineLatency,
  formatLatency,
} from "@studio/web-protocol/quality";
import {
  Circle,
  ListMusic,
  Loader2,
  Lock,
  Pause,
  Play,
  Settings,
  Share2,
  Square,
  StickyNote,
  Terminal,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, engines, moduleStore } from "./api";
import { DECK_ICONS, STUDIO_ICONS } from "./chainsIcons";
import type { MaybeClipboard } from "./clipboard";
import { canonicalizeCommand } from "./commandI18n";
import { type CommandPrefs, labelOf, orderCommands } from "./commandPrefs";
import { AlternativePicker } from "./components/AlternativePicker";
import { AssetPicker } from "./components/AssetPicker";
import type { AudioClipHandle } from "./components/AudioClipPanel";
import { AudioClipPanel } from "./components/AudioClipPanel";
import { ChainsBuilder } from "./components/ChainsBuilder";
import { ChainsTab } from "./components/ChainsTab";
import { ClipView, type EditTarget } from "./components/ClipView";
import {
  CommandBar,
  type CommandBarHandle,
  type CommandPending,
  type PaletteCommand,
} from "./components/CommandBar";
import { CommandsSettings } from "./components/CommandsSettings";
import { ContextMenu } from "./components/ContextMenu";
import { type EditorHandle, EditorTab } from "./components/EditorTab";
import { EditSharedModuleDialog } from "./components/EditSharedModuleDialog";
import { GraphPanel } from "./components/GraphPanel";
import { HelpPage } from "./components/HelpPage";
import { ImportDialog } from "./components/ImportDialog";
import { LogsPanel } from "./components/LogsPanel";
import { MasteringTab } from "./components/MasteringTab";
import { MasterMeter, type MasterMeterHandle } from "./components/MasterMeter";
import { MetronomeButton } from "./components/MetronomeButton";
import { Minimap, type MinimapItem } from "./components/Minimap";
import { MobileMenu, MobileMenuItem } from "./components/MobileChrome";
import {
  type ModulePick,
  ModulePicker,
  type PickerModule,
} from "./components/ModulePicker";
import { PaneSplitter } from "./components/PaneSplitter";
import type { RollHandle } from "./components/PianoRoll";
import { PlaylistsPanel } from "./components/PlaylistsPanel";
import { RackBuilder } from "./components/RackBuilder";
import { SeqGridPane } from "./components/SeqGridPane";
import {
  isSettingsTab,
  SETTINGS_TABS,
  SettingsPanel,
  type SettingsTab,
} from "./components/SettingsPanel";
import { type OpenShare, ShareDownload } from "./components/SharedGate";
import { SharePanel, shareBadge } from "./components/SharePanel";
import { SurfaceTab } from "./components/SurfaceTab";
import { type TimelineHandle, TimelineTab } from "./components/TimelineTab";
import { TrackModulesPane } from "./components/TrackModulesPane";
import { ViewportTab } from "./components/ViewportTab";
import {
  contextMenu,
  type MenuCtx,
  type MenuItem,
  type NodeMenuTarget,
  nodeMenu,
  withAmbient,
} from "./contextMenu";
import { fixedMaster, TARGET_DB, trimFor } from "./gainTrim";
import type { ClipGridHandle } from "./gridCaret";
import { useCameras } from "./hooks/useCameras";
import { useCommandKeys } from "./hooks/useCommandKeys";
import { useEngineLink } from "./hooks/useEngineLink";
import { useInputDevices } from "./hooks/useInputDevices";
import { useLogs } from "./hooks/useLogs";
import type { MidiControlApi } from "./hooks/useMidiControl";
import { useMidiRecording } from "./hooks/useMidiRecording";
import {
  useActiveProjectFollow,
  useGitStatus,
  useOrbit,
  useProjectErrors,
  useWarmWaveforms,
} from "./hooks/usePolls";
import { useProjectImport } from "./hooks/useProjectDialogs";
import { useProjectDoc } from "./hooks/useProjectDoc";
import { noteRevision } from "./hooks/useRevision";
import { isMixFormat, MIX_FORMATS, useShare } from "./hooks/useShare";
import { useSnapshotPlayer } from "./hooks/useSnapshotPlayer";
import { useSurfaces } from "./hooks/useSurfaces";
import { useTrackControls } from "./hooks/useTrackControls";
import { useTurntableDeck } from "./hooks/useTurntableDeck";
import { useVideoDoc } from "./hooks/useVideoDoc";
import { useVideoEdits } from "./hooks/useVideoEdits";
import { useLocale } from "./i18n";
import {
  blurOnClick,
  type ConditionCtx,
  effectiveKeys,
  keyForCommand,
  shortcutsByCommand,
} from "./keys";
import { laneGains } from "./laneGains";
import { isLibraryPath, libraryModuleRef } from "./libraryTree";
import { BARE_TRANSPORT, isUiLine, namesLine } from "./localCommands";
import { headTokens, resolveEntry, resolveModuleFile } from "./localTargets";
import {
  chainRefFromCreate,
  createForGraphCommand,
  ensureModuleCommand,
  type PendingInsert,
  wireCommand,
} from "./nodeInsert";
import { noteSpans } from "./noteSpans";
import { resolveEditorFile } from "./openInEditor";
import { buildPaletteCommands, commandNameOf, makeListArg } from "./palette";
import { m } from "./paraglide/messages.js";
import { closeTopPopin, useAnyPopin, usePopin } from "./popins";
import { entityFile, fileStem } from "./projectPaths";
import { rememberCommand } from "./recentCommands";
import { type Reload, UNKNOWN_RELOAD } from "./reloadScope";
import {
  isRollMode,
  ROLL_MODES,
  ROLL_PRESS,
  type RollMode,
  rollCondition,
} from "./rollMode";
import { type Pane, type Panel, viewPanes } from "./routes";
import type { RowKey, RowTarget } from "./rows";
import { parseSeqEdit, resolveSequence, type SeqView } from "./sequenceEdit";
import {
  MiniTransport,
  MixerIcon,
  PANE_META,
  PANEL_META,
  PANES,
  TransportClock,
} from "./shellMeta";
import {
  placedBeat,
  type TakeOption,
  takeOptions,
  trackPlacing,
} from "./takeReview";
import { modeCondition, type TimelineMode } from "./timelineMode";
import { isTool, TOOLS, type Tool } from "./timelineTools";
import type {
  CommandInfo,
  ProjectInfo,
  WebAutomationLane,
  WebGraph,
  WebVideoTrack,
  WorkspaceInfo,
} from "./types";
import { useIsMobile } from "./useIsMobile";
import { useViewRoute } from "./useViewRoute";
import { videoSpans } from "./videoSpans";
import {
  isWaveMode,
  WAVE_MODES,
  type WaveMode,
  waveCondition,
} from "./waveMode";

// Build stamp baked in by the Dockerfile; "dev" anywhere it wasn't set.
const VERSION = import.meta.env.VITE_APP_VERSION ?? "dev";

/** One frozen empty list, so a builder with no live plugin does not get a new array per render. */
const EMPTY_PRESETS: PresetInfo[] = [];

/** The same, for a song with no picture — which is most of them. Keeps the timeline's row memo cold. */
const EMPTY_VIDEO_TRACKS: WebVideoTrack[] = [];

export default function App({
  engineUrl,
  engineLatency,
  userEmail,
  onQuitWorkspace,
  onChangeEngine,
  snapshot,
}: {
  engineUrl: EngineUrl;
  /** What the link measured — the footer's Q badge; null when the gate could not, which the badge says. */
  engineLatency: EngineLatency | null;
  /** Who is logged in — feeds the SESSION id, so two people on one engine hold two projects. */
  userEmail: string;
  onQuitWorkspace: () => void;
  /** Back to the engine picker — the settings panel's Compte tab. */
  onChangeEngine: () => void;
  /** The FROZEN snapshot this shell draws when it was opened through a share link — see docs/shared.md. */
  snapshot?: OpenShare;
}) {
  // Read once as a boolean: nearly every call site asks 'is this editable', not 'which snapshot is it'.
  const frozen = !!snapshot;
  // The layout: null is the global view, a pane name is that pane expanded; `focus` is which pane owns the keys.
  const [full, setFull] = useState<Pane | null>(null);
  // A phone shows one pane, not the studio layout — the hamburger drives `full`. See docs/shell.md.
  const isMobile = useIsMobile();
  const [mobileMenu, setMobileMenu] = useState(false);
  // The timeline, because it is what the default view opens on — see ringPanes.
  const [focusPane, setFocusPane] = useState<Pane>("timeline");
  const [panel, setPanel] = useState<Panel | null>(null);
  // The CHAINS BUILDER: a library chain being edited by its ref, `""` for the list, null closed — docs/chainsBuilder.md.
  const [openBuilder, setOpenBuilder] = useState<string | null>(null);
  /** The NODE of that chain to land on — its file name, or null for the chain itself. Not in the URL. */
  const [builderNode, setBuilderNode] = useState<string | null>(null);
  // The module the shared builder is open on, or null — an overlay, not a pane, so nothing under it unmounts.
  const [builder, setBuilder] = useState<{
    path: string;
    pane: BuilderPane;
    /** Whether this shared module has been unlocked for editing; whether it IS shared is read off the path. */
    unlocked?: boolean;
  } | null>(null);
  /** The assembly TEMPLATE open in its builder: the file, and its folder's graph once it lands. */
  const [assemblyBuilder, setAssemblyBuilder] = useState<{
    file: string;
    folder: string;
  } | null>(null);
  const [assemblyGraph, setAssemblyGraph] = useState<WebGraph | null>(null);
  /** …and whether it has been unlocked, the same one-click confirmation a shared module opens behind. */
  const [assemblyUnlocked, setAssemblyUnlocked] = useState(false);
  // The template's own graph is what the builder lists params from: an assembly folder IS a graph folder.
  useEffect(() => {
    if (!assemblyBuilder) {
      setAssemblyGraph(null);
      return;
    }
    let live = true;
    void api
      .graphAt(assemblyBuilder.folder)
      .then((g) => live && setAssemblyGraph(g))
      .catch(() => live && setAssemblyGraph(null));
    return () => {
      live = false;
    };
  }, [assemblyBuilder]);
  // The shared module the Edit button asks about, held so the dialog closes without touching what is behind it.
  const [editShared, setEditShared] = useState<string | null>(null);
  /** The LIVE plugin behind the builder's module, matched on the chain step's NAME — see docs/moduleBuilder.md. */
  const [builderPlugin, setBuilderPlugin] = useState<{
    module: string;
    pluginId: string;
  } | null>(null);
  // The documentation overlay (/docs), read RAW before the router mounts — hence slicing BASE_URL off by hand here.
  const [showHelp, setShowHelp] = useState(() =>
    ["docs", "help"].includes(
      window.location.pathname
        .slice(import.meta.env.BASE_URL.length - 1)
        .replace(/^\/+|\/+$/g, ""),
    ),
  );
  const [panelH, setPanelH] = useState(280);
  /** A pane's dragged size in px, by pane. Absent (or 0) means it is still on the Tailwind
   *  fraction it opens at — see components/PaneSplitter.tsx. */
  const [paneSize, setPaneSize] = useState<Partial<Record<Pane, number>>>({});
  const sizePane = useCallback(
    (p: Pane, px: number) =>
      setPaneSize((cur) => ({ ...cur, [p]: px > 0 ? px : undefined })),
    [],
  );
  // One ref per resizable pane: the splitter measures the pane it resizes at drag start.
  const viewportPaneRef = useRef<HTMLDivElement>(null);
  const timelinePaneRef = useRef<HTMLDivElement>(null);
  const deskPaneRef = useRef<HTMLDivElement>(null);
  const masteringPaneRef = useRef<HTMLDivElement>(null);
  const [editTarget, setEditTarget] = useState<EditTarget | null>(null);

  // What the editor has open (a clip/track), for the minimap's highlight ring.
  const [openItem, setOpenItem] = useState<MinimapItem | null>(null);
  // The timeline caret: its row for the minimap, its id for m/s, its timecodes for `caretAnswers` in commandFill.ts.
  const [caret, setCaret] = useState<{
    row: RowKey;
    beat: number;
    trackId: string | null;
    tc: string | null;
    eventTc: string | null;
    selection: { tracks: string; from: string; to: string } | null;
  } | null>(null);
  /** The caret as the COMMAND BAR reads it — narrowed here to keep commandFill.ts free of the timeline's vocabulary. */
  const caretAim = useMemo(
    () =>
      caret
        ? {
            track: caret.trackId,
            at: caret.tc,
            eventStart: caret.eventTc,
            selTracks: caret.selection?.tracks ?? null,
            selFrom: caret.selection?.from ?? null,
            selTo: caret.selection?.to ?? null,
          }
        : null,
    [caret],
  );
  const [project, setProject] = useState<ProjectInfo | null>(null);
  const [ws, setWs] = useState<WorkspaceInfo | null>(null);
  // The take this tab has dismissed: the server names the last one for ever, so this is what shows the review ONCE.
  const [reviewedTake, setReviewedTake] = useState<string | null>(null);
  /** Where the take now rolling STARTED, in beats — one source for two surfaces, read at the `rolling` edge rather than subscribed. */
  const [takeStart, setTakeStart] = useState(0);
  // …and the one ASKED for by name (`ui review <clip>`), which outranks it — how a take is reopened afterwards.
  const [reviewOn, setReviewOn] = useState<{
    clip: string;
    track: string;
  } | null>(null);
  // The engine's live state as an EXTERNAL store, so a component re-renders only when its own slice changes.
  const store = useRef(new EngineStore()).current;
  const playing = useStoreState(store, (s) => s.playing);
  // NOTE: App does NOT subscribe to `playhead` — at ~20 Hz that would re-render the whole tree every frame.
  const armed = useStoreState(store, (s) => s.armed, arrayEq);
  // Global record enable — ENGINE session state, so it comes straight off the frame; play then records the armed.
  const recordEnabled = useStoreState(store, (s) => s.recordEnabled);
  const [statusLine, setStatusLine] = useState<{
    text: string;
    refused: boolean;
  }>({ text: "", refused: false });
  const status = statusLine.text;
  /** Say something on the status line — and, by saying it this way, say it is NOT a refusal; only `runCommand` refuses. */
  const setStatus = useCallback(
    (text: string) => setStatusLine({ text, refused: false }),
    [],
  );
  /** …and the other half: a command was understood and declined. `runCommand` is its one caller. */
  const setRefusal = useCallback(
    (text: string) => setStatusLine({ text, refused: true }),
    [],
  );
  /** 'Something changed — re-read what you draw', plus WHAT changed: `files`, which reloadScope.ts reads (null = re-ask). */
  const [reload, setReload] = useState<Reload>(UNKNOWN_RELOAD);
  const reloadKey = reload.key;
  // Bumped when `graph organize` runs: the one signal that lets dagre re-lay out every drawn node.
  const [organizeKey, setOrganizeKey] = useState(0);
  // The unscoped bump: whatever the caller did, it is not saying what moved.
  const bumpReload = useCallback(
    () => setReload((r) => ({ key: r.key + 1, files: null })),
    [],
  );
  // MIDI recording is browser-side (the engine records audio only), one track at a time, landing in its sequence.
  const [midiArmed, setMidiArmed] = useState<string | null>(null);
  const [tlView, setTlView] = useState<{
    mode: TimelineMode;
    tool: Tool;
    selecting: boolean;
    zoomed: boolean;
    loop: boolean;
    expanded: boolean;
  }>({
    mode: "normal",
    tool: "pointer",
    selecting: false,
    zoomed: false,
    loop: false,
    expanded: false,
  });
  /** Which panel has the RIGHT COLUMN, or null — one state because there is one column (docs/shell.md). */
  const [rightPanel, setRightPanel] = useState<
    "settings" | "playlists" | "share" | null
  >(null);
  /** Which tab the settings panel shows, kept while closed so the cog reopens where you left it. */
  const [settingsTab, setSettingsTab] = useState<SettingsTab>(SETTINGS_TABS[0]);
  /** The command catalogue, the one settings screen still drawn as a full PAGE. */
  const [commandsPage, setCommandsPage] = useState(false);
  /** Open `which`, or close it when it is already the one showing — every panel button toggles. */
  const toggleRight = useCallback(
    (which: "settings" | "playlists" | "share") =>
      setRightPanel((cur) => (cur === which ? null : which)),
    [],
  );
  // Vim mode is a global user preference (~/.studio/preferences.yaml). Starts ON to match the brain's default.
  const [vimMode, setVimMode] = useState(true);
  useEffect(() => {
    void api
      .preferences()
      .then((p) => setVimMode(p.vim))
      .catch(() => {});
  }, []);
  const cmdRef = useRef<CommandBarHandle>(null);
  // On a wide screen the bar is DOCKED and always there; `paletteOpen` governs the PHONE's popin alone (docs/commandBar.md).
  const docked = !isMobile;
  const [paletteOpen, setPaletteOpen] = useState(false);
  // Which field the command bar is waiting on, or null — it decides whether a gesture ACTS or feeds the bar (docs/commandBar.md).
  const [barPending, setBarPending] = useState<CommandPending | null>(null);
  // …and read LIVE by the phone's dismiss timer below, which fires after the state that would have told it not to.
  const barPendingRef = useRef<CommandPending | null>(null);
  barPendingRef.current = barPending;

  /** The PHONE's bar goes away when it loses the keyboard — two guards, both load-bearing; see docs/commandBar.md. */
  const dismiss = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onBarFocusChange = useCallback(
    (focused: boolean) => {
      if (dismiss.current) {
        clearTimeout(dismiss.current);
        dismiss.current = null;
      }
      if (docked || focused) return;
      dismiss.current = setTimeout(() => {
        dismiss.current = null;
        if (!barPendingRef.current) setPaletteOpen(false);
      }, 150);
    },
    [docked],
  );
  useEffect(() => () => clearTimeout(dismiss.current ?? undefined), []);
  // The editor as a POPIN: the SAME instance, restyled onto the surface — see docs/shell.md.
  const [editorPopin, setEditorPopin] = useState(false);
  // A popin in the registry's sense too, so Esc closes it; its own vim keeps Escape while you are typing in it.
  usePopin(editorPopin, () => setEditorPopin(false));
  // The rack builder popin — a 4×4 pad grid ending in modules/instruments/<name>; Esc and the backdrop close it.
  const [rackBuilder, setRackBuilder] = useState(false);
  usePopin(rackBuilder, () => setRackBuilder(false));
  // Whether ANY overlay is up, this shell's or a component's own. Drives the `popin` condition.
  const anyPopin = useAnyPopin();
  /** What the chains slot shows INSTEAD of the graph, or null — three occupants, one state (docs/shell.md). */
  const [graphSlot, setGraphSlot] = useState<
    | { kind: "grid"; path: string; view: SeqView }
    | { kind: "clip"; target: EditTarget }
    | { kind: "recording" }
    // One track's modules side by side, opened by a double-click on the lane's header — see docs/shell.md.
    | { kind: "trackModules"; trackId: string }
    | null
  >(null);
  /** The mixer view: the SAME graph, with every strip pulled onto one rank (`alignModuleRank`). */
  const [mixerView, setMixerView] = useState(false);

  /** Whether the graph draws the project's NOTES — off by default and not remembered; `docCount` is reported up by the pane holding the graph. */
  const [showDocs, setShowDocs] = useState(false);
  const [docCount, setDocCount] = useState(0);
  /** What the graph knows about each lane's node — its other attribute sets and its freeze, travelling up like `docCount`. */
  const [laneNodes, setLaneNodes] = useState<{
    alternatives: WebGraph["trackAlternatives"];
    frozen: WebGraph["frozen"];
    automation: Record<string, WebAutomationLane[]>;
  }>({ alternatives: undefined, frozen: undefined, automation: {} });

  // A take rolling (record enabled AND playing) shows it, one-way: the pane STAYS when the take ends, only the × puts the graph back.
  const rolling = recordEnabled && playing;
  useEffect(() => {
    if (rolling)
      setGraphSlot((s) =>
        s?.kind === "recording" ? s : { kind: "recording" },
      );
  }, [rolling]);
  const timelineRef = useRef<TimelineHandle>(null);
  /** The clip pane's caret — the timeline handle's three verbs on whichever grid the pane draws (gridCaret.ts). */
  const clipGridRef = useRef<ClipGridHandle>(null);
  /** The AUDIO leaf's counterpart of `clipGridRef`, and the mode it is in — one clip pane draws one or the other. */
  const waveRef = useRef<AudioClipHandle>(null);
  const [waveView, setWaveView] = useState<WaveMode | null>(null);
  /** …and the ROLL's, the third surface with a mode of its own (rollMode.ts). */
  const rollRef = useRef<RollHandle>(null);
  const [rollMode, setRollMode] = useState<RollMode | null>(null);
  const [clipSel, setClipSel] = useState(false);
  /** The shell's ONE clipboard, carrying its KIND so one paste verb names the surface — see clipboard.ts. */
  const [clipboard, setClipboard] = useState<MaybeClipboard>(null);
  const clipboardRef = useRef<MaybeClipboard>(null);
  clipboardRef.current = clipboard;
  // The chains pane owns the MIDI runtime; the shell only reaches in to arm a learn — see docs/midi.md.
  const chainsMidiRef = useRef<MidiControlApi | null>(null);
  const editorRef = useRef<EditorHandle>(null);

  // Undo/redo: a process step (restoring a bounced file) is gated behind this confirm dialog.
  const [undoConfirm, setUndoConfirm] = useState<{
    files: string[];
    label: string;
    resolve: (ok: boolean) => void;
  } | null>(null);
  // Registered like the other dialogs; refusing IS an answer here, so the closer resolves the promise.
  usePopin(!!undoConfirm, () => {
    if (!undoConfirm) return;
    undoConfirm.resolve(false);
    setUndoConfirm(null);
  });
  const confirmProcess = useCallback(
    (files: string[], label: string) =>
      new Promise<boolean>((resolve) =>
        setUndoConfirm({ files, label, resolve }),
      ),
    [],
  );
  const historyDeps = useMemo<HistoryDeps>(
    () => ({
      openFile: (p) => editorRef.current?.open(p),
      notify: (message, variant) => showToast({ message, variant }),
      confirmProcess,
      currentFile: () => editorRef.current?.currentFile() ?? null,
      onApplied: bumpReload,
    }),
    [confirmProcess, bumpReload],
  );
  // Live plugin params go to an EXTERNAL store: at ~20 Hz a top-level setState would re-render the app each frame.
  const pluginParamsStore = useRef(new PluginParamsStore()).current;
  // The backend command catalogue (canonical name + trailing param names), for the step-by-step palette. Fetched once.
  const [backendCmds, setBackendCmds] = useState<CommandInfo[]>([]);
  /** What this person has made of the command catalogue — names, icons, order, in the ACCOUNT's preferences (commandPrefs.ts). */
  const [commandPrefs, setCommandPrefs] = useState<CommandPrefs>({});
  useEffect(() => {
    void engines
      .prefs()
      .then((p: unknown) =>
        setCommandPrefs((p as { commands?: CommandPrefs })?.commands ?? {}),
      )
      .catch(() => {}); // never saved any: the defaults are the catalogue's own
  }, []);
  // Optimistic and not awaited; ONE call per Save, because this state is the app's root.
  const saveCommandPrefs = useCallback((next: CommandPrefs) => {
    setCommandPrefs(next);
    void engines.patchPrefs({ commands: next }).catch(() => {});
  }, []);
  // The keymap as this person has it, computed once per prefs change — the key listener reads it on every press.
  const effKeys = useMemo(() => effectiveKeys(commandPrefs), [commandPrefs]);
  // …and the same table read the other way, for a legend that can only ever advertise a key that binds (keys.ts).
  const shortcuts = useMemo(
    () => shortcutsByCommand(commandPrefs),
    [commandPrefs],
  );
  const lastActive = useRef<string | null>(null);
  const pendingPrewrite = useRef<string | null>(null);

  // The Logs panel's buffer + the process-log tail (polled only while it's open).
  const { logs, pushLog, clearLogs } = useLogs(panel);

  // The engine connection: client lifecycle, live state wiring, stable senders.
  const {
    engineRef,
    connected,
    engineReady,
    engineBusy,
    // …and the same flag as a REF, for the local command dispatcher, which must not be rebuilt when it changes.
    engineBusyRef,
    engineWarnings,
    watchWaveform,
    transport: engineTransport,
    seek: engineSeek,
    requestPluginParams,
    setPluginParam,
    watchPluginParams,
    pluginParamMeta,
    presets,
    listPresets,
    setPreset,
  } = useEngineLink(
    engineUrl,
    userEmail,
    store,
    pluginParamsStore,
    setStatus,
    pushLog,
  );

  /** On a snapshot the transport is a browser clock over rendered audio, substituted at the two verbs and nowhere else. */
  const player = useSnapshotPlayer(snapshot, store);
  const transport = snapshot ? player.transport : engineTransport;
  const seek = snapshot ? player.seek : engineSeek;
  // Into the status line rather than a dialog: a refused autoplay is something to READ, the rest of the screen still works.
  useEffect(() => {
    if (player.fault) setStatus(player.fault);
  }, [player.fault]);

  // Where playback LAST STARTED, in seconds — read off the store's frames, so a start from anywhere counts.
  const replayAtRef = useRef(0);
  useEffect(() => {
    let wasPlaying = store.getSnapshot().playing;
    let restingAt = store.getSnapshot().playhead;
    return store.subscribe(() => {
      const s = store.getSnapshot();
      if (!s.playing) restingAt = s.playhead;
      else if (!wasPlaying) replayAtRef.current = restingAt;
      wasPlaying = s.playing;
    });
  }, [store]);

  /** A playing song is an ACTIVE session: without this the idle timer would cut a set mid-way — @studio/project-shell/docs/idle.md. */
  useEffect(() => {
    if (!playing) return;
    markActive();
    const t = setInterval(markActive, 60_000);
    return () => clearInterval(t);
  }, [playing]);

  // The special views this PROJECT declares (`surfaces/`), and the engine as a desk sees it — both cheap and unconditional.
  const { surfaces } = useSurfaces(reloadKey);
  /** The project's ARRANGEMENT, if it declares one: a `split` surface of type `timeline`, false for a frame or two on open. */
  const timelineSurface = useMemo(
    () =>
      surfaces.find(
        (s) => s.surface.type === "timeline" && s.surface.layout === "split",
      ) ?? null,
    [surfaces],
  );
  const hasTimeline = !!timelineSurface;
  /** The project's FRAME, if it declares one: the DECLARATION mounts it, not the document. */
  const viewportSurface = useMemo(
    () =>
      surfaces.find(
        (s) => s.surface.type === "viewport" && s.surface.layout === "split",
      ) ?? null,
    [surfaces],
  );
  const hasViewport = !!viewportSurface;
  // The song's picture — fetched ONCE here, since the timeline draws its lanes and the viewport composites them.
  const { doc: videoDoc, error: videoError } = useVideoDoc(reloadKey);
  const videoTracks = videoDoc?.videoTracks ?? EMPTY_VIDEO_TRACKS;
  // When each lane is showing a frame, so a picture cable knows to ripple — memoised, being a subscription's input (videoSpans.ts).
  const videoLaneSpans = useMemo(() => videoSpans(videoDoc), [videoDoc]);
  // Each picture clip ref → the media file it names; flattened here because only the COMPILER knows it.
  const videoSources = useMemo(() => {
    const out: Record<string, string> = {};
    for (const t of videoTracks) for (const c of t.clips) out[c.id] = c.src;
    return out;
  }, [videoTracks]);

  // Commit a finished picture drag — hooks/useVideoEdits.ts, shared with the surface a second device draws.
  const applyVideoEdit = useVideoEdits(
    ws?.activeProject ?? ".",
    bumpReload,
    setStatus,
  );
  /** The project's DESK, if it declares one: a `split` surface of type `turntables`, a pane in the column. */
  const turntablesSurface = useMemo(
    () =>
      surfaces.find(
        (s) => s.surface.type === "turntables" && s.surface.layout === "split",
      ) ?? null,
    [surfaces],
  );
  const hasTurntables = !!turntablesSurface;

  /** …and its MASTER STRIP, if it declares one — beside the graph, since every knob on it is a param on ONE module there (docs/mastering.md). */
  const masteringSurface = useMemo(
    () =>
      surfaces.find(
        (s) => s.surface.type === "mastering" && s.surface.layout === "split",
      ) ?? null,
    [surfaces],
  );
  const hasMastering = !!masteringSurface;

  /** The addresses this project's surfaces answer on, for the share panel — EVERY surface, since all four draw there (docs/external.md). */
  const externals = useMemo(() => {
    const at = parseLaunch(
      window.location.pathname,
      "st0",
      import.meta.env.BASE_URL,
    );
    if (!at) return [];
    return surfaces.map((s) => ({
      id: s.id,
      type: s.surface.type,
      url: externalUrl(window.location.href, at, s.id, "st0"),
    }));
  }, [surfaces]);

  const turntableDeck = useTurntableDeck({
    store,
    engineRef,
    engineReady,
    watchPluginParams,
    pluginParamsStore,
    engineUrl,
  });

  /** What the modules with NO plugin are set to, for the three screens that draw a graph — undefined when no surface realises one (docs/shell.md). */
  const offlineParams = hasTurntables ? turntableDeck.moduleParams : undefined;

  // The screen is mirrored in the URL both ways; these four setters are the only way it changes. See routes.ts.
  useViewRoute(
    {
      full,
      panel,
      help: showHelp,
      builder: openBuilder,
    },
    useCallback((next) => {
      setFull(next.full);
      setPanel(next.panel);
      setShowHelp(next.help);
      setOpenBuilder(next.builder);
    }, []),
    {
      timeline: hasTimeline,
      viewport: hasViewport,
      turntables: hasTurntables,
      frozen,
    },
  );
  const openHelp = useCallback(() => setShowHelp(true), []);
  const closeHelp = useCallback(() => setShowHelp(false), []);

  // Any change of layout puts the popin away: it is a detour to one file, not a place to be.

  // biome-ignore lint/correctness/useExhaustiveDependencies: the layout changing IS the signal.
  useEffect(() => {
    setEditorPopin(false);
  }, [full]);

  // Optimistic, like the mixer: the editor switches modality on the click and the write's answer settles it.
  const toggleVim = useCallback(async () => {
    const next = !vimMode;
    setVimMode(next);
    try {
      const { vim } = await api.setVim(next);
      setVimMode(vim);
      setStatus(`vim mode ${vim ? "on" : "off"}`);
    } catch (e) {
      setVimMode(!next);
      setStatus(`vim error: ${(e as Error).message}`);
    }
  }, [vimMode]);

  // The second pane of the current view and the ring `tab` walks — the layout's own list, the editor excluded (`viewPanes` in routes.ts).
  const layout = useMemo(
    () =>
      viewPanes({
        timeline: hasTimeline,
        viewport: hasViewport,
        turntables: hasTurntables,
        mastering: hasMastering,
        frozen,
      }),
    [hasTimeline, hasViewport, hasTurntables, hasMastering, frozen],
  );
  const ringPanes = layout.ring;

  // Whether there is an arrangement on screen — the SURFACE's answer, and now the only one.
  const noArrangement = !hasTimeline;

  // The popin IS the active pane while it is up: the pane underneath must not also answer the keys.
  const activePane = editorPopin ? "editor" : (full ?? focusPane);
  const visible = useCallback(
    (p: Pane) => (full === null ? ringPanes.includes(p) : full === p),
    [full, ringPanes],
  );

  /** Is the chains pane off screen? ONE answer, read by the class that hides it and by the `active` it is handed. */
  const chainsOffScreen =
    full === "timeline" ||
    // The desk fullscreened takes the column exactly as the arrangement does.
    full === "turntables" ||
    (full === null && !ringPanes.includes("chains")) ||
    // Expanded lanes give the timeline the whole column — only possible in a layout that HAS a timeline.
    (full === null && ringPanes.includes("timeline") && tlView.expanded);

  /** Is the graph the ONLY pane in the column? What decides `flex-1` and whether ChainsTab draws its sidebar. */
  const chainsAlone = ringPanes.length === 1;

  const timelineVisible = visible("timeline");
  /** The DESK alone on screen: the transport then drives nothing visible — docs/shell.md. */
  const deskOnly =
    visible("turntables") && !timelineVisible && !visible("viewport");
  // Never without an ARRANGEMENT: the minimap is a second view of one, and floats over the popin the docked strip cannot serve (docs/shell.md).
  const minimapFloating = docked && !noArrangement && editorPopin;
  const minimapDocked =
    docked && !noArrangement && !timelineVisible && !editorPopin;

  /** How tall the floating strip is, so the popin can stop ABOVE it — measured, since the minimap sizes itself to the track count. */
  const stripRef = useRef<HTMLDivElement | null>(null);
  const [stripH, setStripH] = useState(0);
  useEffect(() => {
    const el = stripRef.current;
    if (!el) {
      setStripH(0);
      return;
    }
    const ro = new ResizeObserver(() => setStripH(el.offsetHeight));
    ro.observe(el);
    setStripH(el.offsetHeight);
    return () => ro.disconnect();
  }, [minimapFloating]);

  const focusOn = useCallback(
    (p: Pane) => {
      if (p === focusPane) return;
      setFocusPane(p);
      setEditTarget(null);
    },
    [focusPane],
  );

  /** Give one pane the whole screen — the ONE road there, and the point where a layout without that pane refuses out loud. */
  const fullscreen = useCallback(
    (p: Pane) => {
      if (!layout.fullscreen.includes(p)) {
        setStatus(
          `this project declares no ${PANE_META[p].label.toLowerCase()} surface, so there is no such pane to expand.`,
        );
        return;
      }
      setFull(p);
      focusOn(p);
    },
    [focusOn, layout],
  );

  const paneProps = (p: Pane) => ({
    onPointerDown: () => focusOn(p),
  });

  // Focus can be left on a pane the layout no longer shows — snap it back to the ring.
  useEffect(() => {
    if (full === null && !ringPanes.includes(focusPane))
      setFocusPane(ringPanes[0]);
  }, [full, ringPanes, focusPane]);

  const ringFor = (p: Pane) =>
    !full && focusPane === p ? "ring-1 ring-inset ring-primary/50" : undefined;

  const togglePanel = useCallback(
    (p: Panel) => setPanel((cur) => (cur === p ? null : p)),
    [],
  );

  const startResize = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault();
      const startY = e.clientY;
      const startH = panelH;
      const onMove = (ev: PointerEvent) =>
        setPanelH(
          Math.max(
            120,
            Math.min(window.innerHeight - 220, startH + (startY - ev.clientY)),
          ),
        );
      const onUp = () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
      };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
    },
    [panelH],
  );

  // The initial fetch: the project header, the workspace (opening its active project), and the command catalogue.
  useEffect(() => {
    void api
      .project()
      .then(setProject)
      .catch(() => {});
    void api.workspace().then((w) => {
      setWs(w);
      lastActive.current = w.activeProject;
      if (w.activeProject) void api.open(w.activeProject).catch(() => {});
      else fullscreen("editor");
    });
    void api
      .commands()
      .then(setBackendCmds)
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The compiled doc's slice of shell state (track order, mixer, the strudel gate), refetched on reloadKey.
  const {
    trackOrder,
    metronomeOn,
    metronomeLevel,
    recInfo,
    docTracks,
    doc: projectDoc,
    mixerStrips,
    hasStrudel,
    midiSeqRef,
  } = useProjectDoc(reloadKey, {
    // If the currently-armed track lost its sequence, disarm it.
    onMidiSeqs: (seqs) =>
      setMidiArmed((cur) => (cur && !seqs[cur] ? null : cur)),
  });

  // Mixer / graph edits run the same backend commands but must NOT bump reloadKey, and ask for no graph (`want: []`) — docs/shell.md.
  const quietCommand = useCallback(
    async (line: string) => {
      pushLog("cmd", `› ${line}`);
      try {
        const { output } = await api.command(line, { want: [] });
        if (output.length) setStatus(output.join("  ·  "));
        for (const o of output) pushLog("info", o);
      } catch (e) {
        setStatus(`command error: ${(e as Error).message}`);
        pushLog("error", (e as Error).message);
      }
    },
    [pushLog],
  );

  /** The header fader: the song's OUTPUT level, which is the OUT node's `Volume`, written quietly (docs/masterMeter.md). */
  const setMaster = useCallback(
    (db: number) =>
      void quietCommand(`node param "OUT" Volume ${db.toFixed(1)}`),
    [quietCommand],
  );

  // …and the NOTES' half of the picture's answer, since nothing meters MIDI either: when each
  // lane's notes sound, and how hard, so a note cable ripples with what it carries (noteSpans.ts).
  const noteLanes = useMemo(() => noteSpans(projectDoc), [projectDoc]);

  // A RECORDER's button: two go down the socket, `save` is a verb — packages/song/docs/recorderNode.md.
  const onRecorder = useCallback(
    (
      verb: "record" | "clear" | "save",
      node: { module: string; pluginId?: string },
    ) => {
      if (!node.pluginId) return; // in the document but not in the running graph
      if (verb !== "save") {
        engineRef.current?.recorder(node.pluginId, verb);
        return;
      }
      const takes = store.getSnapshot().recorders?.[node.pluginId]?.takes ?? [];
      const last = takes[takes.length - 1];
      if (!last) return; // the button draws faint with no take; this is the race, not the state
      const id = node.pluginId;
      const line = `node record save ${JSON.stringify(last.file)}`;
      // Run here rather than through `runCommand`, which reports a refusal but does not return
      // one: the take is dropped after this, and dropping it on a save that failed loses it.
      void (async () => {
        pushLog("cmd", `› ${line}`);
        try {
          const { output, refused } = await api.command(line, { want: [] });
          const said = output.length ? output.join("  ·  ") : `ran: ${line}`;
          for (const o of output) pushLog(refused ? "refused" : "info", o);
          if (refused) return void setRefusal(said);
          setStatus(said);
          // Filed, so the local take goes: its bytes are in the médiathèque now, and a stack that
          // kept it would offer the same one again — packages/song/docs/recorderNode.md.
          engineRef.current?.recorder(id, "clear");
        } catch (e) {
          setStatus(`command error: ${(e as Error).message}`);
          pushLog("error", (e as Error).message);
        }
      })();
    },
    [store, pushLog, setRefusal],
  );

  /** A PROJECT setting off a card — today the RENDER node's frame shape. A verb, since what it
   *  writes is project.yaml and the node has no file (packages/song/docs/picture.md). */
  const onProjectField = useCallback(
    (field: string, value: string) =>
      void runCommandRef.current(`project ${field} ${value}`),
    [],
  );

  // The lenses this browser can see — the camera cards' dropdown, packages/song/docs/camera.md.
  const cameras = useCameras();

  // The interface's inputs and the act that regroups them, asked once per connection.
  const { devices: inputDevices, regroup: regroupInputs } = useInputDevices(
    engineRef.current ?? null,
    connected,
    quietCommand,
  );

  // The meter holds the pass — its peak, and whether it clipped; `project master fix` asks it through this (docs/masterMeter.md).
  const masterMeterRef = useRef<MasterMeterHandle | null>(null);
  const fixClipping = useCallback(
    async (peakDb: number) => {
      const now = projectDoc?.masterVolume ?? 0;
      const db = fixedMaster(now, peakDb);
      if (db === now) {
        setStatus("rien à baisser — la sortie est déjà au plancher");
        return;
      }
      await quietCommand(`node param "OUT" Volume ${db.toFixed(1)}`);
      bumpReload();
      setStatus(
        `sortie à ${db > 0 ? "+" : ""}${db.toFixed(1)} dB (${trimFor(peakDb).toFixed(1)} dB) — pic visé ${TARGET_DB} dB`,
      );
    },
    [projectDoc?.masterVolume, quietCommand, bumpReload],
  );

  // A ref because `runCommand` reads it and is itself a dependency of half the app.
  const docTracksRef = useRef(docTracks);
  docTracksRef.current = docTracks;

  // Per-track mixer state + the shared mute/solo/arm toggle handler.
  const { trackControls, onTrackToggle, onTrackSet } = useTrackControls({
    docTracks,
    armed,
    midiArmed,
    setMidiArmed,
    midiSeqRef,
    quietCommand,
    bumpReload,
    // On a snapshot these two are the LISTENER's, not the document's — which stem sounds.
    local: frozen,
  });

  /** …and on a snapshot that is what reaches the audio: mute and solo resolved to one gain per lane by `laneGains` (docs/shared.md). */
  const setLaneGains = player.setLaneGains;
  useEffect(() => {
    if (!frozen) return;
    setLaneGains(
      laneGains(trackControls),
      laneGains(
        Object.fromEntries(
          docTracks.map((t) => [
            t.id,
            { mute: t.mute ? 1 : 0, solo: t.solo ? 1 : 0 },
          ]),
        ),
      ),
    );
  }, [frozen, trackControls, docTracks, setLaneGains]);

  // Web MIDI capture, driven by record+play+midiArmed.
  useMidiRecording({
    store,
    tempo: recInfo.tempo,
    recordEnabled,
    playing,
    midiArmed,
    midiSeqRef,
    quietCommand,
  });

  // Background polls: the git badge, the strudel lanes, the project errors, the waveform prewarm.
  const { gitStatus, refreshGitStatus } = useGitStatus();
  const orbit = useOrbit(hasStrudel);
  const { projectErrors, diagnostics } = useProjectErrors(reloadKey);
  const warm = useWarmWaveforms(reloadKey, playing);

  // After a commit/pull: refresh the badge, repaint the view, and refetch the workspace — a pull can add projects.
  const onRepoChanged = useCallback(() => {
    refreshGitStatus();
    bumpReload();
    void api
      .workspace()
      .then(setWs)
      .catch(() => {});
  }, [refreshGitStatus, bumpReload]);

  const openProject = useCallback(
    async (path: string) => {
      try {
        const w = await api.open(path);
        setWs(w);
        lastActive.current = w.activeProject;
        void api
          .project()
          .then(setProject)
          .catch(() => {});
        bumpReload();
        setStatus(`opened ${path === "." ? w.root : path} — engine starting…`);
        setFull(null);
        // The layout the project that was open had — the doc effect above corrects it a moment later.
      } catch (e) {
        setStatus(`open error: ${(e as Error).message}`);
      }
    },
    [bumpReload],
  );

  // The import and delete dialogs register Escape here too, or the key that dismissed one would also close the graph slot behind it.
  const imp = useProjectImport({ openProject, onStatus: setStatus });
  usePopin(!!imp.importPath && !imp.importing, imp.cancelImport);

  // Follow what happened under us: a project switch (another tab, the CLI), and a TAKE.
  useActiveProjectFollow({
    lastActiveRef: lastActive,
    /** A recording landed: `setWs` carries the clip's name and the reload puts it on its lane — neither happened on its own. */
    onTake: (w) => {
      setWs(w);
      bumpReload();
    },
    onSwitch: (w) => {
      setWs(w);
      void api
        .project()
        .then(setProject)
        .catch(() => {});
      bumpReload();
    },
  });

  /** Open a file in the editor pane, by path or by fuzzy name — returns what it settled on, and the reveal FOLLOWS the read (docs/shell.md). */
  const openInEditor = useCallback(
    (arg: string, reveal = true): string | null => {
      if (!arg) return null;
      const ed = editorRef.current;
      if (!ed) {
        setStatus("the editor is not ready yet — try again in a moment");
        return null;
      }
      // Exact path, then a fuzzy name, then the MATERIAL behind a placement id — see openInEditor.ts.
      const path = resolveEditorFile(arg, ed.files());
      if (path === null) {
        setStatus(`no file matching "${arg}" in this project`);
        return null;
      }
      void ed.open(path).then((opened) => {
        if (!opened || !reveal) return;
        // Off screen: bring it up as a POPIN rather than fullscreening the pane — the command asked for the FILE.
        if (!visible("editor")) setEditorPopin(true);
        else focusOn("editor");
      });
      return path;
    },
    [visible, focusOn],
  );

  // `runCommand` is defined below and calls THIS, so a local command reaches it through a ref rather than a closure.
  const runCommandRef = useRef<(line: string) => Promise<void>>(async () => {});
  // The palette's catalogue, for the one thing `runCommand` needs: which command a line runs, so it can be remembered.
  const paletteRef = useRef<PaletteCommand[]>([]);

  /** Which language the shell speaks — taken here because `ui language` is one of runLocalCommand's lines (commandI18n.ts). */
  const { locale, locales, setLocale } = useLocale();
  // The two share entries that are not CLI verbs: the mixdown render and the k7 publish.
  const share = useShare(setStatus);

  /** The footer's two graph toggles, each as ONE callback the button and the command share. */
  const toggleMixer = useCallback(() => {
    if (mixerView) return setMixerView(false);
    if (mixerStrips.length === 0)
      return setStatus(
        "no strip in this song — a strip is a Mixer module at the end of a track",
      );
    // Turning it ON also clears whatever had taken the graph's place.
    setGraphSlot(null);
    setFull(null);
    setMixerView(true);
    setStatus(
      mixerStrips.length === 1
        ? "mixer view — this song has ONE strip, so there is nothing to line up"
        : `mixer view — ${mixerStrips.length} strips lined up`,
    );
  }, [mixerView, mixerStrips.length]);

  const toggleDocs = useCallback(() => {
    if (docCount === 0)
      return setStatus(
        "no notes in this project — a note is a node of @studio/doc, wired from what it is about",
      );
    setShowDocs((on) => !on);
  }, [docCount]);

  /** Arm MIDI learn on one param: the capture is the browser's, the binding is a `module cc` — see docs/midi.md. */
  const armMidiLearn = useCallback((rest: string) => {
    const m = /^(\S+)\s+(?:"([^"]*)"|(.+))$/.exec(rest.trim());
    if (!m) {
      setStatus(
        'usage: ui midi learn <module> <param>  (e.g. ui midi learn synth "Filter Freq")',
      );
      return;
    }
    const module = m[1];
    const param = (m[2] ?? m[3] ?? "").trim();
    const midi = chainsMidiRef.current;
    if (!midi?.ready) {
      setStatus(
        "no MIDI here — this browser has no Web MIDI, or access was refused",
      );
      return;
    }
    setStatus(
      `MIDI learn: ${module} ${param} — move a control on your controller`,
    );
    midi.learn(module, param, (learned) => {
      if (!learned) {
        setStatus(`MIDI learn cancelled — ${module} ${param} unchanged`);
        return;
      }
      const arg = /\s/.test(param) ? JSON.stringify(param) : param;
      void runCommandRef
        .current(`module cc ${module} ${arg} ${learned.ch} ${learned.cc}`)
        .then(() => {
          // Bidirectional when possible: possible means the device that just spoke also has an output port to answer on.
          const both = midi.hasFeedback(module, param);
          setStatus(
            `${module} ${param} ← ${learned.device} ch${learned.ch} cc${learned.cc} — ` +
              (both
                ? "bidirectional (the control will follow the value)"
                : "write only (this device has no MIDI output to answer on)"),
          );
        });
    });
  }, []);

  // The shell's view commands; returns false when the line isn't one, so the caller falls through to the backend.
  const runLocalCommand = useCallback(
    (s: string): boolean => {
      // View commands live under `ui`, and the pairing is enforced both ways. See docs/shell.md.
      const prefixed = /^ui\s+/i.test(s);
      if (prefixed) s = s.replace(/^ui\s+/i, "");
      const line = s.toLowerCase();
      // WHICH lines are `ui`'s is a table of its own (localCommands.ts), so a test can hold it against the palette's catalogue.
      const isUi = isUiLine(line);
      if (isUi !== prefixed) {
        // Handled (true) rather than passed down: the backend has no such command either, and would say less.
        setStatus(
          isUi
            ? `"${line}" is a ui command — type: ui ${line}`
            : `"${line}" is not a ui command — type it without the ui prefix`,
        );
        return true;
      }
      if (line === "global") {
        // Back to the layout: with one of them, that is exactly 'leave the fullscreen'.
        setFull(null);
        return true;
      }
      if ((PANES as string[]).includes(line)) {
        // …and likewise for a pane this layout cannot fullscreen — `fullscreen` decides, as it does for the buttons and the number keys.
        fullscreen(line as Pane);
        return true;
      }
      if (line === "focus next") {
        const i = ringPanes.indexOf(focusPane);
        focusOn(ringPanes[(i + 1) % ringPanes.length]);
        return true;
      }
      if (line === "close") {
        setPanel(null);
        return true;
      }
      // Close the topmost overlay, whoever registered it; with nothing open the line asks for what is already true.
      if (line === "popin close") {
        closeTopPopin();
        return true;
      }
      // Put the graph back. The occupants' ✕ does exactly this — see GraphSlotPane.
      if (line === "slot close") {
        setGraphSlot(null);
        return true;
      }
      // The rack builder popin — the building is the browser's, so the command only OPENS it.
      if (line === "module create rack") {
        setRackBuilder(true);
        return true;
      }
      // No `project new` or `project delete` here: making and unmaking a project is the home page's, not this shell's — packages/project-shell/docs/launch.md.
      if (line.startsWith("file ")) {
        openInEditor(s.slice(5).trim());
        return true;
      }
      if (line === "help") {
        if (window.location.hash === "#help") closeHelp();
        else openHelp();
        return true;
      }
      // The chains builder. `""` is the LIST — the state `/chains-builder` parses to; typing it again closes.
      if (line === "chains builder") {
        setOpenBuilder((cur) => (cur === null ? "" : null));
        return true;
      }
      /** The selection, the loop and `t` belong to whichever grid is ON SCREEN — `selection copy` excepted, at its own branch. */
      const clipGrid = graphSlot?.kind === "clip" ? clipGridRef.current : null;
      if (line === "select") {
        if (clipGrid) clipGrid.toggleSelect();
        else timelineRef.current?.toggleSelect();
        return true;
      }
      if (line === "zoom") {
        timelineRef.current?.zoomIn();
        return true;
      }
      if (line === "zoom out") {
        timelineRef.current?.zoomOut();
        return true;
      }
      if (line === "zoom reset") {
        timelineRef.current?.zoomReset();
        return true;
      }
      /** `ui roll <mode>` — where a press on the piano roll goes: select, create, remove (rollMode.ts). */
      if (namesLine(line, "roll")) {
        const want = line.slice("roll".length).trim();
        if (!isRollMode(want)) {
          setStatus(`unknown mode "${want}" — ${ROLL_MODES.join(" · ")}`);
          return true;
        }
        if (!rollRef.current) {
          setStatus("no piano roll open — click a MIDI event first");
          return true;
        }
        rollRef.current.setMode(want);
        setStatus(`${want} — ${ROLL_PRESS[want]}`);
        return true;
      }
      /** `ui wave <mode>` — the waveform's picture and its gestures are ONE thing, so one verb sets both (waveMode.ts). */
      if (namesLine(line, "wave")) {
        const want = line.slice("wave".length).trim();
        if (!isWaveMode(want)) {
          setStatus(`unknown view "${want}" — ${WAVE_MODES.join(" · ")}`);
          return true;
        }
        if (!waveRef.current) {
          setStatus("no audio clip open — click one on the timeline first");
          return true;
        }
        waveRef.current.setView(want);
        return true;
      }
      /** `ui tool <name>` — the tool belongs to the SURFACE, so it is routed like every other pane verb. */
      if (namesLine(line, "tool")) {
        const want = line.slice("tool".length).trim();
        if (!isTool(want)) {
          setStatus(`unknown tool "${want}" — ${TOOLS.join(" · ")}`);
          return true;
        }
        // Only the timeline holds tools today; the graph gets its own once it has a keyboard (docs/timeline.md).
        timelineRef.current?.setTool(want);
        setStatus(want === "pointer" ? "pointer" : `tool: ${want}`);
        return true;
      }
      if (line === "transport locate") {
        if (clipGrid) clipGrid.seekToCaret();
        else timelineRef.current?.seekToCaret();
        return true;
      }
      if (line === "transport loop") {
        if (clipGrid) clipGrid.toggleLoop();
        else timelineRef.current?.toggleLoop();
        return true;
      }
      /** `selection copy` / `selection paste` — one pair of verbs over events and notes, routed by what the clipboard holds (docs/clipEditors.md). */
      if (line === "selection copy") {
        /** The clip pane first, and the timeline WHEN IT HAS NOTHING — the one verb of the four that falls through (docs/clipEditors.md). */
        const got = clipGrid?.copy() ?? timelineRef.current?.copy() ?? null;
        if (!got) {
          // The caret is a rectangle too, so reaching here means it was parked on nothing — and both ways of pointing are named.
          setStatus(
            "nothing to copy — put the caret on a clip or a note, or draw a rectangle with v",
          );
          return true;
        }
        setClipboard(got);
        setStatus(
          got.kind === "notes"
            ? `copied ${got.notes.length} note(s)`
            : `copied ${got.events.length} event(s)`,
        );
        return true;
      }
      /** `selection paste` — the CLIPBOARD says which surface, having been copied as events or as notes (clipboard.ts). */
      if (line === "selection paste") {
        const held = clipboardRef.current;
        if (!held) {
          setStatus(
            "nothing on the clipboard — `selection copy` (Ctrl+C) something first",
          );
          return true;
        }
        const notes = held.kind === "notes";
        const pane = notes ? clipGridRef.current : timelineRef.current;
        if (!pane) {
          setStatus(
            notes
              ? "no clip open — click a MIDI event to paste notes into it"
              : "no timeline here",
          );
          return true;
        }
        const out = pane.pasteLine(held);
        if (out.line) void runCommand(out.line);
        setStatus(out.note);
        return true;
      }
      /** `selection delete` — the clip grid's alone: the timeline deletes an event by its own verb, which names it. */
      if (line === "selection delete") {
        const out = clipGrid?.deleteLine?.();
        if (!out) {
          setStatus("no clip grid open — click a MIDI event first");
          return true;
        }
        if (out.line) void runCommand(out.line);
        setStatus(out.note);
        return true;
      }
      // Toggle record over the wire. Reading the live snapshot keeps this out of the deps and always flips current.
      if (line === "transport record") {
        engineRef.current?.setRecordEnabled(!store.getSnapshot().recordEnabled);
        return true;
      }
      // Replay: back to where playback last started (`replayAtRef`), then rolls again — `play` is not a toggle.
      if (line === "transport replay") {
        seek(replayAtRef.current);
        // Deliberately the BARE verb: the seek above has already chosen a position.
        transport("play");
        return true;
      }
      /** …and so do the four bare verbs, for LATENCY — falling through to the service only when the socket cannot answer (docs/shell.md). */
      if (BARE_TRANSPORT.includes(line)) {
        // On a snapshot there IS no slow path: `transport` is already the browser player, so it always answers.
        if (!frozen && (!connected || engineBusyRef.current)) return false;
        transport(line.slice("transport ".length) as TransportAction);
        return true;
      }
      // `rec <track>`: an instrument track arms in the browser, an audio track in the engine. See docs/shell.md.
      if (line.startsWith("rec ")) {
        const id = s.slice(4).trim();
        if (midiSeqRef.current[id]) {
          setMidiArmed((cur) => (cur === id ? null : id));
          return true;
        }
        return false;
      }
      // Bare `event move` opens the timeline's move mode; the backend command takes three args, so it still falls through.
      if (line === "event move") {
        timelineRef.current?.startMove();
        return true;
      }
      // `sequence edit roll|tracker <sequence>` — bare-named, not under `ui`, since it writes to the sequence it names.
      const seq = parseSeqEdit(s);
      if (seq) {
        const path = resolveSequence(
          seq.name,
          editorRef.current?.files() ?? [],
        );
        if (!seq.name) setStatus(`usage: sequence edit ${seq.view} <sequence>`);
        else if (!path) setStatus(`no sequence "${seq.name}" in this project`);
        else {
          // The chains slot is where it goes, so make sure the slot is on screen.
          setFull(null);
          setGraphSlot({ kind: "grid", path, view: seq.view });
        }
        return true;
      }
      // e on a clip opens its own definition — the name fuzzy-resolves to sequences/<id>.yaml or clips/<id>.yaml.
      if (line.startsWith("edit sequence ")) {
        openInEditor(s.slice("edit sequence ".length).trim());
        return true;
      }
      if (line.startsWith("edit clip ")) {
        openInEditor(s.slice("edit clip ".length).trim());
        return true;
      }
      /** `ui review <clip>` — reopen the take review on a clip; the lane is looked up rather than asked for (docs/clipEditors.md). */
      if (line.startsWith("review ")) {
        const clip = s.slice("review ".length).trim();
        if (!clip) {
          setStatus("usage: ui review <clip>");
          return true;
        }
        setReviewOn({ clip, track: trackPlacing(projectDoc, clip) });
        // …and put the clip panel on screen: it is the ONE place a clip is drawn now.
        setGraphSlot({ kind: "recording" });
        return true;
      }
      // `ui midi learn <module> <param>` — arm the browser's Web MIDI; the BINDING is written by `module cc`.
      if (line.startsWith("midi learn ")) {
        armMidiLearn(s.slice("midi learn ".length).trim());
        return true;
      }

      // --- what the footer and the timeline header draw ------------------------
      if (line === "mixer") {
        toggleMixer();
        return true;
      }
      if (line === "notes") {
        toggleDocs();
        return true;
      }
      if (line === "logs clear") {
        clearLogs();
        return true;
      }
      if (line === "ruler") {
        timelineRef.current?.toggleRuler();
        return true;
      }
      if (line === "lanes") {
        timelineRef.current?.toggleLanes();
        return true;
      }
      // `ui panel <graph|logs>`: the footer buttons' own toggle — naming the panel already up closes it.
      if (line.startsWith("panel ")) {
        const want = line.slice("panel ".length).trim();
        const names = Object.keys(PANEL_META) as Panel[];
        if (!names.includes(want as Panel))
          setStatus(`usage: ui panel <${names.join("|")}>`);
        else togglePanel(want as Panel);
        return true;
      }
      // `ui surface <id>` names nothing — every surface is a PANE — and this arm exists only to say so to anyone who read the verb in the docs.
      if (line.startsWith("surface ")) {
        setStatus(
          "a surface is a pane now — use `ui turntables` (or its number key). See surfaces/.",
        );
        return true;
      }
      /** `ui external <surface>` — the link that opens ONE surface on another device; it COPIES rather than navigating (docs/external.md). */
      if (line.startsWith("external ")) {
        const want = s.slice("external ".length).trim();
        const hit = surfaces.find((x) => x.id === want);
        if (!hit) {
          setStatus(
            surfaces.length
              ? `no surface "${want}" — this project declares ${surfaces.map((x) => x.id).join(", ")}`
              : "this project declares no surface — see surfaces/",
          );
          return true;
        }
        const at = parseLaunch(
          window.location.pathname,
          "st0",
          import.meta.env.BASE_URL,
        );
        if (!at) return false; // no project in the address; nothing to hang a surface off
        const url = externalUrl(window.location.href, at, hit.id, "st0");
        void navigator.clipboard?.writeText(url).catch(() => {});
        setStatus(url);
        return true;
      }
      // `ui builder <module>`: the shared builder over the shell, on the MODULE file of the trio.
      if (line.startsWith("builder ")) {
        const arg = s.slice("builder ".length).trim();
        const path = resolveModuleFile(arg, editorRef.current?.files() ?? []);
        if (!path) setStatus(`no module "${arg}" in this project`);
        else setBuilder({ path, pane: "module" });
        return true;
      }
      // An assembly TEMPLATE, by its ref. The PATH is the file service's to give — never one built here.
      if (line.startsWith("assembly ")) {
        const ref = s.slice("assembly ".length).trim();
        void api
          .libraryAssemblies()
          .then(({ assemblies }) => {
            const hit = assemblies.find((a) => a.ref === ref);
            if (!hit) {
              setStatus(`no assembly template "${ref}" in the library`);
              return;
            }
            setAssemblyBuilder({ file: hit.file, folder: hit.path });
          })
          .catch((e: Error) => setStatus(e.message));
        return true;
      }

      // --- the three right-hand panels, and the one page left --------------------

      // The bare lines TOGGLE, as their buttons do; naming a settings TAB always opens, never closes.
      if (line === "settings") {
        toggleRight("settings");
        return true;
      }
      if (line === "playlists") {
        toggleRight("playlists");
        return true;
      }
      if (line === "share") {
        toggleRight("share");
        return true;
      }
      if (line === "settings commands") {
        setCommandsPage(true);
        return true;
      }
      if (line.startsWith("settings ")) {
        const which = line.slice("settings ".length);
        if (isSettingsTab(which)) {
          setSettingsTab(which);
          setRightPanel("settings");
          return true;
        }
      }
      // The one control ON the editor settings screen — a global preference, which is why it is `ui` and not a project verb.
      if (line === "vim") {
        void toggleVim();
        return true;
      }
      if (line === "engine") {
        onChangeEngine();
        return true;
      }
      if (line === "workspace quit") {
        onQuitWorkspace();
        return true;
      }
      // Reload after logout: AuthGate is outermost, so a fresh load lands on sign-in.
      if (line === "logout") {
        void api.logout().then(() => window.location.reload());
        return true;
      }
      if (line.startsWith("language ")) {
        const want = line.slice("language ".length).trim();
        if (!(locales as readonly string[]).includes(want))
          setStatus(`usage: ui language <${locales.join("|")}>`);
        else setLocale(want as typeof locale);
        return true;
      }
      // `ui copy path <path>` — the tree's own entry: what it copies is the workspace-relative path every route takes.
      if (line.startsWith("copy path ")) {
        const arg = s.slice("copy path ".length).trim();
        const path = resolveEntry(arg, editorRef.current?.entries() ?? []);
        if (!path) setStatus(`no entry "${arg}" in this workspace`);
        else {
          void navigator.clipboard?.writeText(path);
          setStatus(`copied ${path}`);
        }
        return true;
      }
      // `ui pin <path>` — to the top of the tree, or off it when it is already there.
      if (line.startsWith("pin ")) {
        const arg = s.slice("pin ".length).trim();
        const path = resolveEntry(arg, editorRef.current?.entries() ?? []);
        const pinned = path ? editorRef.current?.togglePin(path) : null;
        if (!path) setStatus(`no file "${arg}" in this workspace`);
        else if (pinned == null)
          setStatus("the file tree is not on screen — the pins live in it");
        else setStatus(`${pinned ? "pinned" : "unpinned"} ${path}`);
        return true;
      }

      // --- the file tree's right-click menu, as commands ------------------------

      // Each of these calls the SAME callback the menu item runs (see EditorHandle), including the confirm a delete asks for.
      if (namesLine(line, "fs file new") || namesLine(line, "fs folder new")) {
        const folder = line.startsWith("folder ");
        const head = folder ? "fs folder new" : "fs file new";
        const [dirArg, name] = headTokens(s.slice(head.length), 2);
        const dir = dirArg
          ? resolveEntry(dirArg, editorRef.current?.entries() ?? [])
          : null;
        if (!dirArg || !name) setStatus(`usage: ${head} <folder> <name>`);
        else if (!dir || !editorRef.current?.isDir(dir))
          setStatus(`no folder "${dirArg}" in this workspace`);
        else if (folder) editorRef.current?.createFolder(dir, name);
        else editorRef.current?.createFile(dir, name);
        return true;
      }
      // The NAME, not a path: a rename leaves the entry where it is.
      if (namesLine(line, "fs file rename")) {
        const [pathArg, name] = headTokens(s.slice("fs file rename".length), 2);
        const path = pathArg
          ? resolveEntry(pathArg, editorRef.current?.entries() ?? [])
          : null;
        if (!pathArg || !name)
          setStatus("usage: fs file rename <path> <new name>");
        else if (!path) setStatus(`no entry "${pathArg}" in this workspace`);
        else editorRef.current?.rename(path, name);
        return true;
      }
      // What dragging a row onto a folder does.
      if (namesLine(line, "fs file move")) {
        const [pathArg, dirArg] = headTokens(s.slice("fs file move".length), 2);
        const entries = editorRef.current?.entries() ?? [];
        const path = pathArg ? resolveEntry(pathArg, entries) : null;
        const dir = dirArg ? resolveEntry(dirArg, entries) : null;
        if (!pathArg || !dirArg)
          setStatus("usage: fs file move <path> <folder>");
        else if (!path) setStatus(`no entry "${pathArg}" in this workspace`);
        else if (!dir || !editorRef.current?.isDir(dir))
          setStatus(`no folder "${dirArg}" in this workspace`);
        else editorRef.current?.move(path, dir);
        return true;
      }
      // Recycled, not erased — and confirmed, because the menu's is.
      if (namesLine(line, "fs file delete")) {
        const arg = s.slice("fs file delete".length).trim();
        const path = resolveEntry(arg, editorRef.current?.entries() ?? []);
        if (!arg) setStatus("usage: fs file delete <path>");
        else if (!path) setStatus(`no entry "${arg}" in this workspace`);
        else editorRef.current?.remove(path, editorRef.current.isDir(path));
        return true;
      }
      // Opens the OS picker; `folder` asks for a whole directory, which a browser draws differently — see FileTree.
      if (namesLine(line, "fs file upload")) {
        const [dirArg, what] = headTokens(s.slice("fs file upload".length), 2);
        const dir = dirArg
          ? resolveEntry(dirArg, editorRef.current?.entries() ?? [])
          : null;
        if (!dir || !editorRef.current?.isDir(dir))
          setStatus("usage: fs file upload <folder> [files|folder]");
        else if (
          !editorRef.current.pickUpload(
            dir,
            (what ?? "").toLowerCase() === "folder",
          )
        )
          setStatus("the file tree is not on screen — the picker lives in it");
        return true;
      }

      // --- the project ---------------------------------------------------------

      // Ctrl+Z / Ctrl+Y as commands: the project-wide journal (@studio/project-shell/undo), the editor's own buffer history staying with the keys.
      if (line === "project undo" || line === "project redo") {
        void (line === "project redo"
          ? runRedo(historyDeps)
          : runUndo(historyDeps));
        return true;
      }
      /** `project master fix [peak-db]` — the Fix button as a verb; local, because the trim comes from a peak only this browser saw (docs/masterMeter.md). */
      if (namesLine(line, "project master fix")) {
        const arg = s.slice("project master fix".length).trim();
        const given = arg ? Number(arg) : null;
        if (given !== null && !Number.isFinite(given)) {
          setStatus(`"${arg}" n'est pas un niveau en dB`);
          return true;
        }
        const pass = masterMeterRef.current?.pass();
        if (given === null && !pass?.offered) {
          setStatus(
            pass
              ? "rien à rattraper — le dernier passage n'a pas saturé (donnez un niveau en dB pour forcer)"
              : "pas de vumètre sur cet écran — donnez un niveau en dB",
          );
          return true;
        }
        masterMeterRef.current?.take();
        void fixClipping(given ?? (pass?.peak as number));
        return true;
      }
      if (line.startsWith("project export")) {
        const fmt = s.slice("project export".length).trim().toLowerCase();
        if (!isMixFormat(fmt))
          setStatus(`usage: project export <${MIX_FORMATS.join("|")}>`);
        else void share.exportMix(fmt);
        return true;
      }
      if (line === "project share k7") {
        void share.shareK7();
        return true;
      }
      if (line === "project share link") {
        void share.shareLink();
        return true;
      }
      // The dialog reports what the translation did and then offers to open the result.
      if (line.startsWith("project import")) {
        const arg = s.slice("project import".length).trim();
        const path = arg
          ? resolveEntry(arg, editorRef.current?.entries() ?? [])
          : null;
        if (!path)
          setStatus(
            "usage: project import <a .dawproject or .als of this workspace>",
          );
        else imp.askImport(path);
        return true;
      }
      return false;
    },
    [
      fullscreen,
      focusOn,
      focusPane,
      openInEditor,
      armMidiLearn,
      ringPanes,
      ws,
      openHelp,
      closeHelp,
      imp,
      engineRef,
      midiSeqRef,
      store,
      seek,
      transport,
      engineBusyRef,
      // …and whether that socket is up, which decides whether the bare transport verbs are answered here or handed to the service.
      connected,
      frozen,
      setFull,
      toggleMixer,
      toggleDocs,
      clearLogs,
      togglePanel,
      onChangeEngine,
      onQuitWorkspace,
      toggleVim,
      locales,
      setLocale,
      historyDeps,
      share,
      fixClipping,
    ],
  );

  // The arrow a module is being created on while the command RUNS — the narrower window the canvas draws a placeholder for.
  const [insertingAt, setInsertingAt] = useState<PendingInsert | null>(null);
  // The graph a writing command handed back, drawn instead of fetched; it carries an id the consumer takes ONCE (ChainsTab's `seedGraph`).
  const seedId = useRef(0);
  const [seedGraph, setSeedGraph] = useState<{
    id: number;
    graph: WebGraph;
  } | null>(null);
  // Every command — typed or bound to a key — comes through here.
  const runCommand = useCallback(
    async (line: string) => {
      if (!line.trim()) return;
      const typed = line.trim();
      const s = canonicalizeCommand(line);
      // What was typed, and — when the catalogue rewrote it — what actually ran, so the transcript shows a line you could retype.
      pushLog("cmd", typed === s ? `› ${typed}` : `› ${typed}   ⇒ ${s}`);
      // Here rather than in the bar, because EVERY command passes here; through a ref, so a rebuilt catalogue does not rebuild this.
      rememberCommand(commandNameOf(s, paletteRef.current));
      if (runLocalCommand(s)) return;
      // CONSUMED, not just read: only the command that follows the pick is an insert, or a later one draws on that stale arrow.
      const willInsert = pendingInsert.current;
      pendingInsert.current = null;
      if (willInsert) setInsertingAt(willInsert);
      // …and where the node that line creates should GO, consumed the same way: it belongs to THIS line and no later one.
      const wire = pendingWire.current;
      pendingWire.current = null;
      const madeRef = wire ? chainRefFromCreate(s) : null;
      // …and the module that line's node needs, ahead of it rather than after, since `node new` refuses a module that is not there.
      const ensure = madeRef ? pendingModule.current : null;
      pendingModule.current = null;
      try {
        // Logged like anything else that RUNS, and asking for no graph: it is the picker's FIRST half.
        if (ensure) {
          pushLog("cmd", `› ${ensure}`);
          await api.command(ensure, { want: [] });
        }
        // This one DOES want the graph, unconditionally: ChainsTab stays mounted when hidden and would refetch it anyway.
        const { output, refused, graph, rev, changed } = await api.command(s, {
          want: ["graph"],
        });
        // A refusal is neither a success nor a failure, so it gets its own channel rather than being recorded as the first.
        const said = output.length ? output.join("  ·  ") : `ran: ${s}`;
        if (refused) setRefusal(said);
        else setStatus(said);
        for (const o of output) pushLog(refused ? "refused" : "info", o);
        // The graph the service built while we waited, present only when the command changed something — see ChainsTab's `seedGraph`.
        if (graph) {
          seedId.current += 1;
          setSeedGraph({ id: seedId.current, graph });
        }
        // The token this command produced, adopted BEFORE the reload it pairs with, so the `/revision` tick does not redo it — see `RevisionPoller.note`.
        if (rev) noteRevision(rev);
        /** …and the reload, carrying the files this command wrote — `undefined`, from a service that could not diff, still means everything. */
        setReload((r) => ({ key: r.key + 1, files: changed ?? null }));
        // The picker's second half, as its own journalled command — and null when there is nothing left to do.
        const after =
          madeRef && wire ? wireCommand(madeRef, wire.at, wire.spawn) : null;
        if (after) await runCommandRef.current(after);
        // The repo verbs move the badge, the view AND the workspace — a pull can add projects.
        if (/^project (commit|pull|alternative)\b/.test(s)) onRepoChanged();
        // The one reorganizing verb: the graph hosts drop their held positions with the same reload that drops the pins.
        if (s === "graph organize") setOrganizeKey((k) => k + 1);
      } catch (e) {
        setStatus(`command error: ${(e as Error).message}`);
        pushLog("error", (e as Error).message);
      } finally {
        // The placeholder comes down in the same update that carries the new graph, so the two swap in one frame.
        if (willInsert) setInsertingAt(null);
      }
    },
    [pushLog, runLocalCommand, onRepoChanged],
  );
  runCommandRef.current = runCommand;

  // --- following a track across the panes ------------------------------------------

  // A double-click on a timeline header says 'this one' to the whole shell; the nonce is what makes the SAME track re-frame.
  const [graphFocus, setGraphFocus] = useState<{
    id: string;
    nonce: number;
  } | null>(null);
  const focusNonce = useRef(0);
  // What the status line said about the file, so the canvas's answer is added to it rather than replacing it.
  const focusLine = useRef("");
  const focusRowInPanes = useCallback(
    (target: RowTarget) => {
      // Named, not fuzzy-matched, and under `nodes/`, because that is where a lane lives (packages/song/docs/trackModules.md).
      const file = entityFile(
        editorRef.current?.files() ?? [],
        "nodes",
        target.id,
      );
      const path = file && openInEditor(file, false);
      focusLine.current = `${target.id} — ${path ?? "no nodes/ file"}`;
      setStatus(focusLine.current);
      focusNonce.current += 1;
      setGraphFocus({ id: target.id, nonce: focusNonce.current });
      // …and the lane's modules, side by side, OVER the graph; the framing above still happens.
      if (target.kind === "track")
        setGraphSlot({ kind: "trackModules", trackId: target.id });
    },
    [openInEditor],
  );
  // The canvas reports what the framing found: a track wired to nothing has to say so, or the double-click reads as a miss.
  const reportFramed = useCallback((chains: number) => {
    setStatus(
      chains
        ? `${focusLine.current} · ${chains} chain${chains > 1 ? "s" : ""} framed`
        : `${focusLine.current} · no chain takes it as its source`,
    );
  }, []);

  // The right-click context menu (timeline + graph).
  const [menu, setMenu] = useState<{
    items: MenuItem[];
    x: number;
    y: number;
  } | null>(null);
  // What the entry under the pointer DOES, borrowing the status line while the menu is open — see ContextMenu.tsx's `onHint`.
  const [menuHint, setMenuHint] = useState("");
  const prewriteCommand = useCallback(
    (text: string) => {
      // Docked, the bar is already mounted: write into it; the deferral below exists only for the popin.
      if (docked || paletteOpen) cmdRef.current?.prewrite(text);
      else {
        pendingPrewrite.current = text;
        setPaletteOpen(true);
      }
    },
    [docked, paletteOpen],
  );
  useEffect(() => {
    if (paletteOpen && pendingPrewrite.current != null) {
      cmdRef.current?.prewrite(pendingPrewrite.current);
      pendingPrewrite.current = null;
    }
  }, [paletteOpen]);
  /** A pick from the right-click menu: the bar is a form for COLLECTING arguments, so an entry with nothing left to collect just runs. */
  const pickMenuItem = useCallback(
    (item: MenuItem) => {
      if (item.complete) void runCommandRef.current(item.command);
      else prewriteCommand(item.command);
    },
    [prewriteCommand],
  );
  // The catalogue in a ref: the menu reads it at open time, and a dependency would rebuild every pane's onContextMenu.
  const cmdCatalogue = useRef<CommandInfo[]>([]);
  cmdCatalogue.current = backendCmds;
  // …and the prefs beside it: the handler below has empty deps, so reading the state directly would pin the first render's.
  const cmdPrefs = useRef<CommandPrefs>({});
  cmdPrefs.current = commandPrefs;
  // …and the language, for the third time: the entries' descriptions are resolved when the menu opens.
  const cmdLocale = useRef(locale);
  cmdLocale.current = locale;
  const openContextMenu = useCallback((ctx: MenuCtx, x: number, y: number) => {
    const items = contextMenu(
      withAmbient(ctx),
      cmdCatalogue.current,
      cmdPrefs.current,
      cmdLocale.current,
    );
    if (items.length) setMenu({ items, x, y });
  }, []);
  /** The ⋮ bubble on a node — the same ContextMenu the right-click uses, over the same rows (`nodeMenu` in contextMenu.ts). */
  const openNodeMenu = useCallback(
    (n: NodeMenuTarget, at: { x: number; y: number }) => {
      const items = nodeMenu(n);
      if (items.length) setMenu({ items, x: at.x, y: at.y });
    },
    [],
  );
  // A `+` click asks WHICH module before writing anything; picking pre-writes a command. See docs/shell.md.
  const pendingInsert = useRef<PendingInsert | null>(null);
  // Where the node a CREATING line is about to make should be wired: an arrow or nowhere, plus the world point clicked (see onModulePick).
  const pendingWire = useRef<{
    at: PendingInsert | null;
    spawn: { x: number; y: number } | null;
  } | null>(null);
  // …and the `module new` that has to run BEFORE that line — null for a module of this project, which stays one command.
  const pendingModule = useRef<string | null>(null);
  // 'Which file?' — a filepicker widget's asset browser, rendered by the shell because the popup is viewport-positioned.
  const [assetPicker, setAssetPicker] = useState<{
    module: string;
    param: string;
    x: number;
    y: number;
    files: string[];
  } | null>(null);
  /** Find the open project's node of the builder's module and watch its plugin — `watchPluginParams` is what makes the values LIVE. */
  useEffect(() => {
    if (!builder) return void setBuilderPlugin(null);
    // The key a chain would write — `amps/neural-amp-modeler`, or `@st0/audio/amps/nam` for a library module (@studio/song/moduleTypes).
    const module =
      libraryModuleRef(builder.path) ?? moduleKeyFromPath(builder.path);
    if (!module) return void setBuilderPlugin(null);
    let cancelled = false;
    void api
      .graph()
      .then((g) => {
        if (cancelled) return;
        const step = Object.values(g.chains ?? {})
          .flatMap((c) => c.use ?? [])
          .find((s) => s.module === module && s.pluginId);
        setBuilderPlugin(
          step?.pluginId ? { module, pluginId: step.pluginId } : null,
        );
      })
      .catch(() => {
        if (!cancelled) setBuilderPlugin(null);
      });
    return () => {
      cancelled = true;
    };
  }, [builder]);

  // …and once one is found, ask for it and keep it coming — its own effect, so the unwatch is paired with the watch.
  useEffect(() => {
    if (!builderPlugin) return;
    const { module, pluginId } = builderPlugin;
    requestPluginParams(pluginId);
    watchPluginParams(pluginId, true);
    listPresets(module);
    return () => watchPluginParams(pluginId, false);
  }, [builderPlugin, requestPluginParams, watchPluginParams, listPresets]);

  const browseAssets = useCallback(
    (module: string, param: string, x: number, y: number) => {
      // The choices are the MODULE's own assets/ and its ancestors', re-read from the graph so a file dropped since the last look is offered.
      void api
        .graph()
        .then((g) => {
          const step = Object.values(g.chains ?? {})
            .flatMap((c) => c.use ?? [])
            .find((s) => s.module === module);
          setAssetPicker({
            module,
            param,
            x,
            y,
            files: step?.assetChoices ?? [],
          });
        })
        .catch(() => {});
    },
    [],
  );
  // `info` is the arrow the pick will splice into — NULL when the picker was opened on empty canvas.
  const [modulePicker, setModulePicker] = useState<{
    info: { before: string; after: string } | null;
    x: number;
    y: number;
    // The click's WORLD point — where the picked module will be BORN, so a new node never asks the layout where to appear.
    at?: { x: number; y: number };
    /** What a node of the picked module lands CALLED — `<lane>_<module>_<n>`, from the pane that holds the graph (ChainsTab's `nameFor`). */
    nameFor: (module: string) => string;
  } | null>(null);
  // Offer the click into the pre-written line's `at` field, deferred a tick: a same-tick offer reads the bar's old state.
  const offerSpawnAt = useCallback((at?: { x: number; y: number }) => {
    if (!at) return;
    // Negative is kept, not clamped: above the first lane is where a node belongs as readily as below it (`graph move`).
    const v = `${Math.round(at.x)},${Math.round(at.y)}`;
    setTimeout(() => cmdRef.current?.offer({ at: v }, true), 0);
  }, []);
  // The picker's vocabulary, PREFETCHED once per project — the CATALOGUE and not a list of refs, since only the module says what kind it is.
  const [baseModules, setBaseModules] = useState<PickerModule[]>([]);
  useEffect(() => {
    let alive = true;
    void Promise.all([api.moduleCatalogue(), api.baseModules()])
      .then(([cat, refs]) => {
        if (!alive) return;
        // The project's OWN modules come from the ref list: the picker needs them to know one already exists to instantiate.
        const known = new Set(cat.map((m) => m.ref));
        setBaseModules([
          ...cat.map((m) => ({ ref: m.ref, category: m.category })),
          ...refs.filter((r) => !known.has(r)).map((ref) => ({ ref })),
        ]);
      })
      .catch(() => {}); // the picker falls back to pre-writing the command
    return () => {
      alive = false;
    };
  }, [reloadKey]);

  // Opening the picker awaits nothing; with no vocabulary yet, the command is pre-written instead.
  const insertIntoChain = useCallback(
    (
      info: { before: string; after: string },
      x: number,
      y: number,
      at: { x: number; y: number } | undefined,
      nameFor: (module: string) => string,
    ) => {
      if (!baseModules.length) {
        prewriteCommand(`node insert ${info.before} ${info.after} `);
        offerSpawnAt(at);
        return;
      }
      setModulePicker({ info, x, y, at, nameFor });
    },
    [baseModules, prewriteCommand, offerSpawnAt],
  );
  // Right-click on empty canvas: the same picker, but the pick has nowhere to be spliced.
  const placeInGraph = useCallback(
    (
      x: number,
      y: number,
      at: { x: number; y: number } | undefined,
      nameFor: (module: string) => string,
    ) => {
      if (!baseModules.length) {
        // No catalogue to pick from: the person names what to create, and `node new` puts it in the graph.
        prewriteCommand("node new ");
        offerSpawnAt(at);
        return;
      }
      setModulePicker({ info: null, x, y, at, nameFor });
    },
    [baseModules, prewriteCommand, offerSpawnAt],
  );
  const onModulePick = useCallback(
    (pick: ModulePick) => {
      if (!modulePicker) return;
      setModulePicker(null);
      const { info, at, nameFor } = modulePicker;
      // The picker's one non-module offer: a curve has nothing to pick and nothing to splice into, so the bar is prewritten.
      if (pick.newCurve) {
        prewriteCommand("curve new ");
        offerSpawnAt(at);
        return;
      }
      /** TWO lines, and the split is the vocabulary's: a module made or noded, then that node WIRED — see `chainRefFromCreate`. */
      pendingWire.current = { at: info, spawn: at ?? null };
      pendingInsert.current = info; // the ghost on the arrow, while the commands run
      const ref = pick.namespace === null ? undefined : pick.ref;
      // A catalogue pick has no local folder, so its `module new` runs ahead of the line below.
      pendingModule.current = ensureModuleCommand(pick.type, pick.name, ref);
      const spawn = at ? ` ${Math.round(at.x)},${Math.round(at.y)}` : "";
      void runCommandRef.current(
        createForGraphCommand(pick.type, pick.name) +
          nameFor(pick.name) +
          spawn,
      );
    },
    [modulePicker, prewriteCommand, offerSpawnAt],
  );

  // What the caret is currently over, for the conditional bindings (keys.ts).
  const conditions = useMemo<ConditionCtx>(() => {
    const cond: ConditionCtx = {};
    cond.focus_pane = focusPane;
    // The two layers Esc backs out of before it touches the layout; `popin` counts every registered overlay — see popins.ts.
    if (anyPopin) cond.popin = "1";
    if (graphSlot) cond.graph_slot = "1";
    if (full) cond.fullscreen = "1";
    if (caret?.trackId) cond.caret_track = caret.trackId;
    // A rectangle, on whichever grid drew it: `z` stays the timeline's, but ⇧L means 'loop what is selected' anywhere (keys.ts).
    if (tlView.selecting) cond.timeline_selection = "1";
    if (tlView.zoomed) cond.timeline_zoomed = "1";
    if (tlView.loop) cond.timeline_loop = "1";
    // The timeline's MODE and TOOL, one condition per name — `{ if: "tl_select" }` is the truthiness test keys.ts does (docs/timeline.md).
    cond[modeCondition(tlView.mode)] = "1";
    cond.timeline_mode = tlView.mode;
    cond.timeline_tool = tlView.tool;
    // Both gated on the timeline OWNING the keys: a tool belongs to a surface, and one you are not looking at is one you cannot see.
    if (activePane === "timeline") cond.timeline_active = "1";
    if (activePane === "timeline" && tlView.tool !== "pointer")
      cond.tool_held = "1";
    // The WAVEFORM's mode, when an audio clip is the one open — its picture and its gestures are one thing (waveMode.ts).
    if (waveView && graphSlot?.kind === "clip") {
      cond.wave_open = "1";
      cond[waveCondition(waveView)] = "1";
      cond.wave_mode = waveView;
      // `wave_marks` is Esc's rung: standard touches no mark, so there is nothing to back out OF there.
      if (waveView !== "standard") cond.wave_marks = "1";
    }
    // …and the ROLL's, on the same terms — one clip pane draws one leaf or the other, never both.
    if (rollMode && graphSlot?.kind === "clip") {
      cond.roll_open = "1";
      cond[rollCondition(rollMode)] = "1";
      cond.roll_mode = rollMode;
      // Esc's rung, for the same reason as the wave's: `select` writes nothing, so there is nothing to back out of.
      if (rollMode !== "select") cond.roll_armed = "1";
    }
    if (clipSel && graphSlot?.kind === "clip") cond.clip_selection = "1";
    // …and the grid itself, whether or not it holds a rectangle: `x` acts on the caret's own cell when there is none.
    if (graphSlot?.kind === "clip") cond.clip_grid = "1";
    // No `clipboard_events` / `clipboard_notes` condition: there is one paste verb and its binding is unconditional (keys.ts).
    if (editTarget?.kind === "seq")
      cond.hover_midi_sequence = fileStem(editTarget.path);
    else if (editTarget?.kind === "clip") {
      if (editTarget.clip.type === "midi")
        cond.hover_midi_sequence = editTarget.clip.name;
      else cond.hover_audio_clip = editTarget.clip.name;
    }
    return cond;
  }, [
    anyPopin,
    caret,
    clipSel,
    editTarget,
    graphSlot,
    tlView,
    focusPane,
    full,
    // `activePane` is `full ?? focusPane`, and both are above — but the tool conditions read it by name.
    activePane,
    waveView,
    rollMode,
  ]);

  /** The command entry a double-Shift opens: docked it FOCUSES the bar, on the phone it opens the popin palette. */
  const onDoubleShift = useCallback(() => {
    if (docked) cmdRef.current?.focus();
    else
      setPaletteOpen((o) => {
        if (!o) pendingPrewrite.current = null;
        return !o;
      });
  }, [docked]);

  /** Global keys — every binding names a command and runs through runCommand (hooks/useCommandKeys.ts); the two screens that switch it off own the surface outright. */
  useCommandKeys({
    enabled: !commandsPage && !builder,
    effKeys,
    conditions,
    runCommand,
    onDoubleShift,
  });

  // Ctrl+Z / Ctrl+Y — the project journal, captured so it runs before CodeMirror's keymap and spends the buffer's history first (project-shell/undo.ts).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // The PAGE owns the surface; a docked panel does not, and Ctrl+Z belongs to the project underneath it either way.
      if (commandsPage || undoConfirm) return;
      if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
      const key = e.key.toLowerCase();
      if (key !== "z" && key !== "y") return;
      const isRedo = key === "y" || (key === "z" && e.shiftKey);
      const h = editorRef.current;
      if (h?.editorFocused()) {
        // Spend the buffer's own keystroke history first; once it is empty, fall through to the project journal.
        const depth = isRedo ? h.localRedoDepth() : h.localUndoDepth();
        if (depth > 0) {
          e.preventDefault();
          e.stopPropagation();
          if (isRedo) h.localRedo();
          else h.localUndo();
          return;
        }
      } else {
        // A plain input (command bar, a rename field) keeps its own native text undo.
        const t = e.target as HTMLElement | null;
        if (
          t &&
          (t.tagName === "INPUT" ||
            t.tagName === "TEXTAREA" ||
            t.isContentEditable)
        )
          return;
      }
      e.preventDefault();
      e.stopPropagation();
      void (isRedo ? runRedo(historyDeps) : runUndo(historyDeps));
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [commandsPage, historyDeps, undoConfirm]);

  // The layout has no mobile form, so entering mobile lands on a pane — the timeline; a project that fullscreens nothing is skipped.
  useEffect(() => {
    const [first] = layout.fullscreen;
    if (isMobile && full === null && first) setFull("timeline");
  }, [isMobile, full]);

  // …and never on a snapshot: there is no engine coming, and what plays here is the browser, ready at once.
  const waitingForEngine = !frozen && !!ws?.activeProject && !engineReady;

  // The take's start, taken on the edge `rolling` goes true; the snapshot is READ, never subscribed to.
  useEffect(() => {
    if (!rolling) return;
    setTakeStart((store.getSnapshot().playhead * recInfo.tempo) / 60);
  }, [rolling, store, recInfo.tempo]);

  /** The take to review: the one ASKED for, else the newest the file service has written — the named one wins (docs/shell.md). */
  const reviewTake =
    reviewOn ??
    (ws?.lastTake &&
    ws.lastTake.clip !== reviewedTake &&
    !(recordEnabled && playing)
      ? ws.lastTake
      : null);

  /** The takes the reviewed lane holds — recomputed off the project doc, so it follows every swap. */
  const reviewTakes = useMemo(
    () => takeOptions(projectDoc, reviewTake?.track ?? ""),
    [projectDoc, reviewTake?.track],
  );
  /** Listen to another take: it goes ON the track — a swap rather than a preview, one Ctrl+Z away (packages/song/docs/takes.md). */
  const pickTake = useCallback(
    async (t: TakeOption) => {
      const track = reviewTake?.track;
      if (!track || t.n === null) return;
      await runCommand(`track take select ${track} ${t.n}`);
      if (t.clip) setReviewOn({ clip: t.clip, track });
      seek((t.startBeat * 60) / recInfo.tempo);
    },
    [reviewTake?.track, runCommand, seek, recInfo.tempo],
  );
  // …and the decision: keep whatever is on the track, delete the rest.
  const keepTake = useCallback(() => {
    const track = reviewTake?.track;
    if (track) void runCommand(`track take keep ${track}`);
  }, [reviewTake?.track, runCommand]);

  // Everything that makes the transport unable to answer, as one flag: to whoever is reaching for Play the two causes are one fact.
  const transportWaiting = engineBusy || waitingForEngine;

  // The step-by-step palette's catalogue and per-argument completion — `locale` is a dependency, each description being resolved as the list is built.
  const paletteCommands = useMemo(
    () => buildPaletteCommands(backendCmds, locale),
    [backendCmds, locale],
  );
  /** The catalogue AS THIS PERSON ARRANGED IT — renamed and reordered once, over the palette's built list (commandPrefs.ts). */
  const allCommands = useMemo(
    () =>
      orderCommands(paletteCommands, commandPrefs).map((c) => ({
        ...c,
        readable: labelOf(c, commandPrefs, locale),
      })),
    [paletteCommands, commandPrefs, locale],
  );
  paletteRef.current = allCommands;
  // Four getters, not one: the shell's own commands ask for vocabularies only the shell holds — files, paths, surfaces, languages.
  const listArg = useMemo(
    () =>
      makeListArg({
        files: () => editorRef.current?.files() ?? [],
        entries: () => editorRef.current?.entries() ?? [],
        surfaces: () => surfaces.map((s) => s.id),
        locales: () => [...locales],
      }),
    [surfaces, locales],
  );

  // Whatever key reaches each panel, for the tooltips below — undefined when nothing is bound, and the tooltip then says only what the button does.
  const playlistKey = keyForCommand("ui playlists", commandPrefs);
  const shareKey = keyForCommand("ui share", commandPrefs);
  const settingsKey = keyForCommand("ui settings", commandPrefs);
  const { behind, conflicted, badge } = shareBadge(gitStatus);

  const headerTools = snapshot ? (
    <ShareDownload base={snapshot.base} />
  ) : (
    <>
      {/* The PLAYLIST, for a SET only — every project's are reachable from the palette instead (docs/playlists.md). */}
      {hasTurntables && (
        <Button
          size="icon"
          variant={rightPanel === "playlists" ? "default" : "ghost"}
          aria-pressed={rightPanel === "playlists"}
          title={`Playlists${playlistKey ? ` (${playlistKey})` : ""}`}
          aria-label="Playlists"
          aria-keyshortcuts={playlistKey}
          onClick={() => void runCommand("ui playlists")}
        >
          <ListMusic className="h-4 w-4" />
        </Button>
      )}
      {/* SHARE. The badge stays on the button: it says the repository is behind BEFORE you open anything. */}
      <Button
        size="icon"
        variant={rightPanel === "share" ? "default" : "ghost"}
        className="relative"
        aria-pressed={rightPanel === "share"}
        disabled={share.busy}
        title={
          conflicted
            ? "Partager / exporter — le dépôt a divergé, un pull demande une fusion"
            : behind > 0
              ? `Partager / exporter — ${behind} commit${behind === 1 ? "" : "s"} à tirer`
              : `Partager / exporter${shareKey ? ` (${shareKey})` : ""}`
        }
        aria-label="Partager / exporter"
        aria-keyshortcuts={shareKey}
        onClick={() => void runCommand("ui share")}
      >
        <Share2 className="h-4 w-4" />
        {badge && (
          <span
            className={`absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-semibold leading-none text-white ${
              conflicted ? "bg-amber-500" : "bg-primary"
            }`}
          >
            {badge}
          </span>
        )}
      </Button>
      {/* The COG opens the settings panel — one surface with a tab per entry, where a dropdown used to be. */}
      <Button
        size="icon"
        variant={rightPanel === "settings" ? "default" : "ghost"}
        aria-pressed={rightPanel === "settings"}
        title={`${m["settings.menu"]()}${settingsKey ? ` (${settingsKey})` : ""}`}
        aria-label={m["settings.menu"]()}
        aria-keyshortcuts={settingsKey}
        onClick={() => void runCommand("ui settings")}
      >
        <Settings className="h-4 w-4" />
      </Button>
    </>
  );

  const headerActions = (
    <div className="flex min-w-0 items-center gap-1">
      {/* The mix leaving for the interface — absent on a phone, which cannot fit it, and on a snapshot, which has no engine. */}
      {!isMobile && !snapshot && (
        <MasterMeter
          className="mr-2"
          ref={masterMeterRef}
          // The button dispatches the command rather than calling the handler, like every other button in this shell.
          onFix={() => void runCommand("project master fix")}
          // The song's own level, off the compiled doc — what the FILE says, so the fader reads right before a note has played.
          master={projectDoc?.masterVolume}
          onMaster={setMaster}
        />
      )}
      {/* On a phone ONE button holds everywhere there is to go, and a pane is a destination — always `ui <pane>` (docs/shell.md). */}
      {isMobile ? (
        <MobileMenu open={mobileMenu} onOpenChange={setMobileMenu}>
          <div className="flex flex-col">
            {layout.fullscreen.map((p) => (
              <MobileMenuItem
                key={p}
                icon={PANE_META[p].icon}
                label={PANE_META[p].label}
                current={full === p}
                onSelect={() => {
                  setMobileMenu(false);
                  void runCommand(`ui ${p}`);
                }}
              />
            ))}
            {/* No double-Shift on a phone, so the command bar needs a control of its own and this is the only place left. */}
            <MobileMenuItem
              icon={Terminal}
              label="Commandes"
              onSelect={() => {
                setMobileMenu(false);
                setPaletteOpen(true);
              }}
            />
          </div>
          <div className="h-px bg-border" />
          <div className="flex items-center gap-1">{headerTools}</div>
        </MobileMenu>
      ) : (
        <>
          {/* Pane buttons and no view toggles: the row is the LAYOUT's fullscreenable set, not PANES (docs/shell.md). */}
          <nav className="flex items-center gap-1">
            {layout.fullscreen.map((p) => {
              const Icon = PANE_META[p].icon;
              const key = keyForCommand(`ui ${p}`, commandPrefs);
              return (
                <Button
                  key={p}
                  size="icon"
                  variant={full === p ? "default" : "ghost"}
                  aria-pressed={full === p}
                  onClick={() =>
                    void runCommand(`ui ${full === p ? "global" : p}`)
                  }
                  title={
                    full === p
                      ? `${PANE_META[p].label} — back to the layout (esc)`
                      : `${PANE_META[p].label} fullscreen${key ? ` (${key})` : ""}`
                  }
                  aria-keyshortcuts={key}
                  aria-label={PANE_META[p].label}
                >
                  <Icon className="h-4 w-4" />
                </Button>
              );
            })}
          </nav>
          <div className="mx-1 h-5 w-px bg-border" />
          {headerTools}
        </>
      )}
    </div>
  );

  return (
    <EngineStoreProvider value={store}>
      <div className="relative flex h-full flex-col bg-background text-foreground">
        {/* The shared bar (@frediverse/ui/app-header) with st0's contents; `items` is empty on purpose — docs/shell.md. */}
        <AppHeader
          // No `variant`: the house look, the accent tinted over the page (@frediverse/ui's docs/app-header.md).
          className={cn(
            "z-20",
            isMobile
              ? "[&>div]:gap-2 [&>div]:px-3 [&>div]:py-1"
              : "[&>div]:px-3 [&>div]:py-2",
          )}
          // The name is the way back to the home page — a whole-page navigation on purpose: the
          // project is the router's BASENAME, so nothing below it can route out (docs/projects.md).
          // A share visitor has no home page to go to, so theirs stays plain text (docs/shared.md).
          title={
            snapshot ? (
              "st0"
            ) : (
              <a
                href={projectsUrl(window.location.href)}
                title={m["project.backToProjects"]()}
                className="hover:underline"
              >
                st0
              </a>
            )
          }
          subtitle={VERSION}
          items={[]}
          actions={headerActions}
        >
          {/* Between the two: what you are looking AT, and the transport centred over it with `mx-auto`, the bar owning the outer layout. */}
          <div className="flex min-w-0 flex-1 items-center gap-3">
            <span className="max-w-[10rem] truncate text-sm text-muted-foreground">
              {snapshot?.manifest.name || project?.name || "…"}
            </span>
            {/* Said where the version goes and dressed as a state, not a warning: a visitor has no other way to learn it (docs/shared.md). */}
            {snapshot && (
              <span className="flex shrink-0 items-center gap-1 truncate rounded bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                <Lock className="h-3 w-3" /> {m["share.readOnly"]()}
              </span>
            )}
            {/* The workspace repo's alternatives, right after the title; a snapshot has no repository to switch between. */}
            {!frozen && (
              <AlternativePicker
                reloadKey={reloadKey}
                onSwitch={(name) =>
                  void runCommand(`project alternative switch ${name}`)
                }
              />
            )}
            {ws && !ws.activeProject && (
              <span className="truncate rounded bg-amber-500/15 px-2 py-0.5 text-xs text-amber-500">
                workspace — pick a project ▶ in Editor
              </span>
            )}

            {/* centre: transport — play/pause, stop, the clock, then record, each dropping focus on click (docs/shell.md). */}
            {(!noArrangement || hasTurntables) && !deskOnly && (
              <div className="mx-auto flex shrink-0 items-center gap-1">
                <Button
                  size="icon"
                  variant={playing ? "default" : "secondary"}
                  // While the engine is loading a project it reads nothing: the spinner replaces the icon and the button goes dead.
                  disabled={transportWaiting}
                  onClick={(e) => {
                    transport(playing ? "stop" : "play");
                    blurOnClick(e);
                  }}
                  title={
                    transportWaiting
                      ? "Loading this project — the engine can't answer the transport yet"
                      : playing
                        ? m["transport.pause"]()
                        : m["transport.play"]()
                  }
                  aria-label={
                    transportWaiting
                      ? "loading the project"
                      : playing
                        ? m["transport.pause"]()
                        : m["transport.play"]()
                  }
                  aria-busy={transportWaiting}
                >
                  {transportWaiting ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : playing ? (
                    <Pause className="h-4 w-4" />
                  ) : (
                    <Play className="h-4 w-4" />
                  )}
                </Button>
                <Button
                  size="icon"
                  variant="secondary"
                  onClick={(e) => {
                    transport("stop");
                    // Zero on a set too: every record is on a platter, and the timeline holds only the click.
                    transport("rewind");
                    blurOnClick(e);
                  }}
                  title={m["transport.stop"]()}
                >
                  <Square className="h-4 w-4" />
                </Button>
                {/* The clock and record are the ARRANGEMENT's half: a set has no bars to count and no lane to arm. */}
                {!noArrangement && (
                  <>
                    <TransportClock
                      tempo={recInfo.tempo}
                      beatsPerBar={recInfo.beatsPerBar}
                    />
                    <Button
                      size="icon"
                      variant={recordEnabled ? "default" : "secondary"}
                      aria-pressed={recordEnabled}
                      onClick={(e) => {
                        engineRef.current?.setRecordEnabled(!recordEnabled);
                        blurOnClick(e);
                      }}
                      title={m["transport.record"]()}
                      aria-label={m["transport.record"]()}
                    >
                      <Circle
                        className={`h-4 w-4 ${recordEnabled ? "fill-red-500 text-red-500" : ""}`}
                      />
                    </Button>
                  </>
                )}
              </div>
            )}
          </div>
        </AppHeader>
        {/* main: the panes on top, an optional bottom split panel below */}
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="flex min-h-0 flex-1">
            {/* The popin's backdrop: a click outside is the reliable way out, Escape belonging to the editor's vim. */}
            {editorPopin && (
              <div
                className="fixed inset-0 z-40 bg-black/40"
                onPointerDown={() => setEditorPopin(false)}
              />
            )}
            {/* The rack builder popin: a 4×4 pad grid ending in modules/instruments/<name>, opened by `module create rack`. */}
            {rackBuilder && (
              <RackBuilder
                activeProject={ws?.activeProject ?? null}
                onClose={() => setRackBuilder(false)}
                onCreated={(ref) => {
                  setRackBuilder(false);
                  setStatus(`rack ${ref} créé — branchez-le depuis le graphe`);
                  bumpReload();
                }}
              />
            )}
            <div
              {...paneProps("editor")}
              className={cn(
                "flex min-h-0 min-w-0 flex-col",
                // The SAME element in the same place in the tree, restyled — so the open file, its undo history and the CodeMirror node survive.
                editorPopin
                  ? "fixed inset-4 z-50 overflow-hidden rounded-lg border border-border bg-background shadow-2xl sm:inset-x-[12%] sm:inset-y-[8%]"
                  : full === "editor"
                    ? "flex-1"
                    : "hidden",
                ringFor("editor"),
              )}
              // Stop above the floating minimap rather than over it — inline, because it is a measurement (see `stripH`).
              style={editorPopin && stripH ? { bottom: stripH + 8 } : undefined}
            >
              {editorPopin && (
                <button
                  type="button"
                  className="absolute right-2 top-2 z-10 rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
                  title="Fermer"
                  onClick={() => setEditorPopin(false)}
                >
                  <X className="h-4 w-4" />
                </button>
              )}
              <EditorTab
                ref={editorRef}
                active={activePane === "editor"}
                // Only when it owns the screen, and not in the popin: that is one file, opened by a command that already named it.
                showTree={full === "editor"}
                popin={editorPopin}
                // The whole token, not the counter: this pane holds the two routes that answer about files and about names.
                reload={reload}
                activeProject={ws?.activeProject ?? null}
                projectName={project?.name ?? null}
                vimMode={vimMode}
                onOpenProject={openProject}
                onImportProject={imp.askImport}
                onChanged={bumpReload}
                // The clip file's Process menu runs `clip process` through here — journalled, one Ctrl+Z, and its reload brings the file back.
                command={runCommand}
                setStatus={setStatus}
                onEditTarget={setEditTarget}
                onOpenItem={setOpenItem}
                onOpenBuilder={(path, pane) => setBuilder({ path, pane })}
                // The same builder, over the médiathèque and locked — on the PANEL like a project module.
                onOpenLibraryModule={(path) =>
                  setBuilder({ path, pane: "panel" })
                }
                // A chain row opens the builder ON that chain, both coming out of the one library repository.
                chainsBuilder={
                  openBuilder !== null ? (
                    <ChainsBuilder
                      open={openBuilder}
                      focusNode={builderNode}
                      vimMode={vimMode}
                      onLog={pushLog}
                      onClose={() => setOpenBuilder(null)}
                    />
                  ) : null
                }
                onOpenChain={(ref, node) => {
                  setOpenBuilder(ref);
                  setBuilderNode(node ?? null);
                }}
                diagnostics={diagnostics}
                videoSources={videoSources}
                // The channel strip an `io: in` file gets under its text — what actually opens when somebody clicks an IN node.
                inputDevices={inputDevices}
                onRegroupInputs={connected ? regroupInputs : undefined}
              />
            </div>

            <div
              className={cn(
                // A ROW: the frame sits BESIDE the rest rather than over it — a picture is wide,
                // and stacking it took a third of the height off every pane below (docs/picture.md).
                "flex min-h-0 min-w-0 flex-1",
                full === "editor" && "hidden",
              )}
            >
              {/* The FRAME: a `split` surface the project declares, hidden and never unmounted since it owns a GL context (docs/picture.md). */}
              {hasViewport && (
                <div
                  ref={viewportPaneRef}
                  {...paneProps("viewport")}
                  className={cn(
                    "flex min-h-0 min-w-0",
                    full === "viewport"
                      ? "flex-1"
                      : full !== null
                        ? "hidden"
                        : // Expanded lanes have asked for the room; the frame stands down for
                          // them as the graph does, rather than squeezing three panes into one.
                          tlView.expanded
                          ? "hidden"
                          : "w-1/3 shrink-0",
                    ringFor("viewport"),
                  )}
                  // Once dragged the width is the drag's; until then it is the fraction above.
                  style={
                    full === null && !tlView.expanded && paneSize.viewport
                      ? { width: paneSize.viewport }
                      : undefined
                  }
                >
                  {/* `trackOrder` is what makes a shader's audio input mean anything: `levels` is indexed, not named — see src/shaderAudio.ts. */}
                  <ViewportTab
                    doc={videoDoc}
                    error={videoError}
                    trackIds={trackOrder}
                  />
                </div>
              )}
              {hasViewport && full === null && !tlView.expanded && (
                <PaneSplitter
                  pane={viewportPaneRef}
                  axis="x"
                  onSize={(px) => sizePane("viewport", px)}
                  label={m["pane.resize"]()}
                />
              )}
              {/* …and the panes that stack, in the column the frame is now beside. */}
              <div className="flex min-h-0 min-w-0 flex-1 flex-col">
                {/* The ARRANGEMENT, only when the project declares a `timeline` surface — absent means not mounted (docs/shell.md). */}
                {hasTimeline && (
                  <div
                    ref={timelinePaneRef}
                    {...paneProps("timeline")}
                    className={cn(
                      "flex min-h-0 min-w-0",
                      // Expanded lanes take the whole height, exactly as `full timeline` does: the pane below has stood down for them.
                      full === "timeline" || (full === null && tlView.expanded)
                        ? "flex-1"
                        : full === "chains"
                          ? "hidden"
                          : "h-1/2 shrink-0",
                      ringFor("timeline"),
                    )}
                    // Once dragged the height is the drag's; until then it is the fraction above.
                    style={
                      full === null && !tlView.expanded && paneSize.timeline
                        ? { height: paneSize.timeline }
                        : undefined
                    }
                  >
                    <TimelineTab
                      ref={timelineRef}
                      active={activePane === "timeline"}
                      reloadKey={reloadKey}
                      // …so an armed lane draws the take as it is played, instead of showing nothing while you record.
                      rolling={rolling}
                      takeStartBeat={takeStart}
                      // The pre-roll, in beats: the growing clip skips it, since those bars record nothing.
                      takeCountInBeats={recInfo.countIn * recInfo.beatsPerBar}
                      orbit={orbit}
                      videoTracks={videoTracks}
                      // The picture drag guards on this handler's own presence, so a snapshot simply has none.
                      onVideoEdit={frozen ? undefined : applyVideoEdit}
                      readOnly={frozen}
                      setStatus={setStatus}
                      onEditTarget={setEditTarget}
                      // A clicked clip shows its content where the graph is, and makes the slot visible with it.
                      onOpenClip={(t) => {
                        setFull(null);
                        setGraphSlot({ kind: "clip", target: t });
                      }}
                      // …and the bare lane puts the graph back: what a click opened, a click on nothing closes.
                      onEmptyClick={() => setGraphSlot(null)}
                      onCaret={setCaret}
                      onView={setTlView}
                      onContextMenu={openContextMenu}
                      onSeek={seek}
                      onSetLoop={(start, end, enabled) =>
                        engineRef.current?.loop(start, end, enabled)
                      }
                      onMoveEvent={(trackId, fromTc, toTc, toTrackId) =>
                        void runCommand(
                          `event move ${trackId} ${fromTc} ${toTc}${toTrackId ? ` ${toTrackId}` : ""}`,
                        )
                      }
                      // A tool's press, already spelled by the module that is tested for it — journalled like anything else.
                      onToolLine={(l) => void runCommand(l)}
                      shortcuts={shortcuts}
                      onResizeEvent={(trackId, fromTc, startTc, endTc) =>
                        void runCommand(
                          `event resize ${trackId} ${fromTc} ${startTc} ${endTc}`,
                        )
                      }
                      // `lenTc` is a LENGTH, and the verb's name is the end it applies to — see `event fadein` in commands.yaml.
                      onFadeEvent={(trackId, fromTc, which, lenTc) =>
                        void runCommand(
                          `event ${which === "fadeIn" ? "fadein" : "fadeout"} ${trackId} ${fromTc} ${lenTc}`,
                        )
                      }
                      // While the bar is filling a command whose open field wants a timecode, the ruler ANSWERS it instead of committing.
                      feedTimecode={
                        barPending?.kind === "timecode"
                          ? (tc, live) =>
                              cmdRef.current?.offerValue("timecode", tc, live)
                          : undefined
                      }
                      feedMove={
                        barPending?.canonical === "event move"
                          ? (trackId, fromTc, toTc, toTrackId, live) =>
                              cmdRef.current?.offer(
                                {
                                  track: trackId,
                                  timecode: fromTc,
                                  newTimecode: toTc,
                                  ...(toTrackId ? { toTrack: toTrackId } : {}),
                                },
                                live,
                              )
                          : undefined
                      }
                      // …and the selection rectangle answers `events move` the same way, leaving only the delta to type.
                      feedEventsMove={
                        barPending?.canonical === "events move"
                          ? (tracks, from, to) =>
                              cmdRef.current?.offer({ tracks, from, to })
                          : undefined
                      }
                      onFocusRow={focusRowInPanes}
                      // The corner button over the name column: `track new` with no name, off on a frozen song like every structural edit.
                      onNewTrack={
                        frozen ? undefined : () => void runCommand("track new")
                      }
                      trackControls={trackControls}
                      onTrackToggle={onTrackToggle}
                      laneNodes={laneNodes}
                      // The lane's ⋮ menu, from the gutter badge — the SAME one the chains pane opens on a lane's node.
                      onNodeMenu={openNodeMenu}
                    />
                  </div>
                )}
                {hasTimeline && full === null && !tlView.expanded && (
                  <PaneSplitter
                    pane={timelinePaneRef}
                    axis="y"
                    onSize={(px) => sizePane("timeline", px)}
                    label={m["pane.resize"]()}
                  />
                )}
                {/* The DESK: a `split` surface directly over the graph, mounted for as long as the project declares it (docs/shell.md). */}
                {turntablesSurface && (
                  <div
                    ref={deskPaneRef}
                    {...paneProps("turntables")}
                    className={cn(
                      "flex min-h-0 min-w-0",
                      full === "turntables"
                        ? "flex-1"
                        : full !== null
                          ? "hidden"
                          : // Expanded lanes have asked for the height; the desk stands down for
                            // them as the frame and the graph do.
                            tlView.expanded
                            ? "hidden"
                            : "h-1/2 shrink-0",
                      ringFor("turntables"),
                    )}
                    // Once dragged the height is the drag's; until then it is the fraction above.
                    style={
                      full === null && !tlView.expanded && paneSize.turntables
                        ? { height: paneSize.turntables }
                        : undefined
                    }
                  >
                    <SurfaceTab
                      surface={turntablesSurface}
                      deck={turntableDeck}
                      project={ws?.activeProject ?? "."}
                    />
                  </div>
                )}
                {turntablesSurface && full === null && !tlView.expanded && (
                  <PaneSplitter
                    pane={deskPaneRef}
                    axis="y"
                    onSize={(px) => sizePane("turntables", px)}
                    label={m["pane.resize"]()}
                  />
                )}
                {/* The MASTER STRIP, when declared: last in the column, over the graph holding the module it drives (docs/mastering.md). */}
                {masteringSurface && (
                  <div
                    ref={masteringPaneRef}
                    {...paneProps("mastering")}
                    className={cn(
                      "flex min-h-0 min-w-0",
                      full === "mastering"
                        ? "flex-1"
                        : full !== null
                          ? "hidden"
                          : // Expanded lanes have asked for the height; the strip stands down for
                            // them as the desk, the frame and the graph do.
                            tlView.expanded
                            ? "hidden"
                            : "h-1/3 shrink-0",
                      ringFor("mastering"),
                    )}
                    // Once dragged the height is the drag's; until then it is the fraction above.
                    style={
                      full === null && !tlView.expanded && paneSize.mastering
                        ? { height: paneSize.mastering }
                        : undefined
                    }
                  >
                    <MasteringTab
                      surface={masteringSurface}
                      paramsStore={pluginParamsStore}
                      setPluginParam={setPluginParam}
                      watchPluginParams={watchPluginParams}
                    />
                  </div>
                )}
                {masteringSurface && full === null && !tlView.expanded && (
                  <PaneSplitter
                    pane={masteringPaneRef}
                    axis="y"
                    onSize={(px) => sizePane("mastering", px)}
                    label={m["pane.resize"]()}
                  />
                )}
                <div
                  {...paneProps("chains")}
                  className={cn(
                    "flex min-h-0 min-w-0",
                    // Alone in the column it takes it outright — the same `flex-1` a fullscreened
                    // graph gets (see `viewPanes`). And LAST in the column it takes what is LEFT,
                    // for the same reason by another route: a drag on the pane above has to come
                    // out of this one, and two fixed halves plus a seam overflow by the seam.
                    chainsAlone || full === "chains"
                      ? "flex-1"
                      : chainsOffScreen
                        ? "hidden"
                        : "flex-1",
                    ringFor("chains"),
                  )}
                >
                  {/* The slot takes the graph's PLACE, not its mount: ChainsTab holds the MIDI runtime (docs/shell.md, docs/midi.md). */}
                  <div
                    className={cn(
                      "flex min-h-0 min-w-0 flex-1",
                      graphSlot && "hidden",
                    )}
                  >
                    <ChainsTab
                      cameras={cameras}
                      reloadKey={reloadKey}
                      organizeKey={organizeKey}
                      active={!chainsOffScreen && !graphSlot}
                      // A SET's lanes are DECKS and wear the record the header wears; the choice is the project's — see chainsIcons.tsx.
                      icons={hasTurntables ? DECK_ICONS : STUDIO_ICONS}
                      // The sidebar is fullscreen chrome: it belongs wherever the graph has the whole window, which a set's desk denies it.
                      showList={chainsAlone || full === "chains"}
                      trackOrder={trackOrder}
                      videoSpans={videoLaneSpans}
                      noteLanes={noteLanes}
                      project={projectDoc}
                      command={quietCommand}
                      onBypassModule={(mod) =>
                        void runCommand(`node bypass ${mod}`)
                      }
                      onModuleField={runCommand}
                      onRecorder={onRecorder}
                      onProjectField={onProjectField}
                      onNodeMenu={openNodeMenu}
                      engineWarnings={engineWarnings}
                      onAssetBrowse={browseAssets}
                      onWatchWaveform={watchWaveform}
                      onSetModuleAsset={(mod, kind, f) =>
                        void runCommand(`module ${kind} ${mod} ${f}`)
                      }
                      onContextMenu={openContextMenu}
                      onEdgeInsert={frozen ? undefined : insertIntoChain}
                      onCanvasInsert={frozen ? undefined : placeInGraph}
                      // The patch cable's landing runs the verb outright, and all five are OPTIONAL props a snapshot simply passes none of.
                      onConnect={
                        frozen
                          ? undefined
                          : (from, to) =>
                              void runCommand(
                                `graph chain connect ${from} ${to}`,
                              )
                      }
                      // Both curve cables write one line of the same verb, with the param QUOTED, since a plugin's names have spaces.
                      onAutomate={
                        frozen
                          ? undefined
                          : (module, param, curve, trigger) =>
                              void runCommand(
                                `node automate ${module} ${param} ${curve}${
                                  trigger ? ` ${trigger}` : ""
                                }`,
                              )
                      }
                      onDisconnect={
                        frozen
                          ? undefined
                          : (from, to) =>
                              void runCommand(
                                `graph chain disconnect ${from} ${to}`,
                              )
                      }
                      onReplug={
                        frozen
                          ? undefined
                          : (from, to, nf, nt) =>
                              void runCommand(
                                `graph chain replug ${from} ${to} ${nf} ${nt}`,
                              )
                      }
                      // A dropped header likewise: the drag already said everything.
                      onMoveNode={
                        frozen
                          ? undefined
                          : (mod, x, y) =>
                              void runCommand(`graph move ${mod} ${x} ${y}`)
                      }
                      pendingInsert={insertingAt}
                      seedGraph={seedGraph}
                      // The NOTES: whether the graph draws them, and how many — the count travels up because the button is in the footer.
                      showDocs={showDocs}
                      onDocCount={setDocCount}
                      onLaneNodes={setLaneNodes}
                      pluginParamsStore={pluginParamsStore}
                      requestPluginParams={requestPluginParams}
                      watchPluginParams={watchPluginParams}
                      setPluginParam={setPluginParam}
                      moduleParams={offlineParams}
                      trackControls={trackControls}
                      onTrackToggle={onTrackToggle}
                      onTrackSet={onTrackSet}
                      focus={graphFocus}
                      onFocused={reportFramed}
                      // The mixer view, which is a rank change on this same graph — see mixerView.
                      alignModules={mixerView ? mixerStrips : undefined}
                      // The sockets a live input can be on — the same list the editor's strip uses.
                      inputDevices={inputDevices}
                      // …and the song's output level, for the fader on the OUT card — the same param the header's fader writes.
                      masterVolume={projectDoc?.masterVolume}
                      midiRef={chainsMidiRef}
                      onMidiStatus={setStatus}
                    />
                  </div>
                  {graphSlot?.kind === "grid" && (
                    <SeqGridPane
                      path={graphSlot.path}
                      view={graphSlot.view}
                      onClose={() => setGraphSlot(null)}
                      onChanged={bumpReload}
                      setStatus={setStatus}
                    />
                  )}
                  {/* A clicked clip's content: `ClipView` draws its own header and ✕, and tells audio from MIDI in one place. */}
                  {graphSlot?.kind === "clip" && (
                    <ClipView
                      target={graphSlot.target}
                      onClose={() => setGraphSlot(null)}
                      // The slot's target is a snapshot from the click; this is what lets the open clip re-read itself after a reload.
                      reloadKey={reloadKey}
                      // A click on the editor's arrangement ruler is the timeline's seek.
                      onSeek={seek}
                      // The TRACKER view writes its sequence file directly rather than through a command, so its reload is asked for here.
                      onChanged={bumpReload}
                      setStatus={setStatus}
                      // The caret's three verbs and the loop it sets, pointed at whichever grid this pane is drawing.
                      caretRef={clipGridRef}
                      onSelection={setClipSel}
                      onSetLoop={(start, end, enabled) =>
                        engineRef.current?.loop(start, end, enabled)
                      }
                      // An AUDIO clip opens the clip panel, whose onsets, trim and normalise are command lines like everything else.
                      command={runCommand}
                      // …except the stretch points, whose edits change nothing outside the clip file, so they go the quiet way.
                      quietCommand={quietCommand}
                      // …and they get the same right-click every other entity has.
                      onContextMenu={openContextMenu}
                      // The roll's draw gesture, and all four ANSWER the promise rather than dropping it — the ghost is held until the reload lands (rollPending.ts).
                      onCreateNote={(seqId, key, t0, t1) =>
                        runCommand(
                          `sequence note new ${seqId} ${key} ${t0} ${t1}`,
                        )
                      }
                      // The roll's velocity drag, committed like the timeline's clip drag: one command on release.
                      onSetVelocity={(seqId, key, start, vel) =>
                        runCommand(
                          `sequence note velocity ${seqId} ${key} ${start} ${vel}`,
                        )
                      }
                      // …and the note drag the same way — move and stretch are one verb, being one gesture with two grips.
                      onSetNoteRange={(seqId, key, start, ns, ne) =>
                        runCommand(
                          `sequence note timerange ${seqId} ${key} ${start} ${ns} ${ne}`,
                        )
                      }
                      // …except a drag that changed the PITCH, which is the verb that keeps the duration and refuses an occupied slot.
                      onMoveNote={(seqId, key, start, nk, ns) =>
                        runCommand(
                          `sequence note move ${seqId} ${key} ${start} ${nk} ${ns}`,
                        )
                      }
                      // …and the ear. Straight down the engine's socket: a note heard is not an edit, so it is journalled nowhere.
                      onPreviewNote={(track, key, vel) =>
                        engineRef.current?.previewNote(track, key, vel)
                      }
                      waveRef={waveRef}
                      onWaveView={setWaveView}
                      rollRef={rollRef}
                      onRollMode={setRollMode}
                      // …and the roll's `remove` mode, which is the caret's `x` reached by the pointer instead.
                      onRemoveNote={(seqId, key, start) =>
                        runCommand(
                          `sequence note remove ${seqId} ${key} ${start}`,
                        )
                      }
                    />
                  )}
                  {/* One lane's whole signal path, read left to right; `moduleRow` lays out the graph's own cards (docs/shell.md). */}
                  {graphSlot?.kind === "trackModules" && (
                    <TrackModulesPane
                      trackId={graphSlot.trackId}
                      reloadKey={reloadKey}
                      command={quietCommand}
                      onModuleField={runCommand}
                      onRecorder={onRecorder}
                      onProjectField={onProjectField}
                      trackOrder={trackOrder}
                      pluginParamsStore={pluginParamsStore}
                      requestPluginParams={requestPluginParams}
                      watchPluginParams={watchPluginParams}
                      setPluginParam={setPluginParam}
                      moduleParams={offlineParams}
                      trackControls={trackControls}
                      onContextMenu={openContextMenu}
                      engineWarnings={engineWarnings}
                      onClose={() => setGraphSlot(null)}
                    />
                  )}
                  {/* ONE panel for a take and for the file it becomes; `rolling` chooses the picture, not the mount (docs/shell.md). */}
                  {graphSlot?.kind === "recording" && (
                    <AudioClipPanel
                      clip={rolling ? null : (reviewTake?.clip ?? null)}
                      track={reviewTake?.track ?? ""}
                      rolling={rolling}
                      tempo={recInfo.tempo}
                      beatsPerBar={recInfo.beatsPerBar}
                      countIn={recInfo.countIn}
                      startBeat={takeStart}
                      // Where the clip on screen actually SITS on its lane, asked of the document: a take from the sidebar sits where it was recorded.
                      placedAt={
                        (reviewTake &&
                          placedBeat(
                            projectDoc,
                            reviewTake.track,
                            reviewTake.clip,
                          )) ??
                        takeStart
                      }
                      takes={reviewTakes}
                      onPickTake={pickTake}
                      onKeepTake={keepTake}
                      onPlay={() => void runCommand("transport toggle")}
                      onSeek={seek}
                      trackOrder={trackOrder}
                      trackNames={recInfo.names}
                      command={runCommand}
                      quietCommand={quietCommand}
                      onContextMenu={openContextMenu}
                      reloadKey={reloadKey}
                      onStop={() => void runCommand("transport stop")}
                      onClose={() => {
                        setReviewOn(null);
                        if (reviewTake) setReviewedTake(reviewTake.clip);
                        setGraphSlot(null);
                      }}
                    />
                  )}
                </div>
              </div>
            </div>

            {/* THE RIGHT COLUMN — one of three panels, docked beside the panes; none is a pane and `rightPanel` makes them exclusive (docs/shell.md). */}
            {rightPanel === "settings" && (
              <SettingsPanel
                tab={settingsTab}
                engine={engineRef.current ?? null}
                vimMode={vimMode}
                onRun={runCommand}
                onClose={() => setRightPanel(null)}
              />
            )}
            {rightPanel === "playlists" && (
              <PlaylistsPanel
                vimMode={vimMode}
                onRun={runCommand}
                onClose={() => setRightPanel(null)}
              />
            )}
            {rightPanel === "share" && (
              <SharePanel
                gitStatus={gitStatus}
                busy={share.busy}
                externals={externals}
                onRun={(c) => void runCommand(c)}
                onClose={() => setRightPanel(null)}
              />
            )}
          </div>

          {/* bottom split panel — available on every tab, resizable divider */}
          {panel && (
            <>
              <div
                onPointerDown={startResize}
                className="h-1 shrink-0 cursor-row-resize bg-border transition-colors hover:bg-primary/60"
              />
              <div
                className="min-h-0 shrink-0 overflow-hidden border-t border-border bg-background"
                style={{ height: panelH }}
              >
                {panel === "graph" && (
                  <GraphPanel
                    cameras={cameras}
                    reloadKey={reloadKey}
                    organizeKey={organizeKey}
                    trackId={caret?.trackId ?? null}
                    trackOrder={trackOrder}
                    videoSpans={videoLaneSpans}
                    noteLanes={noteLanes}
                    viewport={videoDoc?.viewport}
                    project={projectDoc}
                    command={quietCommand}
                    onBypassModule={(mod) =>
                      void runCommand(`node bypass ${mod}`)
                    }
                    onModuleField={runCommand}
                    onRecorder={onRecorder}
                    onProjectField={onProjectField}
                    onNodeMenu={openNodeMenu}
                    engineWarnings={engineWarnings}
                    onContextMenu={openContextMenu}
                    pluginParamsStore={pluginParamsStore}
                    setPluginParam={setPluginParam}
                    moduleParams={offlineParams}
                    trackControls={trackControls}
                    onTrackToggle={onTrackToggle}
                    onTrackSet={onTrackSet}
                  />
                )}
                {panel === "logs" && (
                  <LogsPanel
                    lines={logs}
                    onClear={() => void runCommand("ui logs clear")}
                  />
                )}
              </div>
            </>
          )}
        </div>

        {/* The take once it has stopped: the FILE, its onsets and its level — the editing step beside the live pane (docs/shell.md). */}

        <footer
          className={cn(
            "flex items-center border-t border-border text-muted-foreground",
            isMobile
              ? "gap-2 px-2 py-0.5 text-[10px]"
              : "gap-3 px-4 py-1 text-xs",
          )}
        >
          {/* left: the frediverse logo, the engine status light, then the status text */}
          <div className="flex min-w-0 items-center gap-2.5">
            <FrediverseMark size="sm" className="shrink-0 opacity-60" />
            <Circle
              className={`h-2.5 w-2.5 shrink-0 ${connected ? "fill-emerald-500 text-emerald-500" : "fill-red-500 text-red-500"}`}
              aria-label={
                connected ? "engine connected" : "engine disconnected"
              }
            />
            {/* The MODE and the tool, PERSISTENT unlike the line beside it: a state nobody can see is one you leave by surprise (docs/timeline.md). */}
            {/* The waveform's comes FIRST when one is open, the clip pane being the surface in front. */}
            {rollMode && graphSlot?.kind === "clip" ? (
              rollMode !== "select" && (
                <Badge
                  variant="rec"
                  className="shrink-0"
                  title={`piano roll: ${rollMode} — esc or a backs out`}
                >
                  {rollMode}
                </Badge>
              )
            ) : waveView && graphSlot?.kind === "clip" ? (
              waveView !== "standard" && (
                <Badge
                  variant="rec"
                  className="shrink-0"
                  title={`waveform: ${waveView} — esc or a backs out`}
                >
                  {waveView}
                </Badge>
              )
            ) : ringPanes.includes("timeline") &&
              (tlView.mode !== "normal" || tlView.tool !== "pointer") ? (
              <Badge
                variant={tlView.tool !== "pointer" ? "rec" : "default"}
                className="shrink-0"
                title={`timeline: ${tlView.mode}${tlView.tool !== "pointer" ? ` · ${tlView.tool}` : ""} — esc backs out`}
              >
                {tlView.tool !== "pointer" ? tlView.tool : tlView.mode}
              </Badge>
            ) : null}
            {/* The open menu speaks FIRST and borrows the line rather than writing it, so closing gives back what the app last said. */}
            <span
              // This line is the shell's whole error channel, so it is also its only live region.
              role="status"
              aria-live="polite"
              // Truncation is the layout's, not the message's: the full text has to stay reachable.
              title={menuHint || status || project?.root}
              className={cn(
                "truncate",
                // Only when the app's OWN last word was a refusal: a menu hint borrows this line and is nobody's verdict.
                !menuHint && statusLine.refused && "text-amber-400",
              )}
            >
              {menuHint || status || project?.root}
            </span>
            {/* The play button spins for this too; the line stays because it NAMES what is awaited, which a spinner cannot. */}
            {waitingForEngine ? (
              <span
                className="flex shrink-0 items-center gap-1.5 whitespace-nowrap text-amber-500"
                title={m["status.engineStarting"]()}
              >
                <Loader2 className="h-3 w-3 animate-spin" />
                waiting for engine…
              </span>
            ) : warm.warming ? (
              <span
                className="flex shrink-0 items-center gap-1.5 whitespace-nowrap"
                title={m["status.decodingWaveforms"]()}
              >
                <Loader2 className="h-3 w-3 animate-spin" />
                caching waveforms
                {warm.total ? ` ${warm.done}/${warm.total}` : ""}…
              </span>
            ) : null}
            {projectErrors > 0 && (
              <Badge
                variant="rec"
                className="shrink-0"
                title={`${projectErrors} error${projectErrors === 1 ? "" : "s"} in this project — the timeline and chains won't load until they're fixed`}
              >
                {projectErrors} error{projectErrors === 1 ? "" : "s"}
              </Badge>
            )}
          </div>

          {/* How good this engine link is — Q1/Q2/Q3 off the measured latency, a property of the SESSION (@studio/web-protocol/quality). */}
          <span
            className="ml-auto shrink-0 whitespace-nowrap font-mono tabular-nums"
            title={
              engineLatency
                ? m["engines.latencyBreakdown"]({
                    network: Math.round(engineLatency.networkMs),
                    audio: Math.round(engineLatency.audioMs),
                  })
                : m["engines.noLatency"]()
            }
          >
            {engineLatency
              ? formatLatency(engineLatency)
              : m["engines.noLatency"]()}
          </span>

          {/* right: the tempo and signature, the metronome, a separator, then the bottom-panel choices */}
          <div className="flex shrink-0 items-center gap-2">
            {/* Next to the metronome because it is what the metronome clicks — the doc's tempo, not the engine's. */}
            <span
              className="whitespace-nowrap font-mono tabular-nums"
              title={m["transport.tempoSig"]()}
            >
              {recInfo.tempo} bpm
              <span className="mx-1 text-border">·</span>
              {recInfo.beatsPerBar}/{recInfo.beatUnit}
            </span>
            {/* Left click toggles the click, right click opens its level; both are project settings, so both are command lines. */}
            <MetronomeButton
              on={metronomeOn}
              level={metronomeLevel}
              onToggle={() => void runCommand("transport metronome")}
              onLevel={(v) =>
                void runCommand(`transport metronome volume ${v}`)
              }
            />
            <span className="h-4 w-px shrink-0 bg-border" aria-hidden="true" />
            <nav className="flex items-center gap-1">
              {/* The mixer REARRANGES the graph rather than opening a panel, and is dead when the song has no strip (docs/shell.md). */}
              <Button
                size="icon-xs"
                variant={mixerView ? "default" : "ghost"}
                disabled={mixerStrips.length === 0}
                onClick={() => void runCommand("ui mixer")}
                title={
                  mixerStrips.length === 0
                    ? "No strip in this song: a strip is a Mixer module at the end of a track"
                    : mixerStrips.length === 1
                      ? "One strip — the view frames it, but there is nothing to line up"
                      : `Mixer view — line up this song's ${mixerStrips.length} strips`
                }
                aria-label="Mixer view"
                aria-pressed={mixerView}
              >
                <MixerIcon className="h-3.5 w-3.5" />
              </Button>
              {/* The notes, off by default: they are IN the graph and you say when, and the button is dead on a project with none. */}
              <Button
                size="icon-xs"
                variant={showDocs ? "default" : "ghost"}
                disabled={docCount === 0}
                onClick={() => void runCommand("ui notes")}
                title={
                  docCount === 0
                    ? "No notes in this project: a note is a node of @studio/doc, wired from what it is about"
                    : showDocs
                      ? `Hide the ${docCount} note(s) on the graph`
                      : `Show the ${docCount} note(s) on the graph`
                }
                aria-label="Toggle docs"
                aria-pressed={showDocs}
              >
                <StickyNote className="h-3.5 w-3.5" />
              </Button>
              {(Object.keys(PANEL_META) as Panel[]).map((p) => {
                const Icon = PANEL_META[p].icon;
                return (
                  <Button
                    key={p}
                    size="icon-xs"
                    variant={panel === p ? "default" : "ghost"}
                    onClick={() => void runCommand(`ui panel ${p}`)}
                    title={`${PANEL_META[p].label} panel`}
                    aria-label={`${PANEL_META[p].label} panel`}
                  >
                    <Icon className="h-3.5 w-3.5" />
                  </Button>
                );
              })}
            </nav>
          </div>
        </footer>

        {/* The bottom of the window: the minimap, then the docked command bar, both desktop-only (docs/commandBar.md). */}
        {docked && (
          <>
            {minimapDocked && (
              <Minimap
                reloadKey={reloadKey}
                orbit={orbit}
                // Same map the timeline builds its rows from — a row it skipped would put every lane below it out.
                automation={laneNodes.automation}
                caret={caret}
                highlight={openItem}
                onSeek={seek}
              />
            )}
            <div className="flex shrink-0 items-center border-t border-border bg-popover px-3 py-2">
              <CommandBar
                ref={cmdRef}
                commands={paletteCommands}
                listArg={listArg}
                onRun={(line) => void runCommand(line)}
                onClose={() => cmdRef.current?.blur()}
                onPending={setBarPending}
                caret={caretAim}
              />
            </div>
          </>
        )}

        {/* The minimap again, full width over the popin that hid the timeline, last in the tree for painting order (docs/shell.md). */}
        {minimapFloating && (
          <div
            ref={stripRef}
            className="fixed inset-x-0 bottom-0 z-50 border-t border-border bg-background"
          >
            <MiniTransport
              playing={playing}
              waiting={transportWaiting}
              tempo={recInfo.tempo}
              beatsPerBar={recInfo.beatsPerBar}
              onToggle={() => transport(playing ? "stop" : "play")}
            />
            <Minimap
              reloadKey={reloadKey}
              orbit={orbit}
              caret={caret}
              highlight={openItem}
              onSeek={seek}
            />
          </div>
        )}

        {/* A tab bar stood here, one tab per pane; it is in the hamburger now — see `headerActions` and docs/shell.md. */}

        {/* The PHONE's command bar, summoned rather than docked and deliberately not modal (docs/commandBar.md). */}
        {!docked && paletteOpen && (
          <div className="pointer-events-none fixed inset-x-0 bottom-0 z-50 flex justify-center pb-4">
            {/* A click anywhere on the bar is a click on its field: landing on the padding would otherwise blur the input. */}
            <div
              className="pointer-events-auto mx-4 flex w-full max-w-2xl items-center rounded-lg border border-border bg-popover px-3 py-2.5 shadow-2xl"
              onPointerDown={() => cmdRef.current?.focus()}
            >
              <CommandBar
                ref={cmdRef}
                commands={paletteCommands}
                listArg={listArg}
                onRun={(line) => {
                  void runCommand(line);
                  setPaletteOpen(false);
                }}
                onClose={() => setPaletteOpen(false)}
                onPending={setBarPending}
                onFocusChange={onBarFocusChange}
                caret={caretAim}
                autoFocus
              />
            </div>
          </div>
        )}

        {/* right-click context menu — opened by the timeline and the chains graph */}
        {menu && (
          <ContextMenu
            items={menu.items}
            // The icons and names this person chose, from `ui settings commands`.
            prefs={commandPrefs}
            x={menu.x}
            y={menu.y}
            onPick={pickMenuItem}
            // What the row under the pointer does, into the status line — stable, because the menu also calls it from an unmount cleanup.
            onHint={setMenuHint}
            onClose={() => setMenu(null)}
          />
        )}

        {/* "which file?" — a module widget's library browser, the same popup as the `+`: both are a nested catalogue. */}
        {assetPicker && (
          <AssetPicker
            x={assetPicker.x}
            y={assetPicker.y}
            param={assetPicker.param}
            files={assetPicker.files}
            onPick={(file) => {
              const { module, param } = assetPicker;
              setAssetPicker(null);
              // A file-valued param is a param — `node param <node> nam <file>`, all three QUOTED, with `none` left bare (docs/moduleBuilder.md).
              void runCommand(
                file
                  ? `node param "${module}" "${param}" "${file}"`
                  : `node param "${module}" "${param}" none`,
              );
            }}
            onClose={() => setAssetPicker(null)}
          />
        )}

        {/* "which module?" — opened by the `+` on a graph arrow, before any command */}
        {modulePicker && (
          <ModulePicker
            x={modulePicker.x}
            y={modulePicker.y}
            baseModules={baseModules}
            onPick={onModulePick}
            onClose={() => setModulePicker(null)}
          />
        )}

        {/* The documentation at #help — a PAGE, not a popin, so the reference reads as one ctrl-F-able document. */}
        {showHelp && (
          <div className="fixed inset-0 z-50 bg-background">
            <HelpPage onBack={closeHelp} prefs={commandPrefs} />
          </div>
        )}

        {/* The SCREEN surfaces were mounted here; they are panes in the column above now — packages/song/docs/surfaces.md. */}

        {/* "import this .dawproject?" — clicking one in the tree lands here */}
        <ImportDialog
          path={imp.importPath}
          busy={imp.importing}
          error={imp.importError}
          log={imp.importLog}
          onConfirm={() => void imp.confirmImport()}
          onOpen={() => void imp.openImported()}
          onCancel={imp.cancelImport}
        />

        {/* COMMANDS is the one settings screen still drawn as a page: a catalogue does not fit a 24rem column (docs/shell.md). */}
        {commandsPage && (
          <div className="absolute inset-0 z-40 bg-background">
            <CommandsSettings
              // The whole catalogue, both halves: a page that arranged only one would order a menu it does not draw.
              commands={allCommands}
              prefs={commandPrefs}
              onSave={saveCommandPrefs}
              onBack={() => setCommandsPage(false)}
            />
          </div>
        )}

        {/* The shared module builder over the whole shell; it holds no engine link, so no factory banks and no live params (docs/moduleBuilder.md). */}
        {assemblyBuilder && (
          <div className="absolute inset-0 z-30 bg-background">
            <AssemblyBuilder
              store={moduleStore}
              path={assemblyBuilder.file}
              graph={assemblyGraph}
              vimMode={vimMode}
              // A template lives in the library, so it opens the way a shared module does: locked.
              readOnly={
                isLibraryPath(assemblyBuilder.file) && !assemblyUnlocked
              }
              onRequestEdit={
                isLibraryPath(assemblyBuilder.file) && !assemblyUnlocked
                  ? () => setAssemblyUnlocked(true)
                  : undefined
              }
              onClose={() => {
                setAssemblyBuilder(null);
                setAssemblyUnlocked(false);
                bumpReload();
              }}
            />
          </div>
        )}

        {builder && (
          <div className="absolute inset-0 z-30 bg-background">
            <ModuleBuilder
              // ONE store: the libraries are a submodule inside the workspace, so a shared module is an ordinary workspace path.
              store={moduleStore}
              path={builder.path}
              kind="module"
              moduleName={builder.path.split("/").slice(-2)[0] ?? builder.path}
              paramRef={null}
              vimMode={vimMode}
              initialPane={builder.pane}
              // A shared module opens LOCKED: everyone's copy is this one, so writing to it is decided in the dialog below.
              readOnly={isLibraryPath(builder.path) && !builder.unlocked}
              onRequestEdit={
                isLibraryPath(builder.path) && !builder.unlocked
                  ? () => setEditShared(builder.path)
                  : undefined
              }
              onBack={() => setBuilder(null)}
              onSaved={() => {
                bumpReload();
                // A save here PUBLISHES — four files committed and pushed onto the library repository, so the act says so.
                editorRef.current?.refreshLibraries();
              }}
              setStatus={setStatus}
              // What the plugin calls its parameters and what each spans, off `pluginParamMeta` — never the 20 Hz store, which render would read empty.
              pluginParamNames={
                builderPlugin
                  ? Object.keys(pluginParamMeta[builderPlugin.pluginId] ?? {})
                  : undefined
              }
              pluginParamMeta={
                builderPlugin
                  ? pluginParamMeta[builderPlugin.pluginId]
                  : undefined
              }
              // Ask the MACHINE what this module's plugin has, by loading one on purpose — the way out for a module the project does not wire (api.ts).
              onScanParams={api.scanPluginParams}
              // …and the same ref, opened rather than read: only for a plugin this machine SCANNED, on an instance in no project.
              onShowNativeUI={api.showPluginNativeUI}
              // The sockets an `io: in` module can listen on — empty with no engine attached, which is the honest answer.
              inputDevices={inputDevices}
              // …and the one act that changes that list, offered only with an engine attached, which is what does it.
              onRegroupInputs={connected ? regroupInputs : undefined}
              presets={
                (builderPlugin && presets[builderPlugin.module]) ||
                EMPTY_PRESETS
              }
              onListPresets={() =>
                builderPlugin && listPresets(builderPlugin.module)
              }
              // The engine resolves both ends to the same live plugin, so which name is sent does not matter — take the builder's.
              onSetPreset={(module, sel) => setPreset(module, sel)}
              // A save into `_modules` forked: follow the copy, or the next save would fork again.
              onRelocated={(next) => {
                setBuilder({ path: next, pane: "module" });
                editorRef.current?.open(next);
              }}
              // The module drawn as the card it will be in a chain — a slot, since the graph needs OUR glyphs and OUR command line.
              renderPreview={({ ui, params, bases }) => (
                <ModulePreview
                  icons={STUDIO_ICONS}
                  command={runCommand}
                  name={builder.path.split("/").slice(-2)[0] ?? builder.path}
                  path={builder.path}
                  ui={ui}
                  params={params}
                  bases={bases}
                  paramsStore={builderPlugin ? pluginParamsStore : undefined}
                  onSetParam={builderPlugin ? setPluginParam : undefined}
                />
              )}
            />
          </div>
        )}

        {/* The one gate between reading a shared module and rewriting everyone's copy of it. */}
        <EditSharedModuleDialog
          path={editShared}
          onCancel={() => setEditShared(null)}
          onConfirm={() => {
            setEditShared(null);
            setBuilder((b) => (b ? { ...b, unlocked: true } : b));
          }}
        />

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

        {/* Global toast notifications — positioned bottom-right, above everything */}
        <Toaster />
        {/* The app's own confirm/prompt, in place of the OS box that ignored the Escape ladder. */}
        <AskHost />
      </div>
    </EngineStoreProvider>
  );
}
