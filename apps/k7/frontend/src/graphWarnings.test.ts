import type { GraphIssue, GraphWarningCode } from "@studio/graph-model";
import { describe, expect, it } from "vitest";
import { graphWarningLines } from "./graphWarnings";

// The names @studio/song's graphWarnings.ts gives each code: a message asking for another prints "undefined".
const NAMES: Record<GraphWarningCode, string[]> = {
  chainFromUnknown: ["chain", "from"],
  chainMixedLane: ["chain", "track", "module", "wants"],
  chainStepUnknown: ["chain", "module", "hint"],
  chainExtendsUnknown: ["chain", "module", "base"],
  chainTransitionWired: ["chain", "module"],
  outIsInput: ["chain", "out"],
  outIsCamera: ["chain", "out"],
  outIsMidiDevice: ["chain", "out"],
  outIsPictureLane: ["chain", "out"],
  outIsTrack: ["chain", "out"],
  outUnknown: ["chain", "out"],
  outNegativeGain: ["chain", "out"],
  outBadPort: ["chain", "out", "source", "port", "outputs"],
  chainDeadEnd: ["chain"],
  trackClipMissing: ["track", "ref"],
  moduleAssetMissing: ["module", "param", "ref"],
  inputNoChannel: ["input"],
  inputTrackDisabled: ["input", "track"],
  inputTrackMissing: ["input", "track"],
  inputTrackGroup: ["input", "track"],
  inputTrackStrudel: ["input", "track"],
  trackTwoInputs: ["track", "first", "second"],
  moduleChannelNotInput: ["module"],
  groupContainsItself: ["group"],
  groupTrackMissing: ["group", "track"],
  trackTwoGroups: ["track", "first", "second"],
  assemblyNameTaken: ["assembly"],
  assemblyMemberMissing: ["assembly", "member", "node"],
  nodeTwoAssemblies: ["node", "first", "second"],
  chainNoOut: ["chain"],
  chainCycle: ["chain"],
};

const issueOf = (code: GraphWarningCode): GraphIssue => ({
  code,
  params: Object.fromEntries(NAMES[code].map((k) => [k, `<${k}>`])),
  text: `raw ${code}`,
});

describe("graphWarningLines", () => {
  it("words every code with every name it carries", () => {
    for (const code of Object.keys(NAMES) as GraphWarningCode[]) {
      const [line] = graphWarningLines({
        warnings: [`raw ${code}`],
        issues: [issueOf(code)],
      });
      expect(line, code).not.toMatch(/undefined|raw /);
      for (const k of NAMES[code])
        if (k !== "hint") expect(line, `${code}.${k}`).toContain(`<${k}>`);
    }
  });

  it("names the group and the track a group misses", () => {
    const lines = graphWarningLines({
      warnings: ["group 'live': track 'pad' not found"],
      issues: [
        {
          code: "groupTrackMissing",
          params: { group: "live", track: "pad" },
          text: "group 'live': track 'pad' not found",
        },
      ],
    });
    expect(lines).toEqual(["group 'live': track 'pad' not found"]);
  });

  it("shows a warning with no code as it came", () => {
    expect(
      graphWarningLines({ warnings: ["level 'x' is played by nothing"] }),
    ).toEqual(["level 'x' is played by nothing"]);
  });
});
