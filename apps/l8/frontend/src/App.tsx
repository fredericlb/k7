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
import type { PresetInfo } from "@studio/engine-protocol";
import { showToast, Toaster } from "@studio/project-shell/toast";
import { type HistoryDeps, runRedo, runUndo } from "@studio/project-shell/undo";
// The leaf with no `node:fs` in it — a browser may ask what a path names without dragging the
// loader in behind it.
import { moduleKeyFromPath } from "@studio/song/moduleTypes";
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
import { api, moduleStore } from "./api";
import { STUDIO_ICONS } from "./chainsIcons";
import { canonicalizeCommand } from "./commandI18n";
import { AlternativePicker } from "./components/AlternativePicker";
import { AssetPicker } from "./components/AssetPicker";
import { ChainsTab } from "./components/ChainsTab";
import { ClipView, type EditTarget } from "./components/ClipView";
import {
  CommandBar,
  type CommandBarHandle,
  type CommandPending,
  type PaletteCommand,
} from "./components/CommandBar";
import { ContextMenu } from "./components/ContextMenu";
import { DeleteProjectDialog } from "./components/DeleteProjectDialog";
import { EditorSettingsPage } from "./components/EditorSettingsPage";
import { type EditorHandle, EditorTab } from "./components/EditorTab";
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
import { RecordingPane } from "./components/RecordingPane";
import { SeqGridPane } from "./components/SeqGridPane";
import { SettingsMenu, type SettingsScreen } from "./components/SettingsMenu";
import { ShareMenu } from "./components/ShareMenu";
import { SurfaceTab } from "./components/SurfaceTab";
import { TakeReview } from "./components/TakeReview";
import { type TimelineHandle, TimelineTab } from "./components/TimelineTab";
import { TrackModulesPane } from "./components/TrackModulesPane";
import { contextMenu, type MenuCtx, type MenuItem } from "./contextMenu";
import { fuzzyScore } from "./fuzzy";
import { useEngineLink } from "./hooks/useEngineLink";
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
import { useProjectDelete, useProjectImport } from "./hooks/useProjectDialogs";
import { useProjectDoc } from "./hooks/useProjectDoc";
import { useSurfaces } from "./hooks/useSurfaces";
import { useTrackControls } from "./hooks/useTrackControls";
import { useTurntableDeck } from "./hooks/useTurntableDeck";
import { useLocale } from "./i18n";
import {
  blurOnClick,
  type ConditionCtx,
  KEYS,
  keyForCommand,
  keyToken,
  resolveBinding,
} from "./keys";
import {
  moduleInsertCommand,
  modulePlaceCommand,
  type PendingInsert,
} from "./moduleInsert";
import { buildPaletteCommands, commandNameOf, makeListArg } from "./palette";
import { m } from "./paraglide/messages.js";
import { closeTopPopin, useAnyPopin, usePopin } from "./popins";
import { entityFile, fileStem } from "./projectPaths";
import { rememberCommand } from "./recentCommands";
import { type Pane, type Panel, VIEW_PANES, type View } from "./routes";
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
import type {
  CommandInfo,
  ProjectInfo,
  WebGraph,
  WorkspaceInfo,
} from "./types";
import { useIsMobile } from "./useIsMobile";
import { useViewRoute } from "./useViewRoute";

// Build stamp baked in by the Dockerfile; "dev" anywhere it wasn't set.
const VERSION = import.meta.env.VITE_APP_VERSION ?? "dev";

/** One frozen empty list, so a builder with no live plugin does not get a new array per render. */
const EMPTY_PRESETS: PresetInfo[] = [];

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
  } | null>(null);
  /**
   * The LIVE plugin behind the module the builder is open on, when the open project has one.
   *
   * This is what makes the builder more than a text editor: a plugin's parameter names, their
   * ranges and its factory presets are facts about a LOADED plugin, and the only loaded plugins
   * are the ones this project instantiates. The médiathèque used to answer by sending the engine
   * a one-module throwaway project; that only ever worked because it had an engine session with
   * nothing in it, and it is gone with its builder.
   *
   * Matched on the chain step's NAME. An instance named after the module it extends is therefore
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
  // The engine's live state as an EXTERNAL store, so a component re-renders only when its own slice changes.
  const store = useRef(new EngineStore()).current;
  const playing = useStoreState(store, (s) => s.playing);
  // NOTE: App does NOT subscribe to `playhead` — at ~20 Hz that would re-render the whole tree every frame.
  const armed = useStoreState(store, (s) => s.armed, arrayEq);
  // Global record enable — ENGINE session state, so it comes straight off the frame; play then records the armed.
  const recordEnabled = useStoreState(store, (s) => s.recordEnabled);
  const [status, setStatus] = useState("");
  const [reloadKey, setReloadKey] = useState(0);
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

  // The special views this PROJECT declares (`surfaces/`), and the engine as a desk sees it.
  // Both are cheap and unconditional: a project with no surfaces gets an empty list, and the
  // adapter is a memo over the link that is already there.
  const { surfaces } = useSurfaces(reloadKey);
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
  // layout with no timeline in it. See VIEW_PANES in routes.ts.
  const ringPanes = VIEW_PANES[view].ring;

  // Read off the LAYOUT rather than off the project doc, and not only because the doc arrives a
  // frame later: everything below this asks "is there a timeline on screen", which is a question
  // about the view. The effect further down is the one place that turns the project into a view.
  const live = view === "live";

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
  // Never in a LIVE project, in either place. The minimap is a second view of the ARRANGEMENT —
  // it earns its band precisely when the timeline is off screen and you would otherwise have
  // lost the song. A project with no arrangement has nothing for it to be a view of, and the
  // rule above ("the timeline is not visible") is exactly the condition that is permanently
  // true there, so without this it would be the one piece of the timeline that never left.
  const minimapFloating = docked && !live && editorPopin;
  const minimapDocked = docked && !live && !timelineVisible && !editorPopin;

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
   * its list is empty (VIEW_PANES), so every one of those roads is closed at the same point
   * rather than at four. Refused out loud — a key that does nothing reads as a broken key.
   */
  const fullscreen = useCallback(
    (p: Pane) => {
      if (!VIEW_PANES[view].fullscreen.includes(p)) {
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
   * `full` is cleared with it. A live layout fullscreens nothing (VIEW_PANES), so a `full` left
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

  // `new project <audio|m9|v1> <name>`: the same scaffold `l8 create` runs, via the file service,
  // then open it. An m9 set and a v1 cut are created HERE and opened THERE — the file service is the
  // one thing on the machine that can write a folder, whichever app reads it back.
  const createNewProject = useCallback(
    async (type: "audio" | "m9" | "v1", name: string) => {
      try {
        setStatus(`creating ${type} project "${name}"…`);
        const { project } = await api.createProject(type, name);
        pushLog("info", `created ${type} project ${project}`);
        await openProject(project);
      } catch (e) {
        setStatus(`create error: ${(e as Error).message}`);
        pushLog("error", (e as Error).message);
      }
    },
    [openProject, pushLog],
  );

  // The import (.dawproject) and delete-project dialog flows. Both are Radix dialogs, which
  // answer Escape themselves but let it go on propagating — so they register here too, or the
  // key that dismissed the dialog would also close the graph slot behind it. Not while BUSY:
  // an import in flight has nothing to cancel, and its dialog is a progress report.
  const imp = useProjectImport({ openProject, onStatus: setStatus });
  const del = useProjectDelete({
    onStatus: setStatus,
    onDeleted: (w) => {
      setWs(w);
      lastActive.current = w.activeProject;
      bumpReload();
    },
  });
  usePopin(!!imp.importPath && !imp.importing, imp.cancelImport);
  usePopin(!!del.deletePath && !del.deleting, del.cancelDelete);

  // Follow a project switch made under us (another tab, the CLI).
  useActiveProjectFollow({
    lastActiveRef: lastActive,
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
      const UI_EXACT = new Set<string>([
        "global",
        ...PANES,
        "focus next",
        "close",
        "popin close",
        "slot close",
        "select",
        "zoom",
        "zoom out",
        "zoom reset",
        "help",
      ]);
      // The ones that take an argument, so they match on their head rather than whole.
      const UI_HEADS = ["file ", "edit sequence ", "edit clip ", "midi learn "];
      const isUi =
        UI_EXACT.has(line) || UI_HEADS.some((h) => line.startsWith(h));
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
      // new project <audio|m9|v1> <name> — first token the type, the rest the name, so multi-word names work.
      if (line.startsWith("project new")) {
        const rest = s.slice("project new".length).trim();
        const sp = rest.search(/\s/);
        const type = (sp === -1 ? rest : rest.slice(0, sp)).toLowerCase();
        const name = sp === -1 ? "" : rest.slice(sp + 1).trim();
        if ((type !== "audio" && type !== "m9" && type !== "v1") || !name)
          setStatus("usage: project new <audio|m9|v1> <name>");
        else void createNewProject(type, name);
        return true;
      }
      // delete project <name> — resolve against the workspace's projects and hand it to the confirm dialog.
      if (line.startsWith("project delete")) {
        const arg = s.slice("project delete".length).trim();
        const projects = ws?.projects ?? [];
        const match = arg
          ? projects.includes(arg)
            ? arg
            : (projects
                .map((p) => ({ p, score: fuzzyScore(arg, p) }))
                .filter((x) => x.score >= 0)
                .sort((a, b) => b.score - a.score || a.p.localeCompare(b.p))[0]
                ?.p ?? null)
          : null;
        if (!arg) setStatus("usage: project delete <name>");
        else if (!match) setStatus(`no project "${arg}" in this workspace`);
        else if (match === ".")
          setStatus("can't delete the workspace root project");
        else {
          const target = match;
          // Defer the dialog until AFTER the palette closes, so the modal doesn't read that as an outside-dismiss.
          setTimeout(() => del.askDelete(target), 0);
        }
        return true;
      }
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
      // ui midi learn <module> <param> — arm the browser's Web MIDI on one param. The BINDING is
      // written by `module cc`, which is the brain's; what is local here is the listening.
      if (line.startsWith("midi learn ")) {
        armMidiLearn(s.slice("midi learn ".length).trim());
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
      del,
      engineRef,
      midiSeqRef,
      store,
      createNewProject,
      setFull,
      setView,
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
      try {
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
    [pushLog, runLocalCommand],
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
      const file = entityFile(
        editorRef.current?.files() ?? [],
        "tracks",
        target.id,
      );
      const path = file && openInEditor(file, false);
      focusLine.current = `${target.id} — ${path ?? "no tracks/ file"}`;
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
  const openContextMenu = useCallback((ctx: MenuCtx, x: number, y: number) => {
    // A module the ENGINE provides has no file anywhere, and the `@engine/` prefix is exactly what says so:
    // the namespace is the catalogue's own and nothing on disk declares it. Derived here rather than carried
    // as a flag through the graph doc, the graph model and the renderer — four files for one menu entry is a
    // worse trade than one string test at the point of use.
    const full: MenuCtx =
      ctx.kind === "module" && ctx.id.startsWith("@engine/")
        ? { ...ctx, ambient: true }
        : ctx;
    const items = contextMenu(full, cmdCatalogue.current);
    if (items.length) setMenu({ items, x, y });
  }, []);
  // A `+` click asks WHICH module before writing anything; picking pre-writes a command. See docs/shell.md.
  const pendingInsert = useRef<PendingInsert | null>(null);
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
   * Find the open project's instance of the module the builder just opened, and watch its plugin.
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
    const module = moduleKeyFromPath(builder.path);
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
  } | null>(null);
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
    (info: { before: string; after: string }, x: number, y: number) => {
      if (!baseModules.length) {
        prewriteCommand(`chain add ${info.before} ${info.after} `);
        return;
      }
      setModulePicker({ info, x, y });
    },
    [baseModules, prewriteCommand],
  );
  // Right-click on empty canvas: the same picker, but the pick has nowhere to be spliced.
  const placeInGraph = useCallback(
    (x: number, y: number) => {
      if (!baseModules.length) {
        prewriteCommand("module place ");
        return;
      }
      setModulePicker({ info: null, x, y });
    },
    [baseModules, prewriteCommand],
  );
  const onModulePick = useCallback(
    (pick: ModulePick) => {
      if (!modulePicker) return;
      setModulePicker(null);
      const { info } = modulePicker;
      // Remember the arrow: this command only CREATES the module, and runCommand splices it (see moduleInsert.ts).
      pendingInsert.current = info;
      const ref = pick.namespace === null ? undefined : pick.ref;
      // ONE command, whichever kind was picked: it creates the module when there is none and instances it
      // either way. Only the instance name is missing, and only the user can supply it — so the line stops at
      // the bar with the cursor where that name goes. Without an arrow the verb is `module place`, and the
      // module arrives in the graph connected to nothing, which is a state the file can hold.
      prewriteCommand(
        info
          ? moduleInsertCommand(info, pick.type, pick.name, ref)
          : modulePlaceCommand(pick.type, pick.name, ref),
      );
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
        const t = keyToken(e);
        if (t !== "space" && t !== "esc") return;
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
      const binding = KEYS[token];
      if (!binding) return;
      const command = resolveBinding(binding, conditions);
      if (!command) return;
      e.preventDefault();
      void runCommand(command);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [builder, conditions, docked, runCommand, settingsScreen]);

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
  // layout in a state VIEW_PANES says cannot exist.
  useEffect(() => {
    const [first] = VIEW_PANES[view].fullscreen;
    if (isMobile && full === null && first) setFull("timeline");
  }, [isMobile, full, view]);

  const waitingForEngine = !!ws?.activeProject && !engineReady;

  // The take to review: the newest one the file service has written, until this tab dismisses it.
  // Never while a take is ROLLING — the band owns that slot, and the clip being reviewed would be the
  // previous take, which is not what anyone is looking at.
  const reviewTake =
    ws?.lastTake &&
    ws.lastTake.clip !== reviewedTake &&
    !(recordEnabled && playing)
      ? ws.lastTake
      : null;

  // Everything that makes the transport unable to answer, as one flag — because to whoever is reaching for Play
  // the two causes are the same fact, and the button has to say so either way.
  //
  // `engineBusy` alone used to be enough, back when the browser's own apply was the one that built every plugin.
  // The file service now PREWARMS the engine on /workspace, before the socket is even open, so that work (~1.3 s
  // on a real song) finishes unwatched and the browser's apply is a diff — measured at 207 ms, a flash that reads
  // as no spinner at all. What is left to wait for on a first load is the first state frame, which is exactly
  // what `waitingForEngine` means.
  const transportWaiting = engineBusy || waitingForEngine;

  // The step-by-step palette's command catalogue and per-argument completion.
  // Which language the palette speaks — the descriptions are the only translated part of a
  // command, its name being an identifier (see commandI18n.ts).
  const { locale } = useLocale();
  // The locale is a dependency: each command's description is resolved once, when the
  // catalogue is built, so switching language rebuilds the list the palette matches on.
  const paletteCommands = useMemo(
    () => buildPaletteCommands(backendCmds, locale),
    [backendCmds, locale],
  );
  paletteRef.current = paletteCommands;
  const listArg = useMemo(
    () => makeListArg(() => editorRef.current?.files() ?? []),
    [],
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

              Absent in a LIVE project. Every control here addresses a position in an
              arrangement — a playhead to move, a take to punch in — and a project with no
              timeline has none: the clock would count bars nothing is written against and
              record would arm a lane with nowhere to put a take. Sound still reaches the
              engine, played by what is wired in the graph. See docs/projectMode.md. */}
          {!live && (
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
                    onStatus={setStatus}
                    gitStatus={gitStatus}
                    onRepoChanged={onRepoChanged}
                  />
                  <SettingsMenu
                    onOpenScreen={setSettingsScreen}
                    onQuitWorkspace={onQuitWorkspace}
                    onChangeEngine={onChangeEngine}
                  />
                </div>
              </MobileMenu>
            ) : (
              <>
                {/* Pane buttons. The VIEW toggles sat here beside them and are gone: with
                    picture moved to v1 there is one layout left to CHOOSE, and a toggle that is
                    always on and cannot be turned off is a control in name only. `live` did not
                    bring them back — it is what the project IS, not a layout you pick.

                    The row is drawn from the LAYOUT's fullscreenable set, not from PANES: in
                    `live` that set is empty and the nav disappears with it, because its one pane
                    already has the window and every button would either do nothing or hide the
                    only thing on screen. */}
                <nav className="flex items-center gap-1">
                  {VIEW_PANES[view].fullscreen.map((p) => {
                    const Icon = PANE_META[p].icon;
                    const key = keyForCommand(`ui ${p}`);
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
                {/* One button per SURFACE the project declares, after the panes and before the
                    menus. They are not panes — the list is the project's, not the shell's (see
                    routes.ts) — so they get their own group rather than joining the row above.
                    Nothing is drawn for a project with no `surfaces/` folder, which is nearly
                    all of them. */}
                {surfaces.length > 0 && (
                  <nav className="flex items-center gap-1">
                    {surfaces.map((s) => (
                      <Button
                        key={s.id}
                        size="icon"
                        variant={openSurface === s.id ? "default" : "ghost"}
                        aria-pressed={openSurface === s.id}
                        onClick={() =>
                          setOpenSurface(openSurface === s.id ? null : s.id)
                        }
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
                  onStatus={setStatus}
                  gitStatus={gitStatus}
                  onRepoChanged={onRepoChanged}
                />
                <SettingsMenu
                  onOpenScreen={setSettingsScreen}
                  onQuitWorkspace={onQuitWorkspace}
                  onChangeEngine={onChangeEngine}
                />
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
            <div
              {...paneProps("editor")}
              className={cn(
                "flex min-h-0 min-w-0 flex-col",
                // The SAME element in the same place in the tree, restyled — so the open file,
                // its undo history and the CodeMirror instance survive being popped out.
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
                diagnostics={diagnostics}
              />
            </div>

            <div
              className={cn(
                "flex min-h-0 min-w-0 flex-1 flex-col",
                full === "editor" && "hidden",
              )}
            >
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
                      full === "timeline" || (full === null && tlView.expanded)
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
                  orbit={orbit}
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
                  onFocusRow={focusRowInPanes}
                  trackControls={trackControls}
                  onTrackToggle={onTrackToggle}
                />
              </div>
              <div
                {...paneProps("chains")}
                className={cn(
                  "flex min-h-0 min-w-0",
                  // In `live` it is the only pane, so it takes the column outright — the same
                  // `flex-1` a fullscreened graph gets, reached without `full` being set (a live
                  // layout fullscreens nothing; see VIEW_PANES).
                  live || full === "chains"
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
                    active={!chainsOffScreen && !graphSlot}
                    // The sidebar is fullscreen chrome (ChainsTab's own rule): it belongs wherever
                    // the graph has the window rather than half of it. `live` is that case
                    // permanently, and it is also the layout where the list matters most — with
                    // no timeline, picking a chain is the only navigation the project has.
                    showList={live || full === "chains"}
                    trackOrder={trackOrder}
                    command={quietCommand}
                    onBypassModule={(mod) =>
                      void runCommand(`module bypass ${mod}`)
                    }
                    engineWarnings={engineWarnings}
                    onAssetBrowse={browseAssets}
                    onWatchWaveform={watchWaveform}
                    onSetModuleAsset={(mod, kind, f) =>
                      void runCommand(`module ${kind} ${mod} ${f}`)
                    }
                    onContextMenu={openContextMenu}
                    onEdgeInsert={insertIntoChain}
                    onCanvasInsert={placeInGraph}
                    pendingInsert={insertingAt}
                    seedGraph={seedGraph}
                    // The NOTES: whether the graph draws them, and how many it has to draw —
                    // the count travels up because the button is in the footer and the graph
                    // is fetched here. See where `showDocs` is declared.
                    showDocs={showDocs}
                    onDocCount={setDocCount}
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
                {/* The take. `rolling` is what freezes it rather than what mounts it: the pane
                    outlives the take, and closing is the ×, not the Stop. */}
                {graphSlot?.kind === "recording" && (
                  <RecordingPane
                    tempo={recInfo.tempo}
                    beatsPerBar={recInfo.beatsPerBar}
                    countIn={recInfo.countIn}
                    trackOrder={trackOrder}
                    trackNames={recInfo.names}
                    rolling={rolling}
                    onStop={() => transport("stop")}
                    onClose={() => setGraphSlot(null)}
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
                    trackId={caret?.trackId ?? null}
                    trackOrder={trackOrder}
                    command={quietCommand}
                    onBypassModule={(mod) =>
                      void runCommand(`module bypass ${mod}`)
                    }
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
                  <LogsPanel lines={logs} onClear={clearLogs} />
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
        {reviewTake && (
          <TakeReview
            clip={reviewTake.clip}
            track={reviewTake.track}
            command={runCommand}
            onClose={() => setReviewedTake(reviewTake.clip)}
          />
        )}

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
              médiathèque and m9 show. */}
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
                onClick={() => {
                  // Turning it ON also clears whatever had taken the graph's place, or the
                  // rearranged graph would be laid out behind a clip nobody asked to keep.
                  if (mixerView) return setMixerView(false);
                  setGraphSlot(null);
                  setFull(null);
                  setMixerView(true);
                  setStatus(
                    mixerStrips.length === 1
                      ? "mixer view — this song has ONE strip, so there is nothing to line up"
                      : `mixer view — ${mixerStrips.length} strips lined up`,
                  );
                }}
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
                onClick={() => setShowDocs((on) => !on)}
                title={
                  docCount === 0
                    ? "No notes in this project: a note is an instance of @studio/doc, wired from what it is about"
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
                    onClick={() => togglePanel(p)}
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
            tabs={VIEW_PANES[view].fullscreen.map((pn) => ({
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
              // The param names the command AND the key written — `module nam <module> <file>`.
              // "" is a real choice — clearing the asset; the command spells that `none`.
              void runCommand(`module ${param} ${module} ${file || "none"}`);
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
            <HelpPage onBack={closeHelp} />
          </div>
        )}

        {/* A SURFACE, over the layout. Same treatment as the help page and for the same reason:
            it is a screen of its own, not a pane, and what was underneath is untouched — the
            timeline keeps its caret and the graph its camera while a desk is up.

            Mounted only while it is open, unlike the three panes. The invariant those obey is
            about state that is expensive to rebuild and cheap to keep; a surface holds a compile
            and a set list, and a project may declare several — keeping every one of them alive
            behind the layout would be paying that for screens nobody has opened. */}
        {openSurface &&
          (() => {
            const found = surfaces.find((s) => s.id === openSurface);
            return (
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
                {found ? (
                  <SurfaceTab
                    surface={found}
                    deck={turntableDeck}
                    project={ws?.activeProject ?? "."}
                  />
                ) : (
                  // A deep link naming a surface this project has not got — `fromLocation`
                  // deliberately does not check the id, since the list arrives after the shell.
                  <div className="flex flex-1 items-center justify-center p-8 text-center text-sm text-muted-foreground">
                    Aucune surface « {openSurface} » dans ce projet — cherchez
                    un fichier{" "}
                    <code className="mx-1">surfaces/{openSurface}.yaml</code>.
                  </div>
                )}
              </div>
            );
          })()}

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

        {/* "delete this project?" — the `delete project` command lands here */}
        <DeleteProjectDialog
          path={del.deletePath}
          busy={del.deleting}
          error={del.deleteError}
          onConfirm={() => void del.confirmDelete()}
          onCancel={del.cancelDelete}
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
        {settingsScreen && settingsScreen !== "io" && (
          <div className="absolute inset-0 z-40 bg-background">
            <EditorSettingsPage
              vimMode={vimMode}
              onToggleVim={() => void toggleVim()}
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
              store={moduleStore}
              path={builder.path}
              kind="module"
              moduleName={builder.path.split("/").slice(-2)[0] ?? builder.path}
              paramRef={null}
              vimMode={vimMode}
              initialPane={builder.pane}
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
              presets={
                (builderPlugin && presets[builderPlugin.module]) ||
                EMPTY_PRESETS
              }
              onListPresets={() =>
                builderPlugin && listPresets(builderPlugin.module)
              }
              // The builder passes its own module name; the engine resolves BOTH ends to the same
              // live instance, so which of the two is sent does not matter — take the builder's.
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
