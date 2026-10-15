// App.tsx — the k7 web shell: the panes the project DECLARES (editor | timeline over
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
import {
  ArrowLeft,
  Circle,
  Headphones,
  History,
  ListChecks,
  ListMusic,
  Loader2,
  Lock,
  MessageSquare,
  Pause,
  Play,
  Settings,
  Share2,
  Square,
  StickyNote,
  Terminal,
  X,
} from "@frediverse/ui/icons";
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
import type { CurveSpec } from "@studio/graph-model";
import { ViewportTab, sceneOf as videoSceneOf } from "@studio/k7-plugins/video";
import { AskHost, askConfirm } from "@studio/project-shell/ask";
import { markActive } from "@studio/project-shell/idle";
// The address of ONE surface, for another device to open — the same module the launch uses, so both spell a project alike (docs/external.md).
import {
  externalUrl,
  launchUrl,
  parseLaunch,
  projectsUrl,
} from "@studio/project-shell/launch";
import { onToast, showToast, Toaster } from "@studio/project-shell/toast";
import { type HistoryDeps, runRedo, runUndo } from "@studio/project-shell/undo";
// The leaf with no `node:fs` in it — a browser may ask what a path names without dragging the loader in.
import { moduleKeyFromPath, TAP_SAMPLE } from "@studio/song-schema/moduleTypes";
import type { ReferenceTrack } from "@studio/song-schema/reference";
import { beatsToPosition, parsePosition } from "@studio/song-schema/timecode";
import {
  LcdSoundsContext,
  SongClockProvider,
  type TapAction,
} from "@studio/ui-chains-react";
import { ModulePreview } from "@studio/ui-chains-react/module-preview";
import type { BuilderPane } from "@studio/ui-module-builder";
import { usePointerFollow } from "@studio/ui-timeline/drag";
import { projectLabel } from "@studio/web-protocol/projects";
import type { EngineLatency } from "@studio/web-protocol/quality";
import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { aiOrganize, api, engines, moduleStore, PL8_API } from "./api";
import { DECK_ICONS, STUDIO_ICONS } from "./chainsIcons";
import type { MaybeClipboard } from "./clipboard";
import { type CommandPrefs, labelOf, orderCommands } from "./commandPrefs";
import { AssetPicker } from "./components/AssetPicker";
import type { AudioClipHandle } from "./components/AudioClipPanel";
import { AudioClipPanel } from "./components/AudioClipPanel";
import { BottomPanel } from "./components/BottomPanel";
import { ChainsBuilder } from "./components/ChainsBuilder";
import { ChainsTab } from "./components/ChainsTab";
import { ClipView, type EditTarget } from "./components/ClipView";
import {
  barTint,
  CommandBar,
  type CommandBarHandle,
  type CommandPending,
  type PaletteCommand,
} from "./components/CommandBar";
import { CommandsSettings } from "./components/CommandsSettings";
import { CommentsPanel } from "./components/CommentsPanel";
import { ConflictsPanel, ConflictsTab } from "./components/ConflictsPanel";
import { ContextMenu } from "./components/ContextMenu";
import { CurveEditor } from "./components/CurveEditor";
import { type EditorHandle, EditorTab } from "./components/EditorTab";
import { EngineLink } from "./components/EngineLink";
import { EngineSwitch } from "./components/EngineSwitch";
import { EngineSyncFailedDialog } from "./components/EngineSyncFailedDialog";
import {
  EngineSyncProgress,
  syncRunning,
} from "./components/EngineSyncProgress";
import { FloatingWindow } from "./components/FloatingWindow";
import { FooterTab, FooterTabs } from "./components/FooterTab";
import { GraphPanel } from "./components/GraphPanel";
import { HelpPage } from "./components/HelpPage";
import { HistoryPanel } from "./components/HistoryPanel";
import { ImportDialog } from "./components/ImportDialog";
import { LogsPanel } from "./components/LogsPanel";
import { MasteringTab } from "./components/MasteringTab";
import { MasterMeter, type MasterMeterHandle } from "./components/MasterMeter";
import { MetronomeButton } from "./components/MetronomeButton";
import { MidiTakeRoll } from "./components/MidiTakeRoll";
import { Minimap, type MinimapItem } from "./components/Minimap";
import { MobileMenu, MobileMenuItem } from "./components/MobileChrome";
import {
  type ModulePick,
  ModulePicker,
  type PickerModule,
} from "./components/ModulePicker";
import type { RollHandle } from "./components/PianoRoll";
import { PlaylistsPanel } from "./components/PlaylistsPanel";
import { RackBuilder } from "./components/RackBuilder";
import { ReferenceBar } from "./components/ReferenceBar";
import { ReferencesPanel } from "./components/ReferencesPanel";
import { RightPanel } from "./components/RightPanel";
import { SeqGridPane } from "./components/SeqGridPane";
import {
  isSettingsTab,
  SETTINGS_TABS,
  SettingsPanel,
  type SettingsTab,
} from "./components/SettingsPanel";
import type { OpenShare } from "./components/SharedGate";
import { SharePanel } from "./components/SharePanel";
import { SurfaceTab } from "./components/SurfaceTab";
import type { PanelTakes } from "./components/TakesView";
import { TapChainEditor } from "./components/TapChainEditor";
import { TasksPanel } from "./components/TasksPanel";
import { type TimelineHandle, TimelineTab } from "./components/TimelineTab";
import { TrackModulesPane } from "./components/TrackModulesPane";
import {
  contextMenu,
  type MenuCtx,
  type MenuItem,
  type NodeMenuTarget,
  nodeMenu,
  withAmbient,
} from "./contextMenu";
import { newCurveName, type ParamKind } from "./curveDraft";
import { desktop } from "./desktop";
import { EXPORT_USAGE, parseExportAsk } from "./exportArgs";
import { fixedMaster, TARGET_DB, trimFor } from "./gainTrim";
import type { ClipGridHandle } from "./gridCaret";
import type { HistoryMark } from "./historyMarks";
import { useCameras } from "./hooks/useCameras";
import { useCommandKeys } from "./hooks/useCommandKeys";
import { useEngineCompat } from "./hooks/useEngineCompat";
import { useEngineLink } from "./hooks/useEngineLink";
import { useInputDevices } from "./hooks/useInputDevices";
import { useInstrumentStatus } from "./hooks/useInstrumentStatus";
import { type SetStatus, useLogs } from "./hooks/useLogs";
import type { MidiControlApi } from "./hooks/useMidiControl";
import { useMidiRecording } from "./hooks/useMidiRecording";
import { useNodePresets } from "./hooks/useNodePresets";
import {
  useActiveProjectFollow,
  useProjectErrors,
  useWarmWaveforms,
} from "./hooks/usePolls";
import { useProjectImport } from "./hooks/useProjectDialogs";
import { useProjectDoc } from "./hooks/useProjectDoc";
import { useProjectTasks } from "./hooks/useProjectTasks";
import {
  noteQuietRevision,
  noteRevision,
  useRevision,
} from "./hooks/useRevision";
import { useShare } from "./hooks/useShare";
import { useSurfaces } from "./hooks/useSurfaces";
import { useTakeRecording } from "./hooks/useTakeRecording";
import { useTimelineDrop } from "./hooks/useTimelineDrop";
import { useTrackControls } from "./hooks/useTrackControls";
import { useTurntableDeck } from "./hooks/useTurntableDeck";
import { useVideoDoc } from "./hooks/useVideoDoc";
import { useVideoEdits } from "./hooks/useVideoEdits";
import { useVideoRecording } from "./hooks/useVideoRecording";
import { useLocale } from "./i18n";
import {
  blurOnClick,
  type ConditionCtx,
  effectiveKeys,
  keyForCommand,
} from "./keys";
import {
  refreshLcdSounds,
  setLcdSoundsProject,
  shellSounds,
  touchesSounds,
} from "./lcdSounds";
import { isLibraryPath, libraryModuleRef } from "./libraryTree";
import {
  BARE_TRANSPORT,
  isUiLine,
  namesLine,
  uiVerdict,
} from "./localCommands";
import { headTokens, resolveEntry, resolveModuleFile } from "./localTargets";
import { confirmMenuItem } from "./menuConfirm";
import { midiInDeviceFor, midiInLanes } from "./midiIn";
import { describeDownload, followDownload } from "./modelDownload";
import {
  chainRefFromCreate,
  createForGraphCommand,
  nodeNewRefArg,
  type PendingInsert,
  wireCommand,
} from "./nodeInsert";
import { noteSpans } from "./noteSpans";
import { resolveEditorFile } from "./openInEditor";
import { PairRequestsPrompt } from "./pairing/PairRequestsPrompt";
import { buildPaletteCommands, commandNameOf, makeListArg } from "./palette";
import { m } from "./paraglide/messages.js";
import { type PendingEdit, pendingOf } from "./pendingEdits";
import { type PendingNode, spawnBox } from "./pendingNode";
import { soundingNow } from "./sounding";
import { onOpenConflictsPanel } from "./syncConflicts";
import { eventIdOf, takesEventOf } from "./takes";
// The shell's BROWSER composition point: k7's builtin plugins register their pane drawers
// here, before the shell renders any surface — see packages/k7-sdk/docs/sdk.md.
import "./plugins";
import { PanelCloseFrame } from "./components/PanelClose";
import { type FloatState, loadFloat, saveFloat } from "./floatingRect";
import { latestAnswer } from "./latestAnswer";
import { guardSwipeBack } from "./noSwipeBack";
import { PaneBoundary } from "./PaneBoundary";
import { closeTopPopin, useAnyPopin, usePopin } from "./popins";
import { entityFile, fileStem } from "./projectPaths";
import { rememberCommand } from "./recentCommands";
import {
  movedTheAudio,
  movedTheChains,
  movedTheSurfaces,
  type Reload,
  UNKNOWN_RELOAD,
  useScopedKey,
} from "./reloadScope";
import {
  isRollMode,
  ROLL_MODES,
  ROLL_PRESS,
  type RollMode,
  rollCondition,
} from "./rollMode";
import { type Pane, type Panel, viewPanes } from "./routes";
import {
  pictureRowId,
  placementOf,
  type RowKey,
  type RowTarget,
  trackPlacing,
} from "./rows";
import { parseSeqEdit, resolveSequence, type SeqView } from "./sequenceEdit";
import {
  MiniTransport,
  PANE_META,
  PANEL_META,
  PANES,
  TransportClock,
  VIEWPORT_META,
} from "./shellMeta";
import { tabBridge } from "./tabs/bridge";
import { modeCondition, type TimelineMode } from "./timelineMode";
import { isTool, TOOLS, type Tool } from "./timelineTools";
import type {
  ChangedFile,
  CommandInfo,
  EngineSyncState,
  ProjectInfo,
  RankedEngine,
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

/** One frozen empty list, so a builder with no live plugin does not get a new array per render. */
const EMPTY_PRESETS: PresetInfo[] = [];

/** The same, for a song with no picture — which is most of them. Keeps the timeline's row memo cold. */
const EMPTY_VIDEO_TRACKS: WebVideoTrack[] = [];
// One key for every song: where the picture's window sits is a habit of this screen (floatingRect.ts).
const VIEWPORT_FLOAT_KEY = "k7.viewportWindow";

/** Why Play is refused in record mode with nothing armed — said on the button and on the status line. */
const NO_ARM_HINT =
  "record is on and no track is armed — arm a track, or turn record off";

// The two builders open on demand, and carry an editor and a language of their own: loaded then, not with the shell.
const ModuleBuilder = lazy(() =>
  import("@studio/ui-module-builder").then((mod) => ({
    default: mod.ModuleBuilder,
  })),
);
const AssemblyBuilder = lazy(() =>
  import("@studio/ui-module-builder/assembly").then((mod) => ({
    default: mod.AssemblyBuilder,
  })),
);

/** The timeline caret's fields, the selection's included — what decides whether a new caret is a move at all. */
interface CaretFields {
  row: string;
  beat: number;
  trackId: string | null;
  tc: string | null;
  eventTc: string | null;
  selection: { tracks: string; from: string; to: string } | null;
}

/** Two edit targets naming the same notes: the same sequence text, or the same clip, unchanged, on the same lane. */
function sameEditTarget(a: EditTarget, b: EditTarget): boolean {
  if (a.kind === "seq" && b.kind === "seq")
    return a.path === b.path && a.content === b.content;
  if (a.kind === "clip" && b.kind === "clip")
    return (
      a.track === b.track &&
      // The roll draws on the project's grid, so a tempo or metre change is a new target.
      a.project.tempo === b.project.tempo &&
      a.project.timeSigNumerator === b.project.timeSigNumerator &&
      a.project.timeSigDenominator === b.project.timeSigDenominator &&
      a.clip.id === b.clip.id &&
      JSON.stringify(a.clip) === JSON.stringify(b.clip)
    );
  return false;
}

/** Two carets that say the same thing, field by field. */
function sameCaret(a: CaretFields, b: CaretFields): boolean {
  const sa = a.selection;
  const sb = b.selection;
  return (
    a.row === b.row &&
    a.beat === b.beat &&
    a.trackId === b.trackId &&
    a.tc === b.tc &&
    a.eventTc === b.eventTc &&
    (sa === sb ||
      (!!sa &&
        !!sb &&
        sa.tracks === sb.tracks &&
        sa.from === sb.from &&
        sa.to === sb.to))
  );
}

/** The tap-chain popin's first node: where the signal its modules process comes in, named and nothing more. */
// In the desktop app's tab, whose strip already shows the way home and the song's name (apps/k7-standalone/docs/tabs.md).
const inDesktopTab = !!tabBridge();

const TAP_CHAIN_INPUT = {
  id: "tap-chain-input",
  get label() {
    return m["tapChain.input"]();
  },
  get sub() {
    return m["tapChain.inputSub"]();
  },
};

export default function App({
  engineUrl,
  engineLatency,
  userEmail,
  onQuitWorkspace,
  onChangeEngine,
  engine,
  onSwitchEngine,
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
  /** The engine playing this project, for the header's engine menu; absent on a share, which has none. */
  engine?: RankedEngine;
  /** Move this project to another engine from that menu. */
  onSwitchEngine?: (r: RankedEngine) => void;
  /** The FROZEN snapshot this shell draws when it was opened through a share link — see docs/shared.md. */
  snapshot?: OpenShare;
}) {
  // Read once as a boolean: nearly every call site asks 'is this editable', not 'which snapshot is it'.
  const frozen = !!snapshot;
  // The PAGE asked for; null is the project's home page, resolved into `full` once the layout is known (docs/shell.md).
  const [chosen, setFull] = useState<Pane | null>(null);
  // A phone draws the pages from its hamburger rather than from the header's row. See docs/shell.md.
  const isMobile = useIsMobile();
  const [mobileMenu, setMobileMenu] = useState(false);
  // The timeline, because it is what the default view opens on — see ringPanes.
  const [focusPane, setFocusPane] = useState<Pane>("timeline");
  const [panel, setPanel] = useState<Panel | null>(null);
  // The curve editor popin (`ui curve [name]`): the curve it is on, and whether it exists yet — docs/curveEditor.md.
  // The popin on one tap's own chain of effects — `ui tap chain <node> <tap>` (TapChainEditor.tsx).
  const [tapChain, setTapChain] = useState<{
    node: string;
    tap: string;
  } | null>(null);
  const [curveEdit, setCurveEdit] = useState<{
    name: string;
    isNew: boolean;
    spec?: CurveSpec;
    /** The events of the node it automates — the condition's dropdown; absent when no node is in view (`ui curve`). */
    events?: string[];
    /** The control a NEW curve is bound to once created (`ui automate`). */
    bind?: { node: string; param: string };
    /** What kind of param it drives — what shapes it may follow; absent from `ui curve`. */
    kind?: ParamKind;
  } | null>(null);
  // The CHAINS BUILDER: a library chain being edited by its ref, `""` for the list, null closed — docs/chainsBuilder.md.
  const [openBuilder, setOpenBuilder] = useState<string | null>(null);
  /** The NODE of that chain to land on — its file name, or null for the chain itself. Not in the URL. */
  const [builderNode, setBuilderNode] = useState<string | null>(null);
  // The module the shared builder is open on, or null — an overlay, not a pane, so nothing under it unmounts.
  const [builder, setBuilder] = useState<{
    path: string;
    pane: BuilderPane;
  } | null>(null);
  /** Whether this ACCOUNT has a Claude key (the settings panel), asked when the builder opens until it says yes: no key, no button. */
  const [aiEnabled, setAiEnabled] = useState(false);
  const builderOpen = !!builder;
  useEffect(() => {
    if (builderOpen && !aiEnabled) void aiOrganize.enabled().then(setAiEnabled);
  }, [builderOpen, aiEnabled]);
  // A sideways swipe nothing scrolls must not go Back out of the project (noSwipeBack.ts).
  useEffect(guardSwipeBack, []);
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
  // Null until the divider is dragged: the panel opens on half the main column.
  const [panelH, setPanelH] = useState<number | null>(null);
  const panelEl = useRef<HTMLDivElement>(null);
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
  // The timeline re-sends its caret as a new object on every move; an unchanged one must not re-render the shell.
  const setCaretIfMoved = useCallback((next: typeof caret) => {
    setCaret((cur) => (cur && next && sameCaret(cur, next) ? cur : next));
  }, []);
  // The editor re-sends its target on every keystroke; one that says the same thing keeps the shell still.
  const setEditTargetIfOther = useCallback((next: EditTarget | null) => {
    setEditTarget((cur) =>
      cur && next && sameEditTarget(cur, next) ? cur : next,
    );
  }, []);
  // …and the editor re-sends what it has open on every keystroke.
  const setOpenItemIfOther = useCallback((next: MinimapItem | null) => {
    setOpenItem((cur) =>
      cur && next && cur.kind === next.kind && cur.id === next.id ? cur : next,
    );
  }, []);
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
  // Every read of either is numbered as it starts; a slower, older answer is dropped (latestAnswer.ts).
  const askProject = useMemo(() => latestAnswer(setProject), []);
  const askWs = useMemo(() => latestAnswer(setWs), []);
  // A screen's `lcd.sound` resolves `@project/…` against the project the tab has open.
  setLcdSoundsProject(ws?.activeProject ?? null);
  const [engineSync, setEngineSync] = useState<EngineSyncState | null>(null);

  // The song's own name in the tab, over the folder `appMain` named it from (docs/tabs.md).
  const tabName = snapshot?.manifest.name || project?.name;
  useEffect(() => {
    if (tabName) document.title = tabName;
  }, [tabName]);
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
  // The project's change token, read here so the whole tree shares the ONE refcounted poll —
  // the desk's drawer takes it as a prop and refetches its graph when it moves (docs/plugins.md).
  const rev = useRevision();
  const { logs, pushLog, clearLogs } = useLogs(panel);
  // A pane that threw draws its own card (PaneBoundary); the log keeps what it said.
  const paneError = useCallback(
    (name: string, e: Error) => pushLog("error", `${name}: ${e.message}`),
    [pushLog],
  );
  // …and a promise nobody caught, which otherwise reaches only the console and leaves a view silently stale.
  useEffect(() => {
    const onRejection = (e: PromiseRejectionEvent) => {
      const r = e.reason as { message?: string } | undefined;
      pushLog("error", `unhandled: ${r?.message ?? String(e.reason)}`);
    };
    window.addEventListener("unhandledrejection", onRejection);
    return () => window.removeEventListener("unhandledrejection", onRejection);
  }, [pushLog]);
  const [statusLine, setStatusLine] = useState<{
    text: string;
    refused: boolean;
  }>({ text: "", refused: false });
  const status = statusLine.text;
  /** Say something on the status line — and, by saying it this way, say it is NOT a refusal; only `runCommand` refuses. */
  const setStatus = useCallback<SetStatus>(
    (text, level) => {
      // The same line again re-renders nothing: a drag re-states it on every pointermove.
      setStatusLine((cur) =>
        cur.text === text && !cur.refused ? cur : { text, refused: false },
      );
      // The status line is overwritten by the next message, so an error is kept in the log as well.
      if (level === "error") pushLog("error", text);
    },
    [pushLog],
  );
  // An error toast is dismissed and gone, so it is kept in the log as well.
  useEffect(
    () =>
      onToast((t) => {
        if (t.variant === "error") pushLog("error", t.message);
      }),
    [pushLog],
  );
  /** …and the other half: a command was understood and declined. `runCommand` is its one caller. */
  const setRefusal = useCallback(
    (text: string) =>
      setStatusLine((cur) =>
        cur.text === text && cur.refused ? cur : { text, refused: true },
      ),
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
  // The scoped bump: a command's reply says which files it wrote, and `undefined` still means everything.
  const reloadWith = useCallback(
    (changed: ChangedFile[] | undefined) =>
      setReload((r) => ({ key: r.key + 1, files: changed ?? null })),
    [],
  );
  // Counters that move only when a reload could concern them (reloadScope.ts); the raw key is for what reads everything.
  const chainsKey = useScopedKey(reload, movedTheChains);
  // The key a graph handed back by a command answers — ChainsTab's `seedGraph`.
  const reloadKeyRef = useRef(reloadKey);
  reloadKeyRef.current = reloadKey;
  const surfacesKey = useScopedKey(reload, movedTheSurfaces);
  const audioKey = useScopedKey(reload, movedTheAudio);
  // A sample rendered or replaced under a screen: drawn again from the new file, not the one decoded first.
  useEffect(() => {
    if (reload.key && touchesSounds(reload.files)) refreshLcdSounds();
  }, [reload]);
  // MIDI recording is browser-side (the engine records audio only), one track at a time, landing in its sequence.
  const [midiArmed, setMidiArmed] = useState<string | null>(null);
  // The lanes a midi-in node feeds, off the graph: they arm here even while they hold no sequence.
  const midiLanesRef = useRef<Set<string>>(new Set());
  // …and the MIDI record enable — the BROWSER's own record, beside the engine's audio record.
  const [midiRecord, setMidiRecord] = useState(false);
  // A roll that captured MIDI switches the MIDI record off when it stops, as the engine does its own (docs/shell.md).
  const midiRolled = useRef(false);
  useEffect(() => {
    if (playing && midiRecord && midiArmed) midiRolled.current = true;
    if (playing || !midiRolled.current) return;
    midiRolled.current = false;
    setMidiRecord(false);
  }, [playing, midiRecord, midiArmed]);
  /** …and the PICTURE lane armed, which records its camera in the browser (hooks/useVideoRecording.ts). */
  const [videoArmed, setVideoArmed] = useState<string | null>(null);
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
    expanded: true,
  });
  /** Which panel has the RIGHT COLUMN, or null — one state because there is one column (docs/shell.md). */
  const [rightPanel, setRightPanel] = useState<
    | "settings"
    | "playlists"
    | "references"
    | "tasks"
    | "history"
    | "share"
    | "comments"
    | "conflicts"
    | null
  >(null);
  /** What the History panel's hovered row touched — lit on the graph and the timeline (historyMarks.ts). */
  const [historyMark, setHistoryMark] = useState<HistoryMark | null>(null);
  /** The reference track the bar has loaded, or null for no bar — it outlives every tab, being nothing this project owns (docs/references.md). */
  const [reference, setReference] = useState<ReferenceTrack | null>(null);
  // Whether that track is sounding, and the bar's play/pause — for the panel row that stands for it.
  const [referenceSounding, setReferenceSounding] = useState(false);
  const referenceToggle = useRef<(() => void) | null>(null);
  /** Which tab the settings panel shows, kept while closed so the cog reopens where you left it. */
  const [settingsTab, setSettingsTab] = useState<SettingsTab>(SETTINGS_TABS[0]);
  /** The command catalogue, the one settings screen still drawn as a full PAGE. */
  const [commandsPage, setCommandsPage] = useState(false);
  /** Open `which`, or close it when it is already the one showing — every panel button toggles. */
  const toggleRight = useCallback(
    (
      which:
        | "settings"
        | "playlists"
        | "references"
        | "tasks"
        | "history"
        | "share"
        | "comments"
        | "conflicts",
    ) => setRightPanel((cur) => (cur === which ? null : which)),
    [],
  );
  // A conflict banner over the editor opens the conflicts panel (components/ConflictsPanel.tsx).
  useEffect(() => onOpenConflictsPanel(() => setRightPanel("conflicts")), []);
  // Vim mode is a global user preference (~/.k7/preferences.yaml). Starts ON to match the brain's default.
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
  // Whether the per-track view draws its curve cards — a view toggle, writing nothing (`ui curves`).
  const [trackCurves, setTrackCurves] = useState(false);
  const [graphSlot, setGraphSlot] = useState<
    | { kind: "grid"; path: string; view: SeqView }
    | { kind: "clip"; target: EditTarget }
    | { kind: "recording" }
    // A MIDI take rolling: its notes drawn as they are played (MidiTakeRoll.tsx).
    | { kind: "midiTake" }
    // One track's modules side by side, opened by a double-click on the lane's header — see docs/shell.md.
    | { kind: "trackModules"; trackId: string }
    | null
  >(null);
  // The STACK view: a column per lane, the MIX's last — exclusive with the mixer row.
  const [stackView, setStackView] = useState(false);

  /** Whether the graph draws the project's NOTES — off by default and not remembered; `docCount` is reported up by the pane holding the graph. */
  const [showDocs, setShowDocs] = useState(false);
  const [docCount, setDocCount] = useState(0);
  /** What the graph knows about each lane's node — its other attribute sets and its freeze, travelling up like `docCount`. */
  const [laneNodes, setLaneNodes] = useState<{
    alternatives: WebGraph["trackAlternatives"];
    frozen: WebGraph["frozen"];
    automation: Record<string, WebAutomationLane[]>;
  }>({ alternatives: undefined, frozen: undefined, automation: {} });

  // A take rolling (record enabled AND playing) shows it in the event panel, one-way: it STAYS when the take ends, only the × closes it.
  const rolling = recordEnabled && playing;
  // A MIDI take rolling, from either record: the browser captures the armed lane whether or not the engine records.
  const midiRolling = playing && (midiRecord || recordEnabled) && !!midiArmed;
  /** A take just stopped and the file service has not said so yet — the poll quickens until it does, or gives up after 15 s. */
  const [awaitingTake, setAwaitingTake] = useState(false);
  const wasRolling = useRef(false);
  useEffect(() => {
    const ended = wasRolling.current && !rolling;
    wasRolling.current = rolling;
    if (!ended) return;
    setAwaitingTake(true);
    const id = setTimeout(() => setAwaitingTake(false), 15000);
    return () => clearTimeout(id);
  }, [rolling]);
  /** Record is on and nothing is armed — no audio lane, no MIDI lane, no picture lane — so rolling would capture nothing. */
  const recordWithoutArm =
    (recordEnabled || midiRecord) && !armed.length && !midiArmed && !videoArmed;
  // …read by the command path through a ref, so the transport callbacks are not rebuilt on every arm.
  const recordWithoutArmRef = useRef(recordWithoutArm);
  recordWithoutArmRef.current = recordWithoutArm;
  // A take of the takes view is drawn THERE: the record panel would take the very slot it is in.
  // A ref, set where useTakeRecording is called below: the take is on before the engine rolls.
  const takeActiveRef = useRef(false);
  // An audio take shows its envelope; a take of a MIDI lane alone shows its notes instead.
  const takeSlot = armed.length || !midiRolling ? "recording" : "midiTake";
  useEffect(() => {
    if ((!rolling && !midiRolling) || takeActiveRef.current) return;
    setGraphSlot((s) => (s?.kind === takeSlot ? s : { kind: takeSlot }));
    setPanel("event");
  }, [rolling, midiRolling, takeSlot]);
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
  const lastActive = useRef<string | null>(null);
  const pendingPrewrite = useRef<string | null>(null);

  // The Logs panel's buffer + the process-log tail (polled only while it's open).

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

  // A share plays on the server's engine through its player, so the two verbs are the engine's there too.
  const transport = engineTransport;
  const seek = engineSeek;

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

  /** A session making SOUND is active — a playing song, and a live rig played with the transport stopped — @studio/project-shell/docs/idle.md. */
  useEffect(() => {
    let last = 0;
    return store.subscribe(() => {
      const now = Date.now();
      // Ten seconds between stamps: a 20 Hz frame has nothing to add to a twenty-minute clock.
      if (now - last < 10_000 || !soundingNow(store.getSnapshot())) return;
      last = now;
      markActive();
    });
  }, [store]);

  // The special views this PROJECT declares (`surfaces/`), and the engine as a desk sees it — both cheap and unconditional.
  const { surfaces } = useSurfaces(surfacesKey);
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
        (s) => s.surface.type === "viewport" && s.surface.layout === "floating",
      ) ?? null,
    [surfaces],
  );
  const hasViewport = !!viewportSurface;
  // The frame's WINDOW — where it sits and whether it is up, per browser rather than per song (floatingRect.ts).
  const [viewportFloat, setViewportFloat] = useState(() =>
    loadFloat(VIEWPORT_FLOAT_KEY),
  );
  const viewportOpen = hasViewport && viewportFloat.open;
  const setViewportWindow = useCallback(
    (next: (cur: FloatState) => Partial<FloatState>) =>
      setViewportFloat((cur) => {
        const merged = { ...cur, ...next(cur) };
        saveFloat(VIEWPORT_FLOAT_KEY, merged);
        return merged;
      }),
    [],
  );
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

  // Read by `onLaneToggle`, which must not re-bind every time the picture doc is refetched.
  const videoTracksRef = useRef(videoTracks);
  videoTracksRef.current = videoTracks;

  // Has the engine every plugin the open project uses? The header's warning when not — hooks/useEngineCompat.ts.
  const engineCompat = useEngineCompat(
    engineRef,
    connected,
    frozen ? null : (ws?.activeProject ?? null),
    rev,
    !!engine?.filesHosted,
  );

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

  /** The addresses this project answers on, for the share panel — the WHOLE project first, so a
   *  second device can edit it and not only drive a surface, then EVERY surface (docs/external.md). */
  const externals = useMemo(() => {
    const at = parseLaunch(
      window.location.pathname,
      "k7",
      import.meta.env.BASE_URL,
    );
    if (!at) return [];
    return [
      {
        id: projectLabel(at.project),
        type: m["shell.projectKind"](),
        url: launchUrl(window.location.origin, at.repo, at.project, "k7"),
      },
      ...surfaces.map((s) => ({
        id: s.id,
        type: s.surface.type,
        url: externalUrl(window.location.href, at, s.id, "k7"),
      })),
    ];
  }, [surfaces]);

  /** Where a SECOND DEVICE reaches this app: a QR code built on `location.origin` would carry
   *  loopback in the desktop window, which scans to the phone itself (remoteUrl.ts). */
  const [lanUrls, setLanUrls] = useState<string[]>([]);
  useEffect(() => {
    void desktop.state().then((d) => setLanUrls(d?.lanUrls ?? []));
  }, []);

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
      full: chosen,
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
  }, [chosen]);

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
      setStatus(`vim error: ${(e as Error).message}`, "error");
    }
  }, [vimMode]);

  // The second pane of the current view and the ring `tab` walks — the layout's own list, the editor excluded (`viewPanes` in routes.ts).
  const layout = useMemo(
    () =>
      viewPanes({
        timeline: hasTimeline,
        turntables: hasTurntables,
        mastering: hasMastering,
        frozen,
      }),
    [hasTimeline, hasTurntables, hasMastering, frozen],
  );
  const ringPanes = layout.ring;
  /** The page a project opens on: its arrangement when it declares one, else the first pane it does (docs/shell.md). */
  const homePane: Pane = ringPanes.includes("timeline")
    ? "timeline"
    : ringPanes[0];
  /** The ONE page on screen — never null: there is no split, a second view being the bottom panel's job. */
  const full: Pane =
    chosen && layout.fullscreen.includes(chosen) ? chosen : homePane;

  // Whether there is an arrangement on screen — the SURFACE's answer, and now the only one.
  const noArrangement = !hasTimeline;

  // The popin IS the active pane while it is up: the pane underneath must not also answer the keys.
  const activePane = editorPopin ? "editor" : full;
  const visible = useCallback((p: Pane) => full === p, [full]);

  /** Is the chains pane off screen? ONE answer, read by the class that hides it and by the `active` it is handed. */
  const chainsOffScreen = full !== "chains";
  /** Is ANY view of the graph on screen? Only then does a command bring a graph back (docs/shell.md, "A graph only when one is on screen"). */
  const graphOnScreen =
    !chainsOffScreen ||
    panel === "graph" ||
    panel === "mix" ||
    (panel === "event" && graphSlot?.kind === "trackModules");
  const graphOnScreenRef = useRef(graphOnScreen);
  graphOnScreenRef.current = graphOnScreen;

  const timelineVisible = visible("timeline");
  /** The DESK alone on screen: the transport then drives nothing visible — docs/shell.md. */
  const deskOnly = visible("turntables") && !timelineVisible && !viewportOpen;
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
      // Another page closes the bottom panel: it was open on what the PAGE showed, and is about something else now.
      if (p !== full) setPanel(null);
      setFull(p);
      focusOn(p);
    },
    [focusOn, layout, full],
  );

  // The layout before the module builder took the editor fullscreen — put back when it closes; undefined = nothing to restore.
  const beforeBuilder = useRef<Pane | null | undefined>(undefined);
  // Whether the open module has unsaved edits: the tree beside the builder can swap it for another.
  const builderDirty = useRef(false);
  const noteBuilderDirty = useCallback((d: boolean) => {
    builderDirty.current = d;
  }, []);
  /** Open the module builder BESIDE the file tree: the editor fullscreened, where the tree is drawn (docs/moduleBuilder.md). */
  const openModuleBuilder = useCallback(
    async (path: string, pane: BuilderPane) => {
      // Another module while this one holds unsaved edits: the same question the builder's own Back asks.
      if (builder && builder.path !== path && builderDirty.current) {
        const agreed = await askConfirm({
          title: "Leave without saving?",
          body: "This module's files are changed here, and Save writes them together.",
          confirmLabel: "Quitter",
          danger: true,
        });
        if (!agreed) return;
      }
      // A layout with no editor to fullscreen (a frozen share) would hide the builder inside a hidden pane: open nothing.
      if (full !== "editor" && !layout.fullscreen.includes("editor")) {
        setStatus("this view has no editor, so the module builder cannot open");
        return;
      }
      builderDirty.current = false;
      setBuilder({ path, pane });
      if (full === "editor") return;
      if (beforeBuilder.current === undefined) beforeBuilder.current = chosen;
      fullscreen("editor");
    },
    [builder, chosen, full, fullscreen, layout],
  );
  const closeModuleBuilder = useCallback(() => {
    builderDirty.current = false;
    setBuilder(null);
    const back = beforeBuilder.current;
    beforeBuilder.current = undefined;
    if (back !== undefined) setFull(back);
  }, []);

  const paneProps = (p: Pane) => ({
    onPointerDown: () => focusOn(p),
  });

  // The keys follow the page: one pane on screen is the one that owns them.
  useEffect(() => {
    if (focusPane !== full) setFocusPane(full);
  }, [full, focusPane]);

  const togglePanel = useCallback(
    (p: Panel) => setPanel((cur) => (cur === p ? null : p)),
    [],
  );
  /** Put something in the slot and show it: the `event` panel is the one place the slot is drawn. */
  const openEvent = useCallback((slot: NonNullable<typeof graphSlot>) => {
    setGraphSlot(slot);
    setPanel("event");
  }, []);
  /** The occupant's ✕ and Escape: the event is let go, and the panel that drew it goes with it. */
  const closeEvent = useCallback(() => {
    setGraphSlot(null);
    setPanel((cur) => (cur === "event" ? null : cur));
  }, []);
  /** The slot as it is on SCREEN — what the keys and the footer's badges may act on, a hidden panel's clip being nobody's target. */
  const shownSlot = panel === "event" ? graphSlot : null;

  // One pointer per drag, abandoned on a cancel or an unmount — @studio/ui-timeline/drag.
  const follow = usePointerFollow();
  const startResize = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault();
      const startY = e.clientY;
      const startH = panelH ?? panelEl.current?.offsetHeight ?? 280;
      let h = startH;
      // The drag moves the panel's own style; the shell learns the height once, on release, not per pointermove.
      const onMove = (ev: PointerEvent) => {
        h = Math.max(
          120,
          Math.min(window.innerHeight - 220, startH + (startY - ev.clientY)),
        );
        if (panelEl.current) panelEl.current.style.height = `${h}px`;
      };
      const onUp = () => setPanelH(h);
      // A cancel puts the panel back at the height it had, rather than leaving it following the mouse until the next click.
      const onCancel = () => {
        if (panelEl.current) panelEl.current.style.height = `${startH}px`;
      };
      follow(e, { move: onMove, end: onUp, cancel: onCancel });
    },
    [panelH, follow],
  );

  // The initial fetch: the project header, the workspace (opening its active project), and the command catalogue.
  useEffect(() => {
    void api
      .project()
      .then(askProject())
      .catch(() => {});
    const showWs = askWs();
    void api.workspace().then((w) => {
      showWs(w);
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
    midiSeqRef,
  } = useProjectDoc(reloadKey, {
    // If the currently-armed track lost its sequence, disarm it.
    onMidiSeqs: (seqs) =>
      setMidiArmed((cur) =>
        cur && !seqs[cur] && !midiLanesRef.current.has(cur) ? null : cur,
      ),
  });
  // A module whose sampled instrument is not on the engine's machine is drawn in error, like one the engine refused.
  const instrumentWarnings = useInstrumentStatus(
    engineRef,
    connected,
    projectDoc,
    pushLog,
    setStatus,
  );
  const nodeWarnings = useMemo(
    () => ({ ...engineWarnings, ...instrumentWarnings }),
    [engineWarnings, instrumentWarnings],
  );
  // What one-shot commands are doing to the lanes, shown at once until the document agrees (pendingEdits.ts).
  const docRef = useRef(projectDoc);
  docRef.current = projectDoc;
  // A MIDI take that made a new clip, and the lane's clips before it: the one not among them opens once the document shows it.
  const landedMidiRef = useRef<{ track: string; before: Set<string> } | null>(
    null,
  );
  useEffect(() => {
    const landed = landedMidiRef.current;
    if (!landed || !projectDoc) return;
    const clip = projectDoc.tracks
      .find((t) => t.id === landed.track)
      ?.clips.find((c) => c.type === "midi" && !landed.before.has(c.id));
    if (!clip) return;
    landedMidiRef.current = null;
    openEvent({
      kind: "clip",
      target: { kind: "clip", project: projectDoc, clip, track: landed.track },
    });
  }, [projectDoc, openEvent]);
  const [pendingGroups, setPendingGroups] = useState<
    { id: number; edits: PendingEdit[] }[]
  >([]);
  const pendingSeq = useRef(0);
  const pendingEdits = useMemo(
    () => pendingGroups.flatMap((g) => g.edits),
    [pendingGroups],
  );
  // …the groups whose command LANDED: the next document has them done, so it is what lets them go.
  const landedRef = useRef(new Set<number>());
  // biome-ignore lint/correctness/useExhaustiveDependencies: the document's IDENTITY is the signal — a fresh one is the truth.
  useEffect(() => {
    if (!landedRef.current.size) return;
    const landed = landedRef.current;
    landedRef.current = new Set();
    setPendingGroups((g) => g.filter((x) => !landed.has(x.id)));
  }, [projectDoc]);
  // Its tempo and time signature as one stable value: every curve card below reads it through context.
  const songClock = useMemo(
    () => ({
      tempo: recInfo.tempo,
      num: recInfo.beatsPerBar,
      den: recInfo.beatUnit,
    }),
    [recInfo.tempo, recInfo.beatsPerBar, recInfo.beatUnit],
  );
  /** The metronome, optimistically: the click flips the icon, the command follows, and the DOC decides — the mute/solo rule (hooks/useTrackControls.ts). */
  const [optMetronome, setOptMetronome] = useState<boolean | null>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: the doc's IDENTITY is the signal — a fresh one takes the override back, whatever it says.
  useEffect(() => setOptMetronome(null), [projectDoc]);

  // Mixer / graph edits run the same backend commands but must NOT bump reloadKey, and ask for no graph (`want: []`) — docs/shell.md.
  const quietCommandFiles = useCallback(
    async (line: string) => {
      pushLog("cmd", `› ${line}`);
      try {
        const { output, changed, rev, revBefore } = await api.command(line, {
          want: [],
        });
        // Adopted quietly when nothing else moved since — then the tick does not turn a knob into a wave of re-reads.
        if (rev) noteQuietRevision(rev, revBefore);
        if (output.length) setStatus(output.join("  ·  "));
        for (const o of output) pushLog("info", o);
        // What it wrote, for a caller that reloads after it; a quiet command itself reloads nothing.
        return changed;
      } catch (e) {
        setStatus(`command error: ${(e as Error).message}`, "error");
        return undefined;
      }
    },
    [pushLog],
  );
  // The same, for the many callers that only fire it.
  const quietCommand = useCallback(
    async (line: string) => void (await quietCommandFiles(line)),
    [quietCommandFiles],
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
          setStatus(`command error: ${(e as Error).message}`, "error");
        }
      })();
    },
    [store, pushLog, setRefusal],
  );

  /** A PROJECT setting off a card — today the RENDER node's frame shape. A verb, since what it
   *  writes is project.yaml and the node has no file (packages/song-video/docs/picture.md). */
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
        setStatus(m["master.alreadyFloor"]());
        return;
      }
      reloadWith(
        await quietCommandFiles(`node param "OUT" Volume ${db.toFixed(1)}`),
      );
      setStatus(
        m["master.fixed"]({
          db: `${db > 0 ? "+" : ""}${db.toFixed(1)}`,
          trim: trimFor(peakDb).toFixed(1),
          target: TARGET_DB,
        }),
      );
    },
    [projectDoc?.masterVolume, quietCommandFiles, reloadWith],
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
    midiLanesRef,
    quietCommand: quietCommandFiles,
    bumpReload,
    reloadWith,
    // On a share these two are the LISTENER's, not the document's: they reach only the visitor's own session.
    local: frozen,
  });

  /** …and on a share that is what the visitor's session plays: their mute and solo, as the player takes them (docs/shared.md). */
  const sentMixRef = useRef("");
  useEffect(() => {
    if (!frozen) return;
    // A new socket is a new session, which holds the document's own mix until told again.
    if (!connected) {
      sentMixRef.current = "";
      return;
    }
    const mix = docTracks.map((t) => ({
      id: t.id,
      mute: trackControls[t.id]?.mute === 1,
      solo: trackControls[t.id]?.solo === 1,
    }));
    // Sent on a CHANGE only: the controls are rebuilt on every armed-set frame, and the player keeps a rate.
    const key = JSON.stringify(mix);
    if (key === sentMixRef.current) return;
    sentMixRef.current = key;
    engineRef.current?.trackMix(mix);
  }, [frozen, connected, trackControls, docTracks, engineRef]);

  // Web MIDI capture, driven by the MIDI record + play + a MIDI-armed track; it also holds
  // the device picker's data, which the transport's dropdown beside the MIDI record reads.
  // The armed lane's MIDI device: the midi-in node wired to it, read off the graph — packages/song/docs/midiIn.md.
  const [midiIn, setMidiIn] = useState<{ any: boolean; device: string | null }>(
    {
      any: false,
      device: null,
    },
  );
  useEffect(() => {
    let live = true;
    void api
      .graph()
      .then((g) => {
        if (!live) return;
        const steps = Object.values(g.chains).flatMap((c) => c.use);
        midiLanesRef.current = midiInLanes(g);
        const device = midiArmed ? midiInDeviceFor(g, midiArmed) : null;
        setMidiIn({ any: steps.some((st) => st.device !== undefined), device });
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [chainsKey, midiArmed]);
  // `runCommand` is defined below and calls THIS, so a local command reaches it through a ref rather than a closure.
  const runCommandRef = useRef<(line: string) => Promise<void>>(async () => {});
  // The takes view's record button: a take INTO the open event rather than onto its lane (song docs/takes.md).
  const takes = useTakeRecording({
    store,
    engine: () => engineRef.current ?? null,
    runCommand: (line) => runCommandRef.current(line),
    playing,
    midiArmed,
    midiRecord,
    setMidiRecord,
    num: projectDoc?.timeSigNumerator ?? 4,
    den: projectDoc?.timeSigDenominator ?? 4,
    tempo: recInfo.tempo,
    projectPath: ws?.activeProject ?? ".",
    onLanded: () => bumpReload(),
  });
  takeActiveRef.current = takes.active;
  // The open project's tasks — the timeline flags those with a timecode in its ruler.
  const projectTasks = useProjectTasks(
    frozen ? null : (ws?.activeProject ?? null),
  );
  const { midiInputs, openMidiInputs, liveTake } = useMidiRecording({
    store,
    tempo: recInfo.tempo,
    // Either record captures the MIDI-armed lane: the main one is what a take is, the MIDI one a browser-only take.
    midiRecordEnabled: midiRecord || recordEnabled,
    playing,
    midiArmed,
    quietCommand,
    midiDevice: midiIn.device,
    onNoMidiIn: (track) =>
      showToast({ message: m["midi.noMidiIn"]({ track }), variant: "error" }),
    takeTarget: takes.midiTarget,
    onTakePass: (t, pass) =>
      void runCommandRef.current(
        `event take midi ${t.track} ${t.at} ${JSON.stringify(pass)}`,
      ),
    onLiveMidi: (track, data) => {
      // A keyboard played through the rig is a person at the instrument, whatever the mouse is doing.
      markActive();
      engineRef.current?.liveMidi(track, data);
    },
    // A take of no notes lands nothing: the live roll it was drawn on goes with it.
    onEmptyTake: () => setGraphSlot((s) => (s?.kind === "midiTake" ? null : s)),
    onLanded: (lane) => {
      // The take's clip opens in the event panel, as an audio take opens its review.
      landedMidiRef.current = {
        track: lane,
        before: new Set(
          docRef.current?.tracks
            .find((t) => t.id === lane)
            ?.clips.map((c) => c.id) ?? [],
        ),
      };
      bumpReload();
    },
  });
  // A project with a midi-in node asks for MIDI access at once, and again on each press of a dropdown — packages/song/docs/midiIn.md.
  useEffect(() => {
    if (!midiIn.any) return;
    void openMidiInputs();
    const onDown = (e: PointerEvent) => {
      if (e.target instanceof Element && e.target.closest("select"))
        void openMidiInputs();
    };
    document.addEventListener("pointerdown", onDown, true);
    return () => document.removeEventListener("pointerdown", onDown, true);
  }, [midiIn.any, openMidiInputs]);
  const midiDevices = useMemo(
    () => midiInputs.map((d) => d.name),
    [midiInputs],
  );

  // Background polls: the project errors, the waveform prewarm.
  const { projectErrors, diagnostics } = useProjectErrors(reloadKey);
  const warm = useWarmWaveforms(audioKey, playing);

  const openProject = useCallback(
    async (path: string) => {
      try {
        const showWs = askWs();
        const w = await api.open(path);
        showWs(w);
        lastActive.current = w.activeProject;
        pluginParamsStore.clear();
        void api
          .project()
          .then(askProject())
          .catch(() => {});
        bumpReload();
        setStatus(`opened ${path === "." ? w.root : path} — engine starting…`);
        setFull(null);
        // The layout the project that was open had — the doc effect above corrects it a moment later.
      } catch (e) {
        setStatus(`open error: ${(e as Error).message}`, "error");
      }
    },
    [bumpReload, pluginParamsStore, askWs, askProject],
  );

  // The import and delete dialogs register Escape here too, or the key that dismissed one would also close the graph slot behind it.
  const imp = useProjectImport({ openProject, onStatus: setStatus });
  usePopin(!!imp.importPath && !imp.importing, imp.cancelImport);

  // Follow what happened under us: a project switch (another tab, the CLI), and a TAKE.
  useActiveProjectFollow({
    lastActiveRef: lastActive,
    awaitingTake,
    /** A recording landed: `setWs` carries the clip's name and the reload puts it on its lane — neither happened on its own. */
    onTake: (w) => {
      setAwaitingTake(false);
      askWs()(w);
      bumpReload();
    },
    onSync: setEngineSync,
    onSwitch: (w) => {
      askWs()(w);
      // Another project's plugin values would show under a same-named module until a watch frame lands.
      pluginParamsStore.clear();
      void api
        .project()
        .then(askProject())
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

  // The palette's catalogue, for the one thing `runCommand` needs: which command a line runs, so it can be remembered.
  const paletteRef = useRef<PaletteCommand[]>([]);

  /** Which language the shell speaks — taken here because `ui language` is one of runLocalCommand's lines. */
  const { locale, locales, setLocale } = useLocale();
  // The two share entries that are not CLI verbs: the mixdown render and the k7 publish.
  const share = useShare(setStatus);

  /** The footer's two graph toggles, each as ONE callback the button and the command share. */
  const toggleMixer = useCallback(() => {
    if (panel !== "mix" && mixerStrips.length === 0)
      return setStatus(
        "no strip in this song — a strip is a Mixer module at the end of a track",
      );
    togglePanel("mix");
  }, [panel, mixerStrips.length, togglePanel]);

  /** …and the stack view, which takes the graph's whole pane. */
  const toggleStack = useCallback(() => {
    if (stackView) return setStackView(false);
    // Onto the graph's page, closing the bottom panel as any page change does.
    if (full !== "chains") setPanel(null);
    setFull("chains");
    setStackView(true);
    setStatus("stack view — a column per track, the mix last");
  }, [stackView, full]);

  const toggleDocs = useCallback(() => {
    if (docCount === 0)
      return setStatus(
        "no notes in this project — a note is a node of @meta/doc, wired from what it is about",
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
      // The server's catalogue decides a line that shares a word with a `ui` head: `curve set` is not `ui curve set`.
      const verdict = uiVerdict(line, prefixed, (l) => {
        const name = commandNameOf(l, paletteRef.current);
        return !!name && !name.startsWith("ui ");
      });
      if (verdict === "refuse") {
        // Handled (true) rather than passed down: the backend has no such command either, and would say less.
        setStatus(
          isUi
            ? `"${line}" is a ui command — type: ui ${line}`
            : `"${line}" is not a ui command — type it without the ui prefix`,
        );
        return true;
      }
      // …and goes to the server, past every `ui` handler below, which would otherwise take it by its first word.
      if (!prefixed && isUi) return false;
      // `ui tap chain <node> <tap>` — the popin on that tap's own chain; names with a space arrive quoted.
      if (line.startsWith("tap chain ")) {
        const [node, tap] = [
          ...line
            .slice("tap chain ".length)
            .matchAll(/"((?:[^"\\]|\\.)*)"|(\S+)/g),
        ].map((w) => (w[1] !== undefined ? JSON.parse(`"${w[1]}"`) : w[2]));
        if (!node || !tap) setStatus("usage: ui tap chain <node> <tap>");
        else setTapChain({ node, tap });
        return true;
      }
      // `ui curve` opens the editor on a NEW curve; `ui curve <name>` on that one, read off the graph's own curves.
      if (line === "curve") {
        setCurveEdit({ name: newCurveName(), isNew: true });
        return true;
      }
      if (line.startsWith("curve ")) {
        const name = s.slice("curve ".length).trim();
        void api
          .graph()
          .then((g) => {
            const spec = g.curves?.[name]?.spec;
            if (spec) setCurveEdit({ name, isNew: false, spec });
            else setStatus(`no curve "${name}" in this project`);
          })
          .catch((e) =>
            setStatus(`ui curve: ${(e as Error).message}`, "error"),
          );
        return true;
      }
      // `ui automate <node> <param>` — the editor on the curve that control is bound to, or on a new one to bind.
      if (line.startsWith("automate ")) {
        const m = /^(\S+)\s+(?:"([^"]*)"|(.+))$/.exec(
          s.slice("automate ".length).trim(),
        );
        if (!m) {
          setStatus(
            'usage: ui automate <node> <param>  (e.g. ui automate synth "Filter Freq")',
          );
          return true;
        }
        const node = m[1];
        const param = (m[2] ?? m[3] ?? "").trim();
        void api
          .graph()
          .then((g) => {
            const step = Object.values(g.chains)
              .flatMap((c) => c.use)
              .find((u) => u.module === node);
            const events = step?.events ?? [];
            const bound = step?.automations?.find((a) => a.param === param);
            const spec = bound ? g.curves?.[bound.curve]?.spec : undefined;
            // A toggle or a button drives a BOOLEAN, which follows an on/off curve; any other control a number.
            const widget = Object.values(step?.ui?.widgets ?? {}).find(
              (w) => w.bind === param,
            );
            const kind: ParamKind =
              widget?.type === "toggle" ||
              widget?.type === "button" ||
              spec?.type === "onoff"
                ? "boolean"
                : "number";
            setCurveEdit(
              bound && spec
                ? { name: bound.curve, isNew: false, spec, events, kind }
                : {
                    name: newCurveName(),
                    isNew: true,
                    events,
                    kind,
                    bind: { node, param },
                  },
            );
          })
          .catch((e) =>
            setStatus(`ui automate: ${(e as Error).message}`, "error"),
          );
        return true;
      }
      if (line === "global") {
        // Back to the project's home page — there is no split to return to — closing the panel as any page change does.
        if (full !== homePane) setPanel(null);
        setFull(null);
        return true;
      }
      // The frame is a WINDOW over the layout, so its command shows or hides it rather than fullscreening anything.
      if (line === "viewport") {
        if (!hasViewport)
          setStatus(
            "this project declares no viewport surface, so there is no picture to show.",
          );
        else setViewportWindow((cur) => ({ open: !cur.open }));
        return true;
      }
      if ((PANES as string[]).includes(line)) {
        // …and likewise for a pane this layout cannot fullscreen — `fullscreen` decides, as it does for the buttons and the number keys.
        fullscreen(line as Pane);
        return true;
      }
      // One page on screen, so walking the keys' owner IS walking the pages.
      if (line === "focus next") {
        const i = ringPanes.indexOf(full);
        fullscreen(ringPanes[(i + 1) % ringPanes.length]);
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
      // Let the event go and close its panel. Escape and the footer's panel button do exactly this.
      if (line === "slot close") {
        closeEvent();
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
      // A node's model, fetched from its module's `model_url` — the right-click's "Download model". Followed on the
      // status line, and the graph re-read at the end, which is what takes the entry off the node's menu.
      if (line.startsWith("model ")) {
        const node = s.slice("model ".length).trim();
        void api
          .downloadModel(node)
          .then(async ({ job }) => {
            if (!job) {
              setStatus(`${node}'s model is already on this machine`);
              return;
            }
            const end = await followDownload(job, api.modelDownload, (j) =>
              setStatus(describeDownload(j)),
            );
            if (!end.error) bumpReload();
          })
          .catch((e: Error) => setStatus(e.message, "error"));
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
      const clipGrid = shownSlot?.kind === "clip" ? clipGridRef.current : null;
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
        setStatus(`${want} — ${ROLL_PRESS[want]()}`);
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
        // The clip pane's only when IT holds the selection, as Shift+L's conditions say: a timeline range looped from
        // the ruler's menu must not land on the clip pane open below it.
        if (clipGrid && clipSel) clipGrid.toggleLoop();
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
      /** `selection delete` — whichever surface holds a RECTANGLE, the clip grid first; with none, the open grid's caret, else the timeline's. */
      if (line === "selection delete") {
        const grid = clipGrid?.deleteLine ? clipGrid : null;
        // The timeline stays mounted off screen: only the one in FRONT may lose an event to a key.
        const timeline = activePane === "timeline" ? timelineRef.current : null;
        const pane =
          grid && clipSel
            ? grid
            : timeline && tlView.selecting
              ? timeline
              : (grid ?? timeline);
        const out = pane?.deleteLine?.();
        if (!out) {
          setStatus("nothing to delete here");
          return true;
        }
        if (out.line) void runCommand(out.line);
        setStatus(out.note);
        return true;
      }
      // The blade at the PLAYHEAD, on the caret's lane — the same line the cut tool makes, audio or picture (docs/timeline.md).
      if (line === "selection split") {
        const out = timelineRef.current?.splitLine(
          store.getSnapshot().playhead,
        );
        if (out?.line) void runCommand(out.line);
        setStatus(out?.note ?? "nothing to split here");
        return true;
      }
      // Toggle record over the wire. Reading the live snapshot keeps this out of the deps and always flips current.
      if (line === "transport record") {
        engineRef.current?.setRecordEnabled(!store.getSnapshot().recordEnabled);
        return true;
      }
      // One snap position either way, the ticks the timeline draws: a FRAME once it is zoomed in on a picture (docs/timeline.md).
      if (line === "transport step next" || line === "transport step prev") {
        const to = timelineRef.current?.stepTarget(
          store.getSnapshot().playhead,
          line.endsWith("next") ? 1 : -1,
        );
        if (to !== null && to !== undefined) seek(to);
        return true;
      }
      // Replay: back to where playback last started (`replayAtRef`), then rolls again — `play` is not a toggle.
      if (line === "transport replay") {
        if (recordWithoutArmRef.current && !store.getSnapshot().playing) {
          setRefusal(NO_ARM_HINT);
          return true;
        }
        seek(replayAtRef.current);
        // Deliberately the BARE verb: the seek above has already chosen a position.
        transport("play");
        return true;
      }
      /** …and so do the four bare verbs, for LATENCY — falling through to the service only when the socket cannot answer (docs/shell.md). */
      if (BARE_TRANSPORT.includes(line)) {
        // Play in record mode with nothing armed records nothing: refused, with the two ways out.
        if (
          (line === "transport play" || line === "transport replay") &&
          recordWithoutArmRef.current &&
          !store.getSnapshot().playing
        ) {
          setRefusal(NO_ARM_HINT);
          return true;
        }
        // On a snapshot there IS no slow path: `transport` is already the browser player, so it always answers.
        if (!frozen && (!connected || engineBusyRef.current)) return false;
        transport(line.slice("transport ".length) as TransportAction);
        return true;
      }
      // `rec <track>`: an instrument track arms in the browser, an audio track in the engine. See docs/shell.md.
      if (line.startsWith("rec ")) {
        const id = s.slice(4).trim();
        if (midiSeqRef.current[id] || midiLanesRef.current.has(id)) {
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
          openEvent({ kind: "grid", path, view: seq.view });
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
        openEvent({ kind: "recording" });
        return true;
      }
      // `ui midi learn <module> <param>` — arm the browser's Web MIDI; the BINDING is written by `module cc`.
      if (line.startsWith("midi learn ")) {
        armMidiLearn(s.slice("midi learn ".length).trim());
        return true;
      }
      // `ui picture arm [lane]` — nothing is written: the camera is the browser's, so the arm is too.
      if (line === "picture arm" || line.startsWith("picture arm ")) {
        const lane = s.slice("picture arm".length).trim();
        setVideoArmed((cur) => (!lane || cur === lane ? null : lane));
        setStatus(
          lane && videoArmed !== lane
            ? `${lane} armed — record + play captures its camera onto it`
            : "picture disarmed",
        );
        return true;
      }

      // --- what the footer and the timeline header draw ------------------------
      if (line === "mixer") {
        toggleMixer();
        return true;
      }
      if (line === "stack") {
        toggleStack();
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
      if (line === "automation") {
        timelineRef.current?.toggleAutomation();
        return true;
      }
      if (line === "curves") {
        setTrackCurves((v) => !v);
        return true;
      }
      // `ui panel <event|graph|mix|logs>`: the footer buttons' own toggle — naming the panel already up closes it.
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
          "k7",
          import.meta.env.BASE_URL,
        );
        if (!at) return false; // no project in the address; nothing to hang a surface off
        const url = externalUrl(window.location.href, at, hit.id, "k7");
        void navigator.clipboard?.writeText(url).catch(() => {});
        setStatus(url);
        return true;
      }
      // `ui builder <module>`: the shared builder over the shell, on the MODULE file of the trio.
      if (line.startsWith("builder ")) {
        const arg = s.slice("builder ".length).trim();
        const path = resolveModuleFile(arg, editorRef.current?.files() ?? []);
        if (!path) setStatus(`no module "${arg}" in this project`);
        else void openModuleBuilder(path, "module");
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
          .catch((e: Error) => setStatus(e.message, "error"));
        return true;
      }

      // --- the right-hand panels, and the one page left --------------------

      // The bare lines TOGGLE, as their buttons do; naming a settings TAB always opens, never closes.
      if (line === "settings") {
        toggleRight("settings");
        return true;
      }
      if (line === "playlists") {
        toggleRight("playlists");
        return true;
      }
      if (line === "references") {
        toggleRight("references");
        return true;
      }
      if (line === "tasks") {
        toggleRight("tasks");
        return true;
      }
      if (line === "history") {
        toggleRight("history");
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
          setStatus(m["master.notADb"]({ arg }));
          return true;
        }
        const pass = masterMeterRef.current?.pass();
        if (given === null && !pass?.offered) {
          setStatus(pass ? m["master.nothingToFix"]() : m["master.noMeter"]());
          return true;
        }
        masterMeterRef.current?.take();
        void fixClipping(given ?? (pass?.peak as number));
        return true;
      }
      if (line.startsWith("project export")) {
        // Which HALF of the project leaves is the first word now — see exportArgs.ts.
        const ask = parseExportAsk(s.slice("project export".length));
        if (!ask) setStatus(EXPORT_USAGE);
        else if (ask.kind === "audio") void share.exportMix(ask.format);
        else if (ask.kind === "timeline")
          void share.exportTimeline(
            ws?.activeProject ?? ".",
            ask.format,
            ask.lane,
            projectDoc?.name ?? "cut",
            runCommand,
          );
        else
          void share.exportVideo(
            videoDoc ? videoSceneOf(videoDoc, null, "export") : null,
            ask.format,
            ask.audio,
            projectDoc?.name ?? "video",
            ask.settings,
          );
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
            "usage: project import <a .dawproject, .als or Ableton .zip of this workspace>",
          );
        else imp.askImport(path);
        return true;
      }
      return false;
    },
    [
      fullscreen,
      full,
      openEvent,
      closeEvent,
      shownSlot,
      // `selection delete` goes to whichever surface holds a rectangle, and to the timeline only when it is in front.
      clipSel,
      tlView.selecting,
      activePane,
      // `ui global` closes the bottom panel only when it really changes the page.
      homePane,
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
      toggleStack,
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
      openModuleBuilder,
      setRefusal,
      hasViewport,
      setViewportWindow,
    ],
  );

  // The arrow a module is being created on while the command RUNS — the narrower window the canvas draws a placeholder for.
  const [insertingAt, setInsertingAt] = useState<PendingNode | null>(null);
  // The graph a writing command handed back, drawn instead of fetched; it carries an id the consumer takes ONCE (ChainsTab's `seedGraph`).
  const seedId = useRef(0);
  const [seedGraph, setSeedGraph] = useState<{
    id: number;
    graph: WebGraph;
    at: number;
  } | null>(null);
  // Every command — typed or bound to a key — comes through here.
  // `outcome`, when given, is told whether the line WENT THROUGH — for a caller with a second step to gate on it.
  const runCommand = useCallback(
    async (line: string, outcome?: { ok: boolean }): Promise<void> => {
      if (!line.trim()) return;
      const typed = line.trim();
      const s = line.trim();
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
      // A one-shot line shows what it does NOW; a refusal takes it back, the next document makes it true.
      const doc = docRef.current;
      const edits = doc
        ? pendingOf(s, doc.timeSigNumerator, doc.timeSigDenominator)
        : [];
      const groupId = ++pendingSeq.current;
      if (edits.length) setPendingGroups((g) => [...g, { id: groupId, edits }]);
      const settle = (ok: boolean) => {
        if (!edits.length) return;
        if (ok) landedRef.current.add(groupId);
        else setPendingGroups((g) => g.filter((x) => x.id !== groupId));
      };
      try {
        // The graph only when a view of it is on screen: a hidden ChainsTab asks for it when it is shown again.
        const send = () =>
          api.command(s, { want: graphOnScreenRef.current ? ["graph"] : [] });
        const { output, refused, graph, rev, changed } = await send();
        // A refusal is neither a success nor a failure, so it gets its own channel rather than being recorded as the first.
        const said = output.length ? output.join("  ·  ") : `ran: ${s}`;
        if (refused) setRefusal(said);
        else setStatus(said);
        settle(!refused);
        for (const o of output) pushLog(refused ? "refused" : "info", o);
        // The graph the service built while we waited — the answer for the reload below, so for the NEXT key.
        if (graph) {
          seedId.current += 1;
          setSeedGraph({
            id: seedId.current,
            graph,
            at: reloadKeyRef.current + 1,
          });
        }
        // The token this command produced, adopted BEFORE the reload it pairs with, so the `/revision` tick does not redo it — see `RevisionPoller.note`.
        if (rev) noteRevision(rev);
        /** …and the reload, carrying the files this command wrote — `undefined`, from a service that could not diff, still means everything. */
        reloadWith(changed);
        // The picker's second half, as its own journalled command — and null when there is nothing left to do.
        // Not after a refusal: there is no node to wire, and its own refusal would bury the real one.
        const after =
          !refused && madeRef && wire
            ? wireCommand(madeRef, wire.at, wire.spawn)
            : null;
        if (after) await runCommandRef.current(after);
        // The one reorganizing verb: the graph hosts drop their held positions with the same reload that drops the pins.
        if (s === "graph organize") setOrganizeKey((k) => k + 1);
        if (outcome) outcome.ok = !refused;
      } catch (e) {
        settle(false);
        setStatus(`command error: ${(e as Error).message}`, "error");
      } finally {
        // The placeholder comes down in the same update that carries the new graph, so the two swap in one frame.
        if (willInsert) setInsertingAt(null);
      }
    },
    [pushLog, runLocalCommand],
  );
  runCommandRef.current = runCommand;
  // The bottom panel's ✕ runs the command the footer and Escape do, as every button here does (docs/shell.md).
  const closePanel = useCallback(
    () => void runCommand("ui close"),
    [runCommand],
  );
  // A node's preset dropdown: the list, the save and the update, each a `node preset` verb — packages/song/docs/userPresets.md.
  const {
    presetNames,
    openPresets,
    stepPreset,
    picker: presetPicker,
  } = useNodePresets(runCommand);

  // One note through a lane, off the engine link: an SFZ kit's pad on the graph, as the piano roll's click.
  const previewNote = useCallback(
    (track: string, key: number, vel: number) =>
      engineRef.current?.previewNote(track, key, vel),
    [engineRef],
  );

  /** A module's bypass: the GRAPH redrawn from the command's answer, nothing else re-read — a lane's card is its mute, which the mixer draws, so that one reloads (docs/shell.md). */
  const bypassModule = useCallback(
    async (module: string) => {
      const line = `node bypass ${module}`;
      if (projectDoc?.tracks.some((t) => t.id === module))
        return runCommand(line);
      pushLog("cmd", `› ${line}`);
      try {
        const { output, refused, graph, rev } = await api.command(line, {
          want: ["graph"],
        });
        const said = output.length ? output.join("  ·  ") : `ran: ${line}`;
        if (refused) setRefusal(said);
        else setStatus(said);
        for (const o of output) pushLog(refused ? "refused" : "info", o);
        // No reload follows, so it answers the key in force now.
        if (graph) {
          seedId.current += 1;
          setSeedGraph({ id: seedId.current, graph, at: reloadKeyRef.current });
        }
        // Adopted, so the `/revision` tick this write causes does not turn into the full reload skipped here.
        if (rev) noteRevision(rev);
      } catch (e) {
        setStatus(`command error: ${(e as Error).message}`, "error");
      }
    },
    [projectDoc, runCommand, pushLog],
  );

  /** The graph's lane buttons: a PICTURE lane's two words are the `picture` verbs, not the `track` ones. */
  const onLaneToggle = useCallback(
    (id: string, control: "mute" | "solo" | "arm" | "highlight") => {
      if (!videoTracksRef.current.some((t) => t.id === id))
        return onTrackToggle(id, control);
      // A picture lane has mute and solo, and no level to raise.
      if (control === "mute" || control === "solo")
        void runCommandRef.current(`picture ${control} ${id}`);
    },
    [onTrackToggle],
  );

  // Files dropped on a lane — here rather than beside the picture drag, since it PLACES with commands (hooks/useTimelineDrop.ts).
  const { onDrop: onDropOnTimeline, upload: timelineUpload } = useTimelineDrop(
    ws?.activeProject ?? ".",
    runCommand,
    setStatus,
    bumpReload,
  );
  // …and the armed PICTURE lane's own recording, which places its take the same way.
  const { recording: videoRecording } = useVideoRecording({
    store,
    project: ws?.activeProject ?? ".",
    armed: videoArmed,
    camera: videoTracks.find((t) => t.id === videoArmed)?.camera,
    recordEnabled,
    playing,
    runCommand,
    setStatus,
    bumpReload,
  });

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
      // Named, not fuzzy-matched: a lane lives in `nodes/`, or in a chain project's `tracks/` (packages/song/docs/chainFiles.md).
      const files = editorRef.current?.files() ?? [];
      const file =
        entityFile(files, "nodes", target.id) ??
        entityFile(files, "tracks", target.id);
      const path = file && openInEditor(file, false);
      focusLine.current = `${target.id} — ${path ?? "no nodes/ or tracks/ file"}`;
      setStatus(focusLine.current);
      focusNonce.current += 1;
      setGraphFocus({ id: target.id, nonce: focusNonce.current });
      // …and the lane's modules, side by side, in the event panel; the framing above still happens.
      if (target.kind === "track")
        openEvent({ kind: "trackModules", trackId: target.id });
    },
    [openInEditor, openEvent],
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
    async (item: MenuItem) => {
      if (!item.complete) return prewriteCommand(item.command);
      // The catalogue's few `confirm:` entries ask first (menuConfirm.ts).
      if (await confirmMenuItem(item)) void runCommandRef.current(item.command);
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
  /** A lane's gutter badge on the timeline — the same ContextMenu the right-click uses, over `nodeMenu`'s rows (contextMenu.ts). */
  const openNodeMenu = useCallback(
    (n: NodeMenuTarget, at: { x: number; y: number }) => {
      const items = nodeMenu(n);
      if (items.length) setMenu({ items, x: at.x, y: at.y });
    },
    [],
  );
  /** A node's alternative badge on the graph: switch to that set, or copy the one on — packages/song/docs/alternatives.md. */
  const runAlternative = useCallback(
    (module: string, name: string | null) =>
      void runCommand(
        name === null
          ? `node alternative copy ${module}`
          : `node alternative select ${module} ${name}`,
      ),
    [runCommand],
  );
  /** A node's engine dropdown on the graph: run the module as that engine — packages/song/docs/engines.md. */
  const runEngine = useCallback(
    (module: string, name: string) =>
      void runCommand(`node engine ${module} ${name}`),
    [runCommand],
  );
  // A `+` click asks WHICH module before writing anything; picking pre-writes a command. See docs/shell.md.
  const pendingInsert = useRef<PendingNode | null>(null);
  // Where the node a CREATING line is about to make should be wired: an arrow or nowhere, plus the world point clicked (see onModulePick).
  const pendingWire = useRef<{
    at: PendingInsert | null;
    spawn: { x: number; y: number } | null;
  } | null>(null);
  // 'Which file?' — a filepicker widget's asset browser, rendered by the shell because the popup is viewport-positioned.
  const [assetPicker, setAssetPicker] = useState<{
    module: string;
    param: string;
    x: number;
    y: number;
    files: string[];
    /** The library family the widget names, which decides the extensions when the param's name cannot. */
    family?: string;
    /** The command a pick runs, when it is not `node param` — a rack tap's sample is `node tap sample`. */
    commit?: (file: string | null) => string;
  } | null>(null);
  /** Find the open project's node of the builder's module and watch its plugin — `watchPluginParams` is what makes the values LIVE. */
  useEffect(() => {
    if (!builder) return void setBuilderPlugin(null);
    // The key a chain would write — `amps/neural-amp-modeler`, or `@k7-core/audio/amps/nam` for a library module (@studio/song/moduleTypes).
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
    (module: string, param: string, x: number, y: number, family?: string) => {
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
            family,
          });
        })
        .catch(() => {});
    },
    [],
  );
  /** A rack tap's edit, as the `node tap` command it is — a sample opens the same picker a file param does. */
  const editTap = useCallback(
    (module: string, a: TapAction) => {
      const q = (v: string) => JSON.stringify(v);
      if (a.kind === "note")
        void runCommand(`node tap note ${q(module)} ${q(a.symbol)} ${a.note}`);
      else if (a.kind === "add")
        void runCommand(
          a.note === undefined
            ? `node tap add ${q(module)}`
            : `node tap at ${q(module)} ${a.note}`,
        );
      else if (a.kind === "remove")
        void runCommand(`node tap remove ${q(module)} ${q(a.symbol)}`);
      // A kit's pad is muted on the SFZ player, a rack's on its tap — packages/song/docs/racks.md.
      else if (a.kind === "mute")
        void runCommand(
          a.kit
            ? `node param ${q(module)} ${q(`Mute ${a.note}`)} ${a.on ? 1 : 0}`
            : `node tap mute ${q(module)} ${q(a.symbol)} ${a.on ? "on" : "off"}`,
        );
      else
        void api
          .graph()
          .then((g) => {
            const step = Object.values(g.chains ?? {})
              .flatMap((c) => c.use ?? [])
              .find((s) => s.module === module);
            setAssetPicker({
              module,
              param: TAP_SAMPLE,
              x: a.x,
              y: a.y,
              files: step?.assetChoices ?? [],
              commit: (file) =>
                `node tap sample ${q(module)} ${q(a.symbol)} ${file ? q(file) : "none"}`,
            });
          })
          .catch(() => {});
    },
    [runCommand],
  );
  // `info` is the arrow the pick will splice into — NULL when the picker was opened on empty canvas.
  const [modulePicker, setModulePicker] = useState<{
    info: PendingInsert | null;
    x: number;
    y: number;
    // The click's WORLD point — where the picked module will be BORN, so a new node never asks the layout where to appear.
    at?: { x: number; y: number };
    /** What a node of the picked module lands CALLED — `<lane>_<module>_<n>`, from the pane that holds the graph (ChainsTab's `nameFor`). */
    nameFor: (module: string) => string;
    /** Set when the pick is not a node to place but a ref to hand on — a tap's chain asks for one (TapChainEditor.tsx). */
    onRef?: (ref: string) => void;
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
          ...cat.map((m) => ({
            ref: m.ref,
            category: m.category,
            panel: m.panel,
          })),
          ...refs.filter((r) => !known.has(r.ref)),
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
      info: PendingInsert,
      x: number,
      y: number,
      at: { x: number; y: number } | undefined,
      nameFor: (module: string) => string,
    ) => {
      if (!baseModules.length) {
        prewriteCommand(
          info.stack
            ? `node stack ${info.before} `
            : `node insert ${info.before} ${info.after} `,
        );
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
      // A ref wanted, not a node: this project's own module is reached through `@workspace`, like any other ref.
      if (modulePicker.onRef) {
        if (!pick.newCurve)
          modulePicker.onRef(
            pick.namespace === null ? `@workspace/${pick.ref}` : pick.ref,
          );
        return;
      }
      const { info, at, nameFor } = modulePicker;
      // The picker's one non-module offer: a curve has nothing to pick and nothing to splice into, so the bar is prewritten.
      if (pick.newCurve) {
        prewriteCommand("curve new ");
        offerSpawnAt(at);
        return;
      }
      /** ONE creating line, then the WIRED half when the pick was on an arrow — see `chainRefFromCreate`. */
      // An io SOURCE has no input port to receive the arrow's signal, so it is PLACED, never
      // spliced: born wired to nothing, and the person draws its cable from there.
      const placed = pick.type === "io";
      const node = nameFor(pick.name);
      // A splice is CENTRED on the `+`, and a pin is a top-left, so the verb is sent the card's corner (docs/chainsGraph.md).
      const box = !placed && info && at ? spawnBox(at, pick.panel) : null;
      const born = box ?? at ?? null;
      // A bare-canvas pick is fully placed by `node new`'s own spawn pin, so there is no second
      // command to queue: the wire half exists only for an arrow, and never for an io SOURCE.
      pendingWire.current = placed || !info ? null : { at: info, spawn: born };
      // The placeholder on the arrow, while the command runs — the node itself, at the box it will be pinned to.
      pendingInsert.current = box && info ? { ...info, node, ...box } : null;
      const ref = pick.namespace === null ? undefined : pick.ref;
      const spawn = born ? ` ${Math.round(born.x)},${Math.round(born.y)}` : "";
      void runCommandRef.current(
        createForGraphCommand(pick.type, pick.name) +
          node +
          nodeNewRefArg(ref) +
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
    if (shownSlot) cond.graph_slot = "1";
    // Away from the home page, Escape goes back to it; on it, the key falls through to the bottom panel.
    if (full !== homePane) cond.fullscreen = "1";
    if (caret?.trackId) cond.caret_track = caret.trackId;
    // …and the PICTURE lane under it, which reports no track id and arms through its own verb.
    const pic = pictureRowId(caret?.row);
    if (pic) cond.caret_picture = pic;
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
    if (waveView && shownSlot?.kind === "clip") {
      cond.wave_open = "1";
      cond[waveCondition(waveView)] = "1";
      cond.wave_mode = waveView;
      // `wave_marks` is Esc's rung: standard touches no mark, so there is nothing to back out OF there.
      if (waveView !== "standard") cond.wave_marks = "1";
    }
    // …and the ROLL's, on the same terms — one clip pane draws one leaf or the other, never both.
    if (rollMode && shownSlot?.kind === "clip") {
      cond.roll_open = "1";
      cond[rollCondition(rollMode)] = "1";
      cond.roll_mode = rollMode;
      // Esc's rung, for the same reason as the wave's: `select` writes nothing, so there is nothing to back out of.
      if (rollMode !== "select") cond.roll_armed = "1";
    }
    if (clipSel && shownSlot?.kind === "clip") cond.clip_selection = "1";
    // …and the grid itself, whether or not it holds a rectangle: `x` acts on the caret's own cell when there is none.
    if (shownSlot?.kind === "clip") cond.clip_grid = "1";
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
    shownSlot,
    tlView,
    focusPane,
    full,
    homePane,
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

  // …and never on a snapshot: there is no engine coming, and what plays here is the browser, ready at once.
  const waitingForEngine = !frozen && !!ws?.activeProject && !engineReady;
  // The project is sent only once its files are on the engine's machine, so Play waits for the copy too.
  const copyingToEngine = !frozen && syncRunning(engineSync);

  // The take's start, taken on the edge `rolling` goes true; the snapshot is READ, never subscribed to.
  useEffect(() => {
    if (!rolling && !midiRolling) return;
    setTakeStart((store.getSnapshot().playhead * recInfo.tempo) / 60);
  }, [rolling, midiRolling, store, recInfo.tempo]);

  /** The take to review: the one ASKED for, else the newest the file service has written — the named one wins (docs/shell.md). */
  const reviewTake =
    reviewOn ??
    (ws?.lastTake &&
    ws.lastTake.clip !== reviewedTake &&
    !(recordEnabled && playing)
      ? ws.lastTake
      : null);
  /** Where that take sits on its lane — found by its MATERIAL, which is what the file service names it by. */
  const reviewPlaced = reviewTake
    ? placementOf(projectDoc, reviewTake.track, reviewTake.clip)
    : null;
  const reviewBeat = reviewPlaced?.start ?? null;
  // …and its takes, so the panel a recording ends on offers the takes mode as the clip panel does.
  const reviewTakes = useMemo((): PanelTakes | undefined => {
    if (!reviewTake || !reviewPlaced || !projectDoc || frozen) return undefined;
    const ev = takesEventOf(
      projectDoc,
      reviewTake.track,
      eventIdOf(reviewPlaced),
    );
    return ev
      ? {
          host: takes.host,
          ev,
          num: projectDoc.timeSigNumerator,
          den: projectDoc.timeSigDenominator,
        }
      : undefined;
  }, [reviewTake, reviewPlaced, projectDoc, frozen, takes.host]);
  const reviewEventAt =
    reviewBeat === null
      ? null
      : beatsToPosition(
          reviewBeat,
          projectDoc?.timeSigNumerator ?? 4,
          projectDoc?.timeSigDenominator ?? 4,
        );

  // Everything that makes the transport unable to answer, as one flag: to whoever is reaching for Play the two causes are one fact.
  const transportWaiting = engineBusy || waitingForEngine || copyingToEngine;

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
  const referencesKey = keyForCommand("ui references", commandPrefs);
  const tasksKey = keyForCommand("ui tasks", commandPrefs);
  const historyKey = keyForCommand("ui history", commandPrefs);
  const shareKey = keyForCommand("ui share", commandPrefs);
  const settingsKey = keyForCommand("ui settings", commandPrefs);

  /** The bar's height IS its tallest control (docs/shell.md), so the desktop one is 24 px; a phone keeps a thumb-sized button. */
  const toolSize = isMobile ? "icon" : "icon-xs";

  const headerTools = snapshot ? (
    <>
      {/* The one thing a visitor may WRITE, and it is a panel rather than a pane: it is not part of the song. */}
      <FooterTab
        plain={isMobile}
        active={rightPanel === "comments"}
        title={m["share.comments"]()}
        aria-label={m["share.comments"]()}
        onClick={() => toggleRight("comments")}
      >
        <MessageSquare className="h-4 w-4" />
      </FooterTab>
    </>
  ) : (
    <>
      {/* The PLAYLIST, for a SET only — every project's are reachable from the palette instead (docs/playlists.md). */}
      {hasTurntables && (
        <FooterTab
          plain={isMobile}
          active={rightPanel === "playlists"}
          title={`Playlists${playlistKey ? ` (${playlistKey})` : ""}`}
          aria-label="Playlists"
          aria-keyshortcuts={playlistKey}
          onClick={() => void runCommand("ui playlists")}
        >
          <ListMusic className="h-4 w-4" />
        </FooterTab>
      )}
      {/* What you listen AGAINST — always offered, a reference belonging to the workspace and not to a surface (docs/references.md). */}
      <FooterTab
        plain={isMobile}
        active={rightPanel === "references"}
        title={`${m["refs.title"]()}${referencesKey ? ` (${referencesKey})` : ""}`}
        aria-label={m["refs.title"]()}
        aria-keyshortcuts={referencesKey}
        onClick={() => void runCommand("ui references")}
      >
        <Headphones className="h-4 w-4" />
      </FooterTab>
      {/* What is left to do, for the whole WORKSPACE — TODOS.md at its root (docs/tasks.md). */}
      <FooterTab
        plain={isMobile}
        active={rightPanel === "tasks"}
        title={`${m["tasks.title"]()}${tasksKey ? ` (${tasksKey})` : ""}`}
        aria-label={m["tasks.title"]()}
        aria-keyshortcuts={tasksKey}
        onClick={() => void runCommand("ui tasks")}
      >
        <ListChecks className="h-4 w-4" />
      </FooterTab>
      {/* HISTORY. The journal; a hovered row lights what it touched (docs/history.md). */}
      <FooterTab
        plain={isMobile}
        active={rightPanel === "history"}
        title={`${m["history.title"]()}${historyKey ? ` (${historyKey})` : ""}`}
        aria-label={m["history.title"]()}
        aria-keyshortcuts={historyKey}
        onClick={() => void runCommand("ui history")}
      >
        <History className="h-4 w-4" />
      </FooterTab>
      {/* Open sync conflicts, drawn only while there are some (docs/conflicts.md). */}
      <ConflictsTab
        plain={isMobile}
        active={rightPanel === "conflicts"}
        onClick={() => toggleRight("conflicts")}
      />
      {/* SHARE. */}
      <FooterTab
        plain={isMobile}
        active={rightPanel === "share"}
        disabled={share.busy}
        title={`${m["share.button"]()}${shareKey ? ` (${shareKey})` : ""}`}
        aria-label={m["share.button"]()}
        aria-keyshortcuts={shareKey}
        onClick={() => void runCommand("ui share")}
      >
        <Share2 className="h-4 w-4" />
      </FooterTab>
      {/* The COG opens the settings panel — one surface with a tab per entry, where a dropdown used to be. */}
      <FooterTab
        plain={isMobile}
        active={rightPanel === "settings"}
        title={`${m["settings.menu"]()}${settingsKey ? ` (${settingsKey})` : ""}`}
        aria-label={m["settings.menu"]()}
        aria-keyshortcuts={settingsKey}
        onClick={() => void runCommand("ui settings")}
      >
        <Settings className="h-4 w-4" />
      </FooterTab>
    </>
  );

  const headerActions = (
    <div className="flex min-w-0 items-center gap-1">
      {/* The mix leaving for the interface, at the right end of the bar; no phone fits it and a snapshot has no engine. */}
      {!isMobile && !snapshot && (
        <>
          <MasterMeter
            className="shrink-0"
            ref={masterMeterRef}
            // The button dispatches the command rather than calling the handler, like every other button in this shell.
            onFix={() => void runCommand("project master fix")}
            // The song's own level, off the compiled doc — what the FILE says, so the fader reads right before a note has played.
            master={projectDoc?.masterVolume}
            onMaster={setMaster}
          />
          <div className="mx-1 h-5 w-px bg-border" />
        </>
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
            {/* The frame is not a destination but a window over one: the item shows or hides it. */}
            {hasViewport && (
              <MobileMenuItem
                icon={VIEWPORT_META.icon}
                label={VIEWPORT_META.label}
                current={viewportOpen}
                onSelect={() => {
                  setMobileMenu(false);
                  void runCommand("ui viewport");
                }}
              />
            )}
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
          {/* The PAGES, one lit: the row is the LAYOUT's fullscreenable set, not PANES, and picking one never splits (docs/shell.md). */}
          <nav className="flex items-center gap-1">
            {layout.fullscreen.map((p) => {
              const Icon = PANE_META[p].icon;
              const key = keyForCommand(`ui ${p}`, commandPrefs);
              return (
                <Button
                  key={p}
                  size={toolSize}
                  variant={full === p ? "default" : "ghost"}
                  aria-current={full === p ? "page" : undefined}
                  onClick={() => void runCommand(`ui ${p}`)}
                  title={`${PANE_META[p].label}${key ? ` (${key})` : ""}`}
                  aria-keyshortcuts={key}
                  aria-label={PANE_META[p].label}
                >
                  <Icon className="h-4 w-4" />
                </Button>
              );
            })}
            {/* …and the frame's window, lit while it is up — a toggle over the pages rather than one of them. */}
            {hasViewport && (
              <Button
                size={toolSize}
                variant={viewportOpen ? "secondary" : "ghost"}
                aria-pressed={viewportOpen}
                onClick={() => void runCommand("ui viewport")}
                title={VIEWPORT_META.label}
                aria-label={VIEWPORT_META.label}
              >
                <VIEWPORT_META.icon className="h-4 w-4" />
              </Button>
            )}
          </nav>
        </>
      )}
    </div>
  );

  return (
    <EngineStoreProvider value={store}>
      {/* The song's clock for every graph below: a curve card's playhead and its bar lines read it (ui-chains-react docs/nodeCard.md). */}
      <SongClockProvider value={songClock}>
        {/* …and the ONE decoder their screens draw a module's sound files with — every graph, the per-track one included. */}
        <LcdSoundsContext.Provider value={shellSounds}>
          <div className="relative flex h-full flex-col bg-background text-foreground">
            {/* The shared bar (@frediverse/ui/app-header) with k7's contents; `items` is empty on purpose — docs/shell.md. */}
            <AppHeader
              // No `variant`: the house look, the accent tinted over the page (@frediverse/ui's docs/app-header.md).
              className={cn(
                // `relative` on the INNER box is what the transport centres against — the bar's own middle, not the gap between its neighbours.
                "z-20 [&>div]:relative",
                isMobile
                  ? "[&>div]:gap-2 [&>div]:px-3 [&>div]:py-1"
                  : "[&>div]:px-3 [&>div]:py-[3px]",
              )}
              // No name and no build stamp inside a project — the project's own name is the only one left (docs/shell.md).
              title={null}
              items={[]}
              actions={headerActions}
            >
              {/* Between the two: what you are looking AT, and the transport ABSOLUTELY centred over the bar (docs/shell.md). */}
              <div className="flex min-w-0 flex-1 items-center gap-3">
                {/* The way back, whole-page since the project is the router's BASENAME; a share has none (docs/shared.md). */}
                {snapshot ? (
                  <span className="max-w-[10rem] truncate text-muted-foreground text-sm">
                    {snapshot.manifest.name || "…"}
                  </span>
                ) : inDesktopTab ? null : (
                  <span className="flex min-w-0 items-center gap-1">
                    {/* The back arrow, first in the bar: the home page is where every project is opened from. */}
                    <a
                      href={projectsUrl(window.location.href)}
                      title={m["project.backToProjects"]()}
                      aria-label={m["project.backToProjects"]()}
                      className="shrink-0 rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
                    >
                      <ArrowLeft className="h-4 w-4" />
                    </a>
                    <a
                      href={projectsUrl(window.location.href)}
                      title={m["project.backToProjects"]()}
                      className="max-w-[10rem] truncate text-muted-foreground text-sm hover:text-foreground hover:underline"
                    >
                      {project?.name || "…"}
                    </a>
                  </span>
                )}
                {/* Which engine plays this project, and the way to another (components/EngineSwitch.tsx). */}
                {!frozen && engine && onSwitchEngine && (
                  <EngineSwitch
                    current={engine}
                    onSwitch={onSwitchEngine}
                    compat={engineCompat}
                  />
                )}
                {/* …and how that engine is doing, right of it: the light, the latency, the memory (components/EngineLink.tsx). */}
                {!frozen && (
                  <EngineLink
                    connected={connected}
                    latency={engineLatency}
                    compact={isMobile}
                  />
                )}
                {/* Dressed as a state, not a warning: a visitor has no other way to learn it (docs/shared.md). */}
                {snapshot && (
                  <span className="flex shrink-0 items-center gap-1 truncate rounded bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                    <Lock className="h-3 w-3" /> {m["share.readOnly"]()}
                  </span>
                )}
                {ws && !ws.activeProject && (
                  <span className="truncate rounded bg-amber-500/15 px-2 py-0.5 text-xs text-amber-500">
                    workspace — pick a project ▶ in Editor
                  </span>
                )}

                {/* centre: transport — play/pause, stop, the clock, then record, each dropping focus on click (docs/shell.md). */}
                {(!noArrangement || hasTurntables) && !deskOnly && (
                  <div className="-translate-x-1/2 -translate-y-1/2 absolute top-1/2 left-1/2 flex items-center gap-1">
                    <Button
                      size={toolSize}
                      variant={playing ? "default" : "secondary"}
                      // While the engine is loading a project it reads nothing: the spinner replaces the icon and the button goes dead.
                      // …and in record mode with nothing armed it waits for an arm, though a rolling transport can always be stopped.
                      disabled={
                        transportWaiting || (!playing && recordWithoutArm)
                      }
                      onClick={(e) => {
                        transport(playing ? "stop" : "play");
                        blurOnClick(e);
                      }}
                      title={
                        transportWaiting
                          ? "Loading this project — the engine can't answer the transport yet"
                          : !playing && recordWithoutArm
                            ? NO_ARM_HINT
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
                      size={toolSize}
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
                          size={toolSize}
                          variant={recordEnabled ? "default" : "secondary"}
                          aria-pressed={recordEnabled}
                          onClick={(e) => {
                            // A MIDI-armed lane is recorded by THIS record too: the press is the gesture Web MIDI's request rides.
                            if (!recordEnabled && midiArmed)
                              void openMidiInputs().then((ok) => {
                                if (!ok) setStatus(m["midi.unavailable"]());
                              });
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
                      setStatus(m["rack.created"]({ ref }));
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
                  )}
                  // Stop above the floating minimap rather than over it — inline, because it is a measurement (see `stripH`).
                  style={
                    editorPopin && stripH ? { bottom: stripH + 8 } : undefined
                  }
                >
                  {editorPopin && (
                    <button
                      type="button"
                      className="absolute right-2 top-2 z-10 rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
                      title={m["common.close"]()}
                      onClick={() => setEditorPopin(false)}
                    >
                      <X className="h-4 w-4" />
                    </button>
                  )}
                  <PaneBoundary
                    name="editor"
                    resetKey={reloadKey}
                    onError={paneError}
                  >
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
                      // A supervisor older than the field reports none: it runs level 1.
                      engineLevel={
                        engine ? (engine.engine.libraryLevel ?? 1) : undefined
                      }
                      vimMode={vimMode}
                      onOpenProject={openProject}
                      onImportProject={imp.askImport}
                      onChanged={bumpReload}
                      // The clip file's Process menu runs `clip process` through here — journalled, one Ctrl+Z, and its reload brings the file back.
                      command={runCommand}
                      setStatus={setStatus}
                      onEditTarget={setEditTargetIfOther}
                      onOpenItem={setOpenItemIfOther}
                      onOpenBuilder={openModuleBuilder}
                      // The same builder for a library module — on the PANEL like a project module.
                      onOpenLibraryModule={(path) =>
                        void openModuleBuilder(path, "panel")
                      }
                      // The module builder takes the editor's place BESIDE the file tree, as the chains builder does (docs/moduleBuilder.md).
                      moduleBuilder={
                        builder ? (
                          <Suspense fallback={null}>
                            <PaneBoundary
                              name="module builder"
                              resetKey={reloadKey}
                              onError={paneError}
                            >
                              <ModuleBuilder
                                // One mount per module: a module opened from the tree beside it starts clean, not on the last one's state.
                                key={builder.path}
                                // ONE store: the account's libraries answer at `_libraries/<name>/…` in every workspace, so a shared module is an ordinary workspace path.
                                store={moduleStore}
                                path={builder.path}
                                kind="module"
                                moduleName={
                                  builder.path.split("/").slice(-2)[0] ??
                                  builder.path
                                }
                                paramRef={null}
                                vimMode={vimMode}
                                initialPane={builder.pane}
                                // A library module opens EDITABLE, like the project's own: its Save is the publish — docs/sharedModules.md.
                                onBack={closeModuleBuilder}
                                onDirtyChange={noteBuilderDirty}
                                onSaved={() => {
                                  bumpReload();
                                  // A library module saved here is live at once, so the Libraries tab is re-read.
                                  editorRef.current?.refreshLibraries();
                                }}
                                setStatus={setStatus}
                                // What the plugin calls its parameters and what each spans, off `pluginParamMeta` — never the 20 Hz store, which render would read empty.
                                pluginParamNames={
                                  builderPlugin
                                    ? Object.keys(
                                        pluginParamMeta[
                                          builderPlugin.pluginId
                                        ] ?? {},
                                      )
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
                                onRegroupInputs={
                                  connected ? regroupInputs : undefined
                                }
                                presets={
                                  (builderPlugin &&
                                    presets[builderPlugin.module]) ||
                                  EMPTY_PRESETS
                                }
                                onListPresets={() =>
                                  builderPlugin &&
                                  listPresets(builderPlugin.module)
                                }
                                // The engine resolves both ends to the same live plugin, so which name is sent does not matter — take the builder's.
                                onSetPreset={(module, sel) =>
                                  setPreset(module, sel)
                                }
                                // A save into `_modules` forked: follow the copy, or the next save would fork again.
                                onRelocated={(next) => {
                                  setBuilder({ path: next, pane: "module" });
                                  editorRef.current?.open(next);
                                }}
                                // The module drawn as the card it will be in a chain — a slot, since the graph needs OUR glyphs and OUR command line.
                                // Claude draws the panel on THIS app's backend, which holds the key — absent when it holds none.
                                onAiOrganize={
                                  aiEnabled ? aiOrganize.run : undefined
                                }
                                renderPreview={({
                                  ui,
                                  params,
                                  bases,
                                  script,
                                  stage,
                                }) => (
                                  <ModulePreview
                                    icons={STUDIO_ICONS}
                                    command={runCommand}
                                    name={
                                      builder.path.split("/").slice(-2)[0] ??
                                      builder.path
                                    }
                                    path={builder.path}
                                    ui={script ? { ...ui, script } : ui}
                                    params={params}
                                    bases={bases}
                                    stage={stage}
                                    paramsStore={
                                      builderPlugin
                                        ? pluginParamsStore
                                        : undefined
                                    }
                                    onSetParam={
                                      builderPlugin ? setPluginParam : undefined
                                    }
                                  />
                                )}
                              />
                            </PaneBoundary>
                          </Suspense>
                        ) : null
                      }
                      // A chain row opens the builder ON that chain, both coming out of the one library repository.
                      chainsBuilder={
                        openBuilder !== null ? (
                          <PaneBoundary
                            name="chains builder"
                            resetKey={reloadKey}
                            onError={paneError}
                          >
                            <ChainsBuilder
                              open={openBuilder}
                              focusNode={builderNode}
                              vimMode={vimMode}
                              onLog={pushLog}
                              onClose={() => setOpenBuilder(null)}
                            />
                          </PaneBoundary>
                        ) : null
                      }
                      onOpenAssembly={(file, folder) =>
                        setAssemblyBuilder({ file, folder })
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
                  </PaneBoundary>
                </div>

                <div
                  className={cn(
                    "flex min-h-0 min-w-0 flex-1",
                    full === "editor" && "hidden",
                  )}
                >
                  {/* The pages, one of them on screen at a time; the frame floats over them (FloatingWindow below). */}
                  <div className="flex min-h-0 min-w-0 flex-1 flex-col">
                    {/* The ARRANGEMENT, only when the project declares a `timeline` surface — absent means not mounted (docs/shell.md). */}
                    {hasTimeline && (
                      <div
                        {...paneProps("timeline")}
                        className={cn(
                          "flex min-h-0 min-w-0",
                          full === "timeline" ? "flex-1" : "hidden",
                        )}
                      >
                        <PaneBoundary
                          name="timeline"
                          resetKey={reloadKey}
                          onError={paneError}
                        >
                          <TimelineTab
                            mark={historyMark}
                            ref={timelineRef}
                            // What one-shot commands are doing, on the lanes before the round trip (pendingEdits.ts).
                            pendingEdits={pendingEdits}
                            active={activePane === "timeline"}
                            lanesLocked={panel !== null}
                            reloadKey={reloadKey}
                            // …so an armed lane draws the take as it is played, instead of showing nothing while you record.
                            rolling={rolling}
                            takeStartBeat={takeStart}
                            // The pre-roll, in beats: the growing clip skips it — none for a take the engine's record did not start.
                            takeCountInBeats={
                              recordEnabled
                                ? recInfo.countIn * recInfo.beatsPerBar
                                : 0
                            }
                            // …and the MIDI take, drawn on its lane the same way, whichever record started it.
                            // The open project's tasks, flagged in the ruler where they carry a timecode (docs/tasks.md).
                            tasks={projectTasks}
                            midiTake={
                              liveTake
                                ? { lane: liveTake.lane, from: liveTake.from }
                                : null
                            }
                            videoTracks={videoTracks}
                            // A song with no picture lane has no frame to land on, whatever its document defaults.
                            fps={videoTracks.length ? videoDoc?.fps : undefined}
                            // The picture drag guards on this handler's own presence, so a snapshot simply has none.
                            onVideoEdit={frozen ? undefined : applyVideoEdit}
                            // …and so does the file drop, for the same reason: a frozen song has nowhere to put the bytes.
                            onDropFiles={frozen ? undefined : onDropOnTimeline}
                            dropUpload={timelineUpload}
                            readOnly={frozen}
                            setStatus={setStatus}
                            onEditTarget={setEditTargetIfOther}
                            // A double-clicked clip shows its content in the event panel, under the timeline still on screen.
                            onOpenClip={(t) =>
                              openEvent({ kind: "clip", target: t })
                            }
                            // …and the bare lane lets it go: a click on nothing clears what was open, the panel staying up.
                            onEmptyClick={() => setGraphSlot(null)}
                            onCaret={setCaretIfMoved}
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
                                    cmdRef.current?.offerValue(
                                      "timecode",
                                      tc,
                                      live,
                                    )
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
                                        ...(toTrackId
                                          ? { toTrack: toTrackId }
                                          : {}),
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
                              frozen
                                ? undefined
                                : () => void runCommand("track new")
                            }
                            // …and its PICTURE half, which makes that button a menu — only a song with a frame has two kinds of lane.
                            onNewVideoTrack={
                              frozen || !hasViewport
                                ? undefined
                                : () => void runCommand("picture lane new")
                            }
                            // The picture lane armed for its camera, and whether one is rolling (hooks/useVideoRecording.ts).
                            videoArmed={videoArmed}
                            videoRecording={videoRecording}
                            onVideoArm={
                              frozen
                                ? undefined
                                : (id) =>
                                    void runCommand(`ui picture arm ${id}`)
                            }
                            onVideoToggle={
                              frozen
                                ? undefined
                                : (id, control) =>
                                    void runCommand(`picture ${control} ${id}`)
                            }
                            // A header dragged to another slot: two lists, one gesture (packages/song/docs/trackKind.md).
                            onReorder={
                              frozen
                                ? undefined
                                : (family, lane, target) =>
                                    void runCommand(
                                      family === "video"
                                        ? `picture lane order ${lane} ${target}`
                                        : `track order ${lane} ${target}`,
                                    )
                            }
                            trackControls={trackControls}
                            onTrackToggle={onTrackToggle}
                            laneNodes={laneNodes}
                            // The lane's ⋮ menu, from the gutter badge — the SAME one the chains pane opens on a lane's node.
                            onNodeMenu={openNodeMenu}
                          />
                        </PaneBoundary>
                      </div>
                    )}
                    {/* The DESK: a page mounted for as long as the project declares it, its document outliving its screen (docs/shell.md). */}
                    {turntablesSurface && (
                      <div
                        {...paneProps("turntables")}
                        className={cn(
                          "flex min-h-0 min-w-0",
                          full === "turntables" ? "flex-1" : "hidden",
                        )}
                      >
                        <PaneBoundary
                          name="surface"
                          resetKey={reloadKey}
                          onError={paneError}
                        >
                          <SurfaceTab
                            surface={turntablesSurface}
                            deck={turntableDeck}
                            project={ws?.activeProject ?? "."}
                            libraryBase={PL8_API}
                            rev={rev}
                            videoDoc={videoDoc}
                            videoError={videoError}
                            trackIds={trackOrder}
                            readOnly={frozen}
                            videoArmed={videoArmed}
                          />
                        </PaneBoundary>
                      </div>
                    )}
                    {/* The MASTER STRIP, when declared: a page of its own over one quick-master node (docs/mastering.md). */}
                    {masteringSurface && (
                      <div
                        {...paneProps("mastering")}
                        className={cn(
                          "flex min-h-0 min-w-0",
                          full === "mastering" ? "flex-1" : "hidden",
                        )}
                      >
                        <PaneBoundary
                          name="mastering"
                          resetKey={reloadKey}
                          onError={paneError}
                        >
                          <MasteringTab
                            surface={masteringSurface}
                            paramsStore={pluginParamsStore}
                            setPluginParam={setPluginParam}
                            watchPluginParams={watchPluginParams}
                          />
                        </PaneBoundary>
                      </div>
                    )}
                    <div
                      {...paneProps("chains")}
                      className={cn(
                        "flex min-h-0 min-w-0",
                        chainsOffScreen ? "hidden" : "flex-1",
                      )}
                    >
                      {/* The graph alone: what used to take its place is the bottom panel's `event` now (docs/shell.md). */}
                      <div className="flex min-h-0 min-w-0 flex-1">
                        <PaneBoundary
                          name="chains"
                          resetKey={reloadKey}
                          onError={paneError}
                        >
                          <ChainsTab
                            mark={historyMark}
                            onPreviewNote={previewNote}
                            cameras={cameras}
                            midiDevices={midiDevices}
                            reloadKey={reloadKey}
                            organizeKey={organizeKey}
                            active={!chainsOffScreen}
                            // A SET's lanes are DECKS and wear the record the header wears; the choice is the project's — see chainsIcons.tsx.
                            icons={hasTurntables ? DECK_ICONS : STUDIO_ICONS}
                            // The sidebar is fullscreen chrome, and the graph is only ever on screen as a whole page.
                            showList
                            trackOrder={trackOrder}
                            videoSpans={videoLaneSpans}
                            noteLanes={noteLanes}
                            viewport={videoDoc?.viewport}
                            project={projectDoc}
                            command={quietCommand}
                            onBypassModule={(mod) => void bypassModule(mod)}
                            onModuleField={runCommand}
                            onOrganize={() => void runCommand("graph organize")}
                            onRecorder={onRecorder}
                            onProjectField={onProjectField}
                            onAlternative={runAlternative}
                            onEngine={runEngine}
                            onPresets={openPresets}
                            onPresetStep={stepPreset}
                            presetNames={presetNames}
                            engineWarnings={nodeWarnings}
                            onAssetBrowse={browseAssets}
                            onTapEdit={editTap}
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
                                    void runCommand(
                                      `graph move ${mod} ${x} ${y}`,
                                    )
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
                            onTrackToggle={onLaneToggle}
                            onTrackSet={onTrackSet}
                            focus={graphFocus}
                            onFocused={reportFramed}
                            stack={stackView}
                            onStack={() => void runCommand("ui stack")}
                            // The sockets a live input can be on — the same list the editor's strip uses.
                            inputDevices={inputDevices}
                            // …and the song's output level, for the fader on the OUT card — the same param the header's fader writes.
                            masterVolume={projectDoc?.masterVolume}
                            midiRef={chainsMidiRef}
                            onMidiStatus={setStatus}
                          />
                        </PaneBoundary>
                      </div>
                    </div>
                  </div>
                </div>

                {/* THE RIGHT COLUMN — one panel at a time, docked beside the panes; none is a pane and `rightPanel` makes them exclusive (docs/shell.md). */}
                <RightPanel
                  open={rightPanel !== null}
                  width={rightPanel === "comments" ? "w-[22rem]" : "w-[24rem]"}
                >
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
                  {rightPanel === "references" && (
                    <PaneBoundary
                      name="references"
                      resetKey={reloadKey}
                      onError={paneError}
                    >
                      <ReferencesPanel
                        playing={reference?.path ?? null}
                        sounding={referenceSounding}
                        onPlay={setReference}
                        onToggle={() => referenceToggle.current?.()}
                        onClose={() => setRightPanel(null)}
                      />
                    </PaneBoundary>
                  )}
                  {rightPanel === "tasks" && (
                    <PaneBoundary
                      name="tasks"
                      resetKey={reloadKey}
                      onError={paneError}
                    >
                      <TasksPanel
                        project={frozen ? null : (ws?.activeProject ?? null)}
                        timecode={() =>
                          beatsToPosition(
                            (store.getSnapshot().playhead * recInfo.tempo) / 60,
                            projectDoc?.timeSigNumerator ?? 4,
                            projectDoc?.timeSigDenominator ?? 4,
                          )
                        }
                        onSeek={(tc) =>
                          seek(
                            (parsePosition(
                              tc,
                              projectDoc?.timeSigNumerator ?? 4,
                              projectDoc?.timeSigDenominator ?? 4,
                            ) *
                              60) /
                              recInfo.tempo,
                          )
                        }
                        onRun={runCommand}
                        onClose={() => setRightPanel(null)}
                      />
                    </PaneBoundary>
                  )}
                  {rightPanel === "history" && (
                    <PaneBoundary
                      name="history"
                      resetKey={reloadKey}
                      onError={paneError}
                    >
                      <HistoryPanel
                        onMark={setHistoryMark}
                        onClose={() => setRightPanel(null)}
                      />
                    </PaneBoundary>
                  )}
                  {rightPanel === "conflicts" && (
                    <ConflictsPanel onClose={() => setRightPanel(null)} />
                  )}
                  {rightPanel === "comments" && snapshot && (
                    <CommentsPanel
                      base={snapshot.base}
                      store={store}
                      onSeek={seek}
                      onClose={() => setRightPanel(null)}
                    />
                  )}
                  {rightPanel === "share" && (
                    <SharePanel
                      busy={share.busy}
                      progress={share.progress}
                      externals={externals}
                      lanUrls={lanUrls}
                      hasPicture={!!videoDoc}
                      onRun={(c) => void runCommand(c)}
                      onClose={() => setRightPanel(null)}
                    />
                  )}
                </RightPanel>
              </div>

              {/* bottom split panel — available on every tab, resizable divider */}
              <BottomPanel
                open={panel !== null}
                height={panelH ?? "50%"}
                panelRef={panelEl}
                onResizeStart={startResize}
              >
                {/* The panel's ✕ at its top left: a view's own toolbar takes it, else it floats (PanelClose.tsx). */}
                <PanelCloseFrame onClose={closePanel}>
                  {panel === "graph" && (
                    <PaneBoundary
                      name="graph panel"
                      resetKey={reloadKey}
                      onError={paneError}
                    >
                      <GraphPanel
                        mark={historyMark}
                        onPreviewNote={previewNote}
                        cameras={cameras}
                        inputDevices={inputDevices}
                        midiDevices={midiDevices}
                        reloadKey={reloadKey}
                        organizeKey={organizeKey}
                        trackId={caret?.trackId ?? null}
                        trackOrder={trackOrder}
                        videoSpans={videoLaneSpans}
                        noteLanes={noteLanes}
                        viewport={videoDoc?.viewport}
                        project={projectDoc}
                        command={quietCommand}
                        onBypassModule={(mod) => void bypassModule(mod)}
                        onModuleField={runCommand}
                        onRecorder={onRecorder}
                        onProjectField={onProjectField}
                        onAlternative={runAlternative}
                        onAssetBrowse={browseAssets}
                        onTapEdit={editTap}
                        onWatchWaveform={watchWaveform}
                        engineWarnings={nodeWarnings}
                        onContextMenu={openContextMenu}
                        pluginParamsStore={pluginParamsStore}
                        setPluginParam={setPluginParam}
                        moduleParams={offlineParams}
                        trackControls={trackControls}
                        onTrackToggle={onLaneToggle}
                        onTrackSet={onTrackSet}
                      />
                    </PaneBoundary>
                  )}
                  {/* The EVENT: what a clip's or a lane header's double-click opened, drawn under whichever page is on (docs/shell.md). */}
                  {panel === "event" && (
                    <div className="flex h-full min-h-0 min-w-0">
                      {!graphSlot && (
                        <p className="m-auto px-4 text-center text-xs text-muted-foreground">
                          {m["panel.eventEmpty"]()}
                        </p>
                      )}
                      {graphSlot?.kind === "grid" && (
                        <PaneBoundary
                          name="sequence grid"
                          resetKey={reloadKey}
                          onError={paneError}
                        >
                          <SeqGridPane
                            path={graphSlot.path}
                            view={graphSlot.view}
                            onChanged={bumpReload}
                            setStatus={setStatus}
                            reloadKey={reloadKey}
                          />
                        </PaneBoundary>
                      )}
                      {/* A clicked clip's content: `ClipView` draws its own header and ✕, and tells audio from MIDI in one place. */}
                      {graphSlot?.kind === "clip" && (
                        <PaneBoundary
                          name="clip view"
                          resetKey={reloadKey}
                          onError={paneError}
                        >
                          <ClipView
                            target={graphSlot.target}
                            onClose={closeEvent}
                            // The takes mode's record button and files; a snapshot records nothing, so it offers no takes.
                            takesHost={frozen ? undefined : takes.host}
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
                            // …and a dragged SELECTION, every note in one write and one Ctrl+Z.
                            onMoveNotes={(seqId, moves) =>
                              runCommand(
                                `sequence notes move ${seqId} ${JSON.stringify(moves)}`,
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
                        </PaneBoundary>
                      )}
                      {/* One lane's whole signal path, read left to right; `moduleRow` lays out the graph's own cards (docs/shell.md). */}
                      {graphSlot?.kind === "trackModules" && (
                        <PaneBoundary
                          name="lane modules"
                          resetKey={reloadKey}
                          onError={paneError}
                        >
                          <TrackModulesPane
                            mark={historyMark}
                            project={projectDoc}
                            onPreviewNote={previewNote}
                            cameras={cameras}
                            inputDevices={inputDevices}
                            midiDevices={midiDevices}
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
                            onBypassModule={(mod) => void bypassModule(mod)}
                            onAlternative={runAlternative}
                            onEngine={runEngine}
                            onPresets={openPresets}
                            onPresetStep={stepPreset}
                            presetNames={presetNames}
                            onAssetBrowse={browseAssets}
                            onTapEdit={editTap}
                            onWatchWaveform={watchWaveform}
                            onTrackToggle={onLaneToggle}
                            onTrackSet={onTrackSet}
                            onEdgeInsert={frozen ? undefined : insertIntoChain}
                            engineWarnings={nodeWarnings}
                            showCurves={trackCurves}
                            onToggleCurves={() => void runCommand("ui curves")}
                            onTrackInput={(kind) =>
                              void runCommand(
                                `track input ${graphSlot.trackId} ${kind}`,
                              )
                            }
                          />
                        </PaneBoundary>
                      )}
                      {/* A MIDI take's notes as they are played; its clip's own roll replaces it once it lands. */}
                      {graphSlot?.kind === "midiTake" && liveTake && (
                        <MidiTakeRoll
                          take={liveTake}
                          trackName={
                            recInfo.names[liveTake.lane] ?? liveTake.lane
                          }
                          beatsPerBar={recInfo.beatsPerBar}
                          countInBeats={
                            recordEnabled
                              ? recInfo.countIn * recInfo.beatsPerBar
                              : 0
                          }
                          onStop={() => void runCommand("transport stop")}
                        />
                      )}
                      {/* ONE panel for a take and for the file it becomes; `rolling` chooses the picture, not the mount (docs/shell.md). */}
                      {graphSlot?.kind === "recording" && (
                        <PaneBoundary
                          name="audio clip"
                          resetKey={reloadKey}
                          onError={paneError}
                        >
                          <AudioClipPanel
                            clip={rolling ? null : (reviewTake?.clip ?? null)}
                            track={reviewTake?.track ?? ""}
                            rolling={rolling}
                            tempo={recInfo.tempo}
                            beatsPerBar={recInfo.beatsPerBar}
                            countIn={recInfo.countIn}
                            startBeat={takeStart}
                            // Where the clip on screen actually SITS on its lane, asked of the document.
                            placedAt={reviewBeat ?? takeStart}
                            // …and as a timecode, without which trim and the window drag have no event to write.
                            eventAt={rolling ? null : reviewEventAt}
                            // …and its takes, so the takes mode is there the moment the recording ends.
                            takes={rolling ? undefined : reviewTakes}
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
                              closeEvent();
                            }}
                            // The event goes and the file stays: one Ctrl+Z brings the take back.
                            onDiscard={
                              !rolling && reviewTake && reviewEventAt
                                ? () => {
                                    void runCommand(
                                      `event remove ${reviewTake.track} ${reviewEventAt}`,
                                    );
                                    setReviewOn(null);
                                    setReviewedTake(reviewTake.clip);
                                    closeEvent();
                                  }
                                : undefined
                            }
                          />
                        </PaneBoundary>
                      )}
                    </div>
                  )}
                  {panel === "mix" && (
                    <PaneBoundary
                      name="graph panel"
                      resetKey={reloadKey}
                      onError={paneError}
                    >
                      <GraphPanel
                        mark={historyMark}
                        onPreviewNote={previewNote}
                        cameras={cameras}
                        inputDevices={inputDevices}
                        midiDevices={midiDevices}
                        reloadKey={reloadKey}
                        organizeKey={organizeKey}
                        trackId={null}
                        strips={mixerStrips}
                        trackOrder={trackOrder}
                        videoSpans={videoLaneSpans}
                        noteLanes={noteLanes}
                        viewport={videoDoc?.viewport}
                        project={projectDoc}
                        command={quietCommand}
                        onBypassModule={(mod) => void bypassModule(mod)}
                        onModuleField={runCommand}
                        onRecorder={onRecorder}
                        onProjectField={onProjectField}
                        onAlternative={runAlternative}
                        onAssetBrowse={browseAssets}
                        onTapEdit={editTap}
                        onWatchWaveform={watchWaveform}
                        engineWarnings={nodeWarnings}
                        onContextMenu={openContextMenu}
                        pluginParamsStore={pluginParamsStore}
                        setPluginParam={setPluginParam}
                        moduleParams={offlineParams}
                        trackControls={trackControls}
                        onTrackToggle={onLaneToggle}
                        onTrackSet={onTrackSet}
                      />
                    </PaneBoundary>
                  )}
                  {panel === "logs" && (
                    <PaneBoundary
                      name="logs"
                      resetKey={reloadKey}
                      onError={paneError}
                    >
                      <LogsPanel
                        lines={logs}
                        onClear={() => void runCommand("ui logs clear")}
                      />
                    </PaneBoundary>
                  )}
                </PanelCloseFrame>
              </BottomPanel>
            </div>

            {/* The take once it has stopped: the FILE, its onsets and its level — the editing step beside the live pane (docs/shell.md). */}

            {/* What you are listening AGAINST — above the status line and below every pane, since it belongs to no tab (docs/references.md). */}
            {reference && (
              <ReferenceBar
                track={reference}
                onClose={() => setReference(null)}
                onPlayingChange={setReferenceSounding}
                toggleRef={referenceToggle}
              />
            )}

            <footer
              className={cn(
                // The header's tint, so the panel tabs read as tabs against it (components/FooterTab.tsx).
                "flex items-center border-t border-primary/20 bg-primary/20 text-muted-foreground",
                isMobile
                  ? "gap-2 px-2 py-0.5 text-[10px]"
                  : "gap-3 px-4 py-1 text-xs",
              )}
            >
              {/* left: the frediverse logo, then the status text */}
              <div className="flex min-w-0 items-center gap-2.5">
                <FrediverseMark size="sm" className="shrink-0 opacity-60" />
                {/* The MODE and the tool, PERSISTENT unlike the line beside it: a state nobody can see is one you leave by surprise (docs/timeline.md). */}
                {/* The waveform's comes FIRST when one is open, the clip pane being the surface in front. */}
                {rollMode && shownSlot?.kind === "clip" ? (
                  rollMode !== "select" && (
                    <Badge
                      variant="rec"
                      className="shrink-0"
                      title={`piano roll: ${rollMode} — esc or a backs out`}
                    >
                      {rollMode}
                    </Badge>
                  )
                ) : waveView && shownSlot?.kind === "clip" ? (
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
                {copyingToEngine && engineSync ? (
                  <EngineSyncProgress sync={engineSync} />
                ) : waitingForEngine ? (
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

              {/* right: the tempo and signature, the metronome, a separator, then the bottom-panel choices, a separator, then the side panels' buttons */}
              <div className="ml-auto flex shrink-0 items-center gap-2">
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
                  on={optMetronome ?? metronomeOn}
                  level={metronomeLevel}
                  onToggle={() => {
                    setOptMetronome((cur) => !(cur ?? metronomeOn));
                    void runCommand("transport metronome");
                  }}
                  onLevel={(v) =>
                    void runCommand(`transport metronome volume ${v}`)
                  }
                />
                <span
                  className="h-4 w-px shrink-0 bg-border"
                  aria-hidden="true"
                />
                {/* The notes, off by default: they are IN the graph and you say when, and the button is dead on a project with none. */}
                <Button
                  size="icon-xs"
                  variant={showDocs ? "default" : "ghost"}
                  disabled={docCount === 0}
                  onClick={() => void runCommand("ui notes")}
                  title={
                    docCount === 0
                      ? "No notes in this project: a note is a node of @meta/doc, wired from what it is about"
                      : showDocs
                        ? `Hide the ${docCount} note(s) on the graph`
                        : `Show the ${docCount} note(s) on the graph`
                  }
                  aria-label="Toggle docs"
                  aria-pressed={showDocs}
                >
                  <StickyNote className="h-3.5 w-3.5" />
                </Button>
                <FooterTabs dense={isMobile}>
                  {/* The mix panel, apart from the loop below because it is dead when the song has no strip (docs/shell.md). */}
                  <FooterTab
                    active={panel === "mix"}
                    disabled={mixerStrips.length === 0}
                    onClick={() => void runCommand("ui mixer")}
                    title={
                      mixerStrips.length === 0
                        ? "No strip in this song: a strip is a Mixer module at the end of a track"
                        : mixerStrips.length === 1
                          ? "Mix panel — one strip, nothing to line up"
                          : `Mix panel — this song's ${mixerStrips.length} strips lined up`
                    }
                    aria-label="Mix panel"
                  >
                    <PANEL_META.mix.icon className="h-3.5 w-3.5" />
                  </FooterTab>
                  {(Object.keys(PANEL_META) as Panel[]).map((p) => {
                    if (p === "mix") return null;
                    const Icon = PANEL_META[p].icon;
                    return (
                      <FooterTab
                        key={p}
                        active={panel === p}
                        onClick={() => void runCommand(`ui panel ${p}`)}
                        title={`${PANEL_META[p].label} panel`}
                        aria-label={`${PANEL_META[p].label} panel`}
                      >
                        <Icon className="h-3.5 w-3.5" />
                      </FooterTab>
                    );
                  })}
                </FooterTabs>
                {/* The SIDE panels' buttons, at the corner nearest the column they open — a phone keeps them in its menu (docs/shell.md). */}
                {!isMobile && (
                  <>
                    <span
                      className="h-4 w-px shrink-0 bg-border"
                      aria-hidden="true"
                    />
                    <FooterTabs>{headerTools}</FooterTabs>
                  </>
                )}
              </div>
            </footer>

            {/* The bottom of the window: the minimap, then the docked command bar, both desktop-only (docs/commandBar.md). */}
            {docked && (
              <>
                {minimapDocked && (
                  <Minimap
                    reloadKey={reloadKey}
                    // Same map the timeline builds its rows from — a row it skipped would put every lane below it out.
                    automation={laneNodes.automation}
                    caret={caret}
                    highlight={openItem}
                    onSeek={seek}
                  />
                )}
                <div
                  className={`flex shrink-0 items-center border-t border-border px-3 py-2 ${barTint(!!barPending)}`}
                >
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

            {/* The FRAME: a WINDOW over every page, hidden and never unmounted since it owns a GL context (docs/picture.md). */}
            {hasViewport && (
              <FloatingWindow
                title={VIEWPORT_META.label}
                open={viewportOpen}
                onClose={() => void runCommand("ui viewport")}
                rect={viewportFloat.rect}
                onRect={(rect) => setViewportWindow(() => ({ rect }))}
              >
                {/* `trackOrder` is what makes a shader's audio input mean anything: `levels` is indexed, not named — see src/shaderAudio.ts. */}
                <PaneBoundary
                  name="viewport"
                  resetKey={reloadKey}
                  onError={paneError}
                >
                  <ViewportTab
                    doc={videoDoc}
                    error={videoError}
                    trackIds={trackOrder}
                    readOnly={frozen}
                    // An armed lane opens the lens a `monitor: auto` camera wired to it names.
                    armed={videoArmed}
                    // A layer moved or resized in the frame — a command, so one journal entry and one Ctrl+Z.
                    onRect={
                      frozen
                        ? undefined
                        : (lane, r) =>
                            void runCommand(
                              `picture rect ${lane} ${r.x} ${r.y} ${r.w} ${r.h}`,
                            )
                    }
                  />
                </PaneBoundary>
              </FloatingWindow>
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
                  className={`pointer-events-auto mx-4 flex w-full max-w-2xl items-center rounded-lg border border-border px-3 py-2.5 shadow-2xl ${barTint(!!barPending)}`}
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
            {presetPicker}
            {tapChain && (
              <TapChainEditor
                node={tapChain.node}
                tap={tapChain.tap}
                reloadKey={reloadKey}
                command={runCommand}
                onAddModule={(x, y) =>
                  setModulePicker({
                    info: null,
                    x,
                    y,
                    nameFor: (n) => n,
                    onRef: (ref) =>
                      void runCommand(
                        `node tap chain add ${JSON.stringify(tapChain.node)} ${JSON.stringify(tapChain.tap)} ${ref}`,
                      ),
                  })
                }
                renderCards={(nodes) => (
                  <TrackModulesPane
                    mark={historyMark}
                    project={projectDoc}
                    onPreviewNote={previewNote}
                    cameras={cameras}
                    inputDevices={inputDevices}
                    midiDevices={midiDevices}
                    trackId=""
                    nodes={nodes}
                    // The chain's start, as a node that says so and does nothing: the sound arrives from there.
                    lead={TAP_CHAIN_INPUT}
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
                    onBypassModule={(mod) => void bypassModule(mod)}
                    onAlternative={runAlternative}
                    onEngine={runEngine}
                    onPresets={openPresets}
                    onPresetStep={stepPreset}
                    presetNames={presetNames}
                    onAssetBrowse={browseAssets}
                    onTapEdit={editTap}
                    onWatchWaveform={watchWaveform}
                    engineWarnings={nodeWarnings}
                  />
                )}
                onClose={() => setTapChain(null)}
              />
            )}
            {curveEdit && (
              <CurveEditor
                name={curveEdit.name}
                isNew={curveEdit.isNew}
                spec={curveEdit.spec}
                num={projectDoc?.timeSigNumerator ?? 4}
                den={projectDoc?.timeSigDenominator ?? 4}
                events={curveEdit.events}
                kind={curveEdit.kind}
                // An update writes the curve and nothing else; a new one is created, THEN bound — in that order.
                onSave={async (name, fields) => {
                  const written = { ok: false };
                  await runCommand(
                    `curve set ${name} ${JSON.stringify(fields)}`,
                    written,
                  );
                  const bind = curveEdit.bind;
                  // Bound only once the curve EXISTS: a binding to a curve that was refused is dropped by the compile.
                  if (bind && written.ok)
                    await runCommand(
                      `node automate ${bind.node} ${bind.param} ${name}`,
                    );
                }}
                onClose={() => setCurveEdit(null)}
              />
            )}
            {assetPicker && (
              <AssetPicker
                x={assetPicker.x}
                y={assetPicker.y}
                param={assetPicker.param}
                files={assetPicker.files}
                family={assetPicker.family}
                onPick={(file) => {
                  const { module, param, commit } = assetPicker;
                  setAssetPicker(null);
                  if (commit) return void runCommand(commit(file));
                  // A file-valued param is a param — `node param <node> model <file>`, all three QUOTED, with `none` left bare (docs/moduleBuilder.md).
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

            {/* The project's files did not all reach the engine's machine: fatal until reloaded (engineSync.md). */}
            <EngineSyncFailedDialog
              sync={
                !frozen && engineSync && !syncRunning(engineSync)
                  ? engineSync
                  : null
              }
              onReload={async () => {
                await api.retryEngineSync();
              }}
            />

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
                <Suspense fallback={null}>
                  <PaneBoundary
                    name="assembly builder"
                    resetKey={reloadKey}
                    onError={paneError}
                  >
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
                  </PaneBoundary>
                </Suspense>
              </div>
            )}

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
                  <DialogTitle>{m["undo.processTitle"]()}</DialogTitle>
                  <DialogDescription>
                    {undoConfirm
                      ? m["undo.processBody"]({
                          files:
                            undoConfirm.files.join(", ") || undoConfirm.label,
                        })
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
                    {m["common.cancel"]()}
                  </Button>
                  <Button
                    onClick={() => {
                      undoConfirm?.resolve(true);
                      setUndoConfirm(null);
                    }}
                  >
                    {m["common.confirm"]()}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>

            {/* Global toast notifications — positioned bottom-right, above everything */}
            <Toaster />
            {/* A LAN device asking to pair, answered here when this page runs on the engine's machine — docs/pairing.md. */}
            <PairRequestsPrompt
              engine={engineRef.current}
              connected={connected}
            />
            {/* The app's own confirm/prompt, in place of the OS box that ignored the Escape ladder. */}
            <AskHost />
          </div>
        </LcdSoundsContext.Provider>
      </SongClockProvider>
    </EngineStoreProvider>
  );
}
