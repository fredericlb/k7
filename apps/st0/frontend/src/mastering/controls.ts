// controls.ts — what a `mastering` surface has knobs for: ten controls in three groups, one
// group per part of the node it is a picture of. The vocabulary a `surfaces/<id>.yaml` mapping
// is keyed by; `@studio/song` accepts any key and this is the list that is actually drawn.
// See ../../docs/mastering.md.

import type { MixView } from "@studio/song-schema/yaml/mixViewSchema";
import { unmappedControls as unmapped } from "@studio/ui-chains/bindings";
import { m } from "../paraglide/messages.js";

/** The three appliances inside one quick-master node, in the order the signal meets them. */
export const MASTER_PARTS = ["comp", "spread", "limiter"] as const;
export type MasterPart = (typeof MASTER_PARTS)[number];

export const PART_LABEL: Record<MasterPart, () => string> = {
  comp: () => m["master.partComp"](),
  spread: () => m["master.partSpread"](),
  limiter: () => m["master.partLimiter"](),
};

export interface MasterControl {
  /** The mapping key. Prefixed by its part, which is what groups the panel. */
  id: string;
  label: () => string;
  part: MasterPart;
  /** The fallback range, in the PARAM's own units — a fallback and not a scale: the module's own widget wins when it draws one. */
  range: [number, number];
  /** Where the knob sits when nothing is known yet — never 0, which is a real value on most of these. */
  home: number;
  step: number;
  /** Printed after the value — cosmetic, and the reason every number here is readable against a meter rather than against itself. */
  unit: string;
  /** The note the scaffold prints beside the empty line — kept next to the control it is about. */
  wants: string;
  /** Not required by the gate: a surface written before it existed still draws (docs/mastering.md). */
  optional?: true;
  /** A CHOICE rather than a range: the param's values 0, 1, 2… named in order, drawn as a dropdown. */
  choices?: readonly string[];
}

/** The ten, in signal order — with NO normalisation anywhere on this surface, so a number can be checked against a meter (docs/mastering.md). */
export const MASTER_CONTROLS: readonly MasterControl[] = [
  {
    id: "comp.lowCut",
    label: () => m["master.lowCut"](),
    part: "comp",
    range: [0, 300],
    home: 0,
    step: 1,
    unit: "Hz",
    wants:
      "the quick-master module — its low cut on the mid, before it compresses",
    optional: true,
  },
  {
    id: "comp.low",
    label: () => m["master.low"](),
    part: "comp",
    range: [0, 100],
    home: 0,
    step: 1,
    unit: "%",
    wants: "the SAME module — how much it compresses the lows",
  },
  {
    id: "comp.mid",
    label: () => m["master.mid"](),
    part: "comp",
    range: [0, 100],
    home: 0,
    step: 1,
    unit: "%",
    wants: "the SAME module — how much on the mids",
  },
  {
    id: "comp.high",
    label: () => m["master.high"](),
    part: "comp",
    range: [0, 100],
    home: 0,
    step: 1,
    unit: "%",
    wants: "the SAME module — how much on the highs",
  },
  {
    id: "comp.lowFreq",
    label: () => m["master.lowCross"](),
    part: "comp",
    range: [40, 500],
    home: 180,
    step: 1,
    unit: "Hz",
    wants: "the SAME module — the crossover between lows and mids",
  },
  {
    id: "comp.highFreq",
    label: () => m["master.highCross"](),
    part: "comp",
    range: [800, 8000],
    home: 3000,
    step: 10,
    unit: "Hz",
    wants: "the SAME module — the crossover between mids and highs",
  },
  {
    id: "spread.width",
    label: () => m["master.width"](),
    part: "spread",
    range: [0, 200],
    home: 100,
    step: 1,
    unit: "%",
    wants: "the SAME module — the stereo width",
  },
  {
    id: "spread.bassMono",
    label: () => m["master.bassMono"](),
    part: "spread",
    range: [0, 300],
    home: 0,
    step: 1,
    unit: "Hz",
    wants:
      "the SAME module — the frequency below which the bass is brought to the centre",
  },
  {
    id: "limiter.hfLimit",
    label: () => m["master.hfLimit"](),
    part: "limiter",
    range: [0, 100],
    home: 0,
    step: 1,
    unit: "%",
    wants:
      "the SAME module — its HF limit, what it takes off the fastest highs",
    optional: true,
  },
  {
    id: "limiter.drive",
    label: () => m["master.drive"](),
    part: "limiter",
    range: [0, 12],
    home: 0,
    step: 0.1,
    unit: "dB",
    wants: "the SAME module — the limiter's input gain",
  },
  {
    id: "limiter.ceiling",
    label: () => m["master.ceiling"](),
    part: "limiter",
    range: [-12, 0],
    home: 0,
    step: 0.1,
    unit: "dB",
    wants: "the SAME module — its ceiling",
  },
  {
    id: "limiter.release",
    label: () => m["master.release"](),
    part: "limiter",
    range: [10, 500],
    home: 120,
    step: 1,
    unit: "ms",
    wants: "the SAME module — its release time",
  },
  {
    id: "limiter.output",
    label: () => m["master.output"](),
    part: "limiter",
    range: [0, 2],
    home: 0,
    step: 1,
    unit: "",
    wants: "the SAME module — its output word length, float, 24-bit or 16-bit",
    optional: true,
    choices: ["Float", "24-bit", "16-bit"],
  },
];

export const masterControl = (id: string): MasterControl | undefined =>
  MASTER_CONTROLS.find((c) => c.id === id);

/** The REQUIRED controls with no module behind them — a missing line being a knob that does nothing (docs/mastering.md). */
export function unmappedControls(
  mapping: MixView | undefined,
): readonly MasterControl[] {
  return unmapped(
    MASTER_CONTROLS.filter((c) => !c.optional),
    mapping,
  );
}

/** The modules this surface's mapping names, deduplicated — more than one is legal, and worth SAYING rather than refusing. */
export function mappedModules(mapping: MixView | undefined): string[] {
  return [
    ...new Set(
      Object.values(mapping ?? {})
        .map((b) => b?.module)
        .filter((m): m is string => !!m),
    ),
  ];
}
