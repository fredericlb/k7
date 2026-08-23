// controls.ts — what a `mastering` surface has knobs for: ten controls in three groups, one
// group per part of the node it is a picture of. The vocabulary a `surfaces/<id>.yaml` mapping
// is keyed by; `@studio/song` accepts any key and this is the list that is actually drawn.
// See ../../docs/mastering.md.

import type { MixView } from "@studio/song-schema/yaml/mixViewSchema";

/** The three appliances inside one quick-master node, in the order the signal meets them. */
export const MASTER_PARTS = ["comp", "spread", "limiter"] as const;
export type MasterPart = (typeof MASTER_PARTS)[number];

export const PART_LABEL: Record<MasterPart, string> = {
  comp: "Compresseur 3 bandes",
  spread: "Élargisseur",
  limiter: "Limiteur",
};

export interface MasterControl {
  /** The mapping key. Prefixed by its part, which is what groups the panel. */
  id: string;
  label: string;
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
}

/** The ten, in signal order — with NO normalisation anywhere on this surface, so a number can be checked against a meter (docs/mastering.md). */
export const MASTER_CONTROLS: readonly MasterControl[] = [
  {
    id: "comp.low",
    label: "Grave",
    part: "comp",
    range: [0, 100],
    home: 0,
    step: 1,
    unit: "%",
    wants: "le module quick-master — sa quantité de compression sur le grave",
  },
  {
    id: "comp.mid",
    label: "Médium",
    part: "comp",
    range: [0, 100],
    home: 0,
    step: 1,
    unit: "%",
    wants: "le MÊME module — sa quantité sur le médium",
  },
  {
    id: "comp.high",
    label: "Aigu",
    part: "comp",
    range: [0, 100],
    home: 0,
    step: 1,
    unit: "%",
    wants: "le MÊME module — sa quantité sur l'aigu",
  },
  {
    id: "comp.lowFreq",
    label: "Coupure grave",
    part: "comp",
    range: [40, 500],
    home: 180,
    step: 1,
    unit: "Hz",
    wants: "le MÊME module — la coupure entre grave et médium",
  },
  {
    id: "comp.highFreq",
    label: "Coupure aiguë",
    part: "comp",
    range: [800, 8000],
    home: 3000,
    step: 10,
    unit: "Hz",
    wants: "le MÊME module — la coupure entre médium et aigu",
  },
  {
    id: "spread.width",
    label: "Largeur",
    part: "spread",
    range: [0, 200],
    home: 100,
    step: 1,
    unit: "%",
    wants: "le MÊME module — la largeur stéréo",
  },
  {
    id: "spread.bassMono",
    label: "Basses mono",
    part: "spread",
    range: [0, 300],
    home: 0,
    step: 1,
    unit: "Hz",
    wants:
      "le MÊME module — la fréquence sous laquelle le grave est ramené au centre",
  },
  {
    id: "limiter.drive",
    label: "Drive",
    part: "limiter",
    range: [0, 12],
    home: 0,
    step: 0.1,
    unit: "dB",
    wants: "le MÊME module — le gain d'entrée du limiteur",
  },
  {
    id: "limiter.ceiling",
    label: "Plafond",
    part: "limiter",
    range: [-12, 0],
    home: 0,
    step: 0.1,
    unit: "dB",
    wants: "le MÊME module — son plafond",
  },
  {
    id: "limiter.release",
    label: "Release",
    part: "limiter",
    range: [10, 500],
    home: 120,
    step: 1,
    unit: "ms",
    wants: "le MÊME module — son temps de retour",
  },
];

export const masterControl = (id: string): MasterControl | undefined =>
  MASTER_CONTROLS.find((c) => c.id === id);

/** The controls with no module behind them, absent or `null` — it filters the WHOLE list, a missing line being a knob that does nothing. */
export function unmappedControls(
  mapping: MixView | undefined,
): readonly MasterControl[] {
  return MASTER_CONTROLS.filter((c) => !mapping?.[c.id]);
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
