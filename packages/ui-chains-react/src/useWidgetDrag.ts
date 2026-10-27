// useWidgetDrag.ts — a control moved by hand: the drag a press arms, the live send, the commit,
// and the optimistic overrides reconciled as frames arrive. Holds the channels a widget reads and
// the graph's own multi-selection too, since a drag moves every linked node at once — docs/widgets.md.

import type { PluginParamsStore } from "@studio/engine-browser/params";
import type { WebWidget } from "@studio/graph-model";
import { encodeDepth } from "@studio/ui-chains/automationDepth";
import {
  type GraphNode,
  type LaidOutGraph,
  pairValue,
  widgetDenorm,
  widgetNorm,
} from "@studio/ui-chains/graph";
import { linkedNodes } from "@studio/ui-chains/multiSelect";
import {
  type RefObject,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  type Channels,
  dropChannel,
  EMPTY_ORDER,
  EMPTY_SET,
  type OverrideStore,
} from "./chainsStores";
import type { ChainsCallbacks, DomChainsProps } from "./domChainsProps";
import type { LcdSet } from "./LcdScreenWidget";
import {
  hasChannel,
  pairTarget,
  targetKey,
  type WidgetTarget,
  widgetTarget,
  widgetValue,
} from "./widgetTarget";

const DRAG_TRAVEL_PX = 150; // screen px of vertical drag that sweep a control's whole range

export function useWidgetDrag({
  cb,
  graph,
  midiActivity,
  moduleParams,
  onModuleParam,
  onShaderParam,
  onProjectField,
  onRecorder,
  onTrackSet,
  onTrackToggle,
  onTriggerRack,
  overrides,
  params,
  rackLit,
  rehearsal,
  selected,
  setOverride,
  setPluginParam,
  trackControls,
  trackOrder,
}: {
  cb: RefObject<ChainsCallbacks>;
  graph: LaidOutGraph;
  midiActivity: DomChainsProps["midiActivity"];
  moduleParams: DomChainsProps["moduleParams"];
  onModuleParam: DomChainsProps["onModuleParam"];
  onShaderParam: DomChainsProps["onShaderParam"];
  onProjectField: DomChainsProps["onProjectField"];
  onRecorder: DomChainsProps["onRecorder"];
  onTrackSet: DomChainsProps["onTrackSet"];
  onTrackToggle: DomChainsProps["onTrackToggle"];
  onTriggerRack: DomChainsProps["onTriggerRack"];
  overrides: OverrideStore;
  params: PluginParamsStore;
  rackLit: DomChainsProps["rackLit"];
  rehearsal: DomChainsProps["rehearsal"];
  selected: string | null;
  setOverride: OverrideStore["set"];
  setPluginParam: DomChainsProps["setPluginParam"];
  trackControls: DomChainsProps["trackControls"];
  trackOrder: DomChainsProps["trackOrder"];
}) {
  // --- reconcile optimistic overrides as fresh engine/track frames arrive ------------
  const drag = useRef<{
    node: GraphNode;
    w: WebWidget;
    tgt: WidgetTarget;
    key: string;
    /** A crossfade knob's DRY param, written beside the wet one on every send — docs/widgets.md. */
    pair: WidgetTarget | null;
    startT: number;
    startY: number;
    travel: number; // screen px that sweep the whole range for THIS control
    value: number;
    /** The value the press found — a release that did not move it writes nothing. */
    from: number;
    sent: boolean;
    /** The same control on every LINKED node, moved to the same value — multiSelect.ts. */
    /** The other selected nodes, each moved by the SAME travel from its own start — multiSelect.ts. */
    linked: {
      node: GraphNode;
      tgt: WidgetTarget;
      pair: WidgetTarget | null;
      startT: number;
      value: number;
    }[];
  } | null>(null);

  // One live value to the engine, or to the surface that realises an offline module — nothing else sends live.
  // biome-ignore lint/correctness/useExhaustiveDependencies: the inputs are refs and setters DomChains hands in, stable for its lifetime.
  const sendLive = useCallback((t: WidgetTarget, value: number) => {
    if (t.kind === "plugin")
      cb.current.setPluginParam?.(t.pluginId, t.name, value);
    else if (t.kind === "offline" && t.shader)
      cb.current.onShaderParam?.(t.module, t.name, value);
    else if (t.kind === "offline")
      cb.current.onModuleParam?.(t.module, t.name, value);
  }, []);

  // Write a plugin param into the module's file, and a crossfade's dry one AFTER it: two writes to one file must not race.
  // biome-ignore lint/correctness/useExhaustiveDependencies: the inputs are refs and setters DomChains hands in, stable for its lifetime.
  const commitParam = useCallback(
    (
      module: string,
      t: WidgetTarget,
      value: number,
      pair: WidgetTarget | null,
      w: WebWidget,
    ) => {
      if (t.kind !== "plugin") return;
      const line = (name: string, v: number) =>
        `node param ${module} ${JSON.stringify(name)} ${v}`;
      const first = cb.current.command(line(t.name, value));
      if (pair?.kind === "plugin")
        void Promise.resolve(first).then(() =>
          cb.current.command(line(pair.name, pairValue(w, value))),
        );
    },
    [],
  );
  useEffect(() => {
    // A plugin frame landed: drop the overrides it now speaks for, keeping the one under the hand.
    return params.subscribe(() => {
      if (!hasChannel(overrides.get(), "p:")) return;
      setOverride((o) => dropChannel(o, "p:", drag.current?.key));
    });
  }, [params, overrides, setOverride]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: the inputs are refs and setters DomChains hands in, stable for its lifetime.
  useEffect(() => {
    setOverride((o) => dropChannel(o, "o:", drag.current?.key));
  }, [moduleParams, graph, setOverride]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: the inputs are refs and setters DomChains hands in, stable for its lifetime.
  useEffect(() => {
    setOverride((o) => dropChannel(o, "t:", drag.current?.key));
  }, [trackControls, setOverride]);

  // Either prop turns the channel on: a host may only SHOW such a value, or only take one.
  const offlineChannel =
    moduleParams !== undefined || onModuleParam !== undefined;
  const pluginWritable = setPluginParam !== undefined;
  // Either one: a host that wired the toggles or the two continuous controls meant it.
  const trackWritable = onTrackSet !== undefined || onTrackToggle !== undefined;
  const offlineWritable = onModuleParam !== undefined;
  const shaderWritable = onShaderParam !== undefined;
  const rackTriggerable = onTriggerRack !== undefined;
  const recorderWired = onRecorder !== undefined;
  const projectWritable = onProjectField !== undefined;
  // Memoised on VALUES, never on the host's callbacks, which are often inline lambdas.
  const ch = useMemo<Channels>(
    () => ({
      params,
      trackControls: trackControls ?? {},
      overrides,
      trackOrder: trackOrder ?? EMPTY_ORDER,
      moduleParams: moduleParams ?? {},
      offlineChannel,
      pluginWritable,
      trackWritable,
      offlineWritable,
      shaderWritable,
      rackTriggerable,
      recorderWired,
      projectWritable,
      rehearsal: !!rehearsal,
      rackLit,
      midiActivity,
    }),
    [
      params,
      trackControls,
      overrides,
      trackOrder,
      moduleParams,
      offlineChannel,
      pluginWritable,
      trackWritable,
      offlineWritable,
      shaderWritable,
      rackTriggerable,
      recorderWired,
      projectWritable,
      rehearsal,
      rackLit,
      midiActivity,
    ],
  );

  // Through a ref, assigned every render, so every handler binds once and a memoised Node sees no new prop.
  const chRef = useRef(ch);
  chRef.current = ch;
  // Likewise for the window listeners, which are bound once and would hold the binding render's value.
  const rehearsalRef = useRef(false);
  rehearsalRef.current = !!rehearsal;
  const selRef = useRef(selected);
  selRef.current = selected;
  // The Shift+click selection, the graph's own: the host keeps its single `selected` (multiSelect.ts).
  const [multi, setMulti] = useState<ReadonlySet<string>>(EMPTY_SET);
  const multiRef = useRef(multi);
  multiRef.current = multi;
  // A selection made elsewhere — a sidebar row — is a single one again.
  useEffect(() => {
    if (selected && !multiRef.current.has(selected)) setMulti(EMPTY_SET);
  }, [selected]);
  const nodesRef = useRef(graph.nodes);
  nodesRef.current = graph.nodes;
  // The params a curve drives, by node: what makes a control glow — newline-joined per node, see Node's `automated`.
  const automatedOf = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const e of graph.edges)
      if (e.automation) {
        // A line per param, its depth after a tab when the curve has one — Node splits it back.
        const { param, depth } = e.automation;
        const line = depth ? `${param}\t${encodeDepth(depth)}` : param;
        m.set(e.target, [...(m.get(e.target) ?? []), line]);
      }
    return new Map([...m].map(([id, ps]) => [id, ps.sort().join("\n")]));
  }, [graph.edges]);
  // …and the edges, read by the right-click of a control to know whether a curve drives it.
  const edgesRef = useRef(graph.edges);
  edgesRef.current = graph.edges;
  // The other nodes a control on `n` moves too: every selected one, when all are one ref on one engine.
  const linked = useCallback(
    (n: GraphNode) => linkedNodes(nodesRef.current, multiRef.current, n),
    [],
  );

  // --- widget drag (knob/slider/number): live sends coalesced, commit on release ------
  // biome-ignore lint/correctness/useExhaustiveDependencies: the inputs are refs and setters DomChains hands in, stable for its lifetime.
  const beginDrag = useCallback(
    (n: GraphNode, w: WebWidget, e: React.PointerEvent) => {
      const ch = chRef.current;
      e.stopPropagation(); // don't select the node or start a pan
      // A frozen MODULE has no plugin in the engine; a frozen LANE carries its own controls.
      if (n.frozen && n.kind === "module") return;
      // An AUTOMATIC freeze gives way instead: thawed first, so the drag reaches a live plugin.
      if (n.autoFrozen) cb.current.onThawAutoFreeze?.(n.autoFrozen);
      const tgt = widgetTarget(n, w, ch.offlineChannel);
      if (!tgt) return;
      const v = widgetValue(n, w, ch);
      drag.current = {
        node: n,
        w,
        tgt,
        key: targetKey(tgt),
        pair: pairTarget(n, w, ch.offlineChannel),
        startT: v === undefined ? 0 : widgetNorm(w, v),
        startY: e.clientY,
        // A fader sweeps over its OWN throw, measured off the rail — docs/widgets.md.
        travel:
          w.type === "fader"
            ? Math.max(
                40,
                (e.currentTarget as HTMLElement).querySelector(".rail")
                  ?.clientHeight ?? DRAG_TRAVEL_PX,
              )
            : DRAG_TRAVEL_PX,
        value: v ?? widgetDenorm(w, 0),
        from: v ?? widgetDenorm(w, 0),
        sent: false,
        linked: linked(n).flatMap((m) => {
          const t = widgetTarget(m, w, ch.offlineChannel);
          if (!t || t.kind !== tgt.kind) return [];
          const own = widgetValue(m, w, ch) ?? widgetDenorm(w, 0);
          return [
            {
              node: m,
              tgt: t,
              pair: pairTarget(m, w, ch.offlineChannel),
              startT: widgetNorm(w, own),
              value: own,
            },
          ];
        }),
      };
    },
    [linked],
  );

  // An interactive screen's params: a knob's live send and commit, one per name — docs/lcdScreen.md.
  // biome-ignore lint/correctness/useExhaustiveDependencies: the inputs are refs and setters DomChains hands in, stable for its lifetime.
  const lcdOne = useCallback<LcdSet>(
    (n, changes, commit) => {
      const ch = chRef.current;
      if (n.frozen && n.kind === "module") return;
      if (n.autoFrozen) cb.current.onThawAutoFreeze?.(n.autoFrozen);
      const targets: [WidgetTarget, number][] = [];
      for (const [name, value] of Object.entries(changes)) {
        const t = widgetTarget(
          n,
          { type: "knob", col: 0, row: 0, bind: name },
          ch.offlineChannel,
        );
        if (t?.kind === "plugin" || t?.kind === "offline")
          targets.push([t, value]);
      }
      if (!commit) {
        setOverride((o) => {
          const next = { ...o };
          for (const [t, v] of targets) next[targetKey(t)] = v;
          return next;
        });
        for (const [t, v] of targets) sendLive(t, v);
        return;
      }
      const module = n.module;
      if (!module || rehearsalRef.current) return;
      // One after the other: two writes to one module file must not race.
      let chain: Promise<unknown> = Promise.resolve();
      for (const [t, v] of targets)
        if (t.kind === "plugin")
          chain = chain.then(() =>
            cb.current.command(
              `node param ${module} ${JSON.stringify(t.name)} ${v}`,
            ),
          );
    },
    [sendLive, setOverride],
  );
  // …and the same changes on every LINKED node — multiSelect.ts.
  const lcdSet = useCallback<LcdSet>(
    (n, changes, commit) => {
      lcdOne(n, changes, commit);
      for (const m of linked(n)) lcdOne(m, changes, commit);
    },
    [lcdOne, linked],
  );
  return {
    automatedOf,
    beginDrag,
    ch,
    chRef,
    commitParam,
    drag,
    edgesRef,
    lcdSet,
    linked,
    multi,
    nodesRef,
    rehearsalRef,
    selRef,
    sendLive,
    setMulti,
  };
}
