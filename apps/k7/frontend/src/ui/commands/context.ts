// context.ts — what a shell command's handler may reach of App, as one explicit object.
// App rebuilds it every render and the dispatcher reads the latest through a ref, so a
// handler never sees a stale closure and the dispatcher itself never changes identity.

import type { EngineClient } from "@studio/engine-browser";
import type { EngineStore } from "@studio/engine-browser/store";
import type { TransportAction } from "@studio/engine-protocol";
import type { CurveSpec } from "@studio/graph-model";
import type { HistoryDeps } from "@studio/project-shell/undo";
import type { ProjectSurface } from "@studio/song-schema/yaml/surfaceFile";
import type { Dispatch, RefObject, SetStateAction } from "react";
import type { MaybeClipboard } from "../../clipboard";
import type { AudioClipHandle } from "../../components/AudioClipPanel";
import type { EditTarget } from "../../components/ClipView";
import type { PaletteArg } from "../../components/CommandBar";
import type { EditorHandle } from "../../components/EditorTab";
import type { MasterMeterHandle } from "../../components/MasterMeter";
import type { RollHandle } from "../../components/PianoRoll";
import type { SettingsTab } from "../../components/SettingsPanel";
import type { TimelineHandle } from "../../components/TimelineTab";
import type { ParamKind } from "../../curveDraft";
import type { FloatState } from "../../floatingRect";
import type { ClipGridHandle } from "../../gridCaret";
import type { SetStatus } from "../../hooks/useLogs";
import type { useProjectImport } from "../../hooks/useProjectDialogs";
import type { Share } from "../../hooks/useShare";
import type { VideoDocState } from "../../hooks/useVideoDoc";
import type { Pane, Panel } from "../../routes";
import type { SeqView } from "../../sequenceEdit";
import type { WebProject, WorkspaceInfo } from "../../types";

/** The curve editor popin (`ui curve [name]`, `ui automate`) — docs/curveEditor.md. */
export interface CurveEdit {
  name: string;
  isNew: boolean;
  spec?: CurveSpec;
  /** The events of the node it automates — the condition's dropdown; absent when no node is in view. */
  events?: string[];
  /** The control a NEW curve is bound to once created (`ui automate`). */
  bind?: { node: string; param: string };
  /** What kind of param it drives — what shapes it may follow; absent from `ui curve`. */
  kind?: ParamKind;
}

/** What the chains slot shows INSTEAD of the graph — three occupants, one state (docs/shell.md). */
export type GraphSlot =
  | { kind: "grid"; path: string; view: SeqView }
  | { kind: "clip"; target: EditTarget }
  | { kind: "recording" }
  // A MIDI take rolling: its notes drawn as they are played (MidiTakeRoll.tsx).
  | { kind: "midiTake" }
  // One track's modules side by side, opened by a double-click on the lane's header.
  | { kind: "trackModules"; trackId: string };

/** Which panel holds the RIGHT COLUMN — one state because there is one column (docs/shell.md). */
export type RightPanelId =
  | "settings"
  | "playlists"
  | "references"
  | "resources"
  | "tasks"
  | "history"
  | "share"
  | "comments"
  | "conflicts";

/** Everything a handler may touch — grouped as App holds it. */
export interface LocalCtx {
  setStatus: SetStatus;
  setRefusal: (text: string) => void;
  /** The whole dispatcher, for a handler whose answer is another line (a paste, a split). */
  runCommand: (line: string) => Promise<void>;
  /** Is this line one the SERVER's catalogue names — the `ui` gate's tie-breaker. */
  isServerCommand: (line: string) => boolean;

  // Pages, panels and popins.
  full: Pane;
  homePane: Pane;
  ringPanes: Pane[];
  activePane: Pane;
  setFull: (p: Pane | null) => void;
  fullscreen: (p: Pane) => void;
  setPanel: Dispatch<SetStateAction<Panel | null>>;
  togglePanel: (p: Panel) => void;
  shownSlot: GraphSlot | null;
  openEvent: (slot: GraphSlot) => void;
  closeEvent: () => void;
  hasViewport: boolean;
  setViewportWindow: (next: (cur: FloatState) => Partial<FloatState>) => void;
  openHelp: () => void;
  closeHelp: () => void;
  toggleRight: (which: RightPanelId) => void;
  setRightPanel: Dispatch<SetStateAction<RightPanelId | null>>;
  setSettingsTab: (tab: SettingsTab) => void;
  setCommandsPage: (on: boolean) => void;
  toggleMixer: () => void;
  toggleStack: () => void;
  toggleDocs: () => void;
  clearLogs: () => void;
  setTrackCurves: Dispatch<SetStateAction<boolean>>;

  // Editors and builders.
  editorRef: RefObject<EditorHandle | null>;
  openInEditor: (arg: string) => string | null;
  setTapChain: (t: { node: string; tap: string }) => void;
  setCurveEdit: (c: CurveEdit) => void;
  setOpenBuilder: Dispatch<SetStateAction<string | null>>;
  openModuleBuilder: (path: string, pane: "module") => Promise<void>;
  setAssemblyBuilder: (a: { file: string; folder: string }) => void;
  setRackBuilder: (on: boolean) => void;
  setReviewOn: (r: { clip: string; track: string }) => void;
  projectDoc: WebProject | null;
  surfaces: ProjectSurface[];
  bumpReload: () => void;

  // The timeline, the clip grids and the clipboard.
  timelineRef: RefObject<TimelineHandle | null>;
  clipGridRef: RefObject<ClipGridHandle | null>;
  waveRef: RefObject<AudioClipHandle | null>;
  rollRef: RefObject<RollHandle | null>;
  clipSel: boolean;
  timelineSelecting: boolean;
  clipboardRef: RefObject<MaybeClipboard>;
  setClipboard: (c: MaybeClipboard) => void;

  // The transport and the engine's socket.
  store: EngineStore;
  engineRef: RefObject<EngineClient | undefined>;
  engineBusyRef: RefObject<boolean>;
  connected: boolean;
  frozen: boolean;
  transport: (a: TransportAction) => void;
  seek: (seconds: number) => void;
  replayAtRef: RefObject<number>;
  recordWithoutArmRef: RefObject<boolean>;
  onTrackToggle: (id: string, control: "arm") => void;

  // MIDI and the camera.
  armMidiLearn: (rest: string) => void;
  videoArmed: string | null;
  setVideoArmed: Dispatch<SetStateAction<string | null>>;

  // The account and the session.
  toggleVim: () => Promise<void>;
  onChangeEngine: () => void;
  onQuitWorkspace: () => void;
  locales: readonly string[];
  setLocale: (l: string) => void;

  // The project.
  ws: WorkspaceInfo | null;
  historyDeps: HistoryDeps;
  masterMeterRef: RefObject<MasterMeterHandle | null>;
  fixClipping: (peakDb: number) => Promise<void>;
  share: Share;
  videoDoc: VideoDocState["doc"];
  imp: ReturnType<typeof useProjectImport>;
}

/** One shell command: its palette row and its behaviour, in one place. */
export interface LocalCommand {
  /** The palette's name — `ui …` for a view command, bare when it writes. */
  name: string;
  readable?: { en: string; fr: string };
  args?: PaletteArg[];
  /** How the line is matched: whole, by `name `, or both; defaults to whole without args and `name ` with them. */
  match?: "exact" | "head" | "names";
  /** False for a line the shell answers but the palette lists from the server's catalogue instead. */
  listed?: boolean;
  /** `rest` is what follows the name as typed, `lower` the same lowercased; false hands the line on to the server. */
  run: (ctx: LocalCtx, rest: string, lower: string) => boolean | undefined;
}
