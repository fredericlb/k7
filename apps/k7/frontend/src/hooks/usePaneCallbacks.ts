// usePaneCallbacks.ts — every callback the shell hands its panes, built once rather than inline in App's JSX.
// The panes are memoised, so a closure written inline would re-render a HIDDEN pane on every App state change.
// Each is fixed for as long as its inputs are, and every input here is a ref, a setter or a stable callback.
// See ../../docs/shell.md.

import type { EngineClient } from "@studio/engine-browser";
import type { ViewportTabProps } from "@studio/k7-plugins/video";
import {
  type ComponentProps,
  type RefObject,
  useCallback,
  useMemo,
} from "react";
import type { ChainsTab } from "../components/ChainsTab";
import type { CommandBarHandle } from "../components/CommandBar";
import type { EditorTab } from "../components/EditorTab";
import type { TimelineTab } from "../components/TimelineTab";
import type { LiveMidiTake } from "./useMidiRecording";

type Timeline = ComponentProps<typeof TimelineTab>;
type Chains = ComponentProps<typeof ChainsTab>;
type Editor = ComponentProps<typeof EditorTab>;
type Fn<T> = NonNullable<T>;
type ClipTarget = Parameters<Fn<Timeline["onOpenClip"]>>[0];

interface Inputs {
  runCommand: (line: string) => unknown;
  openEvent: (slot: { kind: "clip"; target: ClipTarget }) => void;
  setGraphSlot: (slot: null) => void;
  engineRef: RefObject<EngineClient | undefined>;
  cmdRef: RefObject<CommandBarHandle | null>;
  openModuleBuilder: (path: string, pane: "panel") => unknown;
  setAssemblyBuilder: (b: { file: string; folder: string }) => void;
  setOpenBuilder: (ref: string) => void;
  setBuilderNode: (node: string | null) => void;
  liveTake: LiveMidiTake | null;
}

export function usePaneCallbacks(i: Inputs) {
  const run = i.runCommand;
  // One command line per gesture: the whole set is fixed for as long as `runCommand` is.
  const commands = useMemo(() => {
    const go = (line: string): void => void run(line);
    return {
      moveEvent: ((trackId, fromTc, toTc, toTrackId) =>
        go(
          `event move ${trackId} ${fromTc} ${toTc}${toTrackId ? ` ${toTrackId}` : ""}`,
        )) satisfies Fn<Timeline["onMoveEvent"]>,
      toolLine: ((l) => go(l)) satisfies Fn<Timeline["onToolLine"]>,
      resizeEvent: ((trackId, fromTc, startTc, endTc) =>
        go(
          `event resize ${trackId} ${fromTc} ${startTc} ${endTc}`,
        )) satisfies Fn<Timeline["onResizeEvent"]>,
      // `lenTc` is a LENGTH, and the verb's name is the end it applies to — see `event fadein` in commands.yaml.
      fadeEvent: ((trackId, fromTc, which, lenTc) =>
        go(
          `event ${which === "fadeIn" ? "fadein" : "fadeout"} ${trackId} ${fromTc} ${lenTc}`,
        )) satisfies Fn<Timeline["onFadeEvent"]>,
      newTrack: (() => go("track new")) satisfies Fn<Timeline["onNewTrack"]>,
      newVideoTrack: (() => go("picture lane new")) satisfies Fn<
        Timeline["onNewVideoTrack"]
      >,
      videoArm: ((id) => go(`ui picture arm ${id}`)) satisfies Fn<
        Timeline["onVideoArm"]
      >,
      videoToggle: ((id, control) =>
        go(`picture ${control} ${id}`)) satisfies Fn<Timeline["onVideoToggle"]>,
      // A header dragged to another slot: two lists, one gesture (packages/song/docs/trackKind.md).
      reorder: ((family, lane, target) =>
        go(
          family === "video"
            ? `picture lane order ${lane} ${target}`
            : `track order ${lane} ${target}`,
        )) satisfies Fn<Timeline["onReorder"]>,
      organize: (() => go("graph organize")) satisfies Fn<Chains["onOrganize"]>,
      setModuleAsset: ((mod, kind, f) =>
        go(`module ${kind} ${mod} ${f}`)) satisfies Fn<
        Chains["onSetModuleAsset"]
      >,
      connect: ((from, to) =>
        go(`graph chain connect ${from} ${to}`)) satisfies Fn<
        Chains["onConnect"]
      >,
      // Both curve cables write one line of the same verb, with the param QUOTED, since a plugin's names have spaces.
      automate: ((module, param, curve, trigger) =>
        go(
          `node automate ${module} ${param} ${curve}${trigger ? ` ${trigger}` : ""}`,
        )) satisfies Fn<Chains["onAutomate"]>,
      disconnect: ((from, to) =>
        go(`graph chain disconnect ${from} ${to}`)) satisfies Fn<
        Chains["onDisconnect"]
      >,
      replug: ((from, to, nf, nt) =>
        go(`graph chain replug ${from} ${to} ${nf} ${nt}`)) satisfies Fn<
        Chains["onReplug"]
      >,
      moveNode: ((mod, x, y) => go(`graph move ${mod} ${x} ${y}`)) satisfies Fn<
        Chains["onMoveNode"]
      >,
      stack: (() => go("ui stack")) satisfies Fn<Chains["onStack"]>,
      rect: ((lane, r) =>
        go(`picture rect ${lane} ${r.x} ${r.y} ${r.w} ${r.h}`)) satisfies Fn<
        ViewportTabProps["onRect"]
      >,
    };
  }, [run]);

  const { cmdRef, engineRef } = i;
  // While the bar fills a field the ruler can answer, the ruler ANSWERS it — App picks which by `barPending`.
  const feeds = useMemo(
    () => ({
      timecode: ((tc, live) =>
        cmdRef.current?.offerValue("timecode", tc, live)) satisfies Fn<
        Timeline["feedTimecode"]
      >,
      move: ((trackId, fromTc, toTc, toTrackId, live) =>
        cmdRef.current?.offer(
          {
            track: trackId,
            timecode: fromTc,
            newTimecode: toTc,
            ...(toTrackId ? { toTrack: toTrackId } : {}),
          },
          live,
        )) satisfies Fn<Timeline["feedMove"]>,
      eventsMove: ((tracks, from, to) =>
        cmdRef.current?.offer({ tracks, from, to })) satisfies Fn<
        Timeline["feedEventsMove"]
      >,
    }),
    [cmdRef],
  );

  const { openEvent, setGraphSlot, openModuleBuilder } = i;
  const { setAssemblyBuilder, setOpenBuilder, setBuilderNode } = i;
  // A double-clicked clip shows its content in the event panel, under the timeline still on screen.
  const openClip = useCallback<Fn<Timeline["onOpenClip"]>>(
    (t) => openEvent({ kind: "clip", target: t }),
    [openEvent],
  );
  // …and the bare lane lets it go: a click on nothing clears what was open, the panel staying up.
  const emptyClick = useCallback(() => setGraphSlot(null), [setGraphSlot]);
  const setLoop = useCallback<Fn<Timeline["onSetLoop"]>>(
    (start, end, enabled) => engineRef.current?.loop(start, end, enabled),
    [engineRef],
  );
  // The same builder for a library module — on the PANEL like a project module.
  const openLibraryModule = useCallback<Editor["onOpenLibraryModule"]>(
    (path) => void openModuleBuilder(path, "panel"),
    [openModuleBuilder],
  );
  const openAssembly = useCallback<Editor["onOpenAssembly"]>(
    (file, folder) => setAssemblyBuilder({ file, folder }),
    [setAssemblyBuilder],
  );
  const openChain = useCallback<Editor["onOpenChain"]>(
    (ref, node) => {
      setOpenBuilder(ref);
      setBuilderNode(node ?? null);
    },
    [setOpenBuilder, setBuilderNode],
  );

  // The take is drawn from its lane and start beat, so a new object per App render would re-render the timeline.
  const lane = i.liveTake?.lane;
  const from = i.liveTake?.from;
  const midiTake = useMemo(
    () => (lane !== undefined && from !== undefined ? { lane, from } : null),
    [lane, from],
  );

  return {
    commands,
    feeds,
    openClip,
    emptyClick,
    setLoop,
    openLibraryModule,
    openAssembly,
    openChain,
    midiTake,
  };
}
