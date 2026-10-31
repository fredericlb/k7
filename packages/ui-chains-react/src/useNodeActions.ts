// useNodeActions.ts — what a click, a right-click or a pick on a card asks for: select, open the
// plugin, bypass, switch a set, pick a preset or an asset, set or flip a control. Each one only
// ASKS; the verb that writes it is the host's — docs/hosting.md, docs/widgets.md.

import type { WebWidget } from "@studio/graph-model";
import {
  type GraphNode,
  type LaidOutGraph,
  pairValue,
  rackBindSymbol,
  widgetDenorm,
  widgetNorm,
} from "@studio/ui-chains/graph";
import { toggleSelection } from "@studio/ui-chains/multiSelect";
import { type RefObject, useCallback, useRef } from "react";
import { EMPTY_SET, type OverrideStore } from "./chainsStores";
import type { GraphMenuCtx } from "./chainsTypes";
import type { ChainsCallbacks } from "./domChainsProps";
import { cornerButtons } from "./nodeLayout";
import type { NodeEngines } from "./PresetButton";
import type { TapAction } from "./TapWidget";
import type { useWidgetDrag } from "./useWidgetDrag";
import {
  pairTarget,
  targetKey,
  widgetTarget,
  widgetValue,
} from "./widgetTarget";

type WidgetDrag = ReturnType<typeof useWidgetDrag>;

// Map a right-clicked node to the shell's menu context (track id, module node, chain name, curve and its binding).
function nodeToCtx(n: GraphNode): GraphMenuCtx | null {
  switch (n.kind) {
    case "track":
      return { kind: "track", id: n.label };
    case "module":
      return n.module
        ? {
            kind: "module",
            id: n.module,
            missing: n.missing,
            // Its model can be fetched: the menu grows "Download model".
            ...(n.modelDownload ? { model: true } : {}),
            // The same test as the corner bubble, so the menu offers `node external-ui` exactly where the button shows.
            ...(cornerButtons(n).includes("plugin") ? { native: true } : {}),
            // A rack that takes new sounds — an SFZ kit's pads are fixed — grows the rack's own rows.
            ...(n.rack && !n.rackKit ? { rack: true } : {}),
          }
        : null;
    case "chain":
      return { kind: "chain", id: n.chain ?? n.label };
    case "sink":
      return { kind: "sink", id: n.label };
    case "assembly":
      return n.module && n.assemblyOf
        ? { kind: "assembly", id: n.module, uses: n.assemblyOf.uses }
        : null;
    case "curve":
      return n.curveOf ? { kind: "curve-card", ...n.curveOf } : null;
  }
}

export function useNodeActions({
  cb,
  chRef,
  commitParam,
  edgesRef,
  graph,
  linked,
  rehearsal,
  selRef,
  sendLive,
  setMulti,
  setOverride,
  suppressClick,
}: {
  cb: RefObject<ChainsCallbacks>;
  chRef: WidgetDrag["chRef"];
  commitParam: WidgetDrag["commitParam"];
  edgesRef: WidgetDrag["edgesRef"];
  graph: LaidOutGraph;
  linked: WidgetDrag["linked"];
  rehearsal: boolean | undefined;
  selRef: WidgetDrag["selRef"];
  sendLive: WidgetDrag["sendLive"];
  setMulti: WidgetDrag["setMulti"];
  setOverride: OverrideStore["set"];
  suppressClick: RefObject<boolean>;
}) {
  // --- node + widget actions ---------------------------------------------------------
  // biome-ignore lint/correctness/useExhaustiveDependencies: the inputs are refs and setters DomChains hands in, stable for its lifetime.
  const tapNode = useCallback((n: GraphNode, shift?: boolean) => {
    if (suppressClick.current) return; // that click ended a pan
    const selected = selRef.current;
    // Shift+click grows or shrinks the selection; the host's single one is set only when there was none.
    if (shift && n.kind === "module" && n.module) {
      const name = n.module;
      setMulti((cur) => toggleSelection(cur, selected, name));
      if (!selected) cb.current.onSelect(name);
      return;
    }
    setMulti(EMPTY_SET);
    cb.current.onPickModule?.(n.kind === "module" ? (n.module ?? null) : null);
    if (n.kind === "module" && n.module) {
      cb.current.onSelect(selected === n.module ? null : n.module);
    } else if (n.chain) {
      cb.current.onSelect(selected === n.chain ? null : n.chain);
    }
  }, []);
  // biome-ignore lint/correctness/useExhaustiveDependencies: the inputs are refs and setters DomChains hands in, stable for its lifetime.
  const contextNode = useCallback((n: GraphNode, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const ctx = nodeToCtx(n);
    if (ctx) cb.current.onContextMenu?.(ctx, e.clientX, e.clientY);
  }, []);
  // Right-click on a CONTROL: the menu for the PLUGIN param it drives, and only that — docs/widgets.md.
  // biome-ignore lint/correctness/useExhaustiveDependencies: the inputs are refs and setters DomChains hands in, stable for its lifetime.
  const contextParam = useCallback(
    (n: GraphNode, w: WebWidget, x: number, y: number): void => {
      // A PAD's menu is its kit's — the node and the sound — rather than a param's (packages/song/docs/racks.md).
      const symbol = rackBindSymbol(w.bind);
      if (symbol && n.module) {
        cb.current.onContextMenu?.({ kind: "tap", id: n.module, symbol }, x, y);
        return;
      }
      if (!n.module || !w.bind || w.bind.startsWith("@") || !n.pluginId) return;
      cb.current.onContextMenu?.(
        {
          kind: "param",
          id: n.module,
          param: w.bind,
          label: w.label || w.bind,
          cc: n.cc?.[w.bind],
          automated: edgesRef.current.some(
            (e) => e.target === n.id && e.automation?.param === w.bind,
          ),
        },
        x,
        y,
      );
    },
    [],
  );
  // Which VST's render holds each node, by module — so the plugin bubble can thaw it first.
  const autoFrozenOf = useRef<Record<string, string>>({});
  autoFrozenOf.current = Object.fromEntries(
    graph.nodes.flatMap((n) =>
      n.module && n.autoFrozen ? [[n.module, n.autoFrozen]] : [],
    ),
  );
  // The plugin's OWN window: the verb names an INSTANCE, since a window belongs to what is loaded.
  // biome-ignore lint/correctness/useExhaustiveDependencies: the inputs are refs and setters DomChains hands in, stable for its lifetime.
  const openPlugin = useCallback((module: string) => {
    // A baked VST has no window to open: thaw its freeze, then ask.
    const at = autoFrozenOf.current[module];
    if (at) cb.current.onThawAutoFreeze?.(at);
    void cb.current.command(`node external-ui ${module}`);
  }, []);
  // Bare `node bypass` toggles, and NOT the quiet path: bypass changes the graph's shape, so it must reload.
  // biome-ignore lint/correctness/useExhaustiveDependencies: the inputs are refs and setters DomChains hands in, stable for its lifetime.
  const bypassModule = useCallback(
    (module: string) => cb.current.onBypassModule?.(module),
    [],
  );
  // The badge only ASKS: which command switches or copies a set is the host's — docs/hosting.md.
  // biome-ignore lint/correctness/useExhaustiveDependencies: the inputs are refs and setters DomChains hands in, stable for its lifetime.
  const pickAlternative = useCallback(
    (module: string, name: string | null) =>
      cb.current.onAlternative?.(module, name),
    [],
  );
  // …and so does the engine dropdown.
  // biome-ignore lint/correctness/useExhaustiveDependencies: the inputs are refs and setters DomChains hands in, stable for its lifetime.
  const pickEngine = useCallback(
    (module: string, name: string) => cb.current.onEngine?.(module, name),
    [],
  );
  // …and so does the preset dropdown, which the host draws.
  // biome-ignore lint/correctness/useExhaustiveDependencies: the inputs are refs and setters DomChains hands in, stable for its lifetime.
  const pickPresets = useCallback(
    (module: string, x: number, y: number, engines?: NodeEngines) =>
      cb.current.onPresets?.(module, x, y, engines),
    [],
  );
  // …and its arrows, which load the neighbouring preset.
  // biome-ignore lint/correctness/useExhaustiveDependencies: the inputs are refs and setters DomChains hands in, stable for its lifetime.
  const stepPresets = useCallback(
    (module: string, step: -1 | 1) => cb.current.onPresetStep?.(module, step),
    [],
  );
  // The widget only ASKS, and the shell writes what comes back — an asset loads at BUILD time.
  // biome-ignore lint/correctness/useExhaustiveDependencies: the inputs are refs and setters DomChains hands in, stable for its lifetime.
  const pickAsset = useCallback(
    (n: GraphNode, param: string, x: number, y: number, family?: string) => {
      if (n.module) cb.current.onAssetBrowse?.(n.module, param, x, y, family);
    },
    [],
  );
  // What feeds a track: the list is the MACHINE's — its interface, its channel labels.
  // biome-ignore lint/correctness/useExhaustiveDependencies: the inputs are refs and setters DomChains hands in, stable for its lifetime.
  const pickTrackInput = useCallback((n: GraphNode, x: number, y: number) => {
    cb.current.onPickTrackInput?.(n.label, x, y);
  }, []);
  // Commit a module FIELD into its own file — no optimism and no socket, docs/widgets.md.
  // biome-ignore lint/correctness/useExhaustiveDependencies: the inputs are refs and setters DomChains hands in, stable for its lifetime.
  const setModuleField = useCallback(
    (
      // The whole target, not just its two names: a rehearsal keys its override by it.
      w: WebWidget,
      tgt: { kind: "module"; module: string; field: string },
      value: number,
    ) => {
      const opt = w.options?.find((o) => o.value === value);
      if (!opt) return; // a field with no named settings — nothing to write
      // A rehearsal shows the pick and writes nothing, so the override is all that can answer.
      if (rehearsal) {
        setOverride((o) => ({ ...o, [targetKey(tgt)]: value }));
        return;
      }
      // `arg` where the entry SAYS one thing and SETS another, and the field is named as the WIDGET does.
      const line = `node param ${tgt.module} @${tgt.field} ${opt.arg ?? opt.label}`;
      // The RELOADING sender when the host wired one, since this control shows only the file — docs/widgets.md.
      void (cb.current.onModuleField ?? cb.current.command)(line);
    },
    [rehearsal, setOverride],
  );

  // A dropdown's chosen setting: the same commit path as a toggle, but the value is the option's, not a flip.
  // biome-ignore lint/correctness/useExhaustiveDependencies: the inputs are refs and setters DomChains hands in, stable for its lifetime.
  const pickOne = useCallback(
    (n: GraphNode, w: WebWidget, value: number) => {
      const tgt = widgetTarget(n, w, chRef.current.offlineChannel);
      // A track intrinsic has no named settings, a pad and a recorder button no value: none can be SET here.
      if (
        !tgt ||
        tgt.kind === "track" ||
        tgt.kind === "rack" ||
        tgt.kind === "recorder"
      )
        return;
      if (tgt.kind === "module") {
        setModuleField(w, tgt, value);
        return;
      }
      // A PROJECT setting travels as the option's WORD, `project aspect 16:9`, never its index — docs/widgets.md.
      if (tgt.kind === "project") {
        const opt = w.options?.find((o) => o.value === value);
        if (opt) cb.current.onProjectField?.(tgt.field, opt.arg ?? opt.label);
        return;
      }
      const pair = pairTarget(n, w, chRef.current.offlineChannel);
      // A crossfade knob's dry half moves with the wet one, on screen and in the engine alike.
      const dry = pair ? pairValue(w, value) : 0;
      setOverride((o) => ({
        ...o,
        [targetKey(tgt)]: value,
        ...(pair ? { [targetKey(pair)]: dry } : {}),
      }));
      if (tgt.kind === "offline") {
        sendLive(tgt, value);
        if (pair) sendLive(pair, dry);
        return;
      }
      sendLive(tgt, value);
      if (pair) sendLive(pair, dry);
      if (n.module && !rehearsal) commitParam(n.module, tgt, value, pair, w);
    },
    [setModuleField, rehearsal, sendLive, commitParam, setOverride],
  );
  // …and on every LINKED node too, with the same value — multiSelect.ts.
  const pickWidget = useCallback(
    (n: GraphNode, w: WebWidget, value: number) => {
      pickOne(n, w, value);
      for (const m of linked(n)) pickOne(m, w, value);
    },
    [pickOne, linked],
  );

  // A tap only ASKS: which command writes the kit is the host's, and so is the sample picker.
  // biome-ignore lint/correctness/useExhaustiveDependencies: the inputs are refs and setters DomChains hands in, stable for its lifetime.
  const editTap = useCallback((n: GraphNode, action: TapAction) => {
    if (n.module) cb.current.onTapEdit?.(n.module, action);
  }, []);

  // A TYPED value: one step of what a drag does, committed at once — docs/widgets.md.
  // biome-ignore lint/correctness/useExhaustiveDependencies: the inputs are refs and setters DomChains hands in, stable for its lifetime.
  const typeWidget = useCallback(
    (n: GraphNode, w: WebWidget, value: number) => {
      // The same two gates a drag has: a baked module has no plugin, an automatic freeze gives way.
      if (n.frozen && n.kind === "module") return;
      if (n.autoFrozen) cb.current.onThawAutoFreeze?.(n.autoFrozen);
      const tgt = widgetTarget(n, w, chRef.current.offlineChannel);
      if (tgt?.kind !== "track") return pickWidget(n, w, value);
      // A lane's level and pan, the two a drag commits; a toggle is never typed.
      if (tgt.control !== "volume" && tgt.control !== "pan") return;
      setOverride((o) => ({ ...o, [targetKey(tgt)]: value }));
      cb.current.onTrackSet?.(tgt.trackId, tgt.control, value);
    },
    [pickWidget, setOverride],
  );

  // biome-ignore lint/correctness/useExhaustiveDependencies: the inputs are refs and setters DomChains hands in, stable for its lifetime.
  const tapWidget = useCallback(
    (n: GraphNode, w: WebWidget) => {
      const ch = chRef.current;
      const tgt = widgetTarget(n, w, ch.offlineChannel);
      if (!tgt) return;
      if (tgt.kind === "track") {
        // Mute/solo/arm: no optimism, so a rapid double-click can't leave the button inverted against the file.
        if (
          tgt.control === "mute" ||
          tgt.control === "solo" ||
          tgt.control === "arm" ||
          tgt.control === "highlight"
        )
          cb.current.onTrackToggle?.(tgt.trackId, tgt.control);
        return;
      }
      // A RECORDER's button fires and is done, as a pad does: the 20 Hz state frame is its only light — docs/widgets.md.
      if (tgt.kind === "recorder") {
        cb.current.onRecorder?.(tgt.verb, {
          module: tgt.module,
          pluginId: tgt.pluginId,
        });
        return;
      }
      // A RACK pad fires its sound and is done: no override to place, nothing to commit.
      if (tgt.kind === "rack") {
        cb.current.onTriggerRack?.(tgt.module, tgt.symbol);
        return;
      }
      // A project setting is a dropdown and is PICKED, never flipped — see `pickWidget`.
      if (tgt.kind === "project") return;
      // A module field cycles through its own named settings — there is no 0/1 to flip.
      if (tgt.kind === "module") {
        const opts = w.options ?? [];
        const at = opts.findIndex((o) => o.value === widgetValue(n, w, ch));
        const next = opts[(at + 1) % (opts.length || 1)];
        if (next) {
          setModuleField(w, tgt, next.value);
          // The linked nodes take the SAME setting, not each its own next one.
          for (const m of linked(n)) pickOne(m, w, next.value);
        }
        return;
      }
      // A plugin toggle has no such round-trip: set it 0/1 down the socket, optimistically, and commit at once.
      const cur = widgetValue(n, w, ch);
      const on = cur !== undefined && widgetNorm(w, cur) >= 0.5;
      const next = widgetDenorm(w, on ? 0 : 1);
      setOverride((o) => ({ ...o, [targetKey(tgt)]: next }));
      // The linked nodes are SET to where this one lands, so a flip never leaves them out of step.
      for (const m of linked(n)) pickOne(m, w, next);
      if (tgt.kind === "offline") {
        cb.current.onModuleParam?.(tgt.module, tgt.name, next);
        return;
      }
      cb.current.setPluginParam?.(tgt.pluginId, tgt.name, next);
      if (n.module && !rehearsal)
        cb.current.command(
          `node param ${n.module} ${JSON.stringify(tgt.name)} ${next}`,
        );
    },
    [setModuleField, rehearsal, linked, pickOne, setOverride],
  );
  return {
    bypassModule,
    contextNode,
    contextParam,
    editTap,
    openPlugin,
    pickAlternative,
    pickAsset,
    pickEngine,
    pickPresets,
    pickTrackInput,
    pickWidget,
    stepPresets,
    tapNode,
    tapWidget,
    typeWidget,
  };
}
