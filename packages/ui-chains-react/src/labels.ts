// labels.ts — every word the graph draws on its own controls, as one object a host may override.
// The package has no catalogue (it draws in more than one app): English is the default, and a host
// hands in its own translation through `DomChains`'s `labels` prop. See ../docs/hosting.md.

import { createContext, useContext } from "react";

export interface ChainsLabels {
  stackView: string;
  stackViewHint: string;
  zoomFit: string;
  zoomFitHint: string;
  organize: string;
  organizeHint: string;
  seamsTitle: string;
  addModuleEnd: string;
  addModuleBetween: (before: string, after: string) => string;
  branchUnder: (name: string) => string;
  /** The tab menu of a narrow card. */
  page: string;
  bindCurve: (name: string) => string;
  engineNamed: (engine: string) => string;
  presetNamed: (preset: string) => string;
  presetsOfModule: string;
  previousPreset: string;
  nextPreset: string;
  /** The dropdown's own word while no preset is loaded. */
  preset: string;
  /** Its accessible name while one is: what a screen reader hears is what is loaded. */
  presetLoaded: (preset: string) => string;
  alternativeOn: (name: string) => string;
  alternativeSwitch: (name: string) => string;
  newAlternative: (from: string) => string;
  addTap: string;
  addTapHint: string;
  addTapOnNote: (note: string) => string;
  padByKit: (symbol: string, note: string) => string;
  padSample: (symbol: string, sample: string) => string;
  padNoSample: (symbol: string) => string;
  noteOfKit: string;
  noteAnswers: string;
  soundOfKit: string;
  pickSample: string;
  kit: string;
  sampleEllipsis: string;
  mute: (symbol: string) => string;
  unmute: (symbol: string) => string;
  remove: (symbol: string) => string;
  engineWarning: (warning: string) => string;
  frozen: string;
  frozenAt: string;
  frozenInside: string;
  frozenAuto: string;
  frozenAutoHere: string;
  frozenAutoInside: (module: string) => string;
  bypass: string;
  bypassed: string;
  interfaceInput: (input: string) => string;
  creatingModule: string;
  open: (name: string, uses: string) => string;
  close: (name: string) => string;
  openPluginUi: string;
  listen: string;
  stop: string;
  moduleNotFound: string;
  missingPlugin: string;
  unknownPlugin: string;
  notSupported: string;
  emptyStep: string;
}

export const ENGLISH_CHAINS_LABELS: ChainsLabels = {
  stackView: "Stack view",
  stackViewHint: "Stack view — a column per track, the mix last (ui stack)",
  zoomFit: "Zoom fit",
  zoomFitHint: "Zoom fit — frame the whole graph",
  organize: "Organize",
  organizeHint: "Organize — lay the graph out again (graph organize)",
  seamsTitle: "Where a module can be added",
  addModuleEnd: "Add a module at the end",
  addModuleBetween: (before, after) =>
    `Add a module between ${before} and ${after}`,
  branchUnder: (name) => `Branch: stack a module under ${name}`,
  page: "page",
  bindCurve: (name) => `bind the curve to ${name}`,
  engineNamed: (engine) => `Engine — ${engine}`,
  presetNamed: (preset) => `Preset — ${preset}`,
  presetsOfModule: "Presets of this module",
  previousPreset: "Previous preset",
  nextPreset: "Next preset",
  preset: "preset",
  presetLoaded: (preset) => `preset: ${preset}`,
  alternativeOn: (name) =>
    `Alternative "${name}" — the settings this node is playing now`,
  alternativeSwitch: (name) =>
    `Play this node with the "${name}" settings instead`,
  newAlternative: (from) => `New alternative — a copy of "${from}"`,
  addTap: "Add a tap",
  addTapHint: "Add a tap — then pick its sample",
  addTapOnNote: (note) => `Add a tap on note ${note} — then pick its sample`,
  padByKit: (symbol, note) => `${symbol} — note ${note}, played by the kit`,
  padSample: (symbol, sample) => `${symbol} — ${sample}`,
  padNoSample: (symbol) => `${symbol} — no sample yet`,
  noteOfKit: "The note the kit plays it on",
  noteAnswers: "The note it answers to — click to type another",
  soundOfKit: "Its sound is the kit's: velocity layers and round-robins",
  pickSample: "pick a sample from a library's samples/",
  kit: "kit",
  sampleEllipsis: "sample…",
  mute: (symbol) => `Mute ${symbol}`,
  unmute: (symbol) => `Unmute ${symbol}`,
  remove: (symbol) => `Remove ${symbol}`,
  engineWarning: (warning) => `engine warning: ${warning}`,
  frozen: "frozen",
  frozenAt:
    "Frozen here — everything upstream is playing as one render. Unfreeze from the right-click menu.",
  frozenInside:
    "Inside a render — this node is baked and is not running. Unfreeze the point downstream of it.",
  frozenAuto: "frozen automatically",
  frozenAutoHere:
    "Frozen automatically — this VST and everything upstream play as a render, so an engine without the VST can play it. Touch a control to edit it live.",
  frozenAutoInside: (module) =>
    `Inside ${module}'s automatic render. Touch a control to edit it live.`,
  bypass: "Bypass",
  bypassed: "Bypassed — click to re-enable",
  interfaceInput: (input) => `Interface input: ${input} — click to change`,
  creatingModule: "creating a module",
  open: (name, uses) => `Open ${name} — ${uses}`,
  close: (name) => `Close ${name}`,
  openPluginUi: "Open native plugin UI",
  listen: "Listen",
  stop: "Stop",
  moduleNotFound: "module not found",
  missingPlugin: "missing plugin",
  unknownPlugin: "unknown plugin",
  notSupported: "not supported",
  emptyStep: "empty step",
};

export const ChainsLabelsContext = createContext<ChainsLabels>(
  ENGLISH_CHAINS_LABELS,
);

/** The labels in force under the nearest `DomChains`, English outside one. */
export const useChainsLabels = (): ChainsLabels =>
  useContext(ChainsLabelsContext);
