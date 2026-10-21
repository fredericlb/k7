// paneCommands.ts — one command line per pane gesture: an event moved, a lane made, a cable
// landed. Built once per shell store from its runner, so every pane reads the same fixed set.
// A host that offers fewer gestures (a second device) hands the store a subset. See ../../docs/state.md.

import type { LaneFamily } from "../rows";

/** Every gesture a pane may turn into a command — absent from a host's set means the pane draws no handle for it. */
export interface PaneCommands {
  moveEvent: (
    trackId: string,
    fromTc: string,
    toTc: string,
    toTrackId?: string,
  ) => void;
  toolLine: (line: string) => void;
  resizeEvent: (
    trackId: string,
    fromTc: string,
    newStartTc: string,
    newEndTc: string,
  ) => void;
  fadeEvent: (
    trackId: string,
    fromTc: string,
    which: "fadeIn" | "fadeOut",
    lenTc: string,
  ) => void;
  newTrack: () => void;
  newVideoTrack: () => void;
  newTimeline: () => void;
  newTimelineLane: (timeline: string) => void;
  timelinePlay: (timeline: string | null) => void;
  addEvent: (track: string, ref: string, tc: string) => void;
  videoArm: (id: string) => void;
  videoToggle: (id: string, control: "mute" | "solo") => void;
  reorder: (family: LaneFamily, lane: string, target: string) => void;
  organize: () => void;
  setModuleAsset: (module: string, kind: string, file: string) => void;
  connect: (from: string, to: string) => void;
  automate: (
    module: string,
    param: string,
    curve: string,
    trigger?: string,
  ) => void;
  disconnect: (from: string, to: string) => void;
  replug: (from: string, to: string, newFrom: string, newTo: string) => void;
  moveNode: (module: string, x: number, y: number) => void;
  stack: () => void;
  rect: (
    lane: string,
    r: { x: number; y: number; w: number; h: number },
  ) => void;
}

/** The whole set over one runner; `go` fires and forgets, the runner saying what happened. */
export function paneCommandsFor(go: (line: string) => void): PaneCommands {
  return {
    moveEvent: (trackId, fromTc, toTc, toTrackId) =>
      go(
        `event move ${trackId} ${fromTc} ${toTc}${toTrackId ? ` ${toTrackId}` : ""}`,
      ),
    toolLine: (l) => go(l),
    resizeEvent: (trackId, fromTc, startTc, endTc) =>
      go(`event resize ${trackId} ${fromTc} ${startTc} ${endTc}`),
    // `lenTc` is a LENGTH, and the verb's name is the end it applies to — see `event fadein` in commands.yaml.
    fadeEvent: (trackId, fromTc, which, lenTc) =>
      go(
        `event ${which === "fadeIn" ? "fadein" : "fadeout"} ${trackId} ${fromTc} ${lenTc}`,
      ),
    newTrack: () => go("track new"),
    newVideoTrack: () => go("picture lane new"),
    newTimeline: () => go("timeline new"),
    newTimelineLane: (timeline) => go(`timeline lane new ${timeline}`),
    addEvent: (track, ref, tc) => go(`event add ${track} ${ref} ${tc}`),
    timelinePlay: (timeline) =>
      go(timeline ? `timeline play ${timeline}` : "timeline play"),
    videoArm: (id) => go(`ui picture arm ${id}`),
    videoToggle: (id, control) => go(`picture ${control} ${id}`),
    // A header dragged to another slot: two lists, one gesture (packages/song/docs/trackKind.md).
    reorder: (family, lane, target) =>
      go(
        family === "video"
          ? `picture lane order ${lane} ${target}`
          : `track order ${lane} ${target}`,
      ),
    organize: () => go("graph organize"),
    setModuleAsset: (mod, kind, f) => go(`module ${kind} ${mod} ${f}`),
    connect: (from, to) => go(`graph chain connect ${from} ${to}`),
    // Both curve cables write one line of the same verb, with the param QUOTED, since a plugin's names have spaces.
    automate: (module, param, curve, trigger) =>
      go(
        `node automate ${module} ${param} ${curve}${trigger ? ` ${trigger}` : ""}`,
      ),
    disconnect: (from, to) => go(`graph chain disconnect ${from} ${to}`),
    replug: (from, to, nf, nt) =>
      go(`graph chain replug ${from} ${to} ${nf} ${nt}`),
    moveNode: (mod, x, y) => go(`graph move ${mod} ${x} ${y}`),
    stack: () => go("ui stack"),
    rect: (lane, r) => go(`picture rect ${lane} ${r.x} ${r.y} ${r.w} ${r.h}`),
  };
}
