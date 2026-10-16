// useParamRows.ts — every parameter a module's widgets may bind, unioned from all the sources that
// know some (the file, the live plugin, a scan, the declared built-in, the base, the intrinsics),
// each row carrying the most specific range known for it. None of them is complete on its own.
// See docs/builder.md.

import type { ParamMeta } from "@studio/engine-protocol";
import {
  builtinPluginFor,
  builtinPluginForRef,
} from "@studio/song-schema/builtinParams";
import {
  INPUT_VOLUME_PARAM,
  OUTPUT_VOLUME_PARAM,
  VOLUME_RANGE,
} from "@studio/song-schema/moduleTypes";
import type { Hints } from "@studio/web-protocol";
import { useMemo } from "react";
import {
  extendsRefOf,
  type ModuleUI,
  readParams,
  readPlugin,
} from "./moduleUi";
import type { ParamRow } from "./ParamsPane";

// Track intrinsics a widget can bind besides plugin params — on a track node the graph routes these to the mixer.
const TRACK_BINDS = ["@pan", "@mute", "@solo", "@arm"];

// The engine's level OUT: a lane's fader, and the stage after any module with audio out — engine docs/mix.md.
const OUTPUT_VOLUME_BIND: { name: string; meta: ParamMeta } = {
  name: OUTPUT_VOLUME_PARAM,
  meta: { ...VOLUME_RANGE },
};
// …and the level IN, on an effect only: an instrument's input is the silence before it.
const INPUT_VOLUME_BIND: { name: string; meta: ParamMeta } = {
  name: INPUT_VOLUME_PARAM,
  meta: { ...VOLUME_RANGE },
};

/** An effect is a module filed under `audio/`, in the workspace or a library — the one family with a dry signal. */
const isEffectPath = (path: string): boolean =>
  /(^|\/)_?modules\/audio\//.test(path);

/** The footer an effect or an instrument gets, by its folder — the compile's own test, near enough without its inputs. */
export const stageFor = (path: string, io: string | null): string[] =>
  io != null
    ? []
    : isEffectPath(path)
      ? ["@input-volume", "@mix", "@output-volume"]
      : /(^|\/)_?modules\/instruments\//.test(path)
        ? ["@output-volume"]
        : [];

// The engine's blend around the effect: 0 all dry, 1 all wet — see engine/k7-runtime/docs/mix.md.
const MIX_BIND: { name: string; meta: ParamMeta } = {
  name: "@mix",
  meta: { min: 0, max: 1, def: 1 },
};

// What an `io: in` module binds instead, namespaced like the track intrinsics — see docs/builder.md.
const IO_IN_BINDS: { name: string; meta: ParamMeta }[] = [
  // ±24 dB: a judgement about what is useful, since Tracktion does not clamp this one.
  { name: "@gain", meta: { min: -24, max: 24 } },
  // A DROPDOWN, not a toggle: monitoring is three-state and "auto" is neither on nor off.
  {
    name: "@monitor",
    meta: {
      min: 0,
      max: 2,
      states: [
        { label: "off", value: 0 },
        { label: "auto", value: 1 },
        { label: "on", value: 2 },
      ],
    },
  },
];

// What the FILE says an io setting is: a TOP-LEVEL field, which readParams cannot see.
function authoredIoValue(
  content: string | null,
  bind: string,
): string | undefined {
  if (content == null || !bind.startsWith("@")) return undefined;
  const m = new RegExp(`^${bind.slice(1)}:[ \\t]*(\\S+)[ \\t]*$`, "m").exec(
    content,
  );
  return m?.[1];
}

export function useParamRows({
  content,
  ui,
  io,
  path,
  hints,
  paramRef,
  pluginParamNames,
  pluginParamMeta,
  scanned,
  bases,
}: {
  content: string | null;
  ui: ModuleUI | null;
  io: string | null;
  path: string;
  hints: Hints | null;
  paramRef: string | null;
  pluginParamNames?: string[];
  pluginParamMeta?: Record<string, ParamMeta>;
  scanned: { names: string[]; meta: Record<string, ParamMeta> } | null;
  bases: string[];
}): { rows: ParamRow[]; values: Record<string, number> } {
  const params = paramRef ? (hints?.paramsByBase[paramRef] ?? []) : [];
  // Ranges for a built-in k7 defines; the engine's live report is better, so this only fills what it has not.
  const baseMeta = paramRef ? (hints?.paramMetaByBase[paramRef] ?? {}) : {};

  /** …and the built-in the file itself names, the source that needs NO project — see docs/builder.md. */
  const declared = useMemo(() => {
    if (content == null) return undefined;
    return (
      builtinPluginFor(readPlugin(content)) ??
      builtinPluginForRef(extendsRefOf(content))
    )?.params;
  }, [content]);

  // Every addressable param, unioned from all FIVE sources — none of them is complete on its own.
  const rows = useMemo(() => {
    const set = content == null ? {} : readParams(content);
    const bound = new Set(
      Object.values(ui?.widgets ?? {})
        .map((w) => w.bind)
        .filter(Boolean) as string[],
    );
    // An io module's own settings, offered only on an io module: on a plugin they would name nothing.
    const ioBinds = [
      ...(io === "in" ? IO_IN_BINDS : []),
      // The engine's dry/wet, on an EFFECT only: an instrument or a MIDI module has no dry signal — engine docs/mix.md.
      ...(io == null && isEffectPath(path)
        ? [MIX_BIND, INPUT_VOLUME_BIND]
        : []),
      OUTPUT_VOLUME_BIND,
    ];
    /** `@base`, offered only where there ARE bases; the graph fills its entries — see docs/builder.md. */
    const baseBinds: { name: string; meta: ParamMeta }[] = bases.length
      ? [
          {
            name: "@base",
            meta: {
              min: 0,
              max: bases.length,
              states: [
                { label: "none", value: 0 },
                ...bases.map((b, i) => ({ label: b, value: i + 1 })),
              ],
            },
          },
        ]
      : [];
    const names = new Set([
      ...Object.keys(set),
      ...(pluginParamNames ?? []),
      // …and what a SCAN asked for on purpose: the same plugin, without needing an instance first.
      ...(scanned?.names ?? []),
      ...params,
      ...(declared ?? []).map((p) => p.name),
      // Track intrinsics belong here too: this list is the only place a binding can be picked up from.
      ...TRACK_BINDS,
      ...ioBinds.map((b) => b.name),
      ...baseBinds.map((b) => b.name),
    ]);
    // The io binds bring their OWN ranges, and so does `@base`, whose range is a list of names.
    const ioMeta = Object.fromEntries(
      [...ioBinds, ...baseBinds].map((b) => [b.name, b.meta]),
    );
    // …and the declared built-in's, the only range a module in a LIBRARY will ever have.
    const declaredMeta = Object.fromEntries(
      (declared ?? []).map((p) => [
        p.name,
        { min: p.min, max: p.max, def: p.def },
      ]),
    );
    return [...names]
      .sort((a, b) => a.localeCompare(b))
      .map((name) => ({
        name,
        // The authored value lives at the file's TOP level for an io setting, not under `params:`.
        value: set[name] ?? authoredIoValue(content, name),
        bound: bound.has(name),
        // Most specific first — loaded, scanned, declared, base, io; see docs/builder.md.
        meta:
          pluginParamMeta?.[name] ??
          scanned?.meta[name] ??
          declaredMeta[name] ??
          baseMeta[name] ??
          ioMeta[name],
      }));
  }, [
    content,
    io,
    ui,
    params,
    declared,
    baseMeta,
    pluginParamNames,
    pluginParamMeta,
    scanned,
    bases,
    path,
  ]);

  // The same values as NUMBERS for the preview; anything that is not one falls back to the widget's min.
  const values = useMemo(() => {
    const out: Record<string, number> = {};
    for (const [name, raw] of Object.entries(
      content == null ? {} : readParams(content),
    )) {
      const n = Number(raw);
      if (Number.isFinite(n)) out[name] = n;
    }
    return out;
  }, [content]);

  return { rows, values };
}
