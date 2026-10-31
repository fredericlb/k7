// chainsLabels.ts — the words of @studio/ui-chains-react's controls, filled from this app's
// catalogues and handed to every DomChains k7 mounts. The package stays English for its other
// hosts; this is how k7 reads it in French (docs/settings.md, "Where the words themselves live").

import type { ChainsLabels } from "@studio/ui-chains-react";
import { useMemo } from "react";
import { useLocale } from "./i18n";
import { m } from "./paraglide/messages.js";

export function chainsLabels(): ChainsLabels {
  return {
    stackView: m["chainsUi.stackView"](),
    stackViewHint: m["chainsUi.stackViewHint"](),
    zoomFit: m["chainsUi.zoomFit"](),
    zoomFitHint: m["chainsUi.zoomFitHint"](),
    organize: m["chainsUi.organize"](),
    organizeHint: m["chainsUi.organizeHint"](),
    seamsTitle: m["chainsUi.seamsTitle"](),
    addModuleEnd: m["chainsUi.addModuleEnd"](),
    addModuleBetween: (before, after) =>
      m["chainsUi.addModuleBetween"]({ before, after }),
    branchUnder: (name) => m["chainsUi.branchUnder"]({ name }),
    page: m["chainsUi.page"](),
    bindCurve: (name) => m["chainsUi.bindCurve"]({ name }),
    engineNamed: (engine) => m["chainsUi.engineNamed"]({ engine }),
    presetNamed: (preset) => m["chainsUi.presetNamed"]({ preset }),
    presetsOfModule: m["chainsUi.presetsOfModule"](),
    previousPreset: m["chainsUi.previousPreset"](),
    nextPreset: m["chainsUi.nextPreset"](),
    preset: m["chainsUi.preset"](),
    presetLoaded: (preset) => m["chainsUi.presetLoaded"]({ preset }),
    alternativeOn: (name) => m["chainsUi.alternativeOn"]({ name }),
    alternativeSwitch: (name) => m["chainsUi.alternativeSwitch"]({ name }),
    newAlternative: (from) => m["chainsUi.newAlternative"]({ from }),
    addTap: m["chainsUi.addTap"](),
    addTapHint: m["chainsUi.addTapHint"](),
    addTapOnNote: (note) => m["chainsUi.addTapOnNote"]({ note }),
    padByKit: (symbol, note) => m["chainsUi.padByKit"]({ symbol, note }),
    padSample: (symbol, sample) => m["chainsUi.padSample"]({ symbol, sample }),
    padNoSample: (symbol) => m["chainsUi.padNoSample"]({ symbol }),
    noteOfKit: m["chainsUi.noteOfKit"](),
    noteAnswers: m["chainsUi.noteAnswers"](),
    soundOfKit: m["chainsUi.soundOfKit"](),
    pickSample: m["chainsUi.pickSample"](),
    kit: m["chainsUi.kit"](),
    sampleEllipsis: m["chainsUi.sampleEllipsis"](),
    mute: (symbol) => m["chainsUi.mute"]({ symbol }),
    unmute: (symbol) => m["chainsUi.unmute"]({ symbol }),
    remove: (symbol) => m["chainsUi.remove"]({ symbol }),
    engineWarning: (warning) => m["chainsUi.engineWarning"]({ warning }),
    frozen: m["chainsUi.frozen"](),
    frozenAt: m["chainsUi.frozenAt"](),
    frozenInside: m["chainsUi.frozenInside"](),
    frozenAuto: m["chainsUi.frozenAuto"](),
    frozenAutoHere: m["chainsUi.frozenAutoHere"](),
    frozenAutoInside: (module) => m["chainsUi.frozenAutoInside"]({ module }),
    bypass: m["chainsUi.bypass"](),
    bypassed: m["chainsUi.bypassed"](),
    interfaceInput: (input) => m["chainsUi.interfaceInput"]({ input }),
    creatingModule: m["chainsUi.creatingModule"](),
    open: (name, uses) => m["chainsUi.open"]({ name, uses }),
    close: (name) => m["chainsUi.close"]({ name }),
    openPluginUi: m["chainsUi.openPluginUi"](),
    listen: m["chainsUi.listen"](),
    stop: m["chainsUi.stop"](),
    moduleNotFound: m["chainsUi.moduleNotFound"](),
    missingPlugin: m["chainsUi.missingPlugin"](),
    unknownPlugin: m["chainsUi.unknownPlugin"](),
    notSupported: m["chainsUi.notSupported"](),
    emptyStep: m["chainsUi.emptyStep"](),
  };
}

/** The labels in the language shown now, one object per locale so DomChains keeps its identity across renders. */
export function useChainsWords(): ChainsLabels {
  const { locale } = useLocale();
  // biome-ignore lint/correctness/useExhaustiveDependencies: the locale is the trigger, the messages read it themselves
  return useMemo(() => chainsLabels(), [locale]);
}
