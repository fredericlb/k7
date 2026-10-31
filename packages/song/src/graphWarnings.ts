// graphWarnings.ts — validate()'s warnings as codes with their names, and the English sentence of
// each. The sentence is what a log or the CLI prints; a screen reads the code and words it in its
// own language (apps/k7/frontend/src/graphWarnings.ts). See docs/graphModel.md.

import type { GraphIssue, GraphWarningCode } from "@studio/graph-model";

type P = Record<string, string>;

const TEXT: Record<GraphWarningCode, (p: P) => string> = {
  chainFromUnknown: (p) =>
    `chain '${p.chain}': from '${p.from}' is not a track or chain`,
  chainMixedLane: (p) =>
    `chain '${p.chain}': track '${p.track}' holds audio AND sequences, and '${p.module}' takes ${p.wants} —` +
    ` all of it goes through it. Split the lane: '${p.track}#audio:' and '${p.track}#midi:'`,
  chainStepUnknown: (p) =>
    `chain '${p.chain}': step module '${p.module}' is not a module or module node${p.hint}`,
  chainExtendsUnknown: (p) =>
    `chain '${p.chain}': module '${p.module}' extends unknown module '${p.base}'`,
  chainTransitionWired: (p) =>
    `chain '${p.chain}': '${p.module}' is a transition, and a transition is not wired — a cut names it (\`fadeIn({ over: 1, with: "${p.module}" })\` on a shot of a picture lane)`,
  outIsInput: (p) =>
    `chain '${p.chain}': out '${p.out}' is a live input — signal comes FROM it, not to it`,
  outIsCamera: (p) =>
    `chain '${p.chain}': out '${p.out}' is a camera — picture comes FROM it, not to it`,
  outIsMidiDevice: (p) =>
    `chain '${p.chain}': out '${p.out}' is a MIDI device — notes come FROM it, not to it`,
  outIsPictureLane: (p) =>
    `chain '${p.chain}': out '${p.out}' is a picture lane — only a camera's or a shape's picture lands on one, or a run of shaders nothing feeds (a fade's \`chain:\`)`,
  outIsTrack: (p) =>
    `chain '${p.chain}': out '${p.out}' is a track — only a live input's or a MIDI device's signal lands on a lane`,
  outUnknown: (p) =>
    `chain '${p.chain}': out '${p.out}' is not a chain or io sink`,
  outNegativeGain: (p) =>
    `chain '${p.chain}': out '${p.out}' has a negative gain`,
  outBadPort: (p) =>
    `chain '${p.chain}': out '${p.out}' leaves '${p.source}' through '${p.port}', which is ` +
    `not one of its outputs (${p.outputs || "none"})`,
  chainDeadEnd: (p) => `chain '${p.chain}': has no out (dead end)`,
  trackClipMissing: (p) =>
    `track '${p.track}': clip/sequence '${p.ref}' not found`,
  moduleAssetMissing: (p) =>
    `module '${p.module}': ${p.param} '${p.ref}' is not in this module's assets/`,
  inputNoChannel: (p) => `input '${p.input}': no channel — it feeds nothing`,
  inputTrackDisabled: (p) =>
    `input '${p.input}': track '${p.track}' is disabled — it records nothing`,
  inputTrackMissing: (p) => `input '${p.input}': track '${p.track}' not found`,
  inputTrackGroup: (p) =>
    `input '${p.input}': track '${p.track}' is a group — it holds no material`,
  inputTrackStrudel: (p) =>
    `input '${p.input}': track '${p.track}' is a strudel lane — its pattern is the source`,
  trackTwoInputs: (p) =>
    `track '${p.track}': fed by two inputs ('${p.first}', '${p.second}') — only one can win`,
  moduleChannelNotInput: (p) =>
    `module '${p.module}': channel is for an io "in" module, but '${p.module}' is not one`,
  groupContainsItself: (p) => `group '${p.group}': contains itself`,
  groupTrackMissing: (p) => `group '${p.group}': track '${p.track}' not found`,
  trackTwoGroups: (p) =>
    `track '${p.track}': in two groups ('${p.first}', '${p.second}')`,
  assemblyNameTaken: (p) =>
    `assembly '${p.assembly}': a node of this project is already called that`,
  assemblyMemberMissing: (p) =>
    `assembly '${p.assembly}': member '${p.member}' names '${p.node}', which this project has not got`,
  nodeTwoAssemblies: (p) =>
    `node '${p.node}': in two assemblies ('${p.first}', '${p.second}')`,
  chainNoOut: (p) => `chain '${p.chain}': nothing reaches OUT`,
  chainCycle: (p) => `chain '${p.chain}': is part of a cycle`,
};

/** One warning, its English sentence built from the same names the code carries. */
export function issue(code: GraphWarningCode, params: P): GraphIssue {
  return { code, params, text: TEXT[code](params) };
}
