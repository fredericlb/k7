// useChainsMidi.ts — the chains pane's MIDI: the graph's map played onto the engine's params, handed
// to the shell through `midiRef`, and narrated on the status line — a learn in progress, and the
// bindings that cannot be played. See ../../docs/midi.md.

import { type RefObject, useCallback, useEffect } from "react";
import type { WebGraph } from "../types";
import {
  droppedReport,
  type MappedParam,
  type MidiControlApi,
  useMidiControl,
} from "./useMidiControl";

export function useChainsMidi(
  graph: WebGraph | null,
  setPluginParam: (pluginId: string, param: string, value: number) => void,
  midiRef?: RefObject<MidiControlApi | null>,
  onMidiStatus?: (line: string) => void,
): MidiControlApi {
  // `setParam` is the same call a knob drag makes, so a value moved by hand and one moved by a controller are alike downstream.
  const midi = useMidiControl({
    graph,
    setParam: useCallback(
      (m: MappedParam, value: number) =>
        setPluginParam(m.pluginId, m.param, value),
      [setPluginParam],
    ),
  });
  useEffect(() => {
    if (midiRef) midiRef.current = midi;
  }, [midiRef, midi]);
  useEffect(() => {
    if (!midi.learning) return;
    onMidiStatus?.(
      `MIDI learn: ${midi.learning.module} ${midi.learning.param} — move a control, or press Esc or run any command to cancel`,
    );
  }, [midi.learning, onMidiStatus]);
  // A binding that cannot be played is still a binding somebody wrote: say so once per graph rather than dropping it.
  useEffect(() => {
    if (!midi.ready) return;
    const report = droppedReport(midi.dropped);
    if (report) onMidiStatus?.(report);
  }, [midi.ready, midi.dropped, onMidiStatus]);
  return midi;
}
