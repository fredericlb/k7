// widgetTarget.ts — what a widget actuates and what it shows: a plugin param, a lane control,
// a module field, a pad, a recorder verb or a project setting, and the value read off the
// override, the engine or the file in that order. The rules are docs/widgets.md.

import type { WebWidget } from "@studio/graph-model";
import {
  type GraphNode,
  INPUT_VOLUME_PARAM,
  MIX_PARAM,
  OUTPUT_VOLUME_PARAM,
  projectBindField,
  type RecVerb,
  rackBindSymbol,
  recBindVerb,
  type TrackControlValues,
} from "@studio/ui-chains/graph";
import type { Channels } from "./chainsStores";
import { moduleFieldValue, projectFieldValue } from "./moduleField";

type TrackControl = keyof TrackControlValues;
export type WidgetTarget =
  | { kind: "plugin"; pluginId: string; name: string }
  | { kind: "track"; trackId: string; control: TrackControl }
  | { kind: "module"; module: string; field: string }
  // A param of a module realised OUTSIDE the graph — see `offlineOf`.
  | { kind: "offline"; module: string; name: string; shader?: true }
  // A RACK's pad — the one target that SETS nothing, docs/widgets.md.
  | { kind: "rack"; module: string; symbol: string }
  // …and a RECORDER's button, the second of that family — engine/k7-runtime/docs/recorder.md.
  | { kind: "recorder"; module: string; verb: RecVerb; pluginId?: string }
  // …and a PROJECT setting: read off the card like a field, WRITTEN by a verb (docs/widgets.md).
  | { kind: "project"; field: string };

/** The stage's knobs on a card's bottom bar, in signal order: what goes in, the blend, what comes out. */
export const FOOT_KNOB_PX = 16;
export const FOOT_KNOBS: WebWidget[] = [
  {
    type: "knob",
    col: 0,
    row: 0,
    bind: INPUT_VOLUME_PARAM,
    label: "in",
    min: -60,
    max: 12,
  },
  {
    type: "knob",
    col: 0,
    row: 0,
    bind: MIX_PARAM,
    label: "mix",
    min: 0,
    max: 1,
  },
  {
    type: "knob",
    col: 0,
    row: 0,
    bind: OUTPUT_VOLUME_PARAM,
    label: "out",
    min: -60,
    max: 12,
  },
];

/** The three binds the engine's stage answers around ANY plugin: blend, level in, level out. */
const STAGE_BINDS = new Set([
  MIX_PARAM,
  INPUT_VOLUME_PARAM,
  OUTPUT_VOLUME_PARAM,
]);

/** What a widget actuates: a pad, an `@` intrinsic, a plugin param, else offline — docs/widgets.md. */
export function widgetTarget(
  n: GraphNode,
  w: WebWidget,
  /** Does the host offer a channel for modules with no plugin? See `offlineOf`. */
  offline = false,
): WidgetTarget | null {
  if (!w.bind) return null;
  // A PROMOTED param resolves to the member's own, then takes the arms below — packages/song/docs/assemblies.md.
  const promoted = n.assemblyOf?.params?.[w.bind];
  if (promoted)
    return promoted.pluginId
      ? { kind: "plugin", pluginId: promoted.pluginId, name: promoted.param }
      : { kind: "offline", module: promoted.node, name: promoted.param };
  // A rack pad, before the general `@` case: an intrinsic that FIRES rather than sets.
  const symbol = rackBindSymbol(w.bind);
  if (symbol)
    return n.module ? { kind: "rack", module: n.module, symbol } : null;
  // …and a recorder's, before the `@` arm would make `@rec:record` a FIELD to write — docs/widgets.md.
  const verb = recBindVerb(w.bind);
  if (verb)
    return n.module
      ? { kind: "recorder", module: n.module, verb, pluginId: n.pluginId }
      : null;
  // …and a PROJECT setting, which lives in project.k7x, before the `@` arm for the same reason.
  const setting = projectBindField(w.bind);
  if (setting) return { kind: "project", field: setting };
  // A STRIP's highlight is its LANE's, like the lane card's mute and solo — not a field of the mixer module.
  if (w.bind === "@highlight" && n.trackFace)
    return { kind: "track", trackId: n.trackFace, control: "highlight" };
  // A lane's output volume IS its mixer fader, whose control keeps the mixer's own name.
  if (n.kind === "track" && w.bind === OUTPUT_VOLUME_PARAM)
    return { kind: "track", trackId: n.label, control: "volume" };
  // The engine's stage — blend and levels — is set LIVE on the plugin like one of its params, never at the next build — engine docs/mix.md.
  if (STAGE_BINDS.has(w.bind))
    return n.pluginId
      ? { kind: "plugin", pluginId: n.pluginId, name: w.bind }
      : null;
  if (w.bind.startsWith("@")) {
    const field = w.bind.slice(1);
    if (n.kind === "track")
      return {
        kind: "track",
        trackId: n.label,
        control: field as TrackControl,
      };
    return n.module ? { kind: "module", module: n.module, field } : null;
  }
  if (n.pluginId) return { kind: "plugin", pluginId: n.pluginId, name: w.bind };
  // A SHADER's knob: no plugin, realised by the picture — always a target, the host saying whether it takes one.
  if (n.shader !== undefined && n.module)
    return { kind: "offline", module: n.module, name: w.bind, shader: true };
  // No plugin, and the host says it knows what such a module is set to — opt-in, docs/widgets.md.
  return offline && n.module
    ? { kind: "offline", module: n.module, name: w.bind }
    : null;
}

// The DRY half of a crossfade knob, resolved as its own bind would be — plugin or offline, else nothing.
export function pairTarget(
  n: GraphNode,
  w: WebWidget,
  offline: boolean,
): WidgetTarget | null {
  if (!w.pair) return null;
  const t = widgetTarget(n, { ...w, bind: w.pair, pair: undefined }, offline);
  return t?.kind === "plugin" || t?.kind === "offline" ? t : null;
}

// Is any optimistic value outstanding on this channel? The guard that keeps a frame free when none is.
export function hasChannel(o: Record<string, number>, prefix: string): boolean {
  for (const key in o) if (key.startsWith(prefix)) return true;
  return false;
}

// The override map's key: an optimistic value that outranks the incoming frame until that frame catches up.
export function targetKey(t: WidgetTarget): string {
  if (t.kind === "track") return `t:${t.trackId}:${t.control}`;
  if (t.kind === "module") return `m:${t.module}:${t.field}`;
  // A recorder's button holds no value: the state frame says whether it is rolling, at 20 Hz.
  if (t.kind === "recorder") return `r:${t.module}:${t.verb}`;
  if (t.kind === "project") return `p:${t.field}`;
  if (t.kind === "offline") return `o:${t.module}:${t.name}`;
  // A pad holds no value, so nothing ever writes under this key — it only covers the union.
  if (t.kind === "rack") return `r:${t.module}:${t.symbol}`;
  return `p:${t.pluginId}:${t.name}`;
}

/** The value a widget shows: override, else engine, else authored, else nothing — docs/widgets.md. */
export function widgetValue(
  n: GraphNode,
  w: WebWidget,
  ch: Channels,
  live?: number,
): number | undefined {
  const tgt = widgetTarget(n, w, ch.offlineChannel);
  if (!tgt) return undefined;
  // A pad has no value to show; whether it is LIT is `useRackLit`'s separate question.
  if (tgt.kind === "rack") return undefined;
  // …nor has a recorder's button: the record light comes off the state frame, not off a value.
  if (tgt.kind === "recorder") return undefined;
  // A project setting reads off the CARD, which `buildGraph` put the host's answer on.
  if (tgt.kind === "project") return projectFieldValue(n, tgt.field);
  const key = targetKey(tgt);
  const held = ch.overrides.get();
  if (key in held) return held[key];
  const v =
    tgt.kind === "track"
      ? ch.trackControls[tgt.trackId]?.[tgt.control]
      : tgt.kind === "module"
        ? moduleFieldValue(n, w, tgt.field)
        : tgt.kind === "offline"
          ? // What the SURFACE that realises it says, else what the file authored. There is no
            // engine answer to fall back on: the compiler emitted no plugin to ask.
            (ch.moduleParams[tgt.module]?.[tgt.name] ?? n.params?.[tgt.name])
          : (live ??
            ch.params.getSnapshot()[tgt.pluginId]?.[tgt.name] ??
            n.params?.[tgt.name] ??
            // A module stating none is all wet at 0 dB, and the knob should say so rather than "–".
            (tgt.name === MIX_PARAM
              ? 1
              : STAGE_BINDS.has(tgt.name)
                ? 0
                : undefined));
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

/** A recorder's buttons by what they do, since their faces are glyphs (`●`). */
const REC_NAMES: Record<RecVerb, string> = {
  record: "Record",
  clear: "Clear",
  save: "Save",
};

/** A tapped widget's accessible name: a recorder's verb, a pad's symbol, else its face or its bind. */
export function tapName(
  w: WebWidget,
  tgt: WidgetTarget | null,
  padSymbol: string | null,
): string {
  if (tgt?.kind === "recorder") return REC_NAMES[tgt.verb];
  if (padSymbol) return padSymbol;
  return w.label ?? (typeof w.bind === "string" ? w.bind : w.type);
}

export const draggable = (w: WebWidget) =>
  w.type === "knob" ||
  w.type === "slider" ||
  w.type === "fader" ||
  w.type === "number";

// --- edge geometry (the maths is @studio/ui-chains/cables; here, its per-edge metadata) ---
