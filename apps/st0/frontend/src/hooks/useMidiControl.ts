// useMidiControl.ts — wires the browser's MIDI controller to the graph's params. The map is a
// FILE (each module's `controller.yaml`), so this hook holds no bindings of its own: it reads the
// graph, plays what the graph says, and writes through `module cc` like any other edit.

import type { WebGraph, WebWidget } from "@studio/graph-model";
import { pairValue, widgetDenorm, widgetNorm } from "@studio/ui-chains/graph";
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

/** A binding the join could not honour, and why — reported rather than played (docs/midi.md). */
export interface DroppedBinding {
  module: string;
  param: string;
  why: "no widget" | "no plugin";
}

/** The bindings `mappedParams` left behind. Separate so the join itself stays the one thing it is. */
export function droppedBindings(graph: WebGraph | null): DroppedBinding[] {
  if (!graph) return [];
  const out: DroppedBinding[] = [];
  for (const chain of Object.values(graph.chains)) {
    for (const step of chain.use) {
      if (!step.cc) continue;
      for (const param of Object.keys(step.cc)) {
        // No plugin means the whole step is unreachable; no widget means this one param has no range to sweep.
        if (!step.pluginId)
          out.push({ module: step.module, param, why: "no plugin" });
        else if (
          !Object.values(step.ui?.widgets ?? {}).some((w) => w.bind === param)
        )
          out.push({ module: step.module, param, why: "no widget" });
      }
    }
  }
  return out;
}

/** One sentence naming what was ignored, or null when nothing was — what the status line says. */
export function droppedReport(dropped: DroppedBinding[]): string | null {
  if (!dropped.length) return null;
  const named = dropped
    .slice(0, 3)
    .map((d) => `${d.module} ${d.param} (${d.why})`)
    .join(", ");
  const rest = dropped.length > 3 ? `, and ${dropped.length - 3} more` : "";
  const count =
    dropped.length === 1 ? "1 CC binding" : `${dropped.length} CC bindings`;
  return `${count} ignored: ${named}${rest}`;
}

/** Every mapped param in a graph, joined on the widget's `bind` — one with no WIDGET or no PLUGIN ID is left to `droppedBindings`. */
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
  /** What this project's maps ask for and this graph cannot give — for the status line, not for playing. */
  dropped: DroppedBinding[];
  /** Would a value echoed to this binding reach the controller? See docs/midi.md. */
  hasFeedback: (module: string, param: string) => boolean;
  /** Echo the engine's current values back to the controllers — called by whoever SUBSCRIBES, so the graph does not re-render per frame. */
  pushFeedback: (live: Record<string, Record<string, number>>) => void;
}

/** Play the graph's mapped params from MIDI: `setParam` is the same call a knob drag makes, so the two are alike downstream. */
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
  const dropped = useMemo(() => droppedBindings(graph), [graph]);
  // Read by the message handler, which must not be rebound on every graph reload — a rebind between two turns would drop a message.
  const mappedRef = useRef(mapped);
  mappedRef.current = mapped;
  const setParamRef = useRef(setParam);
  setParamRef.current = setParam;

  const midi = useRef<MidiControl | null>(null);
  if (!midi.current)
    midi.current = new MidiControl((k, t) => {
      const m = mappedRef.current.find((x) => ccKey(x.module, x.param) === k);
      if (!m) return;
      const v = widgetDenorm(m.widget, t);
      setParamRef.current(m, v);
      // A crossfade knob's dry half rides the same CC — packages/ui-chains-react/docs/widgets.md.
      if (m.widget.pair)
        setParamRef.current(
          { ...m, param: m.widget.pair },
          pairValue(m.widget, v),
        );
    });

  useEffect(() => {
    const mc = midi.current;
    if (!mc) return;
    void mc.init().then(setReady);
    return () => mc.dispose();
  }, []);

  // The routes ARE the graph's map, replaced wholesale on every reload: there is no incremental state worth keeping in step.
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

  // Feedback driven by the engine's values rather than a timer, so a motorised fader follows a preset load and an automation curve.
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

  return {
    ready,
    learn,
    learning,
    cancelLearn,
    dropped,
    hasFeedback,
    pushFeedback,
  };
}

export type { MappedParam };
