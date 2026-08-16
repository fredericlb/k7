// App.tsx — the l8 web shell: the global view (editor | timeline over chains), the
// transport header, and the Shift-Shift command palette. A view is a LAYOUT, not a mode —
// every pane stays mounted and `full`/`focus` only decide size and keys, so no open file,
// caret or zoom is ever lost. Live engine state goes to an external store, never App state.
// See docs/shell.md.

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
import { showToast, Toaster } from "@studio/project-shell/toast";
import { type HistoryDeps, runRedo, runUndo } from "@studio/project-shell/undo";
// The leaf with no `node:fs` in it — a browser may ask what a path names without dragging the
// loader in behind it.
import { moduleKeyFromPath } from "@studio/song/moduleTypes";
import { setVideoPlacementField } from "@studio/song/yaml/videoTrackFile";
import { ModulePreview } from "@studio/ui-chains-react/module-preview";
import { type BuilderPane, ModuleBuilder } from "@studio/ui-module-builder";
import {
  type EngineLatency,
  formatLatency,
} from "@studio/web-protocol/quality";
import {
  Circle,
  Disc3,
  Loader2,
  Pause,
  Play,
  Square,
  StickyNote,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, engines, moduleStore } from "./api";
import { STUDIO_ICONS } from "./chainsIcons";
import { canonicalizeCommand } from "./commandI18n";
import { type CommandPrefs, labelOf, orderCommands } from "./commandPrefs";
import { AlternativePicker } from "./components/AlternativePicker";
import { AssetPicker } from "./components/AssetPicker";
import { AudioClipPanel } from "./components/AudioClipPanel";
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
import { EditorSettingsPage } from "./components/EditorSettingsPage";
import { type EditorHandle, EditorTab } from "./components/EditorTab";
import { EditSharedModuleDialog } from "./components/EditSharedModuleDialog";
import { GraphPanel } from "./components/GraphPanel";
import { HelpPage } from "./components/HelpPage";
import { ImportDialog } from "./components/ImportDialog";
import { IoPanel } from "./components/IoPanel";
import { LogsPanel } from "./components/LogsPanel";
import { Minimap, type MinimapItem } from "./components/Minimap";
import { MobileMenu, MobileTabBar } from "./components/MobileChrome";
import {
  type ModulePick,
  ModulePicker,
  type PickerModule,
} from "./components/ModulePicker";
import { RackBuilder } from "./components/RackBuilder";
import { SeqGridPane } from "./components/SeqGridPane";
import { SettingsMenu, type SettingsScreen } from "./components/SettingsMenu";
import { ShareMenu } from "./components/ShareMenu";
import { SurfaceTab } from "./components/SurfaceTab";
import {
  type TimelineHandle,
  TimelineTab,
  type VideoEdit,
} from "./components/TimelineTab";
import { TrackModulesPane } from "./components/TrackModulesPane";
import { ViewportTab } from "./components/ViewportTab";
import { contextMenu, type MenuCtx, type MenuItem } from "./contextMenu";
import { fuzzyScore } from "./fuzzy";
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
import { isMixFormat, MIX_FORMATS, useShare } from "./hooks/useShare";
import { useSurfaces } from "./hooks/useSurfaces";
import { useTrackControls } from "./hooks/useTrackControls";
import { useTurntableDeck } from "./hooks/useTurntableDeck";
import { useVideoDoc } from "./hooks/useVideoDoc";
import { useLocale } from "./i18n";
import {
  blurOnClick,
  type ConditionCtx,
  effectiveKeys,
  keyForCommand,
  keyToken,
  resolveToken,
} from "./keys";
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
import { buildPaletteCommands, commandNameOf, makeListArg } from "./palette";
import { m } from "./paraglide/messages.js";
import { closeTopPopin, useAnyPopin, usePopin } from "./popins";
import { entityFile, fileStem } from "./projectPaths";
import { rememberCommand } from "./recentCommands";
import { type Pane, type Panel, type View, viewPanes } from "./routes";
import type { RowKey, RowTarget } from "./rows";
import { parseSeqEdit, resolveSequence, type SeqView } from "./sequenceEdit";
import {
  DOUBLE_SHIFT_MS,
  MetronomeIcon,
  MiniTransport,
  MixerIcon,
  PANE_META,
  PANEL_META,
  PANES,
  TransportClock,
  VIEW_META,
} from "./shellMeta";
import {
  placedBeat,
  type TakeOption,
  takeOptions,
  trackPlacing,
} from "./takeReview";
import type {
  CommandInfo,
  ProjectInfo,
  WebGraph,
  WebVideoTrack,
  WorkspaceInfo,
} from "./types";
import { useIsMobile } from "./useIsMobile";
import { useViewRoute } from "./useViewRoute";

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
}: {
  engineUrl: EngineUrl;
  /** What the link to that engine measured — the footer's Q badge. Null when the gate
   *  could not measure it, which the badge says rather than guessing a band. */
  engineLatency: EngineLatency | null;
  /** Who is logged in. Feeds the SESSION id, so two people on one engine hold two
   *  projects rather than overwriting each other's. */
  userEmail: string;
  onQuitWorkspace: () => void;
  /** Back to the engine picker — see SettingsMenu. */
  onChangeEngine: () => void;
}) {
  // The layout: null is the global view, a pane name is that pane expanded; `focus` is which pane owns the keys.
  const [full, setFull] = useState<Pane | null>(null);
  // A phone gets tabs, not the studio layout — the tab bar just drives `full`. See docs/shell.md.
  const isMobile = useIsMobile();
  const [mobileMenu, setMobileMenu] = useState(false);
  const [view, setView] = useState<View>("global");
  // The timeline, because it is what the default view opens on — see ringPanes.
  const [focusPane, setFocusPane] = useState<Pane>("timeline");
  const [panel, setPanel] = useState<Panel | null>(null);
  /**
   * Which SURFACE has the screen, by its filename, or null for the layout.
   *
   * Its own state rather than a `full` value, for the reason `RouteState.surface` gives: the
   * list is the project's and is not knowable until one is open, so it cannot be a member of
   * `Pane`. It behaves like `help` — over the layout, which is left exactly as it was underneath.
   */
  const [openSurface, setOpenSurface] = useState<string | null>(null);
  // The module the shared builder is open on, or null. An OVERLAY and not a pane: the builder is a
  // full screen of its own (a code pane, a params list and a widget grid), and the shell's panes are
  // already three. Nothing under it unmounts, so closing it puts the editor back exactly as it was.
  const [builder, setBuilder] = useState<{
    path: string;
    pane: BuilderPane;
    /**
     * Whether this shared module has been unlocked for editing. Only the dialog below sets it.
     *
     * Whether it IS shared is not held here: it is read off the path (`isLibraryPath`), so a
     * module opened by the `ui builder` command locks exactly as one clicked in the Libraries
     * tab does. A flag set at click time would have been a second answer to a question the
     * path already settles.
     */
    unlocked?: boolean;
  } | null>(null);
  // The shared module the "Edit" button is asking about. Held rather than derived from `builder`
  // so the dialog closes on its own without touching what is behind it.
  const [editShared, setEditShared] = useState<string | null>(null);
  /**
   * The LIVE plugin behind the module the builder is open on, when the open project has one.
   *
   * This is what makes the builder more than a text editor: a plugin's parameter names, their
   * ranges and its factory presets are facts about a LOADED plugin, and the only loaded plugins
   * are the ones this project instantiates. The médiathèque used to answer by sending the engine
   * a one-module throwaway project; that only ever worked because it had an engine session with
   * nothing in it, and it is gone with its builder.
   *
   * Matched on the chain step's NAME. A node named after the module it extends is therefore
   * the one that lights this up — which is the rule the bench is built around
   * (apps/st0/docs/banc.md). No match is an ordinary state: the grid still edits, the bindings
   * are just typed rather than picked.
   */
  const [builderPlugin, setBuilderPlugin] = useState<{
    module: string;
    pluginId: string;
  } | null>(null);
  // The documentation: an OVERLAY with its own route (/docs), so Back and typing `help` both close it.
  // Read RAW, before the router mounts, so the prefix the router would strip is
  // still on it — hence slicing BASE_URL off by hand here and nowhere else.
  const [showHelp, setShowHelp] = useState(() =>
    ["docs", "help"].includes(
      window.location.pathname
        .slice(import.meta.env.BASE_URL.length - 1)
        .replace(/^\/+|\/+$/g, ""),
    ),
  );
  const [panelH, setPanelH] = useState(280);
  const [editTarget, setEditTarget] = useState<EditTarget | null>(null);

  // What the editor has open (a clip/track), for the minimap's highlight ring.
  const [openItem, setOpenItem] = useState<MinimapItem | null>(null);
  // The timeline caret: the minimap needs its row, and m/s need its id (commands address a track by name).
  const [caret, setCaret] = useState<{
    row: RowKey;
    beat: number;
    trackId: string | null;
  } | null>(null);
  const [project, setProject] = useState<ProjectInfo | null>(null);
  const [ws, setWs] = useState<WorkspaceInfo | null>(null);
  // The take this tab has already dismissed. The server keeps naming the last one for ever — "the
  // last take" stays true until there is another — so what makes the review appear ONCE is this, and
  // a genuinely new take has a different id and shows up on its own.
  const [reviewedTake, setReviewedTake] = useState<string | null>(null);
  /**
   * Where the take now rolling STARTED, in beats. One source, because two surfaces draw from it —
   * the clip panel's counter and the growing clip on the lane — and two captures would drift the
   * moment they mounted at different times.
   *
   * Read off the store at the `rolling` edge rather than subscribed to: this changes once per take,
   * and a subscription here would re-render the whole shell 20 times a second for a number that
   * does not move. (That is not hypothetical — it is what `Playhead` exists to avoid; see
   * docs/timeline.md.)
   */
  const [takeStart, setTakeStart] = useState(0);
  // …and the one ASKED for by name (`ui review <clip>`), which outranks it. The automatic review is
  // a moment that passes — the service forgets `lastTake` when it restarts, and the ✓ ends it for
  // good — so this is how a take is reopened afterwards, including one nothing is naming any more.
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
  const [status, setStatus] = useState("");
  const [reloadKey, setReloadKey] = useState(0);
  // Bumped when `graph organize` runs: the graph hosts hold every drawn node in place across
  // ordinary edits, and this is the one signal that lets dagre re-lay out everything.
  const [organizeKey, setOrganizeKey] = useState(0);
  const bumpReload = useCallback(() => setReloadKey((k) => k + 1), []);
  // MIDI recording is browser-side (the engine records audio only), one track at a time, landing in its sequence.
  const [midiArmed, setMidiArmed] = useState<string | null>(null);
  const [tlView, setTlView] = useState({
    selecting: false,
    zoomed: false,
    loop: false,
    expanded: false,
  });
  const [settingsScreen, setSettingsScreen] = useState<SettingsScreen | null>(
    null,
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
  // On a wide screen the bar is DOCKED under the minimap and always on screen, so there is
  // nothing to open: `paletteOpen` governs the PHONE's popin alone (no minimap there, and the
  // band a permanent prompt costs is what a phone has least of). See docs/commandBar.md.
  const docked = !isMobile;
  const [paletteOpen, setPaletteOpen] = useState(false);
  // Which field the command bar is waiting on, or null. The shell reads it to decide whether a
  // gesture in a pane should ACT or feed the bar — see docs/commandBar.md.
  const [barPending, setBarPending] = useState<CommandPending | null>(null);
  // …and read LIVE by the phone's dismiss timer below, which fires after the state that would
  // have told it not to.
  const barPendingRef = useRef<CommandPending | null>(null);
  barPendingRef.current = barPending;

  /**
   * The PHONE's bar goes away when it loses the keyboard. The desktop's is docked and stays.
   *
   * A popin over a phone screen is most of the screen: leaving it up after you have tapped past
   * it costs the pane you tapped INTO, and there is no minimap row for it to live under.
   *
   * Two guards, and both are load-bearing. It waits a moment rather than closing on the blur
   * itself, because picking a command takes the keyboard from this field and gives it to the
   * parameter form one render later — closing in between would dismiss the bar at the exact
   * moment it was about to ask you something. And it re-reads `barPending` when the timer
   * fires: while the parameter popin is open the bar is not idle, whatever the command field's
   * focus says.
   */
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
  // The editor as a POPIN: a command sent it to a file while its pane was off screen. It is the
  // SAME instance, restyled onto the surface — see docs/shell.md.
  const [editorPopin, setEditorPopin] = useState(false);
  // It is a popin in the registry's sense too, so Esc closes it and stops there. Its own vim
  // keeps Escape while you are TYPING in it — the listener stands aside for a code editor — so
  // the key still leaves insert mode and only reaches here from outside the text.
  usePopin(editorPopin, () => setEditorPopin(false));
  // The rack builder popin — a 4×4 pad grid that ends in modules/instruments/<name> on disk.
  // Opened by the `module create rack` palette command; Esc and the backdrop close it.
  const [rackBuilder, setRackBuilder] = useState(false);
  usePopin(rackBuilder, () => setRackBuilder(false));
  // Whether ANY overlay is up, this shell's or a component's own. Drives the `popin` condition.
  const anyPopin = useAnyPopin();
  /**
   * What the chains slot is showing INSTEAD of the graph, or null for the graph itself.
   *
   * Three occupants, one state, because they cannot be there together: a sequence's note grid
   * (`sequence edit roll|tracker`), a clicked clip's content, and the take being recorded.
   * Separate flags would have had to agree about which wins, and the × would have had to work
   * out which one it was closing.
   *
   * NOT route state: `routes.ts` carries the LAYOUT, and these name a file or a moment — the
   * same reason the editor's open file is not in the URL either. See docs/shell.md.
   */
  const [graphSlot, setGraphSlot] = useState<
    | { kind: "grid"; path: string; view: SeqView }
    | { kind: "clip"; target: EditTarget }
    | { kind: "recording" }
    // One track's modules, side by side — its whole signal path read left to right, opened by a
    // double-click on the lane's header. See docs/shell.md.
    | { kind: "trackModules"; trackId: string }
    | null
  >(null);
  /**
   * The mixer view: the SAME graph, with every strip pulled onto one rank.
   *
   * A boolean and not a slot, because nothing takes the graph's place — only its ranks move
   * (`alignModuleRank`). Which modules are strips is the project's answer, read below; this just
   * says whether to ask for it.
   */
  const [mixerView, setMixerView] = useState(false);

  /**
   * Whether the graph draws the project's NOTES — its doc modules.
   *
   * Off by default and not remembered, exactly like `mixerView` beside it: both are ways of
   * looking at the one graph rather than places to be, and a shell that reopened holding
   * somebody's last glance would be deciding what you came to look at.
   *
   * `docCount` is reported UP by the pane that has the graph — the button lives in the footer
   * and the graph is fetched in `ChainsTab`, so the count has to travel. It is what makes the
   * button honest on a project with no notes, which is nearly all of them.
   */
  const [showDocs, setShowDocs] = useState(false);
  const [docCount, setDocCount] = useState(0);
  /**
   * What the graph knows about each lane's node: its other attribute sets, and its freeze.
   *
   * It travels the same way `docCount` does, and for the same reason — the graph is fetched by
   * the chains pane, and this is wanted in the timeline's gutter. Both halves are empty for
   * nearly every project, and the whole thing is empty until that pane has a graph.
   */
  const [laneNodes, setLaneNodes] = useState<{
    alternatives: WebGraph["trackAlternatives"];
    frozen: WebGraph["frozen"];
  }>({ alternatives: undefined, frozen: undefined });

  // A take starts rolling (record enabled AND the transport playing): show it. It is deliberately
  // one-way — the pane STAYS when the take ends, because what you just played is exactly what you
  // want to look at, and only the × puts the graph back. Whatever the slot held is evicted: while
  // a take rolls, the take is the thing.
  const rolling = recordEnabled && playing;
  useEffect(() => {
    if (rolling)
      setGraphSlot((s) =>
        s?.kind === "recording" ? s : { kind: "recording" },
      );
  }, [rolling]);
  const timelineRef = useRef<TimelineHandle>(null);
  // The chains pane owns the MIDI runtime (it is the one place that always holds the graph, and
  // the map is part of the graph) — the shell only reaches in to arm a learn. See docs/midi.md.
  const chainsMidiRef = useRef<MidiControlApi | null>(null);
  const editorRef = useRef<EditorHandle>(null);

  // Undo/redo: a process step (restoring a bounced file) is gated behind this confirm dialog.
  const [undoConfirm, setUndoConfirm] = useState<{
    files: string[];
    label: string;
    resolve: (ok: boolean) => void;
  } | null>(null);
  // Registered like the other dialogs: Radix dismisses it on Escape without swallowing the key.
  // Refusing IS an answer here, so the closer resolves the promise rather than dropping it.
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
  /**
   * What this person has made of the command catalogue — names, icons, order (commandPrefs.ts).
   *
   * In the ACCOUNT's preferences, not the rig's: what you call a command follows you to another
   * browser, where which audio interface to open belongs to the machine. `patchPrefs` merges, so
   * writing this cannot wipe the engine id sitting beside it — the trap that document's own
   * comment records.
   */
  const [commandPrefs, setCommandPrefs] = useState<CommandPrefs>({});
  useEffect(() => {
    void engines
      .prefs()
      .then((p: unknown) =>
        setCommandPrefs((p as { commands?: CommandPrefs })?.commands ?? {}),
      )
      .catch(() => {}); // never saved any: the defaults are the catalogue's own
  }, []);
  // Optimistic, and the write is not awaited: the page is a list of small edits, and each one
  // waiting on a round trip would make renaming a command feel like saving a file.
  const saveCommandPrefs = useCallback((next: CommandPrefs) => {
    setCommandPrefs(next);
    void engines.patchPrefs({ commands: next }).catch(() => {});
  }, []);
  // The keymap as this person has it: the app's simple bindings with their `key:` prefs applied.
  // Computed once per prefs change — the key listener reads it on every press.
  const effKeys = useMemo(() => effectiveKeys(commandPrefs), [commandPrefs]);
  const lastActive = useRef<string | null>(null);
  const lastShiftAt = useRef(0); // for the double-tap-Shift palette opener
  const pendingPrewrite = useRef<string | null>(null);

  // The Logs panel's buffer + the process-log tail (polled only while it's open).
  const { logs, pushLog, clearLogs } = useLogs(panel);

  // The engine connection: client lifecycle, live state wiring, stable senders.
  const {
    engineRef,
    connected,
    engineReady,
    engineBusy,
    // …and the same flag as a REF, for the one caller that must read it without being rebuilt
    // when it changes: the local command dispatcher (see the bare transport verbs).
    engineBusyRef,
    engineWarnings,
    watchWaveform,
    transport,
    seek,
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

  // Where playback LAST STARTED, in seconds — what `transport replay` returns to. Read off the
  // store's frames rather than recorded when this shell presses play, so a start from anywhere
  // (a key, the bar, another tab, the CLI) counts: while stopped, the playhead sits where a play
  // would begin, and the rising edge freezes that value. A raw subscription, not useEngineState —
  // frames arrive at 20 Hz and this must remember, not re-render.
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

  // The interface's inputs, asked for only while the builder is open on a module that HAS an input
  // to point somewhere. Nothing else in l8 needs the grouping: the IO panel meters the ports the
  // project already declares, where this is the list you pick a new one from.
  // Asked once per connection rather than while a particular screen is open: TWO surfaces want the
  // list now — the builder and the editor's channel strip — and an input is most often a node you
  // open in the editor. `connected` is the trigger and not just a guard: `engineRef` is a ref, so a
  // link coming up later re-renders nothing on its own and the ask would never be sent.
  const { devices: inputDevices, regroup: regroupInputs } = useInputDevices(
    engineRef.current ?? null,
    connected,
  );

  // The special views this PROJECT declares (`surfaces/`), and the engine as a desk sees it.
  // Both are cheap and unconditional: a project with no surfaces gets an empty list, and the
  // adapter is a memo over the link that is already there.
  const { surfaces } = useSurfaces(reloadKey);
  /**
   * The project's ARRANGEMENT, if it declares one: a `split` surface of type `timeline`.
   *
   * This is what puts the timeline on screen. A project that declares none opens on its graph,
   * and `surfaceIssues` says so beside its other diagnostics rather than leaving the absence to
   * be guessed at.
   *
   * The list arrives a moment after the shell, so this is false for a frame or two on open —
   * the same flash `mode` pays, and paid in the same place (docs/projectMode.md).
   */
  const timelineSurface = useMemo(
    () =>
      surfaces.find(
        (s) => s.surface.type === "timeline" && s.surface.layout === "split",
      ) ?? null,
    [surfaces],
  );
  const hasTimeline = !!timelineSurface;
  /**
   * The project's FRAME, if it declares one: a `split` surface of type `viewport`.
   *
   * The declaration and not the document is what mounts it, exactly as for the timeline — a
   * song whose picture has not been written yet still says it draws picture, and the pane says
   * which file to add rather than showing a black rectangle. The opposite case, lanes with no
   * viewport declared, is `surfaceIssues`' warning.
   */
  const viewportSurface = useMemo(
    () =>
      surfaces.find(
        (s) => s.surface.type === "viewport" && s.surface.layout === "split",
      ) ?? null,
    [surfaces],
  );
  const hasViewport = !!viewportSurface;
  // The song's picture — asked of every project, empty for most. The timeline draws its lanes
  // and the viewport composites them, so it is fetched ONCE here rather than by each.
  const { doc: videoDoc, error: videoError } = useVideoDoc(reloadKey);
  const videoTracks = videoDoc?.videoTracks ?? EMPTY_VIDEO_TRACKS;
  // Each picture clip ref → the media file it names, for the editor's readers strip. Flattened
  // here because only the COMPILER knows it: the ref names `clips/<ref>.yaml`, and reading that
  // to find the source is exactly what the picture compile did.
  const videoSources = useMemo(() => {
    const out: Record<string, string> = {};
    for (const t of videoTracks) for (const c of t.clips) out[c.id] = c.src;
    return out;
  }, [videoTracks]);

  /**
   * Apply a finished picture drag to the lane's own file.
   *
   * A SURGICAL text rewrite, not a re-serialisation: these files carry the comments that
   * document the format, and a round trip through the parser would delete every one of them.
   * `setVideoPlacementField` edits by REF, so a placement that moved in the file between render
   * and drop is still the one that was grabbed.
   *
   * Every edit of the gesture is applied to ONE buffer and written once. Trimming a head is two
   * fields (three on a length-0 shot) describing a single drag; writing them separately would be
   * two reads of the same file, the second built on the text before the first.
   *
   * Not a COMMAND, unlike every audio edit this shell makes: the CLI has no verb for a picture
   * placement. See apps/l8/frontend/docs/picture.md.
   */
  const applyVideoEdit = useCallback(
    async (trackId: string, edits: VideoEdit[]) => {
      const ap = ws?.activeProject ?? ".";
      const path = `${ap === "." ? "" : `${ap}/`}video_tracks/${trackId}.yaml`;
      try {
        const { content } = await api.read(path);
        let next = content;
        for (const e of edits)
          next = setVideoPlacementField(next, e.ref, e.field, e.value);
        if (next === content) return; // no such placement — nothing to write, nothing to say
        await api.write(path, next);
        bumpReload();
      } catch (err) {
        setStatus((err as Error).message);
      }
    },
    [ws?.activeProject, bumpReload, setStatus],
  );
  // The ones that ARE a screen of their own — the only kind the header can offer and the
  // `/surface/<id>` address can name. A `split` surface is in the layout already.
  const screenSurfaces = useMemo(
    () => surfaces.filter((s) => s.surface.layout === "view"),
    [surfaces],
  );
  const turntableDeck = useTurntableDeck({
    store,
    engineRef,
    engineReady,
    watchPluginParams,
    pluginParamsStore,
    engineUrl,
  });

  // The screen is mirrored in the URL both ways; these four setters are the only way it changes. See routes.ts.
  useViewRoute(
    { view, full, panel, help: showHelp, surface: openSurface },
    useCallback((next) => {
      setView(next.view);
      setFull(next.full);
      setPanel(next.panel);
      setShowHelp(next.help);
      setOpenSurface(next.surface);
    }, []),
    hasTimeline,
    hasViewport,
  );
  const openHelp = useCallback(() => setShowHelp(true), []);
  const closeHelp = useCallback(() => setShowHelp(false), []);

  // Any change of layout puts the popin away: it is a detour to one file, not a place to be —
  // and leaving it hanging over a view you deliberately switched to would be the worse surprise.
  // biome-ignore lint/correctness/useExhaustiveDependencies: the layout changing IS the signal.
  useEffect(() => {
    setEditorPopin(false);
  }, [full, view]);

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

  // The second pane of the current view, and the ring `tab` walks.
  //
  // The EDITOR is not in it. The default view is the timeline over the graph, full width; the
  // editor is reached deliberately (`ui editor`) or arrives as a popin when a command sends it
  // to a file. That is what `visible("editor")` reads to decide between the two — see
  // docs/shell.md.
  // The layout's own list, not "the timeline plus one": `live` has no timeline, and a ring that
  // still named it would hand the keys to a pane that is not drawn. It replaces `thirdPane`,
  // which could only ever name the pane UNDER the timeline and so had nothing to say about a
  // layout with no timeline in it. See `viewPanes` in routes.ts.
  const layout = useMemo(
    () => viewPanes(view, hasTimeline, hasViewport),
    [view, hasTimeline, hasViewport],
  );
  const ringPanes = layout.ring;

  // Read off the LAYOUT rather than off the project doc, and not only because the doc arrives a
  // frame later: everything below this asks "is there a timeline on screen", which is a question
  // about the view. The effect further down is the one place that turns the project into a view.
  const live = view === "live";
  // …and the arrangement's own half of that question, which is now the SURFACE's answer rather
  // than the view's: a `global` project that declares no timeline draws none either. Everything
  // that goes with an arrangement — the transport, the minimap, the pane it sits in — reads this.
  const noArrangement = live || !hasTimeline;

  // The popin IS the active pane while it is up: it is what the keys are for, and the pane
  // underneath must not also answer them.
  const activePane = editorPopin ? "editor" : (full ?? focusPane);
  const visible = useCallback(
    (p: Pane) => (full === null ? ringPanes.includes(p) : full === p),
    [full, ringPanes],
  );

  /**
   * Where the minimap goes — docked at the bottom of the shell, floating over a popin, or
   * nowhere at all. See docs/shell.md.
   *
   * It is a SECOND VIEW of the timeline, so while the timeline itself is on screen it shows
   * what is already there, in less detail, for a band of height the arrangement could have had.
   * It earns its place exactly when the timeline is hidden.
   *
   * The popin is the case the docked strip cannot serve: it covers the layout, so the minimap
   * has to come OVER it or not at all — and there it stops being a convenience, because a
   * screen with no visible timeline is one where you have lost the song. Which is why the
   * floating one carries a transport and the docked one does not.
   *
   * Only the editor popin, not the builder, the docs or the settings: those are PAGES that take
   * the whole window and are about something other than this song — the builder's own overlay
   * holds no engine link at all, so a transport over it would be a set of dead buttons.
   */
  /**
   * Is the chains pane off screen? ONE answer, read by the class that hides it and by the
   * `active` it is handed.
   *
   * They were two, and they disagreed the day expanded lanes started hiding the pane: the CSS
   * hid it while `active` still said yes, so ChainsTab went on believing it was on screen and
   * framed its camera against a canvas of zero size — a frame that silently does nothing.
   * Anything that takes this pane away has to say so in one place.
   */
  const chainsOffScreen =
    full === "timeline" ||
    (full === null && !ringPanes.includes("chains")) ||
    // Expanded lanes give the timeline the whole column — which can only happen in a layout that
    // HAS a timeline. In `live` the graph is the only pane, and nothing may take it away.
    (full === null && ringPanes.includes("timeline") && tlView.expanded);

  const timelineVisible = visible("timeline");
  // Never without an ARRANGEMENT, in either place. The minimap is a second view of one — it earns
  // its band precisely when the timeline is off screen and you would otherwise have lost the
  // song. A project with no arrangement has nothing for it to be a view of, and the rule above
  // ("the timeline is not visible") is exactly the condition that is permanently true there, so
  // without this it would be the one piece of the timeline that never left.
  const minimapFloating = docked && !noArrangement && editorPopin;
  const minimapDocked =
    docked && !noArrangement && !timelineVisible && !editorPopin;

  /**
   * How tall the floating strip is, so the popin can stop ABOVE it instead of over it.
   *
   * Measured rather than guessed: the minimap sizes itself to the track count (up to `MAX_H`),
   * so any constant here would be wrong for most songs — too small and the popin covers the
   * transport, too large and it floats over a gap.
   */
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

  /**
   * Give one pane the whole screen — the ONE road there, taken by the header buttons, the number
   * keys, `ui <pane>` and the mobile tabs alike.
   *
   * A layout that cannot fullscreen the pane refuses instead, which is what makes `live` hold:
   * its list is empty (`viewPanes`), so every one of those roads is closed at the same point
   * rather than at four. Refused out loud — a key that does nothing reads as a broken key.
   */
  const fullscreen = useCallback(
    (p: Pane) => {
      if (!layout.fullscreen.includes(p)) {
        setStatus(
          `this project is \`live\` — the graph has the whole screen, and there is no ${PANE_META[p].label.toLowerCase()} pane to expand.`,
        );
        return;
      }
      setFull(p);
      focusOn(p);
    },
    [focusOn, view],
  );

  const paneProps = (p: Pane) => ({
    onPointerDown: () => focusOn(p),
  });

  // Focus can be left on a pane the layout no longer shows — leaving `ui editor` returns to a
  // view the editor is not in, and `activePane` would then hand the keys to something off
  // screen while the timeline answered nothing. Snap it back to the ring.
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
    recInfo,
    docTracks,
    doc: projectDoc,
    mixerStrips,
    hasStrudel,
    mode,
    midiSeqRef,
  } = useProjectDoc(reloadKey, {
    // If the currently-armed track lost its sequence, disarm it.
    onMidiSeqs: (seqs) =>
      setMidiArmed((cur) => (cur && !seqs[cur] ? null : cur)),
  });

  /**
   * The layout FOLLOWS the project: a `live` folder has no arrangement, so it has no `global`.
   *
   * Derived and not chosen — there is no toggle for this anywhere in the shell, and the effect
   * runs on every doc load rather than once, so a project.yaml edited from `arrangement` to
   * `live` in the editor moves the screen on the next reload instead of after a refresh.
   *
   * `full` is cleared with it. A live layout fullscreens nothing (`viewPanes`), so a `full` left
   * over from the project that was open before would name a pane this one cannot draw.
   */
  const liveProject = mode === "live";
  useEffect(() => {
    setView(liveProject ? "live" : "global");
    setFull(null);
  }, [liveProject]);

  /**
   * The layout this PROJECT is entitled to — what "back to the view" means here.
   *
   * A ref, because the callbacks that reset the screen (opening a project, `ui global`, a command
   * that needs the graph slot) are `useCallback`s half the shell depends on being stable; making
   * them re-bind whenever the doc reloads would ripple through every key handler and every menu.
   * Those call sites used to write `"global"` literally, which was correct while it was the only
   * layout and would strand a live project in a screen it has not got now that it is not.
   */
  const baseViewRef = useRef<View>("global");
  baseViewRef.current = liveProject ? "live" : "global";

  // Mixer / graph edits run the same backend commands but must NOT bump reloadKey.
  const quietCommand = useCallback(
    async (line: string) => {
      pushLog("cmd", `› ${line}`);
      try {
        const { output } = await api.command(line);
        if (output.length) setStatus(output.join("  ·  "));
        for (const o of output) pushLog("info", o);
      } catch (e) {
        setStatus(`command error: ${(e as Error).message}`);
        pushLog("error", (e as Error).message);
      }
    },
    [pushLog],
  );

  // A ref because runCommand reads it and is itself a dependency of half the app: making it re-bind on every
  // reload would ripple through every key handler and every menu that names a command.
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
  });

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

  const openProject = useCallback(async (path: string) => {
    try {
      const w = await api.open(path);
      setWs(w);
      lastActive.current = w.activeProject;
      void api
        .project()
        .then(setProject)
        .catch(() => {});
      setReloadKey((k) => k + 1);
      setStatus(`opened ${path === "." ? w.root : path} — engine starting…`);
      setFull(null);
      // The layout the project that was open had — the doc effect above corrects it a moment
      // later, once THIS project's doc says which shape it is.
      setView(baseViewRef.current);
    } catch (e) {
      setStatus(`open error: ${(e as Error).message}`);
    }
  }, []);

  // The import (.dawproject) and delete-project dialog flows. Both are Radix dialogs, which
  // answer Escape themselves but let it go on propagating — so they register here too, or the
  // key that dismissed the dialog would also close the graph slot behind it. Not while BUSY:
  // an import in flight has nothing to cancel, and its dialog is a progress report.
  const imp = useProjectImport({ openProject, onStatus: setStatus });
  usePopin(!!imp.importPath && !imp.importing, imp.cancelImport);

  // Follow what happened under us: a project switch (another tab, the CLI), and a TAKE.
  useActiveProjectFollow({
    lastActiveRef: lastActive,
    /**
     * A recording landed. Two halves, and the bug was that neither happened on its own:
     * `setWs` carries the clip's name, which is what opens the review panel on it, and the
     * reload is what puts the clip on its lane — the placement was written by the file
     * service, so nothing in this tab knew the document had changed.
     *
     * It used to work by accident, and only one way: stopping with SPACE went through the
     * file service, whose reply bumped the reload for its own reasons. Stopping with the
     * header's button never showed the take at all.
     */
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

  // The caret's track used to follow into the Docs panel's context tab. Both are gone: a note
  // is a doc module in the graph, wired from what it is about, so there is no selection to
  // track and nothing for it to point at. See packages/song/docs/docModules.md.

  /**
   * Open a file in the editor pane, by path or by name.
   *
   * An exact project path opens as-is, anything else takes the best fuzzy match — which is
   * what lets `ui file <track>` be typed with a bare id. Returns the path it settled on.
   *
   * `reveal` brings the pane up and puts the keyboard in it: right for a typed command, whose
   * whole point was to go and read the file, and wrong for the timeline pointing the panes at
   * a track — there the hands are still on the arrangement.
   */
  const openInEditor = useCallback(
    (arg: string, reveal = true): string | null => {
      if (!arg) return null;
      const files = editorRef.current?.files() ?? [];
      const path = files.includes(arg)
        ? arg
        : (files
            .map((p) => ({ p, score: fuzzyScore(arg, p) }))
            .filter((x) => x.score >= 0)
            .sort((a, b) => b.score - a.score || a.p.localeCompare(b.p))[0]
            ?.p ?? arg);
      if (reveal) {
        // Off screen: bring it up as a POPIN rather than fullscreening the pane. A command that
        // sends the editor to a file asked for the FILE, not for the view to be rearranged — and
        // fullscreening it threw away the timeline or graph you were reading it against.
        if (!visible("editor")) setEditorPopin(true);
        else focusOn("editor");
      }
      editorRef.current?.open(path);
      return path;
    },
    [visible, focusOn],
  );

  // `runCommand` is defined below and calls THIS, so a local command that needs to run a real one
  // reaches it through a ref rather than closing over it.
  const runCommandRef = useRef<(line: string) => Promise<void>>(async () => {});
  // The palette's catalogue, for the one thing `runCommand` needs from it: which command a line
  // runs, so it can be remembered. A ref because the catalogue is built further down.
  const paletteRef = useRef<PaletteCommand[]>([]);

  /**
   * Which language the shell speaks. Taken HERE, above `runLocalCommand`, because `ui language`
   * is one of its lines — the palette reads the same value further down (the descriptions are
   * the only translated part of a command, its name being an identifier; see commandI18n.ts).
   */
  const { locale, locales, setLocale } = useLocale();
  // The two share entries that are not CLI verbs: the mixdown render and the k7 publish.
  const share = useShare(setStatus);

  /**
   * The footer's two graph toggles, each as ONE callback.
   *
   * The button and the command name the same thing, so they run the same function: a second
   * copy of "turn the mixer on, and clear whatever had taken the graph's place" is a copy that
   * will one day forget the second half.
   */
  const toggleMixer = useCallback(() => {
    if (mixerView) return setMixerView(false);
    if (mixerStrips.length === 0)
      return setStatus(
        "no strip in this song — a strip is a Mixer module at the end of a track",
      );
    // Turning it ON also clears whatever had taken the graph's place, or the rearranged graph
    // would be laid out behind a clip nobody asked to keep.
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

  /**
   * Arm MIDI learn on one param: the next control change from any attached controller binds to it.
   *
   * The capture is the browser's, the binding is a command — so what lands on disk goes through
   * `module cc` like every other edit, and a learn is exactly a `module cc` you did not have to
   * count the CC number for.
   *
   * A param may contain spaces ("Filter Freq"), so it is taken quoted or as the whole rest.
   */
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
          // "bidirectional when possible": possible means the device that just spoke also has an
          // output port to answer on. Said at bind time, because that is when you can still
          // choose a different control.
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
      // WHICH lines are `ui`'s is a table of its own (localCommands.ts), so a test can hold it
      // against the palette's catalogue — a row that lists and then does nothing is the one
      // failure neither half can notice alone.
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
        // The layout is the PROJECT's and not a choice, so in a live project this names a screen
        // it has not got. Say so — running it silently, or quietly landing on `live` instead,
        // would both leave someone believing they had switched.
        if (baseViewRef.current !== "global") {
          setStatus(
            "this project is `live` — it has no timeline, so there is no global view. Change `project_type` in project.yaml to arrange it.",
          );
          return true;
        }
        setView(line);
        setFull(null);
        return true;
      }
      if ((PANES as string[]).includes(line)) {
        // …and likewise for a pane this layout cannot fullscreen: in `live` the graph already has
        // the window, so `ui timeline` names a pane that is not drawn. `fullscreen` is left to
        // decide, since it is what the header buttons and the number keys go through too.
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
      // Close the topmost overlay — whoever registered it, this shell or a component of its
      // own. Handled either way: Esc only names this while one IS up, and a command typed at
      // the bar with nothing open has simply asked for something that is already true.
      if (line === "popin close") {
        closeTopPopin();
        return true;
      }
      // Put the graph back. The occupants' ✕ does exactly this — see GraphSlotPane.
      if (line === "slot close") {
        setGraphSlot(null);
        return true;
      }
      // The rack builder popin — the building is the browser's (drops, audition), so the
      // command only OPENS it; its create writes through the file routes like the tree's verbs.
      if (line === "module create rack") {
        setRackBuilder(true);
        return true;
      }
      // `project new` and `project delete` were answered here. Both are gone with the
      // workspace this app stopped showing: it is opened ON one project and lists no others,
      // so neither verb had anything left to name. st0 owns the repositories — see
      // packages/project-shell/docs/launch.md.
      if (line.startsWith("file ")) {
        openInEditor(s.slice(5).trim());
        return true;
      }
      if (line === "help") {
        if (window.location.hash === "#help") closeHelp();
        else openHelp();
        return true;
      }
      // The timeline owns its selection + zoom + loop + move; the shell only dispatches.
      if (line === "select") {
        timelineRef.current?.toggleSelect();
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
      if (line === "transport locate") {
        timelineRef.current?.seekToCaret();
        return true;
      }
      if (line === "transport loop") {
        timelineRef.current?.toggleLoop();
        return true;
      }
      // Toggle record over the wire. Reading the live snapshot keeps this out of the deps and always flips current.
      if (line === "transport record") {
        engineRef.current?.setRecordEnabled(!store.getSnapshot().recordEnabled);
        return true;
      }
      // Replay: the playhead returns to where playback last started, and rolls again — the
      // retrigger every DAW keeps under a shifted play. The memory is this shell's (see
      // replayAtRef): live transport state routes through the engine WebSocket, never a server.
      // Pressed mid-playback it jumps back and keeps rolling; `play` is not a toggle.
      if (line === "transport replay") {
        seek(replayAtRef.current);
        transport("play");
        return true;
      }
      /**
       * …and so do the four bare verbs, for the same reason and one more: LATENCY.
       *
       * They went to the file service, which sends the very message this socket sends — after an
       * HTTP round trip, after the undo journal walks the whole project twice (measured at 62 ms
       * warm and 215 ms cold on a real song), and behind whatever that single-threaded service was
       * already doing. A project compile is 1.5 s there, so a Space pressed while one was in
       * flight waited for it. That is the "sometimes a second" nobody could reproduce on demand:
       * the delay belonged to the queue, not to the transport.
       *
       * Nothing is lost by keeping them here. The verbs write no file, so there is nothing to
       * journal and nothing to reload — and the header's play button has always driven this same
       * socket directly, so this is the two paths agreeing rather than a new one.
       *
       * It FALLS THROUGH to the service in the two cases the socket cannot answer for: no
       * connection of our own, and an engine mid-apply — which this path DROPS rather than
       * queues (`useEngineLink`, and the reason is that a queue turned one press into three
       * plays and a rewind). Dropping is right for a button you can see is disabled and wrong
       * for a key whose whole promise is that it always works, so the key keeps the slow path
       * for exactly that window. Fast when it can be, honest when it cannot.
       */
      if (BARE_TRANSPORT.includes(line)) {
        if (!connected || engineBusyRef.current) return false;
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
      // `sequence edit roll|tracker <sequence>` — its notes where the graph is. Bare-named, not
      // under `ui`: that namespace promises a command touches no file, and these open an editor
      // that writes to the sequence they name, the way `event move` does to a placement.
      const seq = parseSeqEdit(s);
      if (seq) {
        const path = resolveSequence(
          seq.name,
          editorRef.current?.files() ?? [],
        );
        if (!seq.name) setStatus(`usage: sequence edit ${seq.view} <sequence>`);
        else if (!path) setStatus(`no sequence "${seq.name}" in this project`);
        else {
          // The chains slot is where it goes, so make sure the slot is on screen: a grid drawn
          // behind a fullscreened timeline is a command that reported success and did nothing.
          // The project's own layout, not `global` — in `live` the slot is already the screen.
          setFull(null);
          setView(baseViewRef.current);
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
      /**
       * ui review <clip> — reopen the take review on a clip: its waveform under the project's ruler,
       * its onsets as marks you add and refuse, and the button that brings it up to level.
       *
       * A `ui` command because it opens a VIEW and writes nothing; what the view then does is the
       * brain's (`clip normalize`, `clip onset …`). It exists because the automatic review is a
       * moment that passes — `lastTake` is the file service's memory and dies with the process, and
       * the ✓ ends it for good — so a take could become unreachable while its file sat on disk.
       *
       * The lane is looked up rather than asked for: a placement names the clip, so the project
       * already knows. A clip nothing places (an orphan take, which is exactly the case this is for)
       * reviews just the same, with no lane to show.
       */
      if (line.startsWith("review ")) {
        const clip = s.slice("review ".length).trim();
        if (!clip) {
          setStatus("usage: ui review <clip>");
          return true;
        }
        setReviewOn({ clip, track: trackPlacing(projectDoc, clip) });
        // …and put the clip panel on screen. It is the ONE place a clip is drawn now, so naming a
        // clip has to open it rather than hope it is already up.
        setGraphSlot({ kind: "recording" });
        return true;
      }
      // ui midi learn <module> <param> — arm the browser's Web MIDI on one param. The BINDING is
      // written by `module cc`, which is the brain's; what is local here is the listening.
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
      // `ui panel <graph|logs>`: the footer buttons' own toggle. Naming the panel already up
      // closes it — which is why `ui close` stays a command of its own and not a spelling of this.
      if (line.startsWith("panel ")) {
        const want = line.slice("panel ".length).trim();
        const names = Object.keys(PANEL_META) as Panel[];
        if (!names.includes(want as Panel))
          setStatus(`usage: ui panel <${names.join("|")}>`);
        else togglePanel(want as Panel);
        return true;
      }
      // `ui surface <id>`: the screens this PROJECT declares (`surfaces/`, `layout: view`), which
      // is why the list cannot be a fixed one. Naming the open one closes it, as its button does.
      if (line.startsWith("surface ")) {
        const arg = s.slice("surface ".length).trim();
        const hit = screenSurfaces.find((x) => x.id === arg);
        if (!hit)
          setStatus(
            screenSurfaces.length
              ? `no surface "${arg}" — this project declares ${screenSurfaces
                  .map((x) => x.id)
                  .join(", ")}`
              : "this project declares no surface of its own — see surfaces/",
          );
        else setOpenSurface((cur) => (cur === hit.id ? null : hit.id));
        return true;
      }
      // `ui builder <module>`: the shared builder over the shell, on the MODULE file of the trio
      // — the same screen a module row in the tree opens.
      if (line.startsWith("builder ")) {
        const arg = s.slice("builder ".length).trim();
        const path = resolveModuleFile(arg, editorRef.current?.files() ?? []);
        if (!path) setStatus(`no module "${arg}" in this project`);
        else setBuilder({ path, pane: "module" });
        return true;
      }

      // --- the cog menu --------------------------------------------------------
      if (
        line === "settings editor" ||
        line === "settings io" ||
        line === "settings commands"
      ) {
        setSettingsScreen(
          line === "settings io"
            ? "io"
            : line === "settings commands"
              ? "commands"
              : "editor",
        );
        return true;
      }
      // The one control ON the editor settings screen. A global user preference, so it outlives
      // the project — which is why it is `ui` and not a project verb.
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
      // Reload after logout: AuthGate is outermost, so a fresh load lands on sign-in (and
      // pagehide frees the engine).
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
      // `ui copy path <path>` — the tree's own entry, and the only one that leaves the app: what
      // it puts on the clipboard is the workspace-relative path every route and command takes.
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
      // Each of these calls the SAME callback the menu item runs (see EditorHandle), so the two
      // ways in cannot come to mean different things — including the confirm a delete asks for.
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
      // Opens the OS picker. `folder` asks for a whole directory, which a browser draws as a
      // different dialog and so needs a different input — see FileTree.
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
      // Ctrl+Z / Ctrl+Y as commands: the project-wide journal, which wraps every command that
      // wrote (@studio/project-shell/undo). The EDITOR's own buffer history stays with the keys —
      // a command bar is not where a keystroke is taken back.
      if (line === "project undo" || line === "project redo") {
        void (line === "project redo"
          ? runRedo(historyDeps)
          : runUndo(historyDeps));
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
      // …and whether that socket is up, which decides whether the bare transport verbs are
      // answered here or handed to the service. Stale, this would send Space to the server for
      // ever — the flag is false on the first render of every session.
      connected,
      setFull,
      setView,
      toggleMixer,
      toggleDocs,
      clearLogs,
      togglePanel,
      screenSurfaces,
      onChangeEngine,
      onQuitWorkspace,
      toggleVim,
      locales,
      setLocale,
      historyDeps,
      share,
    ],
  );

  // A `freezing` state and its modal overlay were here. Freezing is gone with the field it wrote
  // — see packages/song/docs/trackModules.md.
  // The arrow a module is being created on, while the command RUNS — not while the user is still typing the
  // name into the bar. pendingInsert.current is set at pick time and lives until the splice; this is the
  // narrower window the canvas should draw a placeholder for.
  const [insertingAt, setInsertingAt] = useState<PendingInsert | null>(null);
  // The graph a writing command handed back. The canvas draws it instead of fetching, which takes
  // a round trip and a ~400 ms re-parse of what the service just parsed — see the `/command` route
  // and ChainsTab's `seedGraph`.
  //
  // Carries an id rather than a reload key: half a dozen things bump that key (a poll, a save, the
  // undo journal), so pairing them would mean keeping a counter in step with all of them. An id the
  // consumer takes ONCE says the only thing that matters — this graph is newer than what you have,
  // and nobody has drawn it yet.
  const seedId = useRef(0);
  const [seedGraph, setSeedGraph] = useState<{
    id: number;
    graph: WebGraph;
  } | null>(null);
  // Every command — typed or bound to a key — comes through here.
  const runCommand = useCallback(
    async (line: string) => {
      if (!line.trim()) return;
      pushLog("cmd", `› ${line.trim()}`);
      const s = canonicalizeCommand(line);
      // Here rather than in the bar, because this is where EVERY command passes: the palette,
      // a key binding, a context menu. What you reach for by shortcut is still what you reach
      // for, and the palette should offer it first when you do come looking. Through a ref, so
      // this callback does not have to be rebuilt every time the catalogue is.
      rememberCommand(commandNameOf(s, paletteRef.current));
      if (runLocalCommand(s)) return;
      // CONSUMED, not just read: the pick arms this and only the command that follows it is an
      // insert. Left armed — which it was — every later command drew a pending node on that same
      // stale arrow, so the spinner people saw belonged to the transport key they pressed
      // afterwards rather than to the module they had added.
      const willInsert = pendingInsert.current;
      pendingInsert.current = null;
      if (willInsert) setInsertingAt(willInsert);
      // …and where the node that line is about to create should GO. Consumed the same way and
      // for the same reason: it belongs to THIS line and to no later one.
      const wire = pendingWire.current;
      pendingWire.current = null;
      const madeRef = wire ? chainRefFromCreate(s) : null;
      // …and the module that line's node needs, when the pick came from a catalogue. Ahead of
      // it rather than after, since `node new` refuses a module that is not there yet.
      const ensure = madeRef ? pendingModule.current : null;
      pendingModule.current = null;
      try {
        if (ensure) await api.command(ensure);
        const { output, graph } = await api.command(s);
        setStatus(output.length ? output.join("  ·  ") : `ran: ${s}`);
        for (const o of output) pushLog("info", o);
        // The graph the service built while we waited, present only when the command changed
        // something. Handed to the canvas so it draws this instead of fetching and re-parsing what
        // the service has just parsed — see ChainsTab's `seedGraph`.
        if (graph) {
          seedId.current += 1;
          setSeedGraph({ id: seedId.current, graph });
        }
        setReloadKey((k) => k + 1);
        // The picker's second half: the module exists now, so put the node it made where the
        // click was. Its own command — journalled, undoable and typeable like any other — which
        // is the price of verbs that do one thing each.
        // …and null when there is nothing left to do: on the bare canvas `node new` has
        // already placed it, and with no click point the layout decides.
        const after =
          madeRef && wire ? wireCommand(madeRef, wire.at, wire.spawn) : null;
        if (after) await runCommandRef.current(after);
        // The repo verbs move the badge, the view AND the workspace — a pull can add projects.
        // Here rather than in the share menu, because the palette and a key run them too.
        if (/^project (commit|pull|alternative)\b/.test(s)) onRepoChanged();
        // The one reorganizing verb: the graph hosts drop their held positions with the
        // same reload that drops the pins, or "reorganize" would visibly do nothing.
        if (s === "graph organize") setOrganizeKey((k) => k + 1);
      } catch (e) {
        setStatus(`command error: ${(e as Error).message}`);
        pushLog("error", (e as Error).message);
      } finally {
        // The placeholder comes down in the same update that carries the new graph, so the two
        // swap in one frame. That is what changed: the reply used to be the START of the wait —
        // the canvas then spent a fetch and a 400 ms parse still showing the old picture, with
        // the spinner already gone — and now it is the end of it.
        if (willInsert) setInsertingAt(null);
      }
    },
    [pushLog, runLocalCommand, onRepoChanged],
  );
  runCommandRef.current = runCommand;

  // --- following a track across the panes ------------------------------------------
  //
  // A double-click on a timeline header says "this one" to the whole shell: the editor opens
  // the row's file and the chains canvas frames what it feeds. Selecting the row is the
  // timeline's own business — the caret — and happens on the single click that precedes this.
  //
  // The nonce is what makes the SAME track twice re-frame: the chains canvas applies a focus
  // once, and without a changing value a second double-click would be indistinguishable from
  // the first and do nothing after the camera had been panned away.
  const [graphFocus, setGraphFocus] = useState<{
    id: string;
    nonce: number;
  } | null>(null);
  const focusNonce = useRef(0);
  // What the status line said about the file, so the canvas's answer can be added to it rather
  // than replace it: the two halves of one action arrive a render apart.
  const focusLine = useRef("");
  const focusRowInPanes = useCallback(
    (target: RowTarget) => {
      // Named, not fuzzy-matched: a row knows which folder its file is in, and the score a
      // bare id would win is the one `clips/<id>.yaml` wins too. See projectPaths.
      // `nodes/`, because that is where a lane lives: it is a node of a
      // `@studio/…-track` module (packages/song/docs/trackModules.md).
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
      // …and the lane's modules, side by side, OVER the graph. The framing above still happens:
      // closing this row leaves the graph already framed on the track it was about, which is
      // where you would have wanted to be anyway.
      if (target.kind === "track")
        setGraphSlot({ kind: "trackModules", trackId: target.id });
    },
    [openInEditor],
  );
  // The canvas reports what the framing found; a track wired to nothing has to say so, or the
  // graph merely looking unchanged reads as the double-click having missed.
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
  const prewriteCommand = useCallback(
    (text: string) => {
      // Docked, the bar is already mounted: write into it. The deferral below exists only for
      // the popin, which cannot be prewritten before it has rendered.
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
  /**
   * A pick from the right-click menu.
   *
   * The bar is a form for COLLECTING arguments. An entry the click already answered in full has
   * none left to collect, so opening the bar over it would ask a question with no blanks in it
   * and wait for an Enter that could only mean yes. Those run.
   *
   * It is not a confirm step, and was never doing that job: nothing here asks twice, and what a
   * command changed is undone by Ctrl+Z like any other (the journal wraps every command). What
   * still opens the bar is exactly what still needs typing.
   */
  const pickMenuItem = useCallback(
    (item: MenuItem) => {
      if (item.complete) void runCommandRef.current(item.command);
      else prewriteCommand(item.command);
    },
    [prewriteCommand],
  );
  // The catalogue in a ref: the menu reads it at open time, and threading it as a dependency
  // would rebuild every pane's onContextMenu the moment the commands land.
  const cmdCatalogue = useRef<CommandInfo[]>([]);
  cmdCatalogue.current = backendCmds;
  // …and the prefs beside it, for the same reason: the handler below has empty deps, so reading
  // the state directly would pin whatever it was on the first render.
  const cmdPrefs = useRef<CommandPrefs>({});
  cmdPrefs.current = commandPrefs;
  const openContextMenu = useCallback((ctx: MenuCtx, x: number, y: number) => {
    // A module the ENGINE provides has no file anywhere, and the `@engine/` prefix is exactly what says so:
    // the namespace is the catalogue's own and nothing on disk declares it. Derived here rather than carried
    // as a flag through the graph doc, the graph model and the renderer — four files for one menu entry is a
    // worse trade than one string test at the point of use.
    const full: MenuCtx =
      ctx.kind === "module" && ctx.id.startsWith("@engine/")
        ? { ...ctx, ambient: true }
        : ctx;
    const items = contextMenu(full, cmdCatalogue.current, cmdPrefs.current);
    if (items.length) setMenu({ items, x, y });
  }, []);
  /**
   * The ⋮ bubble on a node: what it can be, and what it can be replaced BY — its module's
   * other attribute SETS, and its freeze.
   *
   * The same ContextMenu the right-click uses, and the same `MenuItem` shape, so switching runs
   * on the spot while the two that need a name arrive in the command bar half-typed — that split
   * is what `complete` already means, and reusing it means this menu inherits the outside-click
   * close, the positioning and the undo journal for nothing.
   *
   * See packages/song/docs/alternatives.md and packages/song/docs/freeze.md.
   */
  const openNodeMenu = useCallback(
    (
      n: {
        module?: string;
        alternatives?: string[];
        alternative?: string;
        frozen?: "at" | "inside";
      },
      at: { x: number; y: number },
    ) => {
      const module = n.module;
      if (!module) return;
      const names = n.alternatives ?? [];
      const current = n.alternative ?? "1";
      const items: MenuItem[] = [
        // A dot marks the one that is on. The module's own fields are "1" and are listed like
        // any other — they ARE an alternative, and hiding them would leave no way back to them.
        ...names.map((name) => ({
          label: `${name === current ? "• " : "  "}${name === "1" ? "1 (its own settings)" : name}`,
          command: `node alternative select ${module} ${name}`,
          complete: true,
          verb: "node alternative select",
        })),
        {
          label: "New alternative…",
          command: `node alternative create ${module} `,
          complete: false,
          verb: "node alternative create",
        },
        {
          label: "Copy this one…",
          command: `node alternative copy ${module} `,
          complete: false,
          verb: "node alternative copy",
        },
        // Freeze. One entry, and it runs on the click: the command is a toggle, and which way it
        // will go is exactly what the label says. A node INSIDE somebody else's render is offered
        // none — thawing it means thawing the point downstream of it, and an entry here would
        // name the wrong module. The command refuses that case too; this only stops it being
        // offered. See packages/song/docs/freeze.md.
        ...(n.frozen === "inside"
          ? []
          : [
              {
                label:
                  n.frozen === "at"
                    ? "Unfreeze"
                    : "Freeze (bake everything upstream)",
                command: `node freeze ${module}`,
                complete: true,
                verb: "node freeze",
              },
            ]),
      ];
      setMenu({ items, x: at.x, y: at.y });
    },
    [],
  );
  // A `+` click asks WHICH module before writing anything; picking pre-writes a command. See docs/shell.md.
  const pendingInsert = useRef<PendingInsert | null>(null);
  // Where the node a CREATING line is about to make should be wired: an arrow, or nowhere (the
  // bare canvas), plus the world point the click happened at. See onModulePick.
  const pendingWire = useRef<{
    at: PendingInsert | null;
    spawn: { x: number; y: number } | null;
  } | null>(null);
  // …and the `module new` that has to run BEFORE that line, for a pick with no local folder yet.
  // Null for a module of this project, which is the common case and stays one command.
  const pendingModule = useRef<string | null>(null);
  // "which file?" — a filepicker widget's asset browser. The popup is viewport-positioned,
  // so the shell renders it, exactly as it does the `+`'s module picker below.
  const [assetPicker, setAssetPicker] = useState<{
    module: string;
    param: string;
    x: number;
    y: number;
    files: string[];
  } | null>(null);
  /**
   * Find the open project's node of the module the builder just opened, and watch its plugin.
   *
   * Read from the compiled graph rather than kept in state, the same way `browseAssets` reads its
   * choices: the chains can have changed since the last look, and this runs once per builder open.
   * `watchPluginParams` is what makes the values LIVE — without it the engine reports a plugin's
   * set once and never again, so a knob turned in the graph would leave the builder showing the
   * number it happened to see first.
   */
  useEffect(() => {
    if (!builder) return void setBuilderPlugin(null);
    // The key a chain would write, which is everything between the type folder and the file —
    // `amps/neural-amp-modeler`, not `neural-amp-modeler`. Shared with the loader that files it
    // (`@studio/song/moduleTypes`), because a lookup that spelled it differently would report
    // "this project has no such module" about a module plainly in the tree.
    //
    // A LIBRARY module is named with its namespace instead — `@st0/audio/amps/nam` — since
    // that is what a chain writes for a module the project inherits rather than holds. Same
    // lookup, one spelling apart, and getting it wrong here is what would make the Libraries tab
    // a text editor: no ref, no plugin, no real parameters.
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

  // …and once one is found, ask for it and keep it coming. Its own effect so the unwatch is
  // paired with the watch: leaving the builder open on a module for an hour must not leave a
  // subscription behind on a plugin nothing is drawing.
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
      // The choices are the MODULE's own assets/ and its ancestors', carried on its node — a
      // thin local module extending a médiathèque amp offers that amp's profiles. Re-read from
      // the graph rather than kept in state, so a file dropped on the module since the last look
      // is offered. Filtering to the param's extension is the picker's own job.
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
  // `info` is the arrow the pick will splice into — NULL when the picker was opened on
  // empty canvas, where there is no arrow and the module lands wired to nothing.
  const [modulePicker, setModulePicker] = useState<{
    info: { before: string; after: string } | null;
    x: number;
    y: number;
    // The click's WORLD point — where the picked module will be BORN (`at` on the create
    // verbs), so a new node never asks the layout where to appear.
    at?: { x: number; y: number };
  } | null>(null);
  // Offer the click into the pre-written line's `at` field — deferred a tick, because
  // prewrite has only just SET the bar's command state and a same-tick offer reads the old.
  const offerSpawnAt = useCallback((at?: { x: number; y: number }) => {
    if (!at) return;
    const v = `${Math.max(0, Math.round(at.x))},${Math.max(0, Math.round(at.y))}`;
    setTimeout(() => cmdRef.current?.offer({ at: v }, true), 0);
  }, []);
  // The picker's vocabulary, PREFETCHED. It used to be fetched on the click, which put a full /hints — the
  // tracks, the clips, the plugin scan, the path map — between pressing `+` and seeing a list of modules. The
  // catalogue barely moves, so it is fetched once and refreshed when the project changes.
  // The CATALOGUE, not a list of refs. An engine module's ref is flat (`@engine/adt`), so
  // the only thing that says an ADT is an audio effect is the module itself — the picker
  // groups by that, and a ref alone stopped being enough to file one.
  const [baseModules, setBaseModules] = useState<PickerModule[]>([]);
  useEffect(() => {
    let alive = true;
    void Promise.all([api.moduleCatalogue(), api.baseModules()])
      .then(([cat, refs]) => {
        if (!alive) return;
        // The project's OWN modules come from the ref list — they are not catalogue
        // entries, and the picker needs them to know one already exists to instantiate.
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

  // Opening the picker awaits nothing now. With no vocabulary yet — the very first frames, or a failed
  // fetch — pre-write the command instead, which is what a picker with nothing to show was always worth.
  const insertIntoChain = useCallback(
    (
      info: { before: string; after: string },
      x: number,
      y: number,
      at?: { x: number; y: number },
    ) => {
      if (!baseModules.length) {
        prewriteCommand(`node insert ${info.before} ${info.after} `);
        offerSpawnAt(at);
        return;
      }
      setModulePicker({ info, x, y, at });
    },
    [baseModules, prewriteCommand, offerSpawnAt],
  );
  // Right-click on empty canvas: the same picker, but the pick has nowhere to be spliced.
  const placeInGraph = useCallback(
    (x: number, y: number, at?: { x: number; y: number }) => {
      if (!baseModules.length) {
        // No catalogue to pick from: the person names what to create, and `node new`
        // puts it in the graph itself.
        prewriteCommand("node new ");
        offerSpawnAt(at);
        return;
      }
      setModulePicker({ info: null, x, y, at });
    },
    [baseModules, prewriteCommand, offerSpawnAt],
  );
  const onModulePick = useCallback(
    (pick: ModulePick) => {
      if (!modulePicker) return;
      setModulePicker(null);
      const { info, at } = modulePicker;
      /**
       * TWO lines, and the split is the vocabulary's: what the pick needs is a module (created,
       * or noded if it is already there) and then that node WIRED — an arrow to splice into, or
       * the bare canvas. `node insert` used to do both from a `<category>/<name>`, which is
       * what made it indistinguishable from the verb that only spliced.
       *
       * Only this first line reaches the bar, because only the node name is missing and only a
       * person can supply it. The second is the shell's, run against whatever name they typed —
       * see `chainRefFromCreate` in nodeInsert.ts, which reads it back off the line.
       */
      pendingWire.current = { at: info, spawn: at ?? null };
      pendingInsert.current = info; // the ghost on the arrow, while the commands run
      const ref = pick.namespace === null ? undefined : pick.ref;
      // A catalogue pick has no local folder, and `node new` instances a module that exists —
      // so its `module new` runs ahead of the line the person is about to complete.
      pendingModule.current = ensureModuleCommand(pick.type, pick.name, ref);
      prewriteCommand(createForGraphCommand(pick.type, pick.name));
    },
    [modulePicker, prewriteCommand],
  );

  // What the caret is currently over, for the conditional bindings (keys.ts).
  const conditions = useMemo<ConditionCtx>(() => {
    const cond: ConditionCtx = {};
    cond.focus_pane = focusPane;
    cond.current_view = view;
    // The two layers Esc backs out of before it touches the layout. `popin` counts every
    // registered overlay, not just this shell's own: one that closes ITSELF still has to
    // shadow the slot, or one Escape would close two things. See popins.ts.
    if (anyPopin) cond.popin = "1";
    if (graphSlot) cond.graph_slot = "1";
    if (full) cond.fullscreen = "1";
    if (caret?.trackId) cond.caret_track = caret.trackId;
    if (tlView.selecting) cond.timeline_selection = "1";
    if (tlView.zoomed) cond.timeline_zoomed = "1";
    if (tlView.loop) cond.timeline_loop = "1";
    if (editTarget?.kind === "seq")
      cond.hover_midi_sequence = fileStem(editTarget.path);
    else if (editTarget?.kind === "clip") {
      if (editTarget.clip.type === "midi")
        cond.hover_midi_sequence = editTarget.clip.name;
      else cond.hover_audio_clip = editTarget.clip.name;
    }
    return cond;
  }, [anyPopin, caret, editTarget, graphSlot, tlView, focusPane, full, view]);

  // Global keys. Every binding names a command and runs through runCommand.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // A settings screen or the builder owns the surface: the panes these bindings would act
      // on are hidden behind it, and Esc must not reach past it to close the slot underneath.
      if (settingsScreen || builder) return;
      const el = e.target as HTMLElement | null;
      // Two different reasons to stand aside, and only one of them holds for Space.
      //
      // TYPING — a field or a code editor — owns every key it is given, Space included; that is
      // what makes it a text editor. Nothing here may touch it.
      //
      // A CONTROL with focus (a button, a link, a select) is a different case: it keeps the keys
      // the platform gives it, but two of them come back here.
      //
      // Space, because it has to be the transport wherever the last click landed — a button
      // reached by pointer keeps focus, and "Space plays" failing because you had just clicked
      // Mute is the bug this rule exists to kill. Escape, because a focused button does nothing
      // with it at all, and Esc's first job is now to close the overlay that button is sitting
      // in. Enter still activates the button, so a control tabbed to is still reachable from the
      // keyboard. Every other key still belongs to the control — `blurOnClick` (keys.ts) is what
      // hands those back after a mouse click.
      const typing =
        !!el &&
        (el.tagName === "INPUT" ||
          el.tagName === "TEXTAREA" ||
          el.isContentEditable);
      if (typing) return;
      const control =
        !!el &&
        (el.tagName === "BUTTON" ||
          el.tagName === "A" ||
          el.tagName === "SELECT");
      if (control) {
        // What comes back from a focused control is the TRANSPORT's keys — wherever the person
        // has put them, so a remapped play key keeps the promise Space's default had — plus
        // Escape. Enter stays the control's even though its default is transport rewind: it
        // activates the button, which is what keeps a Tab-focused control operable.
        const t = keyToken(e);
        const passes =
          t === "esc" ||
          (t !== null &&
            t !== "enter" &&
            !!effKeys[t]?.startsWith("transport "));
        if (!passes) return;
      }
      // The command bar: two lone Shift presses within DOUBLE_SHIFT_MS, `e.repeat` filtering a held Shift.
      // Docked, it FOCUSES the bar that is already there; on the phone it still opens the popin.
      // (Never the other way: this branch is unreachable from inside the bar, which is an input.)
      if (
        e.key === "Shift" &&
        !e.ctrlKey &&
        !e.metaKey &&
        !e.altKey &&
        !e.repeat
      ) {
        const now = e.timeStamp;
        if (now - lastShiftAt.current <= DOUBLE_SHIFT_MS) {
          lastShiftAt.current = 0;
          if (docked) cmdRef.current?.focus();
          else
            setPaletteOpen((o) => {
              if (!o) pendingPrewrite.current = null;
              return !o;
            });
        } else {
          lastShiftAt.current = now;
        }
        return;
      }
      lastShiftAt.current = 0;
      const token = keyToken(e);
      if (!token) return;
      // Through the person's own keymap: their assignments and steals first, the app's
      // conditional bindings (esc, f, m…) as the fallback — see keys.ts's resolveToken.
      const command = resolveToken(token, conditions, effKeys);
      if (!command) return;
      e.preventDefault();
      void runCommand(command);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [builder, conditions, docked, effKeys, runCommand, settingsScreen]);

  // Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y — the project-wide undo/redo journal. Captured (not the
  // bubble handler above) so it runs BEFORE CodeMirror's own keymap: while the focused editor
  // still has keystroke history to spend, that wins and we drive it directly; once it's spent
  // (or focus is elsewhere) the same key walks the journal instead. See project-shell/undo.ts.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (settingsScreen || undoConfirm) return; // don't stack a second confirm
      if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
      const key = e.key.toLowerCase();
      if (key !== "z" && key !== "y") return;
      const isRedo = key === "y" || (key === "z" && e.shiftKey);
      const h = editorRef.current;
      if (h?.editorFocused()) {
        // Spend the buffer's own keystroke history first; once it's empty, fall through to
        // the project journal (the arbitration the user chose).
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
  }, [historyDeps, settingsScreen, undoConfirm]);

  // The global view has no mobile form, so entering mobile lands on a pane — the timeline, being
  // the one that says what a song is. A LIVE project is skipped entirely: it fullscreens nothing
  // because its single pane already fills the phone, and forcing `full` there would put the
  // layout in a state `viewPanes` says cannot exist.
  useEffect(() => {
    const [first] = layout.fullscreen;
    if (isMobile && full === null && first) setFull("timeline");
  }, [isMobile, full, view]);

  const waitingForEngine = !!ws?.activeProject && !engineReady;

  // The take's start, taken on the edge `rolling` goes true. `recInfo.tempo` converts the store's
  // seconds; the snapshot is READ, never subscribed to — see where `takeStart` is declared.
  useEffect(() => {
    if (!rolling) return;
    setTakeStart((store.getSnapshot().playhead * recInfo.tempo) / 60);
  }, [rolling, store, recInfo.tempo]);

  /**
   * The take to review: the one ASKED for, else the newest the file service has written.
   *
   * The automatic half is the take you just played, until this tab dismisses it — and never while a
   * take is ROLLING, since the band owns that slot and the clip being reviewed would be the previous
   * one. But it is not enough on its own: `lastTake` lives in the file service's memory and is lost
   * whenever that process restarts, and dismissing it is final. So `ui review <clip>` names one
   * outright, which survives both and reaches a take from three days ago (see docs/shell.md).
   *
   * The named one wins, and it is not subject to the rolling guard: asking for a clip by name is a
   * deliberate act, not something that appeared while you were playing.
   */
  const reviewTake =
    reviewOn ??
    (ws?.lastTake &&
    ws.lastTake.clip !== reviewedTake &&
    !(recordEnabled && playing)
      ? ws.lastTake
      : null);

  /**
   * The takes the reviewed lane holds — the panel's sidebar, when a recording left a choice.
   *
   * Recomputed off the project doc, so it follows every swap: `runCommand` bumps the reload key,
   * the doc comes back, and the row marked "on the track" is the one that just moved there.
   */
  const reviewTakes = useMemo(
    () => takeOptions(projectDoc, reviewTake?.track ?? ""),
    [projectDoc, reviewTake?.track],
  );
  /**
   * Listen to another take: it goes ON the track, and what was there becomes that take.
   *
   * A swap rather than a preview, because the point is to hear the pass IN the song — with the
   * rest of the band — and only what the lane plays reaches the engine. Nothing is lost by it
   * (packages/song/docs/takes.md), so this is an audition that happens to be an edit, and one
   * Ctrl+Z away like every other command. The playhead goes to where the take starts, so the
   * sidebar's ▶ means "hear this one from its beginning".
   */
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

  // Everything that makes the transport unable to answer, as one flag — because to whoever is reaching for Play
  // the two causes are the same fact, and the button has to say so either way.
  //
  // `engineBusy` alone used to be enough, back when the browser's own apply was the one that built every plugin.
  // The file service now PREWARMS the engine on /workspace, before the socket is even open, so that work (~1.3 s
  // on a real song) finishes unwatched and the browser's apply is a diff — measured at 207 ms, a flash that reads
  // as no spinner at all. What is left to wait for on a first load is the first state frame, which is exactly
  // what `waitingForEngine` means.
  const transportWaiting = engineBusy || waitingForEngine;

  // The step-by-step palette's command catalogue and per-argument completion. `locale` is taken
  // once, above `runLocalCommand`, since `ui language` writes it.
  // The locale is a dependency: each command's description is resolved once, when the
  // catalogue is built, so switching language rebuilds the list the palette matches on.
  const paletteCommands = useMemo(
    () => buildPaletteCommands(backendCmds, locale),
    [backendCmds, locale],
  );
  /**
   * The catalogue AS THIS PERSON ARRANGED IT — renamed and reordered (commandPrefs.ts).
   *
   * Applied here, once, over the palette's built list: the palette is the one surface that lists
   * every command, so ordering it anywhere else would leave the settings page describing an order
   * nothing obeyed. `label` replaces the sentence the palette matches on, which is deliberate —
   * someone who renamed a command should find it by the name they gave it.
   */
  const allCommands = useMemo(
    () =>
      orderCommands(paletteCommands, commandPrefs).map((c) => ({
        ...c,
        readable: labelOf(c, commandPrefs),
      })),
    [paletteCommands, commandPrefs],
  );
  paletteRef.current = allCommands;
  // Four getters, not one: the shell's own commands ask for vocabularies only the shell holds —
  // what the editor can open, every path the tree draws, this project's surfaces, the languages.
  const listArg = useMemo(
    () =>
      makeListArg({
        files: () => editorRef.current?.files() ?? [],
        entries: () => editorRef.current?.entries() ?? [],
        surfaces: () => screenSurfaces.map((s) => s.id),
        locales: () => [...locales],
      }),
    [screenSurfaces, locales],
  );

  return (
    <EngineStoreProvider value={store}>
      <div className="relative flex h-full flex-col bg-background text-foreground">
        <header
          className={cn(
            "flex items-center border-b border-border px-3",
            // Every row of chrome is a row the panes don't get, and a phone in landscape is ~400px tall.
            isMobile ? "gap-2 py-1" : "gap-3 py-2",
          )}
        >
          {/* left: title + project. flex-1 so the transport, in its own flex-1-flanked
              centre section, sits at the true horizontal middle of the header. */}
          <div className="flex min-w-0 flex-1 items-center gap-3">
            <span className="font-semibold">l8</span>
            <span className="text-xs tabular-nums text-muted-foreground">
              {VERSION}
            </span>
            <span className="max-w-[10rem] truncate text-sm text-muted-foreground">
              {project?.name ?? "…"}
            </span>
            {/* The alternatives of the workspace repo, right after the title: which
                version of the song you are on is part of what you are looking at. */}
            <AlternativePicker
              reloadKey={reloadKey}
              onSwitch={(name) =>
                void runCommand(`project alternative switch ${name}`)
              }
            />
            {ws && !ws.activeProject && (
              <span className="truncate rounded bg-amber-500/15 px-2 py-0.5 text-xs text-amber-500">
                workspace — pick a project ▶ in Editor
              </span>
            )}
          </div>

          {/* centre: transport — play/pause, stop, the clock, then record.
              Each drops focus on click (blurOnClick): these are the buttons a mouse is
              most likely to land on right before reaching for Space, and a focused one
              eats the keypress. On play/pause the theft is invisible (the button does
              what Space would); on stop and record it is not.

              Absent wherever there is no ARRANGEMENT — a `live` project, or one that simply
              declares no timeline surface. Every control here addresses a position in an
              arrangement — a playhead to move, a take to punch in — and a project with no
              timeline has none: the clock would count bars nothing is written against and
              record would arm a lane with nowhere to put a take. Sound still reaches the
              engine, played by what is wired in the graph. See docs/surfaces.md. */}
          {!noArrangement && (
            <div className="flex shrink-0 items-center gap-1">
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
                  transport("rewind");
                  blurOnClick(e);
                }}
                title={m["transport.stop"]()}
              >
                <Square className="h-4 w-4" />
              </Button>
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
            </div>
          )}

          {/* right: view toggles + menus, balancing the left so the centre stays centred */}
          <div className="flex min-w-0 flex-1 items-center justify-end gap-1">
            {/* On a phone the whole right side collapses into one button: the view
                toggles are gone (there is no studio view), the pane buttons became the
                bottom tab bar, and what remains — sharing, settings, the metronome, the
                bottom panels — is menu material rather than a row of icons. */}
            {isMobile ? (
              <MobileMenu open={mobileMenu} onOpenChange={setMobileMenu}>
                {/* What is left of the header's right side once the view toggles are
                    gone (no studio view on a phone) and the pane buttons have become the
                    tab bar. The metronome and the panel toggles are NOT here: they live
                    in the footer, and a second copy would be one more thing to keep in
                    step for no gain. */}
                <div className="flex items-center gap-1">
                  <ShareMenu
                    gitStatus={gitStatus}
                    busy={share.busy}
                    onRun={(c) => void runCommand(c)}
                  />
                  <SettingsMenu onRun={(c) => void runCommand(c)} />
                </div>
              </MobileMenu>
            ) : (
              <>
                {/* Pane buttons, and no VIEW toggles beside them: there is one layout to
                    CHOOSE, and a toggle that is always on and cannot be turned off is a control
                    in name only. `live` is not one either — it is what the project IS, not a
                    layout you pick.

                    The row is drawn from the LAYOUT's fullscreenable set, not from PANES: in
                    `live` that set is empty and the nav disappears with it, because its one pane
                    already has the window and every button would either do nothing or hide the
                    only thing on screen. */}
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
                          void runCommand(`ui ${full === p ? view : p}`)
                        }
                        title={
                          full === p
                            ? `${PANE_META[p].label} — back to the ${VIEW_META[view].label} view (esc)`
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
                {/* One button per SCREEN surface the project declares, after the panes and before
                    the menus. They are not panes — the list is the project's, not the shell's
                    (see routes.ts) — so they get their own group rather than joining the row
                    above. Nothing is drawn for a project with no `surfaces/` folder.

                    `split` surfaces are left out on purpose: one is already on screen, in the
                    layout, and a button that "opened" it would name a screen there is none of.
                    The pane row above is where the arrangement is reached. */}
                {screenSurfaces.length > 0 && (
                  <nav className="flex items-center gap-1">
                    {screenSurfaces.map((s) => (
                      <Button
                        key={s.id}
                        size="icon"
                        variant={openSurface === s.id ? "default" : "ghost"}
                        aria-pressed={openSurface === s.id}
                        onClick={() => void runCommand(`ui surface ${s.id}`)}
                        title={
                          openSurface === s.id
                            ? `${s.id} — revenir à la vue`
                            : `${s.id} (${s.surface.type})`
                        }
                        aria-label={s.id}
                      >
                        <Disc3 className="h-4 w-4" />
                      </Button>
                    ))}
                  </nav>
                )}
                <div className="mx-1 h-5 w-px bg-border" />
                <ShareMenu
                  gitStatus={gitStatus}
                  busy={share.busy}
                  onRun={(c) => void runCommand(c)}
                />
                <SettingsMenu onRun={(c) => void runCommand(c)} />
              </>
            )}
          </div>
        </header>

        {/* main: the panes on top, an optional bottom split panel below */}
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="flex min-h-0 flex-1">
            {/* The popin's backdrop. Dismisses on a click outside, which is the reliable way out:
                Escape belongs to the editor (vim leaves insert mode with it) and must not also
                close the thing you are typing in. */}
            {editorPopin && (
              <div
                className="fixed inset-0 z-40 bg-black/40"
                onPointerDown={() => setEditorPopin(false)}
              />
            )}
            {/* The rack builder — a popin of its own: a 4×4 pad grid that ends in a
                modules/instruments/<name> on disk. Opened by `module create rack`. */}
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
                // The SAME element in the same place in the tree, restyled — so the open file,
                // its undo history and the CodeMirror node survive being popped out.
                //
                // It has no slot in either layout any more: fullscreened, popped in, or away.
                editorPopin
                  ? "fixed inset-4 z-50 overflow-hidden rounded-lg border border-border bg-background shadow-2xl sm:inset-x-[12%] sm:inset-y-[8%]"
                  : full === "editor"
                    ? "flex-1"
                    : "hidden",
                ringFor("editor"),
              )}
              // Stop above the floating minimap rather than over it. Inline, because it is a
              // measurement — see `stripH`; the class above sets the other three edges.
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
                // Only when it owns the screen. Not in the popin: that is one file, opened by a
                // command that already named it.
                showTree={full === "editor"}
                popin={editorPopin}
                reloadKey={reloadKey}
                activeProject={ws?.activeProject ?? null}
                projectName={project?.name ?? null}
                vimMode={vimMode}
                onOpenProject={openProject}
                onImportProject={imp.askImport}
                onChanged={bumpReload}
                setStatus={setStatus}
                onEditTarget={setEditTarget}
                onOpenItem={setOpenItem}
                onOpenBuilder={(path, pane) => setBuilder({ path, pane })}
                // The same builder, over the médiathèque and locked. On the PANEL like a
                // project module, and read-only until the dialog says otherwise.
                onOpenLibraryModule={(path) =>
                  setBuilder({ path, pane: "panel" })
                }
                diagnostics={diagnostics}
                videoSources={videoSources}
                // The channel strip an `io: in` file gets under its text — the surface that
                // actually opens when somebody clicks an IN node.
                inputDevices={inputDevices}
                onRegroupInputs={connected ? regroupInputs : undefined}
              />
            </div>

            <div
              className={cn(
                "flex min-h-0 min-w-0 flex-1 flex-col",
                full === "editor" && "hidden",
              )}
            >
              {/* The FRAME, on the same terms as the arrangement below it: a `split` surface the
                  project declares (`surfaces/`, `type: viewport`), mounted for as long as it
                  does. Mounted is the load-bearing word here — it owns a WebGL context and one
                  <video> per layer, and a pane that unmounted when you looked elsewhere would
                  flush a decoder every time. Hidden, never unmounted, exactly like the rest.
                  See packages/song/docs/surfaces.md. */}
              {hasViewport && (
                <div
                  {...paneProps("viewport")}
                  className={cn(
                    "flex min-h-0 min-w-0",
                    full === "viewport"
                      ? "flex-1"
                      : full !== null
                        ? "hidden"
                        : // Expanded lanes have asked for the height; the frame stands down for
                          // them as the graph does, rather than squeezing three panes into one.
                          tlView.expanded
                          ? "hidden"
                          : "h-1/3 shrink-0 border-b border-border",
                    ringFor("viewport"),
                  )}
                >
                  <ViewportTab doc={videoDoc} error={videoError} />
                </div>
              )}
              {/* The ARRANGEMENT, and only when the project asks for one: it is a `split` surface
                  now (`surfaces/`, `type: timeline`), not a pane the shell hands out. Absent
                  means not mounted — there is no caret to keep for a screen the project has not
                  declared, which is the one case the "no layout unmounts a pane" invariant was
                  never about. See packages/song/docs/surfaces.md. */}
              {hasTimeline && (
                <div
                  {...paneProps("timeline")}
                  className={cn(
                    "flex min-h-0 min-w-0",
                    // Off screen for good in a LIVE project, and still MOUNTED — the invariant in
                    // docs/shell.md is that no layout unmounts a pane, so its caret and zoom stack
                    // survive a project.yaml edited back to `arrangement` without a reload.
                    live
                      ? "hidden"
                      : // Expanded lanes take the whole height, exactly as `full timeline` does: the
                        // pane below has stood down for them — see where `tlView.expanded` is read.
                        full === "timeline" ||
                          (full === null && tlView.expanded)
                        ? "flex-1"
                        : full === "chains"
                          ? "hidden"
                          : "h-1/2 shrink-0 border-b border-border",
                    ringFor("timeline"),
                  )}
                >
                  <TimelineTab
                    ref={timelineRef}
                    active={activePane === "timeline"}
                    reloadKey={reloadKey}
                    // …so an armed lane draws the take as it is played, instead of being the one
                    // place that shows nothing while you record.
                    rolling={rolling}
                    takeStartBeat={takeStart}
                    // The pre-roll, in beats: the growing clip skips it, because those bars
                    // record nothing and the placement that lands on Stop does not cover them.
                    takeCountInBeats={recInfo.countIn * recInfo.beatsPerBar}
                    orbit={orbit}
                    videoTracks={videoTracks}
                    onVideoEdit={applyVideoEdit}
                    setStatus={setStatus}
                    onEditTarget={setEditTarget}
                    // A clicked clip shows its content where the graph is — the waveform for
                    // audio, the piano roll for a sequence. It also makes the slot visible, since
                    // a view drawn behind a fullscreened timeline is a click that did nothing.
                    onOpenClip={(t) => {
                      setFull(null);
                      setView(baseViewRef.current);
                      setGraphSlot({ kind: "clip", target: t });
                    }}
                    // …and the bare lane puts the graph back. Symmetric on purpose: what a click
                    // opened, a click on nothing closes, rather than leaving a clip parked in the
                    // slot until you find its ✕.
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
                    onResizeEvent={(trackId, fromTc, startTc, endTc) =>
                      void runCommand(
                        `event resize ${trackId} ${fromTc} ${startTc} ${endTc}`,
                      )
                    }
                    // While the bar is filling `event move`, the drag ANSWERS it instead of
                    // committing: same gesture, same numbers, but the line is yours to run. The
                    // param names are the command's own — see commands.yaml.
                    // Any command whose open field wants a timecode: the ruler is a timecode
                    // picker, and it does not need to know which command asked.
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
                    // …and the selection rectangle answers `events move` the same way: its
                    // region fills tracks/from/to, leaving only the delta to type.
                    feedEventsMove={
                      barPending?.canonical === "events move"
                        ? (tracks, from, to) =>
                            cmdRef.current?.offer({ tracks, from, to })
                        : undefined
                    }
                    onFocusRow={focusRowInPanes}
                    trackControls={trackControls}
                    onTrackToggle={onTrackToggle}
                    laneNodes={laneNodes}
                    // The lane's ⋮ menu, opened from the gutter badge — the SAME one the chains
                    // pane opens on a lane's node, since a lane IS that module.
                    onNodeMenu={openNodeMenu}
                  />
                </div>
              )}
              <div
                {...paneProps("chains")}
                className={cn(
                  "flex min-h-0 min-w-0",
                  // With no arrangement it is the only pane in the column, so it takes it
                  // outright — the same `flex-1` a fullscreened graph gets, reached without
                  // `full` being set (a live layout fullscreens nothing; see `viewPanes`).
                  noArrangement || full === "chains"
                    ? "flex-1"
                    : chainsOffScreen
                      ? "hidden"
                      : "h-1/2 shrink-0",
                  ringFor("chains"),
                )}
              >
                {/* Whatever the slot holds takes the graph's PLACE, not its mount: ChainsTab is
                    hidden beside it, exactly as it is when the pane is off screen. It holds the
                    MIDI runtime the whole shell reaches for (`ui midi learn`, see docs/midi.md),
                    and unmounting it here would take that away for as long as the slot was busy.
                    `active` false is what already stops it drawing. */}
                <div
                  className={cn(
                    "flex min-h-0 min-w-0 flex-1",
                    graphSlot && "hidden",
                  )}
                >
                  <ChainsTab
                    reloadKey={reloadKey}
                    organizeKey={organizeKey}
                    active={!chainsOffScreen && !graphSlot}
                    // The sidebar is fullscreen chrome (ChainsTab's own rule): it belongs wherever
                    // the graph has the window rather than half of it. A project with no
                    // arrangement is that case permanently, and it is also where the list matters
                    // most — with no timeline, picking a chain is the only navigation there is.
                    showList={noArrangement || full === "chains"}
                    trackOrder={trackOrder}
                    project={projectDoc}
                    command={quietCommand}
                    onBypassModule={(mod) =>
                      void runCommand(`node bypass ${mod}`)
                    }
                    onNodeMenu={openNodeMenu}
                    engineWarnings={engineWarnings}
                    onAssetBrowse={browseAssets}
                    onWatchWaveform={watchWaveform}
                    onSetModuleAsset={(mod, kind, f) =>
                      void runCommand(`module ${kind} ${mod} ${f}`)
                    }
                    onContextMenu={openContextMenu}
                    onEdgeInsert={insertIntoChain}
                    onCanvasInsert={placeInGraph}
                    // The patch cable's landing runs the verb outright: both ends were
                    // clicked, so there is nothing left for the bar to ask. Its two
                    // siblings likewise — a lifted cable dropped on the canvas deletes
                    // its arrow, landed on another jack it moves one end.
                    onConnect={(from, to) =>
                      void runCommand(`graph chain connect ${from} ${to}`)
                    }
                    onDisconnect={(from, to) =>
                      void runCommand(`graph chain disconnect ${from} ${to}`)
                    }
                    onReplug={(from, to, nf, nt) =>
                      void runCommand(
                        `graph chain replug ${from} ${to} ${nf} ${nt}`,
                      )
                    }
                    // A dropped header likewise: the drag already said everything.
                    onMoveNode={(mod, x, y) =>
                      void runCommand(`graph move ${mod} ${x} ${y}`)
                    }
                    pendingInsert={insertingAt}
                    seedGraph={seedGraph}
                    // The NOTES: whether the graph draws them, and how many it has to draw —
                    // the count travels up because the button is in the footer and the graph
                    // is fetched here. See where `showDocs` is declared.
                    showDocs={showDocs}
                    onDocCount={setDocCount}
                    onLaneNodes={setLaneNodes}
                    pluginParamsStore={pluginParamsStore}
                    requestPluginParams={requestPluginParams}
                    watchPluginParams={watchPluginParams}
                    setPluginParam={setPluginParam}
                    trackControls={trackControls}
                    onTrackToggle={onTrackToggle}
                    onTrackSet={onTrackSet}
                    focus={graphFocus}
                    onFocused={reportFramed}
                    // The mixer view, which is a rank change on this same graph — see mixerView.
                    alignModules={mixerView ? mixerStrips : undefined}
                    // The sockets a live input can be on — the same list the editor's strip uses.
                    inputDevices={inputDevices}
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
                {/* A clicked clip's content. `ClipView` draws its own header and ✕ — the same
                    component the Editor bottom panel shows, so audio and MIDI are told apart in
                    one place and the two surfaces cannot come to disagree about a clip. */}
                {graphSlot?.kind === "clip" && (
                  <ClipView
                    target={graphSlot.target}
                    onClose={() => setGraphSlot(null)}
                    // The slot's target is a snapshot from the click; this is what lets the
                    // open clip re-read itself after every command's reload.
                    reloadKey={reloadKey}
                    // A click on the editor's arrangement ruler is the timeline's seek.
                    onSeek={seek}
                    // The TRACKER view writes its sequence file directly rather than through a
                    // command, so the reload it needs is asked for here — the same pair
                    // `SeqGridPane` takes for the same grid.
                    onChanged={bumpReload}
                    setStatus={setStatus}
                    // An AUDIO clip opens the clip panel, whose onsets, trim and normalise are
                    // command lines like everything else here.
                    command={runCommand}
                    // The roll's velocity drag, committed the way the timeline's clip drag is: one
                    // command on release, and the reload it ends in brings the new value back.
                    onSetVelocity={(seqId, key, start, vel) =>
                      void runCommand(
                        `sequence note velocity ${seqId} ${key} ${start} ${vel}`,
                      )
                    }
                    // …and the note drag, the same way: one command on release, exactly as the
                    // timeline's clip drag runs `event move`. Move and stretch are one verb,
                    // because on the roll they are one gesture with two grips.
                    onSetNoteRange={(seqId, key, start, ns, ne) =>
                      void runCommand(
                        `sequence note timerange ${seqId} ${key} ${start} ${ns} ${ne}`,
                      )
                    }
                  />
                )}
                {/* One lane's whole signal path, read left to right. `moduleRow` lays it out —
                    the same function the mixer row used before it became a rank of the graph
                    itself, and the same cards the graph draws. */}
                {graphSlot?.kind === "trackModules" && (
                  <TrackModulesPane
                    trackId={graphSlot.trackId}
                    reloadKey={reloadKey}
                    command={quietCommand}
                    trackOrder={trackOrder}
                    pluginParamsStore={pluginParamsStore}
                    requestPluginParams={requestPluginParams}
                    watchPluginParams={watchPluginParams}
                    setPluginParam={setPluginParam}
                    trackControls={trackControls}
                    onContextMenu={openContextMenu}
                    engineWarnings={engineWarnings}
                    onClose={() => setGraphSlot(null)}
                  />
                )}
                {/* The clip. ONE panel for a take and for the file it becomes: while it rolls it
                    draws the envelope the engine is pushing, and the moment the recorder closes
                    the file it draws that file, with its onsets and its level. `rolling` chooses
                    the picture rather than mounting the panel — it outlives the take, and closing
                    is the ×, not the Stop. */}
                {graphSlot?.kind === "recording" && (
                  <AudioClipPanel
                    clip={rolling ? null : (reviewTake?.clip ?? null)}
                    track={reviewTake?.track ?? ""}
                    rolling={rolling}
                    tempo={recInfo.tempo}
                    beatsPerBar={recInfo.beatsPerBar}
                    countIn={recInfo.countIn}
                    startBeat={takeStart}
                    // Where the clip on screen actually SITS on its lane. The take that just
                    // landed sits where the transport rolled — but one picked out of the sidebar
                    // sits wherever it was recorded, so the ruler asks the document rather than
                    // assuming the last take's start.
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
                    reloadKey={reloadKey}
                    organizeKey={organizeKey}
                    trackId={caret?.trackId ?? null}
                    trackOrder={trackOrder}
                    project={projectDoc}
                    command={quietCommand}
                    onBypassModule={(mod) =>
                      void runCommand(`node bypass ${mod}`)
                    }
                    onNodeMenu={openNodeMenu}
                    engineWarnings={engineWarnings}
                    onContextMenu={openContextMenu}
                    pluginParamsStore={pluginParamsStore}
                    setPluginParam={setPluginParam}
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

        {/* The take, once it has stopped: the FILE this time — its waveform under the project's
            ruler, the onsets you add or refuse, the threshold that finds them, and the button that
            brings it up to level. Kept when the recording view became a pane: the pane is the live
            monitor and outlives the take, this is the editing step on what landed on disk, and
            neither does the other's work. They do both appear at once after a take — see
            docs/shell.md. */}

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
            <span className="truncate">{status || project?.root}</span>
            {/* The play button spins for this too — it is the control being blocked, and the one you are reaching
                for when it matters. This line stays because it NAMES what is being waited for, which a spinner on
                a button cannot. engineBusy gets no line of its own: same meaning, and it is usually too brief to
                read. */}
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

          {/* How good this engine link is — Q1/Q2/Q3 off the measured latency. In the status
              bar because it is a property of the SESSION, not of a screen: it decides what you
              can do here (see @studio/web-protocol/quality), and it is the same line the
              médiathèque shows. */}
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
            <Button
              size="icon-xs"
              variant={metronomeOn ? "default" : "ghost"}
              aria-pressed={metronomeOn}
              onClick={() => void runCommand("transport metronome")}
              title={m["transport.metronome"]()}
              aria-label={m["transport.metronome"]()}
            >
              <MetronomeIcon className="h-3.5 w-3.5" />
            </Button>
            <span className="h-4 w-px shrink-0 bg-border" aria-hidden="true" />
            <nav className="flex items-center gap-1">
              {/* The mixer, beside the panel buttons but not one of them: it REARRANGES the graph,
                  pulling every strip onto one evenly spaced rank. Same place in the row, so the
                  hand that knew where the Mixer button was still finds it.

                  DEAD when the song has no strip, and saying so rather than answering a click with
                  nothing: a strip is a module of plugin type `Mixer` at the end of a track, and a
                  song can perfectly well have none — most of the examples here do. That silence is
                  what the bottom panel used to break with a line of text, and dropping the panel
                  dropped the only thing that explained an empty mixer. */}
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
              {/* The notes, beside the mixer and for the same kind of reason: it changes what the
                  GRAPH shows rather than opening a panel of its own.

                  OFF by default. A note is wired into the chain it is about, so drawing every one
                  of them all the time would put prose in the middle of the signal path you are
                  trying to read — which is the failure the old bottom panel had from the other
                  side, where the notes were somewhere you had to go and look. This is the
                  in-between: they are in the graph, and you say when.

                  DEAD when the project has none, like the mixer button above: a click that
                  toggles nothing on a project with no notes explains nothing. */}
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

        {/* The bottom of the window: the minimap — the whole arrangement at a glance, click to
            move the playhead — and the command bar under it, full width.

            Desktop only, both for the same reason: they are a second view of the timeline and a
            permanent prompt, and the vertical band they cost is the one thing a phone has least
            of. The phone gets the tab bar below instead, and the bar as a popin it opens.

            The bar is DOCKED rather than summoned: it is where you type, so it is always there,
            the way a terminal's prompt is. It never autofocuses — a shell that opened with the
            keyboard captured could not be typed into — so double-Shift focuses it and Escape
            hands the keys back. See docs/commandBar.md.

            The minimap comes and goes with `minimapDocked` — see where it is computed. */}
        {docked && (
          <>
            {minimapDocked && (
              <Minimap
                reloadKey={reloadKey}
                orbit={orbit}
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
              />
            </div>
          </>
        )}

        {/* The minimap again, over the popin that hid the timeline — the full width of the
            window at its very bottom, with a mini transport above it.

            FULL WIDTH and not a centred card, because the minimap maps the whole song to the
            width it is given: narrow it and the arrangement is squeezed into a strip less
            legible than the one it stands in for, and the two views of the same song no longer
            agree about where a bar is.

            It does not overlap the popin. The popin's bottom is pushed up by `stripH` above —
            they share the bottom of the screen rather than fighting for it, which is why this
            can be a plain bar with no shadow or rounding: nothing floats over anything.

            Last in the tree on purpose: it shares the popin panel's z-50, so painting order is
            what puts it in front. It sits outside the backdrop, so scrubbing it does not read as
            the click-outside that dismisses the popin. */}
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

        {/* The tab bar takes the minimap's place — one tab per pane, plus the command
            bar's opener (a phone has no double-Shift to summon it with).

            The tabs come from the LAYOUT's fullscreenable set, so a live project shows none: its
            one pane is already the whole phone, and a tab that is always on and cannot be turned
            off is the control the header's view toggles were deleted for being. The BAR still
            renders — its opener is the only way to a command bar on a phone, and taking that
            away would leave a live project with a graph and no way to wire it. */}
        {isMobile && (
          <MobileTabBar
            tabs={layout.fullscreen.map((pn) => ({
              id: pn,
              icon: PANE_META[pn].icon,
              label: PANE_META[pn].label,
            }))}
            current={full}
            onSelect={(pn) => void runCommand(pn)}
            onOpenCommandBar={() => setPaletteOpen(true)}
          />
        )}

        {/* The PHONE's command bar, which has to be summoned — opened by the tab bar's button
            and by the right-click menus, which prewrite a command into it. Its suggestion list
            opens upward — see CommandBar.

            Still not modal, and that is the whole point: no backdrop, and `pointer-events-none`
            on the strip so only the bar itself takes clicks. What is behind stays visible and
            live, because reaching into it is how a param gets filled — Escape is the way out,
            not a click on the dimmer. See docs/commandBar.md. */}
        {!docked && paletteOpen && (
          <div className="pointer-events-none fixed inset-x-0 bottom-0 z-50 flex justify-center pb-4">
            {/* A click anywhere on the bar is a click on its field. Without this, landing on
                the padding or the `❯` blurs the input — which now also takes the completion
                list with it, for a gesture that was aimed at the bar. */}
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
            onClose={() => setMenu(null)}
          />
        )}

        {/* "which file?" — a module widget's library browser: the same popup as the `+`,
            because both are a nested catalogue you either browse or search. */}
        {assetPicker && (
          <AssetPicker
            x={assetPicker.x}
            y={assetPicker.y}
            param={assetPicker.param}
            files={assetPicker.files}
            onPick={(file) => {
              const { module, param } = assetPicker;
              setAssetPicker(null);
              // A file-valued param is a param: `node param <node> nam <file>`. It used to be a
              // verb per param (`module nam …`), which this line built from the param's own name
              // — so picking an `.onnx` sent a command nobody had written. "" is a real choice,
              // clearing the asset; the command spells that `none`.
              void runCommand(
                `node param ${module} ${param} ${file || "none"}`,
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

        {/* The documentation, at #help. A PAGE, not a popin: it takes the whole window
            (fixed, over the shell's chrome too) so the reference reads as a document —
            its own table of contents, one scrollable body you can ctrl-F end to end. */}
        {showHelp && (
          <div className="fixed inset-0 z-50 bg-background">
            <HelpPage onBack={closeHelp} prefs={commandPrefs} />
          </div>
        )}

        {/* Every SCREEN surface the project declares, mounted for as long as it is open — and
            drawing only the one whose id is in the address.

            Mounted, not conditional. A desk holds a DOCUMENT — the loaded songs, the crossfader,
            the six EQ knobs, the compiled project — and a set does not stop existing because you
            went to look at the graph. Behind `openSurface &&`, a round trip would re-centre the
            crossfader and flatten the EQ while the sound stayed where you put it. `SurfaceTab`
            owns that split: hooks above the line, screen below it.
            See packages/ui-turntables/docs/deckSet.md. */}
        {screenSurfaces.map((s) => (
          <SurfaceTab
            key={s.id}
            surface={s}
            deck={turntableDeck}
            project={ws?.activeProject ?? "."}
            open={openSurface === s.id}
            onClose={() => setOpenSurface(null)}
          />
        ))}
        {/* A deep link naming a surface this project has not got — `fromLocation` deliberately
            does not check the id, since the list arrives a moment after the shell. A `split`
            surface lands here too: it is drawn in the layout and has no screen to open, so
            naming it in the address is the same miss as naming a file that is not there. */}
        {openSurface && !screenSurfaces.some((s) => s.id === openSurface) && (
          <div className="fixed inset-0 z-50 flex flex-col bg-background">
            <div className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-1.5">
              <Disc3 className="h-4 w-4 text-muted-foreground" />
              <span className="truncate text-sm">{openSurface}</span>
              <Button
                size="xs"
                variant="secondary"
                className="ml-auto"
                onClick={() => setOpenSurface(null)}
              >
                Fermer
              </Button>
            </div>
            <div className="flex flex-1 items-center justify-center p-8 text-center text-sm text-muted-foreground">
              Aucune surface « {openSurface} » dans ce projet — cherchez un
              fichier <code className="mx-1">surfaces/{openSurface}.yaml</code>.
            </div>
          </div>
        )}

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

        {/* Settings screens (cog menu) — an OVERLAY covering the shell, not a view. I/O is
            the exception: a dialog over the shell, because you read it while plugging
            something in and want it gone in one key. */}
        {settingsScreen === "io" && (
          <IoPanel
            engine={engineRef.current ?? null}
            onClose={() => setSettingsScreen(null)}
          />
        )}
        {settingsScreen === "commands" && (
          <div className="absolute inset-0 z-40 bg-background">
            <CommandsSettings
              // The whole catalogue, both halves: the shell's own `ui …` lines and the backend's.
              // A page that arranged only one of them would order a menu it does not draw.
              commands={allCommands}
              prefs={commandPrefs}
              onChange={saveCommandPrefs}
              onBack={() => setSettingsScreen(null)}
            />
          </div>
        )}
        {settingsScreen === "editor" && (
          <div className="absolute inset-0 z-40 bg-background">
            <EditorSettingsPage
              vimMode={vimMode}
              onToggleVim={() => void runCommand("ui vim")}
              onBack={() => setSettingsScreen(null)}
            />
          </div>
        )}

        {/* The shared module builder (@studio/ui-module-builder), over the whole shell. The module's OWN
            presets come off its shelf through the store and work here; the plugin's FACTORY banks and its
            live parameter list need an engine, and this overlay holds no engine link, so it offers neither. */}
        {builder && (
          <div className="absolute inset-0 z-30 bg-background">
            <ModuleBuilder
              // ONE store. The libraries are a submodule inside the workspace now, so a shared
              // module is an ordinary workspace path the file service already serves — there is
              // no second path space to keep apart, and no second client to keep in step.
              store={moduleStore}
              path={builder.path}
              kind="module"
              moduleName={builder.path.split("/").slice(-2)[0] ?? builder.path}
              paramRef={null}
              vimMode={vimMode}
              initialPane={builder.pane}
              // A shared module opens LOCKED. Everyone's copy is this one — there is no fork
              // here to absorb a mistake — so writing to it is a thing somebody decides, in the
              // dialog below, rather than a thing that starts happening while they read.
              readOnly={isLibraryPath(builder.path) && !builder.unlocked}
              onRequestEdit={
                isLibraryPath(builder.path) && !builder.unlocked
                  ? () => setEditShared(builder.path)
                  : undefined
              }
              onBack={() => setBuilder(null)}
              onSaved={bumpReload}
              setStatus={setStatus}
              // What the plugin calls its parameters, and what each spans — so a widget adopts the
              // real range instead of the 0..1 a hand-typed binding falls back to.
              //
              // Both off `pluginParamMeta`, which is ordinary React state and therefore re-renders
              // this when the engine answers. NOT off `pluginParamsStore`: that is an external
              // store rewritten by the 20 Hz feed, and reading it during render would give whatever
              // it held on the first frame — empty — and never update. The two carry the same names
              // anyway; the meta is the half that also carries the ranges.
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
              // The sockets an `io: in` module can listen on. Empty with no engine attached, which
              // is the honest answer: which inputs exist is the sound card's to say.
              inputDevices={inputDevices}
              // …and the one act that changes that list: pair two inputs into a stereo device, or
              // split them apart. Only offered with an engine attached, which is what does it.
              onRegroupInputs={connected ? regroupInputs : undefined}
              presets={
                (builderPlugin && presets[builderPlugin.module]) ||
                EMPTY_PRESETS
              }
              onListPresets={() =>
                builderPlugin && listPresets(builderPlugin.module)
              }
              // The builder passes its own module name; the engine resolves BOTH ends to the same
              // live plugin, so which of the two is sent does not matter — take the builder's.
              onSetPreset={(module, sel) => setPreset(module, sel)}
              // A save into `_modules` forked: follow the copy, or the next save would fork again.
              onRelocated={(next) => {
                setBuilder({ path: next, pane: "module" });
                editorRef.current?.open(next);
              }}
              // The module drawn as the card it will be in a chain, under the grid that shapes it.
              // The builder owns the box; the graph needs OUR glyphs and OUR command line, which a
              // shared package cannot invent — hence a slot rather than an import.
              //
              // Its knobs are LIVE when a plugin was found: the store and the setter go in
              // together, because a knob that moves without changing anything is worse than one
              // that does not move.
              renderPreview={({ ui, params }) => (
                <ModulePreview
                  icons={STUDIO_ICONS}
                  command={runCommand}
                  name={builder.path.split("/").slice(-2)[0] ?? builder.path}
                  path={builder.path}
                  ui={ui}
                  params={params}
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
      </div>
    </EngineStoreProvider>
  );
}
