// App.tsx — the k7 web shell: the panes the project DECLARES (editor | timeline over
// chains), the file tree, the command bar, the mixer, the clip editors, the transport
// header, and the Shift-Shift command palette. One layout, and every pane in it stays
// mounted — `full`/`focus` only decide size and keys, so no open file, caret or zoom is
// ever lost. Live engine state goes to an external store, never App state. See docs/shell.md.

import { AppHeader } from "@frediverse/ui/app-header";
import { Button } from "@frediverse/ui/button";
import {
  FolderOpen,
  Headphones,
  History,
  ListChecks,
  ListMusic,
  Lock,
  Menu,
  MessageSquare,
  Settings,
  Share2,
  Terminal,
  X,
} from "@frediverse/ui/icons";
import { cn } from "@frediverse/ui/lib/utils";
import type { EngineUrl } from "@studio/engine-browser";
import { PluginParamsStore } from "@studio/engine-browser/params";
import {
  arrayEq,
  EngineStore,
  useStoreState,
} from "@studio/engine-browser/store";
import type { PresetInfo } from "@studio/engine-protocol";
import { ViewportTab } from "@studio/k7-plugins/video";
import { askConfirm } from "@studio/project-shell/ask";
import { markActive } from "@studio/project-shell/idle";
// The address of ONE surface, for another device to open — the same module the launch uses, so both spell a project alike (docs/external.md).
import {
  externalUrl,
  launchUrl,
  parseLaunch,
  projectsUrl,
} from "@studio/project-shell/launch";
import type { CommandJournal } from "@studio/project-shell/project";
import { onToast, showToast } from "@studio/project-shell/toast";
import { type HistoryDeps, runRedo, runUndo } from "@studio/project-shell/undo";
// The leaf with no `node:fs` in it — a browser may ask what a path names without dragging the loader in.
import { moduleKeyFromPath } from "@studio/song-schema/moduleTypes";
import type { ReferenceTrack } from "@studio/song-schema/reference";
import { beatsToPosition, parsePosition } from "@studio/song-schema/timecode";
import { LcdSoundsContext, SongClockProvider } from "@studio/ui-chains-react";
import { ModulePreview } from "@studio/ui-chains-react/module-preview";
import type { BuilderPane } from "@studio/ui-module-builder";
import { usePointerFollow } from "@studio/ui-timeline/drag";
import { projectLabel } from "@studio/web-protocol/projects";
import type { EngineLatency } from "@studio/web-protocol/quality";
import { useQueryClient } from "@tanstack/react-query";
import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useStore } from "zustand";
import k7Logo from "../icon/k7.svg";
import { useAndroidBusy } from "./androidBusy";
import { aiOrganize, api, engines, moduleStore, PL8_API } from "./api";
import { DECK_ICONS, STUDIO_ICONS } from "./chainsIcons";
import type { MaybeClipboard } from "./clipboard";
import { type CommandPrefs, labelOf, orderCommands } from "./commandPrefs";
import type { AudioClipHandle } from "./components/AudioClipPanel";
import { AudioClipPanel } from "./components/AudioClipPanel";
import { BottomPanel } from "./components/BottomPanel";
import { ChainsBuilder } from "./components/ChainsBuilder";
import { ChainsTab } from "./components/ChainsTab";
import { ClipView } from "./components/ClipView";
import type {
  CommandBarHandle,
  CommandPending,
  PaletteCommand,
} from "./components/CommandBar";
import { CommentsPanel } from "./components/CommentsPanel";
import { ConflictsPanel, ConflictsTab } from "./components/ConflictsPanel";
import { DemoBanner } from "./components/DemoBanner";
import { type EditorHandle, EditorTab } from "./components/EditorTab";
import { EngineLink } from "./components/EngineLink";
import { EngineLostStrip } from "./components/EngineLostStrip";
import { syncRunning } from "./components/EngineSyncProgress";
import {
  FloatingCommandBar,
  useSummonKey,
} from "./components/FloatingCommandBar";
import { FloatingWindow } from "./components/FloatingWindow";
import { FooterTab } from "./components/FooterTab";
import { GraphPanel } from "./components/GraphPanel";
import { HistoryPanel } from "./components/HistoryPanel";
import { LogsPanel } from "./components/LogsPanel";
import { MasteringTab } from "./components/MasteringTab";
import { MasterMeter, type MasterMeterHandle } from "./components/MasterMeter";
import { MidiTakeRoll } from "./components/MidiTakeRoll";
import { Minimap, type MinimapItem } from "./components/Minimap";
import {
  MobileInfo,
  MobileMenu,
  MobileMenuItem,
} from "./components/MobileChrome";
import type { RollHandle } from "./components/PianoRoll";
import { PlaylistsPanel } from "./components/PlaylistsPanel";
import { RackBuilder } from "./components/RackBuilder";
import { ReferenceBar } from "./components/ReferenceBar";
import { ReferencesPanel } from "./components/ReferencesPanel";
import { ResourcesPanel } from "./components/ResourcesPanel";
import { RightPanel } from "./components/RightPanel";
import { SeqGridPane } from "./components/SeqGridPane";
import { SETTINGS_TABS, SettingsPanel } from "./components/SettingsPanel";
import type { OpenShare } from "./components/SharedGate";
import { SharePanel } from "./components/SharePanel";
import { projectLoading, StartupBar } from "./components/StartupBar";
import { SurfaceTab } from "./components/SurfaceTab";
import type { PanelTakes } from "./components/TakesView";
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
import { desktop } from "./desktop";
import { fixedMaster, TARGET_DB, trimFor } from "./gainTrim";
import type { ClipGridHandle } from "./gridCaret";
import { firstTimeFor, givesChannel, hasAudibleInput } from "./headphonesHint";
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
import { usePaneCallbacks } from "./hooks/usePaneCallbacks";
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
import { type ConditionCtx, commandKeyMap, effectiveKeys } from "./keys";
import {
  refreshLcdSounds,
  setLcdSoundsProject,
  shellSounds,
  touchesSounds,
} from "./lcdSounds";
import { libraryModuleRef } from "./libraryTree";
import { confirmMenuItem } from "./menuConfirm";
import { midiInDeviceFor, midiInLanes } from "./midiIn";
import { chainRefFromCreate, wireCommand } from "./nodeInsert";
import { noteSpans } from "./noteSpans";
import { resolveEditorFile } from "./openInEditor";
import { buildPaletteCommands, commandNameOf, makeListArg } from "./palette";
import { PaneVisible } from "./paneVisible";
import { m } from "./paraglide/messages.js";
import { type PendingEdit, pendingOf } from "./pendingEdits";
import type { PendingNode } from "./pendingNode";
import { type EditFocus, keepIfEqual, sameEditFocus } from "./shellEquality";
import { soundingNow } from "./sounding";
import { createStatusLine } from "./statusLine";
import { onOpenConflictsPanel } from "./syncConflicts";
import { eventIdOf, takesEventOf } from "./takes";
// The shell's BROWSER composition point: k7's builtin plugins register their pane drawers here (packages/k7-sdk/docs/sdk.md).
import "./plugins";
import { PanelCloseFrame } from "./components/PanelClose";
import { type FloatState, loadFloat, saveFloat } from "./floatingRect";
import { useLatest } from "./hooks/useLatest";
import { isTyping } from "./hooks/useWindowKey";
import { latestAnswer } from "./latestAnswer";
import { guardSwipeBack } from "./noSwipeBack";
import { PaneBoundary } from "./PaneBoundary";
import { useAnyPopin, usePopin } from "./popins";
import { entityFile, fileStem } from "./projectPaths";
import { SHELL_SCOPE } from "./queries/client";
import { graphQuery, seedGraph, useGraph } from "./queries/graph";
import { rememberCommand } from "./recentCommands";
import {
  movedTheAudio,
  movedTheChains,
  movedTheSurfaces,
  useScopedKey,
} from "./reloadScope";
import { type RollMode, rollCondition } from "./rollMode";
import { type Pane, type Panel, viewPanes } from "./routes";
import { pictureRowId, placementOf, type RowKey, type RowTarget } from "./rows";
import { saveLabel } from "./saveLabel";
import { ShellFooter } from "./shell/ShellFooter";
import { ShellOverlays } from "./shell/ShellOverlays";
import { ShellTransport } from "./shell/ShellTransport";
import { TempoMeter } from "./shell/TempoMeter";
import { useCentredFits } from "./shell/useCentredFits";
import { type PendingWire, useGraphActions } from "./shell/useGraphActions";
import { MiniTransport, PANE_META, VIEWPORT_META } from "./shellMeta";
import { ShellContexts } from "./state/ShellContexts";
import { createShellStore, type ShellVerbs } from "./state/shellStore";
import { modeCondition, type TimelineMode } from "./timelineMode";
import type { Tool } from "./timelineTools";
import type {
  CommandInfo,
  EngineLoadPhase,
  EngineScanState,
  EngineSyncState,
  ProjectInfo,
  RankedEngine,
  WebAutomationLane,
  WebGraph,
  WebVideoTrack,
  WorkspaceInfo,
} from "./types";
import type { GraphSlot, LocalCtx } from "./ui/commands/context";
import { runLocal } from "./ui/commands/dispatch";
import { useIsMobile } from "./useIsMobile";
import { useViewRoute } from "./useViewRoute";
import { videoSpans } from "./videoSpans";
import { type WaveMode, waveCondition } from "./waveMode";

/** One frozen empty list, so a builder with no live plugin does not get a new array per render. */
const EMPTY_PRESETS: PresetInfo[] = [];

/** The same, for a song with no picture — which is most of them. Keeps the timeline's row memo cold. */
const EMPTY_VIDEO_TRACKS: WebVideoTrack[] = [];
// One key for every song: where the picture's window sits is a habit of this screen (floatingRect.ts).
const VIEWPORT_FLOAT_KEY = "k7.viewportWindow";

// The home page's sidebar, as a drawer over the project: it carries the media and rehearsal sections, so it loads on first open.
const HomeDrawer = lazy(() =>
  import("./projects/HomeSidebar").then((mod) => ({
    default: mod.HomeDrawer,
  })),
);

// The two builders open on demand, and carry an editor and a language of their own: loaded then, not with the shell.
const ModuleBuilder = lazy(() =>
  import("@studio/ui-module-builder").then((mod) => ({
    default: mod.ModuleBuilder,
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

/** The shot a new video project is scaffolded with (packages/song/src/scaffold.ts) — a picture holding only it is untouched. */
const SCAFFOLD_SAMPLE = /(^|\/)clips\/sample\.mp4$/;

/** How long a second Ctrl+Z has, once the text pane's own history is spent, to reach the project journal. */
const JOURNAL_ARM_MS = 3000;

export default function App({
  engineUrl,
  engineLatency,
  userEmail,
  onQuitWorkspace,
  onChangeEngine,
  engine,
  snapshot,
  engineSearching = false,
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
  /** The FROZEN snapshot this shell draws when it was opened through a share link — see docs/shared.md. */
  snapshot?: OpenShare;
  /** No engine yet, and the gate is still looking for one: the project is drawn meanwhile (docs/shell.md). */
  engineSearching?: boolean;
}) {
  // Read once as a boolean: nearly every call site asks 'is this editable', not 'which snapshot is it'.
  const frozen = !!snapshot;
  // What the panes read for themselves — the reload signal, the verbs, the overlays (state/shellStore.ts, docs/state.md).
  const shellVerbs = useRef<ShellVerbs | null>(null);
  const [shell] = useState(() =>
    createShellStore({
      scope: SHELL_SCOPE,
      frozen,
      impl: shellVerbs,
      settingsTab: SETTINGS_TABS[0],
      // The documentation overlay (/docs), read RAW before the router mounts — hence slicing BASE_URL off by hand here.
      showHelp: ["docs", "help"].includes(
        window.location.pathname
          .slice(import.meta.env.BASE_URL.length - 1)
          .replace(/^\/+|\/+$/g, ""),
      ),
    }),
  );
  useLayoutEffect(() => {
    if (shell.getState().frozen !== frozen) shell.setState({ frozen });
  }, [shell, frozen]);
  // The overlays' setters; App reads the two that gate its own keys (state/overlaySlice.ts).
  const {
    setMenu,
    setTapChain,
    setCurveEdit,
    setCommandsPage,
    setAssemblyBuilder,
    setUndoConfirm,
  } = shell.getState();
  const commandsPage = useStore(shell, (s) => s.commandsPage);
  const undoConfirm = useStore(shell, (s) => s.undoConfirm);
  // The view toggles a command flips; App draws the right column and the rack builder from them (state/toggleSlice.ts).
  const {
    setShowHelp,
    setRightPanel,
    toggleRight,
    setSettingsTab,
    setHistoryMark,
    setRackBuilder,
    setTrackCurves,
    setStackView,
    setShowDocs,
  } = shell.getState();
  const showHelp = useStore(shell, (s) => s.showHelp);
  const rightPanel = useStore(shell, (s) => s.rightPanel);
  const settingsTab = useStore(shell, (s) => s.settingsTab);
  const rackBuilder = useStore(shell, (s) => s.rackBuilder);
  const trackCurves = useStore(shell, (s) => s.trackCurves);
  // The PAGE asked for; null is the project's home page, resolved into `full` once the layout is known (docs/shell.md).
  const [chosen, setFull] = useState<Pane | null>(null);
  // A phone draws the pages from its hamburger rather than from the header's row. See docs/shell.md.
  const isMobile = useIsMobile();
  const [mobileMenu, setMobileMenu] = useState(false);
  const [mobileInfo, setMobileInfo] = useState(false);
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
  } | null>(null);
  /** Whether this ACCOUNT has a Claude key (the settings panel), asked when the builder opens until it says yes: no key, no button. */
  const [aiEnabled, setAiEnabled] = useState(false);
  const builderOpen = !!builder;
  useEffect(() => {
    if (builderOpen && !aiEnabled) void aiOrganize.enabled().then(setAiEnabled);
  }, [builderOpen, aiEnabled]);
  // A sideways swipe nothing scrolls must not go Back out of the project (noSwipeBack.ts).
  useEffect(guardSwipeBack, []);
  /** The LIVE plugin behind the builder's module, matched on the chain step's NAME — see docs/moduleBuilder.md. */
  const [builderPlugin, setBuilderPlugin] = useState<{
    module: string;
    pluginId: string;
  } | null>(null);
  // Null until the divider is dragged: the panel opens on half the main column.
  const [panelH, setPanelH] = useState<number | null>(null);
  const panelEl = useRef<HTMLDivElement>(null);
  const [editTarget, setEditTarget] = useState<EditFocus | null>(null);

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
  const setEditTargetIfOther = useCallback((next: EditFocus | null) => {
    setEditTarget((cur) =>
      cur && next && sameEditFocus(cur, next) ? cur : next,
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
  // Copying, applying, warming: the engine does not hold a playable project yet, whatever its socket says; undefined until the first answer.
  const [engineLoad, setEngineLoad] = useState<
    EngineLoadPhase | null | undefined
  >(undefined);
  // The engine's plugin scan this load waits for, or the one it went on without (packages/file-service/docs/engineLoad.md).
  const [engineScan, setEngineScan] = useState<EngineScanState | null>(null);

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
  // The project's change token, read here so the whole tree shares the ONE refcounted poll (docs/plugins.md).
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
  // An external store, not state: a drag re-states the line per snapped cell, and only its leaf should re-render.
  const [statusStore] = useState(createStatusLine);
  /** Say something on the status line — and, by saying it this way, say it is NOT a refusal; only `runCommand` refuses. */
  const setStatus = useCallback<SetStatus>(
    (text, level) => {
      statusStore.say(text, false);
      // The status line is overwritten by the next message, so an error is kept in the log as well.
      if (level === "error") pushLog("error", text);
    },
    [pushLog, statusStore],
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
    (text: string) => statusStore.say(text, true),
    [statusStore],
  );
  /** 'Something changed — re-read what you draw', plus WHAT changed: `files`, which reloadScope.ts reads (null = re-ask). */
  const reload = useStore(shell, (s) => s.reload);
  const reloadKey = reload.key;
  // Bumped when `graph organize` runs: the one signal that lets dagre re-lay out every drawn node.
  const [organizeKey, setOrganizeKey] = useState(0);
  const { bumpReload, reloadWith } = shell.getState();
  // Counters that move only when a reload could concern them (reloadScope.ts); the raw key is for what reads everything.
  const chainsKey = useScopedKey(reload, movedTheChains);
  // The key a graph handed back by a command answers — the cache entry it is seeded into (queries/graph.ts).
  const reloadKeyRef = useLatest(reloadKey);
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
  // The timeline re-sends its view as a fresh object on every caret move; an unchanged one keeps the shell still.
  const setTlViewIfOther = useCallback(
    (next: typeof tlView) => setTlView(keepIfEqual(next)),
    [],
  );
  /** The reference track the bar has loaded, or null for no bar — it outlives every tab, being nothing this project owns (docs/references.md). */
  const [reference, setReference] = useState<ReferenceTrack | null>(null);
  // Whether that track is sounding, and the bar's play/pause — for the panel row that stands for it.
  const [referenceSounding, setReferenceSounding] = useState(false);
  const referenceToggle = useRef<(() => void) | null>(null);
  // A conflict banner over the editor opens the conflicts panel (components/ConflictsPanel.tsx).
  useEffect(
    () => onOpenConflictsPanel(() => setRightPanel("conflicts")),
    [setRightPanel],
  );
  // Vim mode is a global user preference (~/.k7/preferences.yaml). Starts ON to match the brain's default.
  const [vimMode, setVimMode] = useState(true);
  useEffect(() => {
    void api
      .preferences()
      .then((p) => setVimMode(p.vim))
      .catch(() => {});
  }, []);
  const cmdRef = useRef<CommandBarHandle>(null);
  // The wide-screen layout, which docks the minimap at the foot of the window.
  const docked = !isMobile;
  // The command bar floats, hidden until summoned — Ctrl/⌘+Shift+P, double-Shift, the phone's menu (docs/commandBar.md).
  const [paletteOpen, setPaletteOpen] = useState(false);
  const closePalette = useCallback(() => setPaletteOpen(false), []);
  // The home sidebar's drawer, opened by the header's hamburger (docs/shell.md).
  const [homeDrawer, setHomeDrawer] = useState(false);
  const closeHomeDrawer = useCallback(() => setHomeDrawer(false), []);
  // Which field the command bar is waiting on, or null — it decides whether a gesture ACTS or feeds the bar (docs/commandBar.md).
  const [barPending, setBarPending] = useState<CommandPending | null>(null);
  // The editor as a POPIN: the SAME instance, restyled onto the surface — see docs/shell.md.
  const [editorPopin, setEditorPopin] = useState(false);
  // A popin in the registry's sense too, so Esc closes it; its own vim keeps Escape while you are typing in it.
  usePopin(editorPopin, () => setEditorPopin(false));
  // The rack builder popin — a 4×4 pad grid ending in modules/instruments/<name>; Esc and the backdrop close it.
  usePopin(rackBuilder, () => setRackBuilder(false));
  // Whether ANY overlay is up, this shell's or a component's own. Drives the `popin` condition.
  const anyPopin = useAnyPopin();
  /** What the chains slot shows INSTEAD of the graph, or null — three occupants, one state (docs/shell.md). */
  const [graphSlot, setGraphSlot] = useState<GraphSlot | null>(null);

  /** What the graph knows about each lane's node — its other attribute sets and its freeze, travelling up like `docCount`. */
  const [laneNodes, setLaneNodes] = useState<{
    alternatives: WebGraph["trackAlternatives"];
    frozen: WebGraph["frozen"];
    autoFrozen: WebGraph["autoFrozen"];
    autoFreezeWaiting: WebGraph["autoFreezeWaiting"];
    automation: Record<string, WebAutomationLane[]>;
  }>({
    alternatives: undefined,
    frozen: undefined,
    autoFrozen: undefined,
    autoFreezeWaiting: undefined,
    automation: {},
  });

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
  const recordWithoutArmRef = useLatest(recordWithoutArm);
  // A take of the takes view is drawn THERE, so the record panel must not take its slot; set by useTakeRecording below.
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
  // Mirrors whether a learn is pending, for Esc's first rung; the learn itself is the chains pane's.
  const [midiLearning, setMidiLearning] = useState(false);
  const editorRef = useRef<EditorHandle>(null);

  // The process-step undo's confirm, registered like the other dialogs: refusing IS an answer, so the closer resolves it.
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
    [setUndoConfirm],
  );
  // When a Ctrl+Z last met the end of the text pane's history: the next one, soon after, goes to the journal.
  const journalArmedAt = useRef(0);
  const historyDeps = useMemo<HistoryDeps>(
    () => ({
      openFile: (p) => editorRef.current?.open(p),
      notify: (message, variant) => showToast({ message, variant }),
      confirmProcess,
      currentFile: () => editorRef.current?.currentFile() ?? null,
      onApplied: bumpReload,
      strings: {
        undone: (what) => m["undo.undone"]({ what }),
        redone: (what) => m["undo.redone"]({ what }),
        nothingToUndo: m["undo.nothing"](),
        nothingToRedo: m["undo.nothingRedo"](),
      },
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
    audioToBrowser,
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

  // The Android app holds its foreground service and the screen while this engine is busy (androidBusy.ts).
  useAndroidBusy(store);

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
  const videoTracksRef = useLatest(videoTracks);

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

  /** The addresses this project answers on, for the share panel — the WHOLE project first, then EVERY surface (docs/external.md). */
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

  /** Where a SECOND DEVICE reaches this app — not `location.origin`, which is loopback in the desktop window (remoteUrl.ts). */
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
    useCallback(
      (next) => {
        setFull(next.full);
        setPanel(next.panel);
        setShowHelp(next.help);
        setOpenBuilder(next.builder);
      },
      [setShowHelp],
    ),
    {
      timeline: hasTimeline,
      turntables: hasTurntables,
      mastering: hasMastering,
      frozen,
    },
  );
  const openHelp = useCallback(() => setShowHelp(true), [setShowHelp]);
  const closeHelp = useCallback(() => setShowHelp(false), [setShowHelp]);

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
      setStatus(vim ? m["status.vimOn"]() : m["status.vimOff"]());
    } catch (e) {
      setVimMode(!next);
      setStatus(
        m["status.vimFailed"]({ message: (e as Error).message }),
        "error",
      );
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
  const graphOnScreenRef = useLatest(graphOnScreen);

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
          m["status.noSuchSurface"]({
            surface: PANE_META[p].label.toLowerCase(),
          }),
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
        setStatus(m["status.noEditorForBuilder"]());
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
      // The gate OPENED this project before mounting us (useGatePhase.ts), so the load it began is already here: a second open re-pushed the whole project.
      setEngineLoad(w.engineLoad ?? null);
      lastActive.current = w.activeProject;
      if (!w.activeProject) fullscreen("editor");
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
  } = useProjectDoc(SHELL_SCOPE, reloadKey, {
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
  const docRef = useLatest(projectDoc);
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
    async (line: string, journal?: CommandJournal) => {
      pushLog("cmd", `› ${line}`);
      try {
        const { output, changed, rev, revBefore } = await api.command(line, {
          want: [],
          journal,
        });
        // Adopted quietly when nothing else moved since — then the tick does not turn a knob into a wave of re-reads.
        if (rev) noteQuietRevision(rev, revBefore);
        if (output.length) setStatus(output.join("  ·  "));
        for (const o of output) pushLog("info", o);
        // What it wrote, for a caller that reloads after it; a quiet command itself reloads nothing.
        return changed;
      } catch (e) {
        setStatus(
          m["status.commandFailed"]({ message: (e as Error).message }),
          "error",
        );
        return undefined;
      }
    },
    [pushLog],
  );
  // The same, for the many callers that only fire it.
  const quietCommand = useCallback(
    async (line: string, journal?: CommandJournal) =>
      void (await quietCommandFiles(line, journal)),
    [quietCommandFiles],
  );

  /** The header fader: the song's OUTPUT level, which is the OUT node's `Volume`, written quietly (docs/masterMeter.md). */
  const setMaster = useCallback(
    (db: number) =>
      void quietCommand(`node param "OUT" Volume ${db.toFixed(1)}`),
    [quietCommand],
  );

  // …and the NOTES' half, since nothing meters MIDI either: when each lane's notes sound, and how hard (noteSpans.ts).
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
      // Not through `runCommand`, which does not RETURN a refusal: the take is dropped after this, so a failed save would lose it.
      void (async () => {
        pushLog("cmd", `› ${line}`);
        try {
          const { output, refused } = await api.command(line, { want: [] });
          const said = output.length
            ? output.join("  ·  ")
            : m["status.ran"]({ line });
          for (const o of output) pushLog(refused ? "refused" : "info", o);
          if (refused) return void setRefusal(said);
          setStatus(said);
          // Filed, so the local take goes: its bytes are in the médiathèque now (packages/song/docs/recorderNode.md).
          engineRef.current?.recorder(id, "clear");
        } catch (e) {
          setStatus(
            m["status.commandFailed"]({ message: (e as Error).message }),
            "error",
          );
        }
      })();
    },
    [store, pushLog, setRefusal],
  );

  /** A PROJECT setting off a card — the RENDER node's frame shape, written to project.k7x (packages/song-video/docs/picture.md). */
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

  // Per-track mixer state + the shared mute/solo/arm toggle handler.
  const { trackControls, onTrackToggle, onTrackSet, onTrackArm } =
    useTrackControls({
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

  // The shell's own read of the graph moves only when a reload could have moved the CHAINS: the key in force when one last did.
  const chainsAt = useRef({ chains: chainsKey, key: reloadKey });
  if (chainsAt.current.chains !== chainsKey)
    chainsAt.current = { chains: chainsKey, key: reloadKey };
  const { graph: shellGraph } = useGraph(SHELL_SCOPE, chainsAt.current.key);
  // The lanes a midi-in node feeds, off that graph: they arm even while they hold no sequence.
  const midiLanes = useMemo(
    () => (shellGraph ? midiInLanes(shellGraph) : midiLanesRef.current),
    [shellGraph],
  );
  midiLanesRef.current = midiLanes;
  // The armed lane's MIDI device: the midi-in node wired to it, read off the graph — packages/song/docs/midiIn.md.
  const midiInAny = useMemo(
    () =>
      !!shellGraph &&
      Object.values(shellGraph.chains)
        .flatMap((c) => c.use)
        .some((st) => st.device !== undefined),
    [shellGraph],
  );
  const midiIn = useMemo(
    () => ({
      any: midiInAny,
      device:
        shellGraph && midiArmed ? midiInDeviceFor(shellGraph, midiArmed) : null,
    }),
    [midiInAny, shellGraph, midiArmed],
  );
  // `runCommand` is defined below and calls THIS, so a local command reaches it through a ref rather than a closure.
  const runCommandRef = useRef<
    (
      line: string,
      outcome?: { ok: boolean },
      journal?: CommandJournal,
    ) => Promise<void>
  >(async () => {});
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
  // Web MIDI capture, driven by the MIDI record + play + a MIDI-armed track, and the device picker's data.
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
  const { projectErrors, diagnostics, formatTooNew } =
    useProjectErrors(reloadKey);
  const warm = useWarmWaveforms(audioKey, playing);

  const openProject = useCallback(
    async (path: string) => {
      try {
        const showWs = askWs();
        const w = await api.open(path);
        showWs(w);
        setEngineLoad(w.engineLoad ?? null);
        lastActive.current = w.activeProject;
        pluginParamsStore.clear();
        void api
          .project()
          .then(askProject())
          .catch(() => {});
        bumpReload();
        setStatus(m["status.opened"]({ path: path === "." ? w.root : path }));
        setFull(null);
        // The layout the project that was open had — the doc effect above corrects it a moment later.
      } catch (e) {
        setStatus(
          m["status.openFailed"]({ message: (e as Error).message }),
          "error",
        );
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
    // Fast only with an engine up: with none the file service reports a wait that only a binding ends.
    loading: engineReady && engineLoad !== null,
    /** A recording landed: `setWs` carries the clip's name and the reload puts it on its lane — neither happened on its own. */
    onTake: (w) => {
      setAwaitingTake(false);
      askWs()(w);
      bumpReload();
    },
    onSync: setEngineSync,
    onLoad: setEngineLoad,
    onScan: (s) => {
      // Said once, where errors are: a scan given up on leaves its unscanned plugins drawn missing.
      if (s?.stalled) setStatus(m["pluginScan.stalled"](), "error");
      setEngineScan(s);
    },
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
        setStatus(m["status.editorNotReady"]());
        return null;
      }
      // Exact path, then a fuzzy name, then the MATERIAL behind a placement id — see openInEditor.ts.
      const path = resolveEditorFile(arg, ed.files());
      if (path === null) {
        setStatus(m["status.noFileMatching"]({ name: arg }));
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
      return setStatus(m["status.noStrip"]());
    togglePanel("mix");
  }, [panel, mixerStrips.length, togglePanel]);

  /** …and the stack view, which takes the graph's whole pane. */
  const toggleStack = useCallback(() => {
    if (shell.getState().stackView) return setStackView(false);
    // Onto the graph's page, closing the bottom panel as any page change does.
    if (full !== "chains") setPanel(null);
    setFull("chains");
    setStackView(true);
    setStatus(m["status.stackView"]());
  }, [shell, setStackView, full]);

  const toggleDocs = useCallback(() => {
    if (shell.getState().docCount === 0)
      return setStatus(m["status.noNotes"]());
    setShowDocs((on) => !on);
  }, [shell, setShowDocs]);

  /** Arm MIDI learn on one param: the capture is the browser's, the binding is a `module cc` — see docs/midi.md. */
  const armMidiLearn = useCallback(
    (rest: string) => {
      const hit = /^(\S+)\s+(?:"([^"]*)"|(.+))$/.exec(rest.trim());
      if (!hit) {
        setStatus(
          m["status.usageExample"]({
            syntax: "ui midi learn <module> <param>",
            example: 'ui midi learn synth "Filter Freq"',
          }),
        );
        return;
      }
      const module = hit[1];
      const param = (hit[2] ?? hit[3] ?? "").trim();
      const midi = chainsMidiRef.current;
      if (!midi?.ready) {
        setStatus(m["status.noMidi"]());
        return;
      }
      setStatus(m["status.midiLearnArmed"]({ module, param }));
      setMidiLearning(true);
      midi.learn(module, param, (learned) => {
        setMidiLearning(false);
        if (!learned) {
          const said = m["status.midiLearnCancelled"]({ module, param });
          setStatus(said);
          pushLog("info", said);
          return;
        }
        const arg = /\s/.test(param) ? JSON.stringify(param) : param;
        void runCommandRef
          .current(`module cc ${module} ${arg} ${learned.ch} ${learned.cc}`)
          .then(() => {
            // Bidirectional when possible: possible means the device that just spoke also has an output port to answer on.
            const both = midi.hasFeedback(module, param);
            setStatus(
              m[both ? "status.midiLearnBoth" : "status.midiLearnWriteOnly"]({
                module,
                param,
                device: learned.device,
                ch: learned.ch,
                cc: learned.cc,
              }),
            );
          });
      });
    },
    [pushLog],
  );

  // What the shell's own commands may reach, rebuilt every render and read through a ref (ui/commands/context.ts).
  const localCtx = useRef<LocalCtx | null>(null);
  localCtx.current = {
    setStatus,
    setRefusal,
    runCommand: (l) => runCommandRef.current(l),
    isServerCommand: (l) => {
      const name = commandNameOf(l, paletteRef.current);
      return !!name && !name.startsWith("ui ");
    },
    full,
    homePane,
    ringPanes,
    activePane,
    setFull,
    fullscreen,
    setPanel,
    togglePanel,
    shownSlot,
    openEvent,
    closeEvent,
    hasViewport,
    setViewportWindow,
    openHelp,
    closeHelp,
    toggleRight,
    setRightPanel,
    setSettingsTab,
    setCommandsPage,
    toggleMixer,
    toggleStack,
    toggleDocs,
    clearLogs,
    setTrackCurves,
    editorRef,
    openInEditor: (arg) => openInEditor(arg),
    setTapChain,
    setCurveEdit,
    setOpenBuilder,
    openModuleBuilder,
    setAssemblyBuilder,
    setRackBuilder,
    setReviewOn,
    projectDoc,
    surfaces,
    bumpReload,
    timelineRef,
    clipGridRef,
    waveRef,
    rollRef,
    clipSel,
    timelineSelecting: tlView.selecting,
    clipboardRef,
    setClipboard,
    store,
    engineRef,
    engineBusyRef,
    connected,
    frozen,
    transport,
    seek,
    replayAtRef,
    recordWithoutArmRef,
    onTrackToggle,
    armMidiLearn,
    videoArmed,
    setVideoArmed,
    toggleVim,
    onChangeEngine,
    onQuitWorkspace,
    locales,
    setLocale: (l) => setLocale(l as typeof locale),
    ws,
    historyDeps,
    masterMeterRef,
    fixClipping,
    share,
    videoDoc,
    imp,
  };
  // The shell's own commands; false when the line isn't one, so the caller falls through to the backend.
  const runLocalCommand = useCallback(
    (s: string): boolean => runLocal(localCtx.current as LocalCtx, s),
    [],
  );

  // The arrow a module is being created on while the command RUNS — the narrower window the canvas draws a placeholder for.
  const [insertingAt, setInsertingAt] = useState<PendingNode | null>(null);
  // The graph a writing command handed back goes into the cache, drawn instead of fetched (queries/graph.ts).
  const queryClient = useQueryClient();
  // The open project, for the headphones hint, which says itself once per project (headphonesHint.ts).
  const activeProjectRef = useRef<string | null>(null);
  activeProjectRef.current = ws?.activeProject ?? null;
  const warnHeadphones = useCallback(() => {
    const p = activeProjectRef.current;
    if (!p || !firstTimeFor(p)) return;
    showToast({ message: m["live.headphones"](), duration: 0 });
  }, []);
  // …and on opening a project whose input is ALREADY audible: one graph read per project, not per poll.
  useEffect(() => {
    const p = ws?.activeProject;
    if (frozen || !p) return;
    let live = true;
    void queryClient
      .fetchQuery(graphQuery(SHELL_SCOPE, reloadKeyRef.current))
      .then((g) => live && hasAudibleInput(g) && warnHeadphones())
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [ws?.activeProject, frozen, warnHeadphones, queryClient]);
  // Every command comes through here; `outcome`, when given, is told whether the line WENT THROUGH, and `journal` how it is undone.
  const runCommand = useCallback(
    async (
      line: string,
      outcome?: { ok: boolean },
      journal?: CommandJournal,
    ): Promise<void> => {
      if (!line.trim()) return;
      // A pending MIDI learn waits for a control OR the next command, whichever comes first — see docs/midi.md.
      if (chainsMidiRef.current?.learning) chainsMidiRef.current.cancelLearn();
      const s = line.trim();
      pushLog("cmd", `› ${s}`);
      // A live input given a channel is heard at once: say headphones before the speakers find the mic (headphonesHint.ts).
      if (givesChannel(s)) warnHeadphones();
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
          api.command(s, {
            want: graphOnScreenRef.current ? ["graph"] : [],
            journal,
          });
        const { output, refused, graph, rev, changed } = await send();
        // A refusal is neither a success nor a failure, so it gets its own channel rather than being recorded as the first.
        const said = output.length
          ? output.join("  ·  ")
          : m["status.ran"]({ line: s });
        if (refused) setRefusal(said);
        else setStatus(said);
        settle(!refused);
        for (const o of output) pushLog(refused ? "refused" : "info", o);
        // The graph the service built while we waited — the answer for the reload below, so for the NEXT key.
        if (graph)
          seedGraph(queryClient, SHELL_SCOPE, reloadKeyRef.current + 1, graph);
        // The token this command produced, adopted BEFORE the reload it pairs with, so the `/revision` tick does not redo it — see `RevisionPoller.note`.
        if (rev) noteRevision(rev);
        /** …and the reload, carrying the files this command wrote — `undefined`, from a service that could not diff, still means everything. */
        reloadWith(changed);
        // The picker's second half, folded into the first's undo step (docs/chainsGraph.md) — never after a refusal, which it would bury.
        const after =
          !refused && madeRef && wire
            ? wireCommand(madeRef, wire.at, wire.spawn)
            : null;
        if (after) await runCommandRef.current(after, undefined, "join");
        // The one reorganizing verb: the graph hosts drop their held positions with the same reload that drops the pins.
        if (s === "graph organize") setOrganizeKey((k) => k + 1);
        if (outcome) outcome.ok = !refused;
      } catch (e) {
        settle(false);
        setStatus(
          m["status.commandFailed"]({ message: (e as Error).message }),
          "error",
        );
      } finally {
        // The placeholder comes down in the same update that carries the new graph, so the two swap in one frame.
        if (willInsert) setInsertingAt(null);
      }
    },
    [pushLog, runLocalCommand, warnHeadphones, queryClient],
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
        const said = output.length
          ? output.join("  ·  ")
          : m["status.ran"]({ line });
        if (refused) setRefusal(said);
        else setStatus(said);
        for (const o of output) pushLog(refused ? "refused" : "info", o);
        // No reload follows, so it answers the key in force now.
        if (graph)
          seedGraph(queryClient, SHELL_SCOPE, reloadKeyRef.current, graph);
        // Adopted, so the `/revision` tick this write causes does not turn into the full reload skipped here.
        if (rev) noteRevision(rev);
      } catch (e) {
        setStatus(
          m["status.commandFailed"]({ message: (e as Error).message }),
          "error",
        );
      }
    },
    [projectDoc, runCommand, pushLog, queryClient],
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

  // The picture's shape for a drop to read: a phone clip turns an untouched landscape picture to 9:16 (hooks/useTimelineDrop.ts).
  const videoDocRef = useLatest(videoDoc);
  const pictureShape = useCallback(() => {
    const d = videoDocRef.current;
    if (!d) return null;
    const shots = d.videoTracks.flatMap((t) => t.clips);
    return {
      landscape: d.viewport[0] > d.viewport[1],
      untouched: shots.every((c) => SCAFFOLD_SAMPLE.test(c.src)),
    };
  }, []);
  // Files dropped on a lane — here rather than beside the picture drag, since it PLACES with commands (hooks/useTimelineDrop.ts).
  const {
    onDrop: onDropOnTimeline,
    onDropResource,
    upload: timelineUpload,
  } = useTimelineDrop(
    ws?.activeProject ?? ".",
    runCommand,
    setStatus,
    bumpReload,
    pictureShape,
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
  // Read through a ref: `openInEditor` follows fullscreen and focus, and the panels this is handed to are memoised.
  const openInEditorRef = useLatest(openInEditor);
  const focusRowInPanes = useCallback(
    (target: RowTarget) => {
      // Named, not fuzzy-matched: a lane lives in `nodes/`, or in a chain project's `tracks/` (packages/song/docs/chainFiles.md).
      const files = editorRef.current?.files() ?? [];
      const file =
        entityFile(files, "nodes", target.id) ??
        entityFile(files, "tracks", target.id);
      const path = file && openInEditorRef.current(file, false);
      focusLine.current = `${target.id} — ${path ?? m["status.noNodesFile"]()}`;
      setStatus(focusLine.current);
      focusNonce.current += 1;
      setGraphFocus({ id: target.id, nonce: focusNonce.current });
      // …and the lane's modules, side by side, in the event panel; the framing above still happens.
      if (target.kind === "track")
        openEvent({ kind: "trackModules", trackId: target.id });
    },
    [openEvent],
  );
  // The canvas reports what the framing found: a track wired to nothing has to say so, or the double-click reads as a miss.
  const reportFramed = useCallback((chains: number) => {
    setStatus(
      chains
        ? chains > 1
          ? m["status.framedMany"]({ line: focusLine.current, count: chains })
          : m["status.framedOne"]({ line: focusLine.current })
        : m["status.framedNone"]({ line: focusLine.current }),
    );
  }, []);

  // What the entry under the pointer DOES, borrowing the status line while the menu is open — see ContextMenu.tsx's `onHint`.
  const setMenuHint = statusStore.hint;
  // Read through a ref: the graph's insert callbacks are built on this one, and the chains pane is memoised.
  const paletteOpenRef = useLatest(paletteOpen);
  const prewriteCommand = useCallback(
    (text: string) => {
      // An open bar is written into; a hidden one is opened, and the effect below writes once it is mounted.
      if (paletteOpenRef.current) cmdRef.current?.prewrite(text);
      else {
        pendingPrewrite.current = text;
        setPaletteOpen(true);
      }
    },
    [paletteOpenRef],
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
  const openContextMenu = useCallback(
    (ctx: MenuCtx, x: number, y: number) => {
      const items = contextMenu(
        withAmbient(ctx),
        cmdCatalogue.current,
        cmdPrefs.current,
        cmdLocale.current,
      );
      if (items.length) setMenu({ items, x, y });
    },
    [setMenu],
  );
  // What the store's verbs call, read at call time so a pane's first effect already reaches these.
  shellVerbs.current = {
    setStatus,
    runCommand,
    quietCommand,
    openContextMenu,
    seek,
    setLoop: (start, end, enabled) =>
      engineRef.current?.loop(start, end, enabled),
  };
  /** A lane's gutter badge on the timeline — the same ContextMenu the right-click uses, over `nodeMenu`'s rows (contextMenu.ts). */
  const openNodeMenu = useCallback(
    (n: NodeMenuTarget, at: { x: number; y: number }) => {
      const items = nodeMenu(n);
      if (items.length) setMenu({ items, x: at.x, y: at.y });
    },
    [setMenu],
  );
  // A `+` click asks WHICH module before writing anything; picking pre-writes a command. See docs/shell.md.
  const pendingInsert = useRef<PendingNode | null>(null);
  // Where the node a CREATING line is about to make should be wired: an arrow or nowhere, plus the world point clicked (see onModulePick).
  const pendingWire = useRef<PendingWire | null>(null);
  // The graph's insert, asset and tap callbacks, and the two pickers they open (shell/useGraphActions.ts).
  const {
    baseModules,
    insertIntoChain,
    placeInGraph,
    onModulePick,
    browseAssets,
    editTap,
    runAlternative,
    runEngine,
  } = useGraphActions({
    runCommand,
    runCommandRef,
    prewriteCommand,
    cmdRef,
    reloadKey,
    pendingInsert,
    pendingWire,
    shell,
  });
  /** Find the open project's node of the builder's module and watch its plugin — `watchPluginParams` is what makes the values LIVE. */
  useEffect(() => {
    if (!builder) return void setBuilderPlugin(null);
    // The key a chain would write — `amps/neural-amp-modeler`, or `@k7-core/audio/amps/nam` for a library module (@studio/song/moduleTypes).
    const module =
      libraryModuleRef(builder.path) ?? moduleKeyFromPath(builder.path);
    if (!module) return void setBuilderPlugin(null);
    // Another module's plugin is let go at once: a graph that keeps failing would otherwise leave it watched.
    setBuilderPlugin((cur) => (cur?.module === module ? cur : null));
    let cancelled = false;
    void queryClient
      .fetchQuery(graphQuery(SHELL_SCOPE, reloadKeyRef.current))
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
  }, [builder, queryClient]);

  // …and once one is found, ask for it and keep it coming — its own effect, so the unwatch is paired with the watch.
  useEffect(() => {
    if (!builderPlugin) return;
    const { module, pluginId } = builderPlugin;
    requestPluginParams(pluginId);
    watchPluginParams(pluginId, true);
    listPresets(module);
    return () => watchPluginParams(pluginId, false);
  }, [builderPlugin, requestPluginParams, watchPluginParams, listPresets]);

  // What every module card is drawn with, whichever host holds it — the chains page, the bottom panel, a lane's or a tap's cards.
  const cardProps = useMemo(
    () => ({
      onPreviewNote: previewNote,
      cameras,
      inputDevices,
      midiDevices,
      trackOrder,
      project: projectDoc,
      onBypassModule: (mod: string) => void bypassModule(mod),
      onRecorder,
      onProjectField,
      onAlternative: runAlternative,
      onAssetBrowse: browseAssets,
      onTapEdit: editTap,
      onWatchWaveform: watchWaveform,
      engineWarnings: nodeWarnings,
      pluginParamsStore,
      setPluginParam,
      moduleParams: offlineParams,
      trackControls,
    }),
    [
      previewNote,
      cameras,
      inputDevices,
      midiDevices,
      trackOrder,
      projectDoc,
      bypassModule,
      onRecorder,
      onProjectField,
      runAlternative,
      browseAssets,
      editTap,
      watchWaveform,
      nodeWarnings,
      pluginParamsStore,
      setPluginParam,
      offlineParams,
      trackControls,
    ],
  );
  // …plus what a WHOLE graph draws: its lanes' spans and notes, the picture's viewport, the lane buttons.
  const graphHostProps = useMemo(
    () => ({
      ...cardProps,
      organizeKey,
      videoSpans: videoLaneSpans,
      noteLanes,
      viewport: videoDoc?.viewport,
      onTrackToggle: onLaneToggle,
      onTrackSet,
    }),
    [
      cardProps,
      organizeKey,
      videoLaneSpans,
      noteLanes,
      videoDoc?.viewport,
      onLaneToggle,
      onTrackSet,
    ],
  );
  // …or what a card needs of the LIVE engine: its plugin's params, its engine and its presets.
  const liveCardProps = useMemo(
    () => ({
      ...cardProps,
      requestPluginParams,
      watchPluginParams,
      onEngine: runEngine,
      onPresets: openPresets,
      onPresetStep: stepPreset,
      presetNames,
    }),
    [
      cardProps,
      requestPluginParams,
      watchPluginParams,
      runEngine,
      openPresets,
      stepPreset,
      presetNames,
    ],
  );
  // What the caret is currently over, for the conditional bindings (keys.ts).
  const conditions = useMemo<ConditionCtx>(() => {
    const cond: ConditionCtx = {};
    cond.focus_pane = focusPane;
    // The two layers Esc backs out of before it touches the layout; `popin` counts every registered overlay — see popins.ts.
    if (anyPopin) cond.popin = "1";
    if (midiLearning) cond.midi_learning = "1";
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
    midiLearning,
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

  /** Summon the bar — Ctrl/⌘+Shift+P or double-Shift: open it focused, or give an open one the keys back. */
  const summonBar = useCallback(() => {
    if (paletteOpenRef.current) cmdRef.current?.focus();
    else {
      pendingPrewrite.current = null;
      setPaletteOpen(true);
    }
  }, [paletteOpenRef]);
  useSummonKey(summonBar, !commandsPage && !builder);

  /** Global keys — every binding names a command and runs through runCommand (hooks/useCommandKeys.ts); the two screens that switch it off own the surface outright. */
  useCommandKeys({
    enabled: !commandsPage && !builder,
    effKeys,
    conditions,
    runCommand,
    onDoubleShift: summonBar,
  });

  // Ctrl+Z / Ctrl+Y — the project journal, captured so it runs before CodeMirror's keymap and spends the buffer's history first (project-shell/undo.ts).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // The PAGE owns the surface; a docked panel does not, and Ctrl+Z belongs to the project underneath it either way.
      if (commandsPage || undoConfirm) return;
      if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
      const key = e.key.toLowerCase();
      const h = editorRef.current;
      // Ctrl+S off the text pane: no "Save page as" — say instead that nothing needs saving (the pane flushes its own).
      if (key === "s" && !e.shiftKey && !h?.editorFocused()) {
        e.preventDefault();
        showToast({ message: m["save.automatic"]() });
        return;
      }
      if (key !== "z" && key !== "y") return;
      const isRedo = key === "y" || (key === "z" && e.shiftKey);
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
        // …but not on the same press: typing Ctrl+Z through the text must not silently undo a timeline edit next.
        const now = Date.now();
        if (now - journalArmedAt.current > JOURNAL_ARM_MS) {
          e.preventDefault();
          e.stopPropagation();
          journalArmedAt.current = now;
          showToast({
            message: isRedo ? m["undo.textEndRedo"]() : m["undo.textEnd"](),
          });
          return;
        }
        journalArmedAt.current = 0;
      } else {
        // A plain input (command bar, a rename field) keeps its own native text undo.
        if (isTyping(e)) return;
      }
      e.preventDefault();
      e.stopPropagation();
      void (isRedo ? runRedo(historyDeps) : runUndo(historyDeps));
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [commandsPage, historyDeps, undoConfirm]);

  // Record pressed with NOTHING armed arms a track rather than leaving Play dead: the caret's, else the song's only one.
  const armForRecord = useCallback((): boolean => {
    if (armed.length || midiArmed || videoArmed) return true;
    const tracks = (docRef.current?.tracks ?? []).filter((t) => !t.generated);
    const id =
      caret?.trackId ?? (tracks.length === 1 ? (tracks[0]?.id ?? null) : null);
    if (!id) {
      setStatus(m["transport.noArm"]());
      return false;
    }
    onTrackArm(id);
    setStatus(m["transport.armed"]({ track: id }));
    return true;
  }, [armed, midiArmed, videoArmed, caret?.trackId, onTrackArm, setStatus]);
  const loopState = useStoreState(store, (s) => s.loop);
  // The transport's loop button: off when on; else the selection, or four bars from the playhead.
  const toggleTransportLoop = useCallback(() => {
    const e = engineRef.current;
    if (!e) return;
    if (loopState?.on) return e.loop(0, 0, false);
    if (caret?.selection) return timelineRef.current?.toggleLoop();
    const start = store.getSnapshot().playhead;
    const bars = (4 * recInfo.beatsPerBar * 60) / Math.max(1, recInfo.tempo);
    e.loop(start, start + bars, true);
  }, [loopState?.on, caret?.selection, store, recInfo, engineRef]);
  // An engine just ready may hold nothing yet: the request that binds it is what answers whether a load began (packages/file-service/docs/engineLoad.md).
  const [askingLoad, setAskingLoad] = useState(false);
  useEffect(() => {
    if (!engineReady || frozen) return;
    let live = true;
    setAskingLoad(true);
    void api
      .workspace()
      .then((w) => live && setEngineLoad(w.engineLoad ?? null))
      .catch(() => {})
      .finally(() => live && setAskingLoad(false));
    return () => {
      live = false;
      setAskingLoad(false);
    };
  }, [engineReady, frozen]);
  // …and never on a snapshot: there is no engine coming, and what plays here is the browser, ready at once.
  const waitingForEngine =
    !frozen && !!ws?.activeProject && (!engineReady || askingLoad);
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
  const transportWaiting =
    engineBusy ||
    waitingForEngine ||
    copyingToEngine ||
    projectLoading(engineLoad, frozen);

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
  // Five getters, not one: the shell's own commands ask for vocabularies only the shell holds — files, paths, surfaces, languages, timelines.
  const listArg = useMemo(
    () =>
      makeListArg({
        files: () => editorRef.current?.files() ?? [],
        entries: () => editorRef.current?.entries() ?? [],
        surfaces: () => surfaces.map((s) => s.id),
        locales: () => [...locales],
        timelines: () => (docRef.current?.timelines ?? []).map((t) => t.id),
      }),
    [surfaces, locales],
  );

  // Whatever key reaches each panel, for the tooltips below — undefined when nothing is bound, and the tooltip then says only what the button does.
  const commandKeys = useMemo(
    () => commandKeyMap(commandPrefs),
    [commandPrefs],
  );
  const playlistKey = commandKeys.get("ui playlists");
  const referencesKey = commandKeys.get("ui references");
  const resourcesKey = commandKeys.get("ui resources");
  const tasksKey = commandKeys.get("ui tasks");
  const historyKey = commandKeys.get("ui history");
  const shareKey = commandKeys.get("ui share");
  const settingsKey = commandKeys.get("ui settings");

  /** The bar's height IS its tallest control (docs/shell.md), so the desktop one is 24 px; a phone keeps a thumb-sized button. */
  const toolSize = isMobile ? "icon" : "icon-xs";
  // The transport stays centred on the bar while that clears its neighbours, and joins the row when it would cover them.
  const headerGroupRef = useRef<HTMLDivElement | null>(null);
  const transportRef = useRef<HTMLDivElement | null>(null);
  const transportCentred = useCentredFits(headerGroupRef, transportRef);

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
      {/* What this PROJECT imported — audio and video, to hear and place again (docs/resources.md). */}
      <FooterTab
        plain={isMobile}
        active={rightPanel === "resources"}
        title={`${m["res.title"]()}${resourcesKey ? ` (${resourcesKey})` : ""}`}
        aria-label={m["res.title"]()}
        aria-keyshortcuts={resourcesKey}
        onClick={() => void runCommand("ui resources")}
      >
        <FolderOpen className="h-4 w-4" />
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

  // The project's name, linking home; in the phone's info popover it has the popover's width rather than the bar's.
  const projectLink = (
    <a
      href={projectsUrl(window.location.href)}
      title={m["project.backToProjects"]()}
      className={cn(
        "truncate text-muted-foreground text-sm hover:text-foreground hover:underline",
        isMobile ? "px-1.5 font-medium text-foreground" : "max-w-[10rem]",
      )}
    >
      {project?.name || "…"}
    </a>
  );
  // How the engine is doing: the light, the latency, the memory (components/EngineLink.tsx); it is CHOSEN in the sidebar.
  const engineLink = !frozen && (
    <EngineLink connected={connected} latency={engineLatency} />
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
              label={m["commandBar.list"]()}
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
              const key = commandKeys.get(`ui ${p}`);
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

  // EditorTab's two builders, built here so its own props stay references; each is null while closed.
  const moduleBuilderEl = builder ? (
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
          moduleName={builder.path.split("/").slice(-2)[0] ?? builder.path}
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
          // The same save sentence as every other text pane, in the app's language.
          saveLabel={saveLabel}
          // What the plugin calls its parameters and what each spans, off `pluginParamMeta` — never the 20 Hz store, which render would read empty.
          pluginParamNames={
            builderPlugin
              ? Object.keys(pluginParamMeta[builderPlugin.pluginId] ?? {})
              : undefined
          }
          pluginParamMeta={
            builderPlugin ? pluginParamMeta[builderPlugin.pluginId] : undefined
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
            (builderPlugin && presets[builderPlugin.module]) || EMPTY_PRESETS
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
          // Claude draws the panel on THIS app's backend, which holds the key — absent when it holds none.
          onAiOrganize={aiEnabled ? aiOrganize.run : undefined}
          renderPreview={({ ui, params, bases, script, stage }) => (
            <ModulePreview
              icons={STUDIO_ICONS}
              command={runCommand}
              name={builder.path.split("/").slice(-2)[0] ?? builder.path}
              path={builder.path}
              ui={script ? { ...ui, script } : ui}
              params={params}
              bases={bases}
              stage={stage}
              paramsStore={builderPlugin ? pluginParamsStore : undefined}
              onSetParam={builderPlugin ? setPluginParam : undefined}
            />
          )}
        />
      </PaneBoundary>
    </Suspense>
  ) : null;
  const chainsBuilderEl =
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
    ) : null;

  // Everything the panes are handed that is not already a ref, a setter or a stable callback (hooks/usePaneCallbacks.ts).
  const paneFns = usePaneCallbacks({
    openEvent,
    setGraphSlot,
    cmdRef,
    openModuleBuilder,
    setAssemblyBuilder,
    setOpenBuilder,
    setBuilderNode,
    liveTake,
  });

  return (
    <ShellContexts shell={shell} engine={store}>
      {/* The song's clock for every graph below: a curve card's playhead and its bar lines read it (ui-chains-react docs/nodeCard.md). */}
      <SongClockProvider value={songClock}>
        {/* …and the ONE decoder their screens draw a module's sound files with — every graph, the per-track one included. */}
        <LcdSoundsContext.Provider value={shellSounds}>
          {/* `overflow-hidden`: a pane wider than the screen must not widen the page, or a phone moves every dialog off it (docs/shell.md). */}
          <div className="relative flex h-full flex-col overflow-hidden bg-background text-foreground">
            {/* The shared bar (@frediverse/ui/app-header) with k7's contents; `items` is empty on purpose — docs/shell.md. */}
            <AppHeader
              // `plain`, not the house tint: k7 keeps its violet for what is lit, and a violet bar would drown it (docs/shell.md).
              variant="plain"
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
              <div
                ref={headerGroupRef}
                className="flex min-w-0 flex-1 items-center gap-3"
              >
                {/* The way back, whole-page since the project is the router's BASENAME; a share has none (docs/shared.md). */}
                {snapshot ? (
                  <span className="max-w-[10rem] truncate text-muted-foreground text-sm">
                    {snapshot.manifest.name || "…"}
                  </span>
                ) : (
                  <span className="flex min-w-0 items-center gap-1">
                    {/* The hamburger, first in the bar: it opens the home page's sidebar over the project. */}
                    <button
                      type="button"
                      onClick={() => setHomeDrawer(true)}
                      title={m["common.menu"]()}
                      aria-label={m["common.menu"]()}
                      aria-expanded={homeDrawer}
                      className="shrink-0 rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
                    >
                      <Menu className="h-4 w-4" />
                    </button>
                    {!isMobile && (
                      <>
                        <img
                          src={k7Logo}
                          alt=""
                          className="ml-1 h-4 w-auto shrink-0"
                        />
                        {projectLink}
                      </>
                    )}
                  </span>
                )}
                {/* A phone folds the name and the engine into one icon, the bar having room for neither (docs/shell.md). */}
                {isMobile && !snapshot ? (
                  <MobileInfo
                    open={mobileInfo}
                    onOpenChange={setMobileInfo}
                    status={
                      frozen
                        ? null
                        : !engine
                          ? "none"
                          : connected
                            ? "up"
                            : "down"
                    }
                  >
                    {projectLink}
                    <div className="px-1.5">{engineLink}</div>
                    {/* The tempo and meter the footer holds on a desktop; a phone's footer has no room for them. */}
                    <div className="px-1.5 text-muted-foreground text-xs">
                      <TempoMeter recInfo={recInfo} runCommand={runCommand} />
                    </div>
                  </MobileInfo>
                ) : (
                  engineLink
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
                  <ShellTransport
                    toolSize={toolSize}
                    playing={playing}
                    transportWaiting={transportWaiting}
                    recordWithoutArm={recordWithoutArm}
                    transport={transport}
                    noArrangement={noArrangement}
                    recInfo={recInfo}
                    recordEnabled={recordEnabled}
                    midiArmed={midiArmed}
                    openMidiInputs={openMidiInputs}
                    setStatus={setStatus}
                    engineRef={engineRef}
                    centred={transportCentred}
                    rootRef={transportRef}
                    armForRecord={armForRecord}
                    loopOn={!!loopState?.on}
                    onLoop={toggleTransportLoop}
                  />
                )}
              </div>
            </AppHeader>
            {/* A demo is overwritten on the service's next start: said before an edit is lost (components/DemoBanner.tsx). */}
            {!frozen && ws?.activeIsDemo && ws.activeProject && (
              <DemoBanner project={ws.activeProject} />
            )}
            <EngineLostStrip
              connected={connected}
              onRetry={() => engineRef.current?.connect()}
            />
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
                    // `isolate` — load-bearing: CodeMirror's panels and gutters (z 200–300) would cover the floating command bar (docs/commandBar.md).
                    "isolate flex min-h-0 min-w-0 flex-col",
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
                  {/* Per-frame work under a pane stops while CSS hides it, the pane staying mounted (paneVisible.ts). */}
                  <PaneVisible.Provider
                    value={editorPopin || full === "editor"}
                  >
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
                        activeProject={ws?.activeProject ?? null}
                        projectName={project?.name ?? null}
                        // A supervisor older than the field reports none: it runs level 1.
                        engineLevel={
                          engine ? (engine.engine.libraryLevel ?? 1) : undefined
                        }
                        vimMode={vimMode}
                        onOpenProject={openProject}
                        onImportProject={imp.askImport}
                        onEditTarget={setEditTargetIfOther}
                        onOpenItem={setOpenItemIfOther}
                        onOpenBuilder={openModuleBuilder}
                        onOpenLibraryModule={paneFns.openLibraryModule}
                        // The module builder takes the editor's place BESIDE the file tree, as the chains builder does (docs/moduleBuilder.md).
                        moduleBuilder={moduleBuilderEl}
                        // A chain row opens the builder ON that chain, both coming out of the one library repository.
                        chainsBuilder={chainsBuilderEl}
                        onOpenAssembly={paneFns.openAssembly}
                        onOpenChain={paneFns.openChain}
                        diagnostics={diagnostics}
                        videoSources={videoSources}
                        // The channel strip an `io: in` file gets under its text — what actually opens when somebody clicks an IN node.
                        inputDevices={inputDevices}
                        onRegroupInputs={connected ? regroupInputs : undefined}
                      />
                    </PaneBoundary>
                  </PaneVisible.Provider>
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
                        <PaneVisible.Provider value={full === "timeline"}>
                          <PaneBoundary
                            name="timeline"
                            resetKey={reloadKey}
                            onError={paneError}
                          >
                            <TimelineTab
                              ref={timelineRef}
                              // What one-shot commands are doing, on the lanes before the round trip (pendingEdits.ts).
                              pendingEdits={pendingEdits}
                              active={activePane === "timeline"}
                              lanesLocked={panel !== null}
                              // …so an armed lane draws the take as it is played, instead of showing nothing while you record.
                              rolling={rolling}
                              takeStartBeat={takeStart}
                              // The pre-roll, in beats: the growing clip skips it — none for a take the engine's record did not start.
                              takeCountInBeats={
                                recordEnabled
                                  ? recInfo.countIn * recInfo.beatsPerBar
                                  : 0
                              }
                              // The open project's tasks, flagged in the ruler where they carry a timecode (docs/tasks.md).
                              tasks={projectTasks}
                              // …and the MIDI take, drawn on its lane the same way, whichever record started it.
                              midiTake={paneFns.midiTake}
                              videoTracks={videoTracks}
                              timelineVideoTracks={videoDoc?.timelines}
                              // A song with no picture lane has no frame to land on, whatever its document defaults.
                              fps={
                                videoTracks.length ? videoDoc?.fps : undefined
                              }
                              // The picture drag guards on this handler's own presence, so a snapshot simply has none.
                              onVideoEdit={frozen ? undefined : applyVideoEdit}
                              // …and so does the file drop, for the same reason: a frozen song has nowhere to put the bytes.
                              onDropFiles={
                                frozen ? undefined : onDropOnTimeline
                              }
                              onDropResource={
                                frozen ? undefined : onDropResource
                              }
                              dropUpload={timelineUpload}
                              // A song with a frame has two kinds of lane, which makes the new-lane button a menu.
                              pictureLanes={hasViewport}
                              onEditTarget={setEditTargetIfOther}
                              onOpenClip={paneFns.openClip}
                              onEmptyClick={paneFns.emptyClick}
                              onCaret={setCaretIfMoved}
                              onView={setTlViewIfOther}
                              // While the bar is filling a command whose open field wants a timecode, the ruler ANSWERS it instead of committing.
                              feedTimecode={
                                barPending?.kind === "timecode"
                                  ? paneFns.feeds.timecode
                                  : undefined
                              }
                              feedMove={
                                barPending?.canonical === "event move"
                                  ? paneFns.feeds.move
                                  : undefined
                              }
                              // …and the selection rectangle answers `events move` the same way, leaving only the delta to type.
                              feedEventsMove={
                                barPending?.canonical === "events move"
                                  ? paneFns.feeds.eventsMove
                                  : undefined
                              }
                              onFocusRow={focusRowInPanes}
                              // The picture lane armed for its camera, and whether one is rolling (hooks/useVideoRecording.ts).
                              videoArmed={videoArmed}
                              videoRecording={videoRecording}
                              trackControls={trackControls}
                              onTrackToggle={onTrackToggle}
                              laneNodes={laneNodes}
                              // The lane's ⋮ menu, from the gutter badge — the SAME one the chains pane opens on a lane's node.
                              onNodeMenu={openNodeMenu}
                            />
                          </PaneBoundary>
                        </PaneVisible.Provider>
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
                            command={quietCommand}
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
                            {...graphHostProps}
                            {...liveCardProps}
                            active={!chainsOffScreen}
                            // A SET's lanes are DECKS and wear the record the header wears; the choice is the project's — see chainsIcons.tsx.
                            icons={hasTurntables ? DECK_ICONS : STUDIO_ICONS}
                            // The sidebar is fullscreen chrome, and the graph is only ever on screen as a whole page.
                            showList
                            onEdgeInsert={frozen ? undefined : insertIntoChain}
                            onCanvasInsert={frozen ? undefined : placeInGraph}
                            pendingInsert={insertingAt}
                            // The NOTES: whether the graph draws them, and how many — the count travels up because the button is in the footer.
                            onLaneNodes={setLaneNodes}
                            focus={graphFocus}
                            onFocused={reportFramed}
                            // …and the song's output level, for the fader on the OUT card — the same param the header's fader writes.
                            masterVolume={projectDoc?.masterVolume}
                            midiRef={chainsMidiRef}
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
                  {rightPanel === "resources" && (
                    <PaneBoundary
                      name="resources"
                      resetKey={reloadKey}
                      onError={paneError}
                    >
                      <ResourcesPanel
                        reloadKey={reloadKey}
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
                      timelines={(projectDoc?.timelines ?? []).map((t) => t.id)}
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
                  {/* The caret's track, or the MIX: every strip on one rank. Keyed, so switching the two remounts it. */}
                  {(panel === "graph" || panel === "mix") && (
                    <PaneBoundary
                      key={panel}
                      name="graph panel"
                      resetKey={reloadKey}
                      onError={paneError}
                    >
                      <GraphPanel
                        {...graphHostProps}
                        trackId={
                          panel === "graph" ? (caret?.trackId ?? null) : null
                        }
                        strips={panel === "mix" ? mixerStrips : undefined}
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
                            // The caret's three verbs and the loop it sets, pointed at whichever grid this pane is drawing.
                            caretRef={clipGridRef}
                            onSelection={setClipSel}
                            // …and the ear. Straight down the engine's socket: a note heard is not an edit, so it is journalled nowhere.
                            onPreviewNote={previewNote}
                            waveRef={waveRef}
                            onWaveView={setWaveView}
                            rollRef={rollRef}
                            onRollMode={setRollMode}
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
                            {...liveCardProps}
                            trackId={graphSlot.trackId}
                            onTrackToggle={onLaneToggle}
                            onTrackSet={onTrackSet}
                            onEdgeInsert={frozen ? undefined : insertIntoChain}
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
                            trackOrder={trackOrder}
                            trackNames={recInfo.names}
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

            {/* The status line on the left, the tempo, the metronome and the panels' buttons on the right (shell/ShellFooter.tsx). */}
            <ShellFooter
              isMobile={isMobile}
              rollMode={rollMode}
              waveView={waveView}
              shownSlot={shownSlot}
              ringPanes={ringPanes}
              tlView={tlView}
              statusStore={statusStore}
              statusFallback={project?.root}
              copyingToEngine={copyingToEngine}
              engineSync={engineSync}
              waitingForEngine={waitingForEngine}
              warm={warm}
              projectErrors={projectErrors}
              formatTooNew={formatTooNew}
              recInfo={recInfo}
              optMetronome={optMetronome}
              setOptMetronome={setOptMetronome}
              metronomeOn={metronomeOn}
              metronomeLevel={metronomeLevel}
              panel={panel}
              mixerStrips={mixerStrips}
              headerTools={headerTools}
              onSummonBar={summonBar}
            />

            {/* The bottom of the window: the minimap, desktop-only (docs/shell.md). */}
            {docked && minimapDocked && (
              <Minimap
                // Same map the timeline builds its rows from — a row it skipped would put every lane below it out.
                automation={laneNodes.automation}
                caret={caret}
                highlight={openItem}
                onSeek={seek}
              />
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
                    onRect={frozen ? undefined : shell.getState().commands.rect}
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
                <Minimap caret={caret} highlight={openItem} onSeek={seek} />
              </div>
            )}

            {/* A tab bar stood here, one tab per pane; it is in the hamburger now — see `headerActions` and docs/shell.md. */}

            {homeDrawer && (
              <Suspense fallback={null}>
                <HomeDrawer
                  open
                  onClose={closeHomeDrawer}
                  // The one engine selector, given this project's live engine; a share has none to change (docs/shell.md).
                  engine={
                    frozen
                      ? undefined
                      : {
                          current: engine ?? null,
                          searching: engineSearching,
                          compat: engineCompat,
                          audioToBrowser,
                          stats: engineLink,
                          onChange: () => {
                            closeHomeDrawer();
                            onChangeEngine();
                          },
                        }
                  }
                />
              </Suspense>
            )}

            {/* The command bar, floating at the top once summoned and deliberately not modal (docs/commandBar.md). */}
            <FloatingCommandBar
              ref={cmdRef}
              open={paletteOpen}
              onDismiss={closePalette}
              pending={!!barPending}
              commands={paletteCommands}
              listArg={listArg}
              onRun={(line) => void runCommand(line)}
              onPending={setBarPending}
              caret={caretAim}
            />

            {/* What Play is still waiting for, along the bottom — the project is drawn meanwhile (components/StartupBar.tsx). */}
            {!frozen && (
              <StartupBar
                searching={engineSearching}
                hasEngine={!!engine}
                load={engineLoad}
                sync={engineSync}
                scan={engineScan}
                connecting={waitingForEngine}
              />
            )}

            {/* Every popin, dialog and menu over the shell (shell/ShellOverlays.tsx). */}
            <ShellOverlays
              commandPrefs={commandPrefs}
              pickMenuItem={pickMenuItem}
              setMenuHint={setMenuHint}
              presetPicker={presetPicker}
              liveCardProps={liveCardProps}
              baseModules={baseModules}
              onModulePick={onModulePick}
              projectDoc={projectDoc}
              engineSync={engineSync}
              imp={imp}
              allCommands={allCommands}
              saveCommandPrefs={saveCommandPrefs}
              vimMode={vimMode}
              paneError={paneError}
              engineRef={engineRef}
              connected={connected}
            />
          </div>
        </LcdSoundsContext.Provider>
      </SongClockProvider>
    </ShellContexts>
  );
}
