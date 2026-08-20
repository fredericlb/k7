// useMidiControl.ts — wires the browser's MIDI controller to the graph's params. The map is a
// FILE (each module's `controller.yaml`), so this hook holds no bindings of its own: it reads the
// graph, plays what the graph says, and writes through `module cc` like any other edit.

import type { WebGraph, WebWidget } from "@studio/graph-model";
import { widgetDenorm, widgetNorm } from "@studio/ui-chains/graph";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  type CcRoute,
  ccKey,
  type LearnedCc,
  MidiControl,
} from "../midiControl";

/** What a mapped control drives, resolved against the graph so a value can be scaled and sent. */
interface MappedParam {
  module: string;
  param: string;
  /** The widget that draws it — where min/max come from, so a CC sweeps the range you see. */
  widget: WebWidget;
  /** The engine's plugin id — what a value is actually sent to. */
  pluginId: string;
  ch: number;
  cc: number;
}

/**
 * Every mapped param in a graph, with the widget that gives it a range.
 *
 * The map is keyed by the widget's `bind`, which is exactly how a widget names its own target —
 * so this is a join on one string and never a guess. Two bindings are dropped rather than played:
 *
 * - one whose param has no WIDGET. Without min/max there is no way to turn 0..127 into a value,
 *   and inventing a range would make a knob sweep one nobody chose.
 * - one on a step with no PLUGIN ID — a stub, an unsupported plugin, an io module. There is
 *   nothing to send a value to.
 *
 * Both are silent: the map belongs to the module and travels with it, so a project that draws the
 * module differently (or cannot load its plugin) is a normal state, not a broken file.
 *
 * The same module in two chains yields TWO entries, and that is right: one control plays both,
 * because the map is the module's and each chain has its own instance of the plugin.
 */
export function mappedParams(graph: WebGraph | null): MappedParam[] {
  if (!graph) return [];
  const out: MappedParam[] = [];
  for (const chain of Object.values(graph.chains)) {
    for (const step of chain.use) {
      if (!step.cc || !step.pluginId) continue;
      const pluginId = step.pluginId;
      for (const [param, b] of Object.entries(step.cc)) {
        const widget = Object.values(step.ui?.widgets ?? {}).find(
          (w) => w.bind === param,
        );
        if (!widget) continue;
        out.push({
          module: step.module,
          param,
          widget,
          pluginId,
          ch: b.ch,
          cc: b.cc,
        });
      }
    }
  }
  return out;
}

export interface MidiControlApi {
  /** False when the browser has no Web MIDI, or access was refused — the menu says so. */
  ready: boolean;
  /** Arm learn for a param. `onDone` gets what was captured, or null if it was cancelled. */
  learn: (
    module: string,
    param: string,
    onDone: (l: LearnedCc | null) => void,
  ) => void;
  /** The param a learn is waiting on, for the status line. */
  learning: { module: string; param: string } | null;
  /** Cancel an armed learn. */
  cancelLearn: () => void;
  /** Would a value echoed to this binding reach the controller? See docs/midi.md. */
  hasFeedback: (module: string, param: string) => boolean;
  /**
   * Echo the engine's current values back to the controllers — the bidirectional half.
   *
   * Takes the whole live map and is called by whoever SUBSCRIBES to it, rather than subscribing
   * here: those values tick per frame, and a hook used by the graph must not re-render the graph
   * at that rate (see `MidiFeedback`).
   */
  pushFeedback: (live: Record<string, Record<string, number>>) => void;
}

/**
 * Play the graph's mapped params from MIDI, and echo their values back when the device can take it.
 *
 * `setParam` is the same call a knob drag makes, so a value moved by hand and one moved by a
 * controller are indistinguishable downstream — the widget follows when the engine's param frame
 * comes back, exactly as it does for a drag.
 */
export function useMidiControl({
  graph,
  setParam,
}: {
  graph: WebGraph | null;
  /** Send a param's value, in the param's own units. */
  setParam: (m: MappedParam, value: number) => void;
}): MidiControlApi {
  const [ready, setReady] = useState(false);
  const [learning, setLearning] = useState<{
    module: string;
    param: string;
  } | null>(null);
  const cancelRef = useRef<(() => void) | null>(null);

  const mapped = useMemo(() => mappedParams(graph), [graph]);
  // Read by the message handler, which must not be rebound on every graph reload — a rebind
  // between two turns of a knob would drop the message in between.
  const mappedRef = useRef(mapped);
  mappedRef.current = mapped;
  const setParamRef = useRef(setParam);
  setParamRef.current = setParam;

  const midi = useRef<MidiControl | null>(null);
  if (!midi.current)
    midi.current = new MidiControl((k, t) => {
      const m = mappedRef.current.find((x) => ccKey(x.module, x.param) === k);
      if (m) setParamRef.current(m, widgetDenorm(m.widget, t));
    });

  useEffect(() => {
    const mc = midi.current;
    if (!mc) return;
    void mc.init().then(setReady);
    return () => mc.dispose();
  }, []);

  // The routes ARE the graph's map — replaced wholesale on every reload, because that is when a
  // binding can have changed and there is no incremental state worth keeping in step.
  useEffect(() => {
    midi.current?.setRoutes(
      mapped.map(
        (m): CcRoute => ({
          ch: m.ch,
          cc: m.cc,
          key: ccKey(m.module, m.param),
        }),
      ),
    );
  }, [mapped]);

  // Feedback: each mapped param's current value, back to the controller that drives it. Driven by
  // the engine's values rather than by a timer — a motorised fader should follow a preset load and
  // an automation curve, not only its own knob. `feedback` no-ops when the device has no output,
  // which is what makes a write-only controller cost nothing here.
  const pushFeedback = useCallback(
    (live: Record<string, Record<string, number>>) => {
      const mc = midi.current;
      if (!mc) return;
      for (const m of mappedRef.current) {
        const v = live[m.pluginId]?.[m.param];
        if (v === undefined) continue;
        mc.feedback(ccKey(m.module, m.param), widgetNorm(m.widget, v));
      }
    },
    [],
  );

  const cancelLearn = useCallback(() => {
    cancelRef.current?.();
    cancelRef.current = null;
    setLearning(null);
  }, []);

  const learn = useCallback(
    (module: string, param: string, onDone: (l: LearnedCc | null) => void) => {
      const mc = midi.current;
      if (!mc?.ready) {
        onDone(null);
        return;
      }
      cancelRef.current?.(); // one learn at a time; a second arm replaces the first
      setLearning({ module, param });
      cancelRef.current = mc.learn((l) => {
        cancelRef.current = null;
        setLearning(null);
        onDone(l);
      });
    },
    [],
  );

  const hasFeedback = useCallback(
    (module: string, param: string) =>
      midi.current?.hasFeedback(ccKey(module, param)) ?? false,
    [],
  );

  return { ready, learn, learning, cancelLearn, hasFeedback, pushFeedback };
}

export type { MappedParam };
