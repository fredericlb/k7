// `transport arm <track> [on|off]`: a bare arm toggles in the engine, a stated one sets.
// A caller that cannot wait for the engine's echo states it, or its toggle undoes a fresh arm (docs/verbs.md).

import type { ProjectDoc } from "@studio/song/project";
import { describe, expect, it } from "vitest";
import { runCommand } from "./commandSpec";
import { testHost } from "./testHost";

const song = () =>
  ({
    name: "s",
    recordDir: "/s/clips",
    tracks: [{ id: "vox", name: "vox", inputChannels: [1] }],
    groups: [],
  }) as unknown as ProjectDoc;

/** Runs `line` and answers what reached the host's arm, and the host's lines. */
async function arm(line: string) {
  const calls: [string, boolean | undefined][] = [];
  const host = testHost({
    project: song,
    arm: async (track, armed) => {
      calls.push([track, armed]);
      return armed ?? true;
    },
  });
  await runCommand(line, host, "cli");
  return { calls, lines: host.lines };
}

describe("transport arm", () => {
  it("toggles when no state is given", async () => {
    expect((await arm("transport arm vox")).calls).toEqual([
      ["vox", undefined],
    ]);
  });

  it("sets the arm when on or off is given", async () => {
    expect((await arm("transport arm vox on")).calls).toEqual([["vox", true]]);
    expect((await arm("transport arm vox off")).calls).toEqual([
      ["vox", false],
    ]);
  });

  it("refuses a state that is neither on nor off", async () => {
    const { calls, lines } = await arm("transport arm vox maybe");
    expect(calls).toEqual([]);
    expect(lines.refuse.join("\n")).toMatch(/\[on\|off\]/);
  });
});
