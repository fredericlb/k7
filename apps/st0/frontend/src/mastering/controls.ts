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
  /**
   * The fallback range, in the PARAM's own units — dB, Hz, percent, ms.
   *
   * A fallback and not a scale: when the module the mapping names draws a widget for the param,
   * that widget's `min`/`max` win, because they are what the module says its own knob covers.
   * This is what the control shows when there is no panel to ask (see `masterRange`).
   */
  range: [number, number];
  /** Where the knob sits when nothing is known yet — never 0, which is a real value on most of these. */
  home: number;
  step: number;
  /** Printed after the value. Cosmetic, and the reason every number on this surface is readable
   *  against a meter rather than against itself. */
  unit: string;
  /** The note the scaffold prints beside the empty line — kept next to the control it is about. */
  wants: string;
}

/**
 * The ten, in signal order.
 *
 * **No normalisation anywhere on this surface**, and that is the one place it parts company with
 * the DJ desk (`packages/song/docs/viewBindings.md`). There a control has a range of its own and
 * the widget's expands it, because a crossfader is a gesture that could drive anything. Here the
 * control IS the param: a ceiling knob shows −0.3 dB and −0.3 dB is what goes to the engine. A
 * mastering number that had been through two scales could not be checked against a meter, which
 * is the only way anybody knows whether a master is right.
 */
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

/**
 * The controls with no module behind them. Absent and `null` both count — a scaffolded file is
 * made of the second, so a gate that only looked for absence would pass every freshly created
 * surface and then draw ten dead knobs.
 *
 * It filters **the whole list**, where the desk's equivalent filters a `REQUIRED_CONTROLS` subset
 * of its own — and that is the difference between the two surfaces rather than a stricter mood. A
 * desk without its stem cuts is a complete desk; it was yesterday's. This one is a picture of ONE
 * node and every control on it names that same node, so a mapping missing a line is not a smaller
 * mastering strip, it is the same strip with a knob that does nothing.
 */
export function unmappedControls(
  mapping: MixView | undefined,
): readonly MasterControl[] {
  return MASTER_CONTROLS.filter((c) => !mapping?.[c.id]);
}

/**
 * The modules this surface's mapping names, deduplicated.
 *
 * Normally exactly one, and that is the shape the strip is drawn for. More than one is legal —
 * nothing in the format says a mapping's lines have to agree — and worth SAYING rather than
 * refusing: somebody wiring a second quick-master by mistake gets a sentence naming both.
 */
export function mappedModules(mapping: MixView | undefined): string[] {
  return [
    ...new Set(
      Object.values(mapping ?? {})
        .map((b) => b?.module)
        .filter((m): m is string => !!m),
    ),
  ];
}
