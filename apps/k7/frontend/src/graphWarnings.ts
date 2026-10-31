// graphWarnings.ts — the graph's warnings in the language shown: each one validate() raised comes
// with a code and its names (@studio/song's graphWarnings.ts), worded here; any other warning, or
// one from a server that sends no codes, is shown as the English sentence it came as.

import type { GraphIssue, GraphWarningCode } from "@studio/graph-model";
import { m } from "./paraglide/messages.js";

type P = Record<string, string>;

// The names arrive as a plain map; graphWarnings.test.ts is what checks each message asks for no other.
const say =
  (f: (p: never) => string) =>
  (p: P): string =>
    f(p as never);

const WORDS: Record<GraphWarningCode, (p: P) => string> = {
  chainFromUnknown: say(m["graphWarn.chainFromUnknown"]),
  chainMixedLane: say(m["graphWarn.chainMixedLane"]),
  chainStepUnknown: say(m["graphWarn.chainStepUnknown"]),
  chainExtendsUnknown: say(m["graphWarn.chainExtendsUnknown"]),
  chainTransitionWired: say(m["graphWarn.chainTransitionWired"]),
  outIsInput: say(m["graphWarn.outIsInput"]),
  outIsCamera: say(m["graphWarn.outIsCamera"]),
  outIsMidiDevice: say(m["graphWarn.outIsMidiDevice"]),
  outIsPictureLane: say(m["graphWarn.outIsPictureLane"]),
  outIsTrack: say(m["graphWarn.outIsTrack"]),
  outUnknown: say(m["graphWarn.outUnknown"]),
  outNegativeGain: say(m["graphWarn.outNegativeGain"]),
  outBadPort: (p) =>
    say(m["graphWarn.outBadPort"])({
      ...p,
      outputs: p.outputs || m["graphWarn.none"](),
    }),
  chainDeadEnd: say(m["graphWarn.chainDeadEnd"]),
  trackClipMissing: say(m["graphWarn.trackClipMissing"]),
  moduleAssetMissing: say(m["graphWarn.moduleAssetMissing"]),
  inputNoChannel: say(m["graphWarn.inputNoChannel"]),
  inputTrackDisabled: say(m["graphWarn.inputTrackDisabled"]),
  inputTrackMissing: say(m["graphWarn.inputTrackMissing"]),
  inputTrackGroup: say(m["graphWarn.inputTrackGroup"]),
  inputTrackStrudel: say(m["graphWarn.inputTrackStrudel"]),
  trackTwoInputs: say(m["graphWarn.trackTwoInputs"]),
  moduleChannelNotInput: say(m["graphWarn.moduleChannelNotInput"]),
  groupContainsItself: say(m["graphWarn.groupContainsItself"]),
  groupTrackMissing: say(m["graphWarn.groupTrackMissing"]),
  trackTwoGroups: say(m["graphWarn.trackTwoGroups"]),
  assemblyNameTaken: say(m["graphWarn.assemblyNameTaken"]),
  assemblyMemberMissing: say(m["graphWarn.assemblyMemberMissing"]),
  nodeTwoAssemblies: say(m["graphWarn.nodeTwoAssemblies"]),
  chainNoOut: say(m["graphWarn.chainNoOut"]),
  chainCycle: say(m["graphWarn.chainCycle"]),
};

/** Every warning of a graph, in order, each in this screen's words when its code is known. */
export function graphWarningLines(graph: {
  warnings: string[];
  issues?: GraphIssue[];
}): string[] {
  const byText = new Map(graph.issues?.map((i) => [i.text, i]));
  return graph.warnings.map((w) => {
    const i = byText.get(w);
    const word = i && WORDS[i.code];
    return word ? word(i.params) : w;
  });
}
