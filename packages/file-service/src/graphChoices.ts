// graphChoices.ts — what a graph node's fields may be SET to: its assets, a Faust module's slots,
// a library file's choices, its bases and shaders, a rack's or kit's sounds, and what its bound params
// play at unset. Read by graphDoc.ts while it builds each node. See docs/graphFlags.md.

import type { WebRackSound, WebWidget } from "@studio/graph-model";
import { type PanelLike, panelWidgets } from "@studio/graph-model/panel";
import { moduleBaseChoices } from "@studio/song/basePreset";
import type { Rack } from "@studio/song/graph";
import { libraryFiles } from "@studio/song/libraryFiles";
import {
  type AssetLookup,
  moduleAssetChoices,
} from "@studio/song/moduleAssetChoices";
import { FAUST_TYPE } from "@studio/song/project";
import { builtinParamsFor } from "@studio/song-schema/builtinParams";
import {
  isLibraryFileFamily,
  isLibraryFileParam,
  LIBRARY_FILE_PARAMS,
  type LibraryFileFamily,
  SHADER_CATEGORY,
  sharedFamilyOf,
} from "@studio/song-schema/moduleTypes";
import { moduleShaderChoices } from "@studio/song-video/shaders";

/** What each param a panel binds plays at unset, for a BUILT-IN plugin — so a widget never reads "–" for a known value. */
export function paramDefaults(
  plugin: unknown,
  ui: (PanelLike<WebWidget> & { vertical?: PanelLike<WebWidget> }) | undefined,
): Record<string, number> | undefined {
  const params = builtinParamsFor(plugin);
  if (!params?.length || !ui) return undefined;
  // Only the BOUND ones: a synth declares hundreds, and the graph is sent whole on every reload.
  const bound = new Set<string>();
  for (const [, w] of [...panelWidgets(ui), ...panelWidgets(ui.vertical)])
    for (const b of [w.bind, w.pair]) if (b) bound.add(b);
  const out: Record<string, number> = {};
  for (const p of params)
    if (p.def !== undefined && bound.has(p.name)) out[p.name] = p.def;
  return Object.keys(out).length ? out : undefined;
}

/** The assets a module may name — its own and its ancestors'. See docs/graphFlags.md. */
export function assetChoicesFor(
  dir: string,
  module: { category?: string; file?: string; extends?: string } | undefined,
  refs: Readonly<Record<string, { extends?: unknown }>>,
  lookup: AssetLookup,
): string[] | undefined {
  try {
    const files = moduleAssetChoices(dir, module, refs, lookup);
    return files.length ? files : undefined;
  } catch {
    return undefined;
  }
}

/** A module's chosen files: its asset params, plus a FAUST module's sound slots — every string param it has. */
export function withFaustSlots(
  module:
    | { assets?: Record<string, string>; plugin?: unknown; params?: unknown }
    | undefined,
): Record<string, string> | undefined {
  // Read off the PLUGIN's type, which the graph's module always carries — its source path it may not.
  const type = (module?.plugin as { type?: unknown } | undefined)?.type;
  if (String(type ?? "").toLowerCase() !== FAUST_TYPE) return module?.assets;
  const slots = Object.entries(
    (module?.params ?? {}) as Record<string, unknown>,
  ).filter((e): e is [string, string] => typeof e[1] === "string");
  return slots.length
    ? { ...module?.assets, ...Object.fromEntries(slots) }
    : module?.assets;
}

/** …plus the libraries' shared files, for a panel that picks one — every step carrying them would bloat each graph. */
export function withLibraryChoices(
  own: string[] | undefined,
  ui: unknown,
  also: readonly LibraryFileFamily[] = [],
  projectDir?: string,
): string[] | undefined {
  // Every tab's widgets, not only the shared ones: a picker on a closed tab still needs its choices.
  const widgets = panelWidgets(
    ui as PanelLike<{ bind?: unknown }> | undefined,
  ).map(([, w]) => w);
  const families = [
    ...new Set([
      ...also,
      // A picker that NAMES its family, as a Faust module's sound slot does: its bind is the slot, not a known param.
      ...widgets.flatMap((w) => {
        const lib = (w as { library?: unknown }).library;
        return typeof lib === "string" && isLibraryFileFamily(lib) ? [lib] : [];
      }),
      ...widgets.flatMap((w) =>
        typeof w.bind !== "string"
          ? []
          : isLibraryFileParam(w.bind)
            ? [LIBRARY_FILE_PARAMS[w.bind]]
            : (() => {
                // A param that may name a module's own file OR a library's, like an amp's `model`.
                const shared = sharedFamilyOf(w.bind);
                return shared ? [shared] : [];
              })(),
      ),
    ]),
  ];
  if (!families.length) return own;
  // A project's own `samples/` and `wavetables/` answer as `@project/…`; its IRs are the libraries' alone.
  const shared = families.flatMap((f) =>
    libraryFiles(
      f,
      f === "samples" || f === "wavetables" ? projectDir : undefined,
    ),
  );
  return own || shared.length ? [...(own ?? []), ...shared] : undefined;
}

/** The named bases a module may be set to — its own `base/` and its ancestors'. See docs/graphFlags.md. */
export function baseChoicesFor(
  module: { extends?: unknown; folderAbs?: unknown } | undefined,
  refs: Readonly<Record<string, { extends?: unknown; folderAbs?: unknown }>>,
): string[] | undefined {
  try {
    const names = moduleBaseChoices(module, refs);
    return names.length ? names : undefined;
  } catch {
    return undefined;
  }
}

/** …and the shaders a `shaders` module carries, its ancestors' included — packages/song-video/docs/shaders.md. */
export function shaderChoicesFor(
  dir: string,
  module:
    | {
        category?: unknown;
        file?: unknown;
        extends?: unknown;
        folderAbs?: unknown;
      }
    | undefined,
  refs: Readonly<Record<string, { extends?: unknown; folderAbs?: unknown }>>,
): string[] | undefined {
  if (module?.category !== SHADER_CATEGORY) return undefined;
  try {
    const names = moduleShaderChoices(dir, module, refs);
    return names.length ? names : undefined;
  } catch {
    return undefined;
  }
}

/** An input's channels when the file states them as NUMBERS, else undefined — docs/graphFlags.md. */
export function numericChannels(channel: unknown): number[] | undefined {
  if (!Array.isArray(channel)) return undefined;
  const ns = channel
    .map((n) => Number(n))
    .filter((n) => Number.isInteger(n) && n > 0);
  return ns.length ? ns : undefined;
}

/** A rack's sounds, flattened for the pads its node draws — packages/song/docs/racks.md. */
export function rackSounds(
  module: { rack?: Rack } | undefined,
): WebRackSound[] | undefined {
  const rack = module?.rack;
  if (!rack) return undefined;
  const out = Object.entries(rack.symbols)
    .map(([symbol, s]) => ({
      symbol,
      note: Number(s?.note ?? 0),
      ...(s?.sample ? { sample: String(s.sample) } : {}),
      ...(s?.mute === true ? { mute: true } : {}),
      ...(rack.rackType === "slice"
        ? {
            ...(rack.source ? { source: rack.source } : {}),
            ...(s?.from != null ? { from: Number(s.from) } : {}),
            ...(s?.to != null ? { to: Number(s.to) } : {}),
          }
        : { ...(s?.clip ? { clip: String(s.clip) } : {}) }),
    }))
    // In NOTE order, the order a kit is played in — kick, snare, hats — then by name for a shared note.
    .sort((a, b) => a.note - b.note || a.symbol.localeCompare(b.symbol));
  // EMPTY rather than absent: a rack with no sound yet still draws its "+", the way a kit node starts.
  return out;
}

/** An SFZ kit's pads, drawn like a rack's: a name and its note each, in note order — packages/song/docs/racks.md. */
export function kitSounds(
  module: { kit?: Record<string, number>; params?: unknown } | undefined,
): WebRackSound[] | undefined {
  if (!module?.kit) return undefined;
  // A kit pad's mute is the SFZ player's `Mute <note>` param, set on the node like its gain.
  const params = (module.params ?? {}) as Record<string, unknown>;
  const muted = (note: number) => Number(params[`Mute ${note}`] ?? 0) >= 0.5;
  return Object.entries(module.kit)
    .map(([symbol, note]) => ({
      symbol,
      note,
      ...(muted(note) ? { mute: true } : {}),
    }))
    .sort((a, b) => a.note - b.note || a.symbol.localeCompare(b.symbol));
}
