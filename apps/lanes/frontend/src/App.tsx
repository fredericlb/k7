// App.tsx — the lanes web shell: the global view (editor | timeline over chains), the
// transport header, and the Shift-Shift command palette. A view is a LAYOUT, not a mode —
// every pane stays mounted and `full`/`focus` only decide size and keys, so no open file,
// caret or zoom is ever lost. Live engine state goes to an external store, never App state.
// See docs/shell.md.

import { Badge } from "@frediverse/ui/badge";
import { Button } from "@frediverse/ui/button";
import { FrediverseMark } from "@frediverse/ui/frediverse-mark";
import { cn } from "@frediverse/ui/lib/utils";
import { PluginParamsStore } from "@studio/engine-browser/params";
import {
  arrayEq,
  EngineStore,
  EngineStoreProvider,
  useStoreState,
} from "@studio/engine-browser/store";
import { Circle, Loader2, Pause, Play, Square } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "./api";
import { canonicalizeCommand } from "./commandI18n";
import { AlternativePicker } from "./components/AlternativePicker";
import { ChainsTab } from "./components/ChainsTab";
import { CommandBar, type CommandBarHandle } from "./components/CommandBar";
import { ContextMenu } from "./components/ContextMenu";
import { DeleteProjectDialog } from "./components/DeleteProjectDialog";
import { DocsPanel, type DocsSelection } from "./components/DocsPanel";
import { EditorPanel, type EditTarget } from "./components/EditorPanel";
import { EditorSettingsPage } from "./components/EditorSettingsPage";
import { type EditorHandle, EditorTab } from "./components/EditorTab";
import { FreezeOverlay } from "./components/FreezeOverlay";
import { GraphPanel } from "./components/GraphPanel";
import { HelpPage } from "./components/HelpPage";
import { ImportDialog } from "./components/ImportDialog";
import { IoPanel } from "./components/IoPanel";
import { LibraryPicker } from "./components/LibraryPicker";
import { LogsPanel } from "./components/LogsPanel";
import { Minimap, type MinimapItem } from "./components/Minimap";
import { MixerTab } from "./components/MixerTab";
import { MobileMenu, MobileTabBar } from "./components/MobileChrome";
import {
  type ModulePick,
  ModulePicker,
  type PickerModule,
} from "./components/ModulePicker";
import { RecordingOverlay } from "./components/RecordingOverlay";
import { SettingsMenu, type SettingsScreen } from "./components/SettingsMenu";
import { ShareMenu } from "./components/ShareMenu";
import { SshKeyPage } from "./components/SshKeyPage";
import { type TimelineHandle, TimelineTab } from "./components/TimelineTab";
import { Toaster } from "./components/Toast";
import { VideoTab } from "./components/VideoTab";
import { contextMenu, type MenuCtx, type MenuItem } from "./contextMenu";
import { fuzzyScore } from "./fuzzy";
import { useEngineLink } from "./hooks/useEngineLink";
import { useLogs } from "./hooks/useLogs";
import { useMidiRecording } from "./hooks/useMidiRecording";
import {
  useActiveProjectFollow,
  useGitStatus,
  useOrbit,
  useProjectErrors,
  useWarmWaveforms,
} from "./hooks/usePolls";
import {
  useDawprojectImport,
  useProjectDelete,
} from "./hooks/useProjectDialogs";
import { useProjectDoc } from "./hooks/useProjectDoc";
import { useTrackControls } from "./hooks/useTrackControls";
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
import { buildPaletteCommands, makeCompleteArg } from "./palette";
import { m } from "./paraglide/messages.js";
import { fileStem } from "./projectPaths";
import type { Pane, Panel, View } from "./routes";
import type { RowKey } from "./rows";
import {
  ALL_PANES,
  DOUBLE_SHIFT_MS,
  MetronomeIcon,
  PANE_META,
  PANEL_META,
  PANES,
  TransportClock,
  VIEW_META,
} from "./shellMeta";
import type { CommandInfo, ProjectInfo, WorkspaceInfo } from "./types";
import { useIsMobile } from "./useIsMobile";
import { useViewRoute } from "./useViewRoute";

// Build stamp baked in by the Dockerfile; "dev" anywhere it wasn't set.
const VERSION = import.meta.env.VITE_APP_VERSION ?? "dev";

export default function App({
  engineUrl,
  onQuitWorkspace,
}: {
  engineUrl: string;
  onQuitWorkspace: () => void;
}) {
  // The layout: null is the global view, a pane name is that pane expanded; `focus` is which pane owns the keys.
  const [full, setFull] = useState<Pane | null>(null);
  // A phone gets tabs, not the studio layout — the tab bar just drives `full`. See docs/shell.md.
  const isMobile = useIsMobile();
  const [mobileMenu, setMobileMenu] = useState(false);
  const [view, setView] = useState<View>("global");
  const [focusPane, setFocusPane] = useState<Pane>("editor");
  const [panel, setPanel] = useState<Panel | null>(null);
  const [docSel, setDocSel] = useState<DocsSelection>(null);
  // The documentation: an OVERLAY with its own route (/docs), so Back and typing `help` both close it.
  const [showHelp, setShowHelp] = useState(() =>
    ["docs", "help"].includes(
      window.location.pathname.replace(/^\/+|\/+$/g, ""),
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
  });
  const [settingsScreen, setSettingsScreen] = useState<SettingsScreen | null>(
    null,
  );
  // Vim mode is a global user preference (~/.lanes/preferences.yaml). Starts ON to match the brain's default.
  const [vimMode, setVimMode] = useState(true);
  useEffect(() => {
    void api
      .preferences()
      .then((p) => setVimMode(p.vim))
      .catch(() => {});
  }, []);
  const cmdRef = useRef<CommandBarHandle>(null);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const timelineRef = useRef<TimelineHandle>(null);
  const editorRef = useRef<EditorHandle>(null);
  // Live plugin params go to an EXTERNAL store: at ~20 Hz a top-level setState would re-render the app each frame.
  const pluginParamsStore = useRef(new PluginParamsStore()).current;
  // The backend command catalogue (canonical name + trailing param names), for the step-by-step palette. Fetched once.
  const [backendCmds, setBackendCmds] = useState<CommandInfo[]>([]);
  const lastActive = useRef<string | null>(null);
  const autoVideoRef = useRef<string | null>(null);
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
  } = useEngineLink(engineUrl, store, pluginParamsStore, setStatus, pushLog);

  // The screen is mirrored in the URL both ways; these four setters are the only way it changes. See routes.ts.
  useViewRoute(
    { view, full, panel, help: showHelp },
    useCallback((next) => {
      setView(next.view);
      setFull(next.full);
      setPanel(next.panel);
      setShowHelp(next.help);
    }, []),
  );
  const openHelp = useCallback(() => setShowHelp(true), []);
  const closeHelp = useCallback(() => setShowHelp(false), []);

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

  // The third pane of the current view, and the ring `tab` walks.
  const thirdPane = VIEW_META[view].third;
  const ringPanes = useMemo<Pane[]>(
    () => ["editor", "timeline", thirdPane],
    [thirdPane],
  );

  const activePane = full ?? focusPane;
  const visible = useCallback(
    (p: Pane) => (full === null ? ringPanes.includes(p) : full === p),
    [full, ringPanes],
  );

  const focusOn = useCallback(
    (p: Pane) => {
      if (p === focusPane) return;
      setFocusPane(p);
      setEditTarget(null);
    },
    [focusPane],
  );

  const fullscreen = useCallback(
    (p: Pane) => {
      setFull(p);
      focusOn(p);
    },
    [focusOn],
  );

  const paneProps = (p: Pane) => ({
    onPointerDown: () => focusOn(p),
  });

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

  // The compiled doc's slice of shell state (track order, mixer, video/strudel gates), refetched on reloadKey.
  const {
    trackOrder,
    metronomeOn,
    recInfo,
    docTracks,
    hasVideo,
    hasStrudel,
    midiSeqRef,
  } = useProjectDoc(reloadKey, {
    // If the currently-armed track lost its sequence, disarm it.
    onMidiSeqs: (seqs) =>
      setMidiArmed((cur) => (cur && !seqs[cur] ? null : cur)),
    onVideo: (name) => {
      if (!name) {
        setFull((f) => (f === "viewport" ? null : f));
        setView("global");
        autoVideoRef.current = null;
        return;
      }
      // A video project auto-enters the video view — once per project.
      if (autoVideoRef.current !== name) {
        autoVideoRef.current = name;
        setView("video");
      }
    },
  });

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
  const warm = useWarmWaveforms(reloadKey);

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
      setView("global");
      autoVideoRef.current = null;
    } catch (e) {
      setStatus(`open error: ${(e as Error).message}`);
    }
  }, []);

  // `new project <audio|video> <name>`: the same scaffold `lanes create` runs, via the file service, then open it.
  const createNewProject = useCallback(
    async (type: "audio" | "video", name: string) => {
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

  // The import (.dawproject) and delete-project dialog flows.
  const imp = useDawprojectImport({ openProject, onStatus: setStatus });
  const del = useProjectDelete({
    onStatus: setStatus,
    onDeleted: (w) => {
      setWs(w);
      lastActive.current = w.activeProject;
      bumpReload();
    },
  });

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

  // Follow the caret's TRACK into the Docs panel's context.
  useEffect(() => {
    const id = caret?.trackId;
    if (id) setDocSel({ kind: "track", id });
  }, [caret?.trackId]);

  // The shell's view commands; returns false when the line isn't one, so the caller falls through to the backend.
  const runLocalCommand = useCallback(
    (s: string): boolean => {
      // View commands live under `ui`, and the pairing is enforced both ways. See docs/shell.md.
      const prefixed = /^ui\s+/i.test(s);
      if (prefixed) s = s.replace(/^ui\s+/i, "");
      const line = s.toLowerCase();
      const UI_EXACT = new Set<string>([
        "global",
        "video",
        ...ALL_PANES,
        "focus next",
        "close",
        "select",
        "zoom",
        "zoom out",
        "zoom reset",
        "help",
      ]);
      // The ones that take an argument, so they match on their head rather than whole.
      const UI_HEADS = ["file ", "edit sequence ", "edit clip "];
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
      if (line === "global" || line === "video") {
        if (line === "video" && !hasVideo) return true;
        setView(line);
        setFull(null);
        return true;
      }
      if ((ALL_PANES as string[]).includes(line)) {
        if (line === "viewport" && !hasVideo) return true;
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
      // new project <audio|video> <name> — first token the type, the rest the name, so multi-word names work.
      if (line.startsWith("project new")) {
        const rest = s.slice("project new".length).trim();
        const sp = rest.search(/\s/);
        const type = (sp === -1 ? rest : rest.slice(0, sp)).toLowerCase();
        const name = sp === -1 ? "" : rest.slice(sp + 1).trim();
        if ((type !== "audio" && type !== "video") || !name)
          setStatus("usage: project new <audio|video> <name>");
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
      // Open a file by name: an exact project path opens as-is, anything else takes the best fuzzy match.
      const openInEditor = (arg: string) => {
        if (!arg) return;
        const files = editorRef.current?.files() ?? [];
        const path = files.includes(arg)
          ? arg
          : (files
              .map((p) => ({ p, score: fuzzyScore(arg, p) }))
              .filter((x) => x.score >= 0)
              .sort((a, b) => b.score - a.score || a.p.localeCompare(b.p))[0]
              ?.p ?? arg);
        if (!visible("editor")) fullscreen("editor");
        else focusOn("editor");
        editorRef.current?.open(path);
      };
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
      // e on a clip opens its own definition — the name fuzzy-resolves to sequences/<id>.yaml or clips/<id>.yaml.
      if (line.startsWith("edit sequence ")) {
        openInEditor(s.slice("edit sequence ".length).trim());
        return true;
      }
      if (line.startsWith("edit clip ")) {
        openInEditor(s.slice("edit clip ".length).trim());
        return true;
      }
      return false;
    },
    [
      fullscreen,
      focusOn,
      focusPane,
      hasVideo,
      ringPanes,
      visible,
      ws,
      openHelp,
      closeHelp,
      del,
      engineRef,
      midiSeqRef,
      store,
      createNewProject,
    ],
  );

  // The track a `track freeze` is about to RENDER, or null. Only that direction of the toggle takes time — an
  // unfreeze is a line removed from a file — so the overlay goes up for one of the two and not the other.
  const [freezing, setFreezing] = useState<string | null>(null);
  // The arrow a module is being created on, while the command RUNS — not while the user is still typing the
  // name into the bar. pendingInsert.current is set at pick time and lives until the splice; this is the
  // narrower window the canvas should draw a placeholder for.
  const [insertingAt, setInsertingAt] = useState<PendingInsert | null>(null);
  const freezeTarget = useCallback((line: string): string | null => {
    const m = /^track\s+freeze\s+(\S+)/.exec(line.trim());
    if (!m) return null;
    const t = docTracksRef.current.find((x) => x.id === m[1]);
    return t && !t.frozen ? t.id : null;
  }, []);

  // Every command — typed or bound to a key — comes through here.
  const runCommand = useCallback(
    async (line: string) => {
      if (!line.trim()) return;
      pushLog("cmd", `› ${line.trim()}`);
      const s = canonicalizeCommand(line);
      if (runLocalCommand(s)) return;
      const willFreeze = freezeTarget(s);
      if (willFreeze) setFreezing(willFreeze);
      const willInsert = pendingInsert.current;
      if (willInsert) setInsertingAt(willInsert);
      try {
        const { output } = await api.command(s);
        setStatus(output.length ? output.join("  ·  ") : `ran: ${s}`);
        for (const o of output) pushLog("info", o);
        setReloadKey((k) => k + 1);
      } catch (e) {
        setStatus(`command error: ${(e as Error).message}`);
        pushLog("error", (e as Error).message);
      } finally {
        // finally, not after the await: a freeze that fails still has to give the app back.
        if (willFreeze) setFreezing(null);
        if (willInsert) setInsertingAt(null);
      }
    },
    [freezeTarget, pushLog, runLocalCommand],
  );

  // The right-click context menu (timeline + graph).
  const [menu, setMenu] = useState<{
    items: MenuItem[];
    x: number;
    y: number;
  } | null>(null);
  const prewriteCommand = useCallback(
    (text: string) => {
      if (paletteOpen) cmdRef.current?.prewrite(text);
      else {
        pendingPrewrite.current = text;
        setPaletteOpen(true);
      }
    },
    [paletteOpen],
  );
  useEffect(() => {
    if (paletteOpen && pendingPrewrite.current != null) {
      cmdRef.current?.prewrite(pendingPrewrite.current);
      pendingPrewrite.current = null;
    }
  }, [paletteOpen]);
  const openContextMenu = useCallback((ctx: MenuCtx, x: number, y: number) => {
    const items = contextMenu(ctx);
    if (items.length) setMenu({ items, x, y });
  }, []);
  // A `+` click asks WHICH module before writing anything; picking pre-writes a command. See docs/shell.md.
  const pendingInsert = useRef<PendingInsert | null>(null);
  // "which file?" — the module widget's library browser. The popup is viewport-positioned,
  // so the shell renders it, exactly as it does the `+`'s module picker below.
  const [libraryPicker, setLibraryPicker] = useState<{
    module: string;
    kind: string;
    x: number;
    y: number;
    files: string[];
  } | null>(null);
  const browseLibrary = useCallback(
    (module: string, kind: string, x: number, y: number) => {
      void api
        .graph()
        .then((g) =>
          setLibraryPicker({ module, kind, x, y, files: g.libraryFiles ?? [] }),
        )
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
  }, [caret, editTarget, tlView, focusPane, full, view]);

  // Global keys. Every binding names a command and runs through runCommand.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // A settings screen owns the surface: the panes its bindings would act on are hidden.
      if (settingsScreen) return;
      const el = e.target as HTMLElement | null;
      if (
        el &&
        (el.tagName === "INPUT" ||
          el.tagName === "TEXTAREA" ||
          el.tagName === "BUTTON" ||
          el.tagName === "A" ||
          el.tagName === "SELECT" ||
          el.isContentEditable)
      )
        return;
      // The command palette: two lone Shift presses within DOUBLE_SHIFT_MS, `e.repeat` filtering a held Shift.
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
  }, [conditions, runCommand, settingsScreen]);

  // The global view has no mobile form, so entering mobile lands on the timeline — the pane that says what a song is.
  useEffect(() => {
    if (isMobile && full === null) setFull("timeline");
  }, [isMobile, full]);

  const waitingForEngine = !!ws?.activeProject && !engineReady;

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
  const paletteCommands = useMemo(
    () => buildPaletteCommands(backendCmds),
    [backendCmds],
  );
  const completeArg = useMemo(
    () => makeCompleteArg(() => editorRef.current?.files() ?? []),
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
            <span className="font-semibold">lanes</span>
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
              what Space would); on stop and record it is not. */}
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
                  />
                </div>
              </MobileMenu>
            ) : (
              <>
                {/* View toggles — icon-only. */}
                <nav className="flex items-center gap-1">
                  {(Object.keys(VIEW_META) as View[])
                    .filter((v) => v !== "video" || hasVideo)
                    .map((v) => {
                      const Icon = VIEW_META[v].icon;
                      const on = full === null && view === v;
                      return (
                        <Button
                          key={v}
                          size="icon"
                          variant={on ? "default" : "ghost"}
                          aria-pressed={on}
                          onClick={() => void runCommand(`ui ${v}`)}
                          title={
                            v === "video"
                              ? "Video — editor, timeline and the renderer at once"
                              : "Global — editor, timeline and the graph at once"
                          }
                          aria-label={VIEW_META[v].label}
                        >
                          <Icon className="h-4 w-4" />
                        </Button>
                      );
                    })}
                  {(hasVideo ? ALL_PANES : PANES).map((p) => {
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
                <div className="mx-1 h-5 w-px bg-border" />
                <ShareMenu
                  onStatus={setStatus}
                  gitStatus={gitStatus}
                  onRepoChanged={onRepoChanged}
                />
                <SettingsMenu
                  onOpenScreen={setSettingsScreen}
                  onQuitWorkspace={onQuitWorkspace}
                />
              </>
            )}
          </div>
        </header>

        {/* main: the panes on top, an optional bottom split panel below */}
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="flex min-h-0 flex-1">
            <div
              {...paneProps("editor")}
              className={cn(
                "flex min-h-0 min-w-0 flex-col",
                full === "editor"
                  ? "flex-1"
                  : full
                    ? "hidden"
                    : "w-1/2 shrink-0 border-r border-border",
                ringFor("editor"),
              )}
            >
              <EditorTab
                ref={editorRef}
                active={activePane === "editor"}
                showTree={full === null || full === "editor"}
                reloadKey={reloadKey}
                activeProject={ws?.activeProject ?? null}
                projectName={project?.name ?? null}
                vimMode={vimMode}
                onOpenProject={openProject}
                onImportDawproject={imp.askImport}
                onChanged={bumpReload}
                setStatus={setStatus}
                onEditTarget={setEditTarget}
                onOpenItem={setOpenItem}
                diagnostics={diagnostics}
              />
            </div>

            <div
              className={cn(
                "flex min-h-0 min-w-0 flex-1 flex-col",
                (full === "editor" || full === "viewport") && "hidden",
              )}
            >
              <div
                {...paneProps("timeline")}
                className={cn(
                  "flex min-h-0 min-w-0",
                  full === "timeline"
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
                  trackControls={trackControls}
                  onTrackToggle={onTrackToggle}
                />
              </div>
              <div
                {...paneProps("chains")}
                className={cn(
                  "flex min-h-0 min-w-0",
                  full === "chains"
                    ? "flex-1"
                    : full === "timeline" ||
                        (full === null && view !== "global")
                      ? "hidden"
                      : "h-1/2 shrink-0",
                  ringFor("chains"),
                )}
              >
                <ChainsTab
                  reloadKey={reloadKey}
                  active={visible("chains")}
                  showList={full === "chains"}
                  trackOrder={trackOrder}
                  command={quietCommand}
                  onBypassModule={(mod) =>
                    void runCommand(`module bypass ${mod}`)
                  }
                  engineWarnings={engineWarnings}
                  onLibraryBrowse={browseLibrary}
                  onWatchWaveform={watchWaveform}
                  onSetModuleAsset={(mod, kind, f) =>
                    void runCommand(`module ${kind} ${mod} ${f}`)
                  }
                  onContextMenu={openContextMenu}
                  onEdgeInsert={insertIntoChain}
                  onCanvasInsert={placeInGraph}
                  pendingInsert={insertingAt}
                  onPickModule={(mod) =>
                    mod && setDocSel({ kind: "module", id: mod })
                  }
                  pluginParamsStore={pluginParamsStore}
                  requestPluginParams={requestPluginParams}
                  watchPluginParams={watchPluginParams}
                  setPluginParam={setPluginParam}
                  trackControls={trackControls}
                  onTrackToggle={onTrackToggle}
                  onTrackSet={onTrackSet}
                />
              </div>

              {hasVideo && full === null && view === "video" && (
                <div
                  {...paneProps("viewport")}
                  className={cn(
                    "flex min-h-0 min-w-0 h-1/2 shrink-0",
                    ringFor("viewport"),
                  )}
                >
                  <VideoTab reloadKey={reloadKey} />
                </div>
              )}
            </div>

            {hasVideo && full === "viewport" && (
              <div className="flex min-h-0 min-w-0 flex-1">
                <VideoTab reloadKey={reloadKey} />
              </div>
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
                {panel === "editor" && (
                  <EditorPanel
                    target={editTarget}
                    onClose={() => setPanel(null)}
                  />
                )}
                {panel === "mixer" && (
                  <MixerTab reloadKey={reloadKey} command={quietCommand} />
                )}
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
                  />
                )}
                {panel === "docs" && (
                  <DocsPanel reloadKey={reloadKey} selection={docSel} />
                )}
                {panel === "logs" && (
                  <LogsPanel lines={logs} onClear={clearLogs} />
                )}
              </div>
            </>
          )}
        </div>

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

          {/* right: the metronome, a separator, then the bottom-panel choices */}
          <div className="ml-auto flex shrink-0 items-center gap-2">
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

        {/* minimap — the whole arrangement at a glance, click to move the playhead.
            Desktop only: it is a second, redundant view of the timeline, and the vertical
            band it costs is the one thing a phone has least of. */}
        {!isMobile && (
          <Minimap
            reloadKey={reloadKey}
            orbit={orbit}
            caret={caret}
            highlight={openItem}
            onSeek={seek}
          />
        )}

        {/* The tab bar takes the minimap's place — one tab per pane, plus the command
            bar's opener (a phone has no double-Shift to summon it with). */}
        {isMobile && (
          <MobileTabBar
            tabs={(hasVideo ? ALL_PANES : PANES).map((pn) => ({
              id: pn,
              icon: PANE_META[pn].icon,
              label: PANE_META[pn].label,
            }))}
            current={full}
            onSelect={(pn) => void runCommand(pn)}
            onOpenCommandBar={() => setPaletteOpen(true)}
          />
        )}

        {/* Command palette — a popin docked to the BOTTOM of the window (a prompt, where
            a terminal's is), opened by a double-tap of Shift and by the right-click
            menus, which prewrite a command into it. Its suggestion list opens upward —
            see CommandBar. */}
        {paletteOpen && (
          <div
            className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 pb-4"
            onMouseDown={(e) => {
              if (e.target === e.currentTarget) setPaletteOpen(false);
            }}
          >
            <div className="mx-4 flex w-full max-w-2xl items-center rounded-lg border border-border bg-popover px-3 py-2.5 shadow-2xl">
              <CommandBar
                ref={cmdRef}
                commands={paletteCommands}
                completeArg={completeArg}
                onRun={(line) => {
                  void runCommand(line);
                  setPaletteOpen(false);
                }}
                onClose={() => setPaletteOpen(false)}
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
            onPick={prewriteCommand}
            onClose={() => setMenu(null)}
          />
        )}

        {/* "which file?" — a module widget's library browser: the same popup as the `+`,
            because both are a nested catalogue you either browse or search. */}
        {libraryPicker && (
          <LibraryPicker
            x={libraryPicker.x}
            y={libraryPicker.y}
            kind={libraryPicker.kind}
            files={libraryPicker.files}
            onPick={(file) => {
              const { module, kind } = libraryPicker;
              setLibraryPicker(null);
              // "" is a real choice — clearing the asset; the command spells that `none`.
              void runCommand(`module ${kind} ${module} ${file || "none"}`);
            }}
            onClose={() => setLibraryPicker(null)}
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
            {settingsScreen === "ssh-keys" ? (
              <SshKeyPage onBack={() => setSettingsScreen(null)} />
            ) : (
              <EditorSettingsPage
                vimMode={vimMode}
                onToggleVim={() => void toggleVim()}
                onBack={() => setSettingsScreen(null)}
              />
            )}
          </div>
        )}

        {/* Freezing a track: the one modal wait in the app. See FreezeOverlay for why this one earns it. */}
        {freezing && <FreezeOverlay track={freezing} />}

        {/* Recording surface — up whenever a take is actually rolling (record enabled AND
            the transport playing). Its own overlay, above the shell, closed by stopping. */}
        {recordEnabled && playing && (
          <RecordingOverlay
            tempo={recInfo.tempo}
            beatsPerBar={recInfo.beatsPerBar}
            countIn={recInfo.countIn}
            trackOrder={trackOrder}
            trackNames={recInfo.names}
            onStop={() => transport("stop")}
          >
            <Minimap
              reloadKey={reloadKey}
              orbit={orbit}
              caret={caret}
              highlight={openItem}
              onSeek={seek}
            />
          </RecordingOverlay>
        )}

        {/* Global toast notifications — positioned bottom-right, above everything */}
        <Toaster />
      </div>
    </EngineStoreProvider>
  );
}
