// usePaneCallbacks.ts — the callbacks the shell still hands its panes, built once rather than inline in App's JSX.
// The panes are memoised, so a closure written inline would re-render a HIDDEN pane on every App state change.
// Each is fixed for as long as its inputs are, and every input here is a ref, a setter or a stable callback.
// See ../../docs/shell.md.

import {
  type ComponentProps,
  type RefObject,
  useCallback,
  useMemo,
} from "react";
import type { CommandBarHandle } from "../components/CommandBar";
import type { EditorTab } from "../components/EditorTab";
import type { TimelineTab } from "../components/TimelineTab";
import type { LiveMidiTake } from "./useMidiRecording";

type Timeline = ComponentProps<typeof TimelineTab>;
type Editor = ComponentProps<typeof EditorTab>;
type Fn<T> = NonNullable<T>;
type ClipTarget = Parameters<Fn<Timeline["onOpenClip"]>>[0];

interface Inputs {
  openEvent: (slot: { kind: "clip"; target: ClipTarget }) => void;
  setGraphSlot: (slot: null) => void;
  cmdRef: RefObject<CommandBarHandle | null>;
  openModuleBuilder: (path: string, pane: "panel") => unknown;
  setAssemblyBuilder: (b: { file: string; folder: string }) => void;
  setOpenBuilder: (ref: string) => void;
  setBuilderNode: (node: string | null) => void;
  liveTake: LiveMidiTake | null;
}

export function usePaneCallbacks(i: Inputs) {
  const { cmdRef } = i;
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
    feeds,
    openClip,
    emptyClick,
    openLibraryModule,
    openAssembly,
    openChain,
    midiTake,
  };
}
