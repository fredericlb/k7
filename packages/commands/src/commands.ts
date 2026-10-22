// commands.ts — the feature registry: one stable SID (module.new, transport.play, …) per
// capability, mapped to a handler that acts through a CommandHost, so the SAME feature
// runs from the command bar, a key, a menu or a plugin. Which words invoke a SID lives
// declaratively in commands.yaml (see commandSpec.ts); the behaviours live in verbs/, one
// table per group, and this file only gathers them. A verb file imports erased TYPES from here.

import type { RunColdStep } from "@studio/audio-passes/coldPass";
import type {
  AudioDeviceInfo,
  PluginInfo,
} from "@studio/engine-client/engineClient";
import type { ProjectDoc } from "@studio/song/project";
import type { Renderer } from "@studio/take-render/renderer";
import { CLIP_VERBS } from "./verbs/clip.ts";
import { CONSOLE_VERBS } from "./verbs/console.ts";
import { CROSSFADE_VERBS } from "./verbs/crossfade.ts";
import { CURVE_VERBS } from "./verbs/curve.ts";
import { CURVE_POINT_VERBS } from "./verbs/curvePoint.ts";
import { ENGINE_VERBS } from "./verbs/engine.ts";
import { EVENT_VERBS } from "./verbs/event.ts";
import { EVENT_EDIT_VERBS } from "./verbs/eventEdit.ts";
import { EVENT_PROCESS_VERBS } from "./verbs/eventProcess.ts";
import { EVENT_STRIP_VERBS } from "./verbs/eventStrip.ts";
import { EVENTS_REMOVE_VERBS } from "./verbs/eventsRemove.ts";
import { EVENT_TAKE_VERBS } from "./verbs/eventTakes.ts";
import { GRAPH_VERBS } from "./verbs/graph.ts";
import { LIBRARY_VERBS } from "./verbs/library.ts";
import { NODE_VERBS } from "./verbs/node.ts";
import { NODE_NEW_VERBS } from "./verbs/nodeNew.ts";
import { NODE_PARAM_VERBS } from "./verbs/nodeParam.ts";
import { NODE_STACK_VERBS } from "./verbs/nodeStack.ts";
import { NODE_TAP_VERBS } from "./verbs/nodeTap.ts";
import { PICTURE_VERBS } from "./verbs/picture.ts";
import { PICTURE_IMPORT_VERBS } from "./verbs/pictureImport.ts";
import { PICTURE_INTERCHANGE_VERBS } from "./verbs/pictureInterchange.ts";
import { PICTURE_KEY_VERBS } from "./verbs/pictureKeys.ts";
import { PICTURE_LANE_VERBS } from "./verbs/pictureLane.ts";
import { PICTURE_MEDIA_VERBS } from "./verbs/pictureMedia.ts";
import { PICTURE_RENDER_VERBS } from "./verbs/pictureRender.ts";
import { PICTURE_SOUND_VERBS } from "./verbs/pictureSound.ts";
import { PICTURE_SPEED_VERBS } from "./verbs/pictureSpeed.ts";
import { PLAYLIST_VERBS } from "./verbs/playlist.ts";
import { PRESET_VERBS } from "./verbs/preset.ts";
import { PROJECT_VERBS } from "./verbs/project.ts";
import { PROJECT_TAG_VERBS } from "./verbs/projectTags.ts";
import { SEQUENCE_VERBS } from "./verbs/sequence.ts";
import { SEQUENCE_NOTE_VERBS } from "./verbs/sequenceNotes.ts";
import { SEQUENCE_RECORD_VERBS } from "./verbs/sequenceRecord.ts";
import { SYSTEM_VERBS } from "./verbs/system.ts";
import { TASK_VERBS } from "./verbs/tasks.ts";
import { TIMELINE_VERBS } from "./verbs/timeline.ts";
import { TIMELINE_LANE_COPY_VERBS } from "./verbs/timelineLaneCopy.ts";
import { TRACK_VERBS } from "./verbs/track.ts";
import { TRACK_DELETE_VERBS } from "./verbs/trackDelete.ts";
import { TRACK_GROUP_VERBS } from "./verbs/trackGroup.ts";
import { TRACK_HIDE_VERBS } from "./verbs/trackHide.ts";
import { TRACK_HIGHLIGHT_VERBS } from "./verbs/trackHighlight.ts";
import { TRACK_INPUT_VERBS } from "./verbs/trackInput.ts";
import { TRACK_LANE_VERBS } from "./verbs/trackLane.ts";
import { TRANSPORT_VERBS } from "./verbs/transport.ts";

export { collectPluginModules } from "./verbs/node.ts";
export { collectSequences, parseMidiNote } from "./verbs/sequence.ts";
export { splitWords } from "./verbs/shared.ts";

export type TransportAction = "play" | "stop" | "toggle" | "rewind" | "panic";

// The environment a feature acts on; `project()` is a getter so the CLI can lazy-load what a command may not need.
export interface CommandHost {
  songPath: string;
  project(): ProjectDoc;
  baseModules: string[]; // plugin module refs a module can extend (for completion)
  log(lines: string[]): void;
  /** Say NO, and why — a refusal is not an error, and the handler `return`s right after; docs/refusal.md. */
  refuse(lines: string[]): void;
  reload(): void | Promise<void>;
  // engine ops (may connect + await):
  transport(a: TransportAction): void | Promise<void>;
  // Toggle a track's arm, or set it to `armed` — the engine owns this state, nothing is written to disk; undefined when it refused.
  arm(track: string, armed?: boolean): Promise<boolean | undefined>;
  applyProject(p: ProjectDoc): void | Promise<void>; // set + push to engine
  sendProject(p: ProjectDoc): void | Promise<void>;
  listPlugins(filter?: string): void | Promise<void>;
  rescanPlugins(force?: boolean): void | Promise<void>;
  showNativePluginUI(id: string): void | Promise<void>;
  getPlugins(filter?: string): Promise<PluginInfo[]>;
  // The audio interfaces the engine can see, for `module populate`; optional — docs/verbs.md.
  getAudioDevices?(): Promise<AudioDeviceInfo[]>;
  // `system channel type`: group two interface inputs into one stereo device, or take them apart; optional.
  setInputStereo?(channel: number, stereo: boolean): boolean;
  /** Play timeline `id` alone in place of the song, or (null) the song again — the timeline pane's; song docs/timelines.md. */
  timelinePlay?(id: string | null): boolean;
  /** Record the session's next takes INTO one event, or (null) back onto the lane — the takes view's; song docs/takes.md. */
  takeArm?(
    arm: {
      track: string;
      eventBeats: number;
      punch: { from: number; to?: number };
    } | null,
  ): boolean;
  // A clip's source envelope — per-bucket peaks over the whole file, for `event trim`; optional.
  clipEnvelope?(
    clip: string,
  ): Promise<{ peak: number[]; seconds: number } | null>;
  /** Run ONE offline step over one file — the stem separator, today; handed in, docs/verbs.md. */
  runColdStep?: RunColdStep;
  /** What the bound engine's MACHINE separates on, read — or set, given a list — THERE; null with no machine. */
  onnxProviders?(set?: readonly string[]): Promise<string[] | null>;
  /** The chain this MACHINE separates with, as `system stems` wrote it; handed in, docs/verbs.md. */
  stemsChain?: string;
  /** …and the one it makes an instrumental with, as `system instrumental` wrote it. */
  instrumentalChain?: string;
  // The workspace ROOT, where the workspace-wide files (set lists, tasks) live.
  repoDir?: string;
  // Back up a file the command is about to overwrite, so undo can restore it — docs/verbs.md.
  snapshot?(absPath: string): void;
  /** Send one recorder take to the médiathèque, from the engine's machine — packages/song/docs/recorderNode.md. */
  saveTake?(file: string, label?: string): Promise<string>;
  /** Bring version `version` of library `name` onto this machine; a reason when it cannot — ../../../docs/library-versions-plan.md. */
  fetchLibraryVersion?(name: string, version: number): Promise<string | null>;
  /** …and the versions the origin publishes of it, for a machine choosing an upgrade it has not fetched. */
  remoteLibraryVersions?(
    name: string,
  ): Promise<{ version: number; requires: number }[]>;
  /** Who bounces a render, handed in by a host with no engine binary — packages/file-service/docs/renderers.md. */
  renderer?: Renderer;
  /** Run `work` after the command returns, once per tag; false when that tag is already running. Absent, a verb waits for it. */
  background?(tag: string, work: () => Promise<string>): boolean;
  /** Render the active project's PICTURE with no browser open; the file written, project-relative — packages/file-service/docs/serverRender.md. */
  renderPicture?(opts: {
    format: "webm" | "mp4";
    audio: boolean;
    from?: number;
    to?: number;
    size?: { height: number } | { width: number; height: number };
    quality?: "low" | "medium" | "high" | "max";
  }): Promise<string>;
}

export type SidHandler = (
  args: string,
  host: CommandHost,
) => void | Promise<void>;

/** Every verb group's table, in dispatch order; a SID appears in exactly one (registry.test.ts). */
export const VERB_TABLES: readonly Record<string, SidHandler>[] = [
  TRACK_LANE_VERBS,
  SEQUENCE_VERBS,
  TIMELINE_VERBS,
  TIMELINE_LANE_COPY_VERBS,
  CLIP_VERBS,
  EVENT_EDIT_VERBS,
  EVENT_VERBS,
  EVENT_STRIP_VERBS,
  CURVE_POINT_VERBS,
  SEQUENCE_NOTE_VERBS,
  PROJECT_VERBS,
  SYSTEM_VERBS,
  PLAYLIST_VERBS,
  LIBRARY_VERBS,
  PICTURE_VERBS,
  PICTURE_LANE_VERBS,
  PICTURE_SOUND_VERBS,
  PICTURE_KEY_VERBS,
  PICTURE_SPEED_VERBS,
  PICTURE_MEDIA_VERBS,
  PICTURE_INTERCHANGE_VERBS,
  PICTURE_IMPORT_VERBS,
  PICTURE_RENDER_VERBS,
  TRACK_VERBS,
  NODE_STACK_VERBS,
  TRACK_HIDE_VERBS,
  TRACK_INPUT_VERBS,
  TASK_VERBS,
  TRACK_GROUP_VERBS,
  TRACK_HIGHLIGHT_VERBS,
  EVENT_TAKE_VERBS,
  EVENT_PROCESS_VERBS,
  CROSSFADE_VERBS,
  TRACK_DELETE_VERBS,
  SEQUENCE_RECORD_VERBS,
  EVENTS_REMOVE_VERBS,
  CURVE_VERBS,
  ENGINE_VERBS,
  PRESET_VERBS,
  CONSOLE_VERBS,
  PROJECT_TAG_VERBS,
  NODE_VERBS,
  NODE_TAP_VERBS,
  NODE_PARAM_VERBS,
  NODE_NEW_VERBS,
  GRAPH_VERBS,
  TRANSPORT_VERBS,
];

export const SID_HANDLERS: Record<string, SidHandler> = Object.assign(
  {},
  ...VERB_TABLES,
);

/** Add a plugin's verb; its catalogue half is registerCommandSpec's, and a taken SID is refused, never shadowed. */
export function registerCommand(c: { sid: string; handler: SidHandler }): void {
  if (SID_HANDLERS[c.sid])
    throw new Error(`command '${c.sid}' already has a handler`);
  SID_HANDLERS[c.sid] = c.handler;
}
