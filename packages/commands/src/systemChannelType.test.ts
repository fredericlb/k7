// `system channel type` — two interface inputs heard as one device, or taken apart. The act has
// TWO halves and the whole point of the verb is that neither can happen without the other: the
// preference is what survives a restart, the engine message is what makes it true now.
//
// `setInputPair` is mocked rather than exercised, and that is not laziness: `PREFS_PATH` is
// `homedir()/.studio/preferences.yaml` read at module load, so a test of the real writer would
// rewrite the rig of whoever runs the suite (@studio/song's preferences.ts says the same thing
// about `normalizePreferences` being exported at all).

import { describe, expect, it, vi } from "vitest";
import { runCommand } from "./commandSpec";

const paired: { channel: number; stereo: boolean }[] = [];
vi.mock("@studio/song/preferences", async (real) => ({
  ...(await real<Record<string, unknown>>()),
  setInputPair: (channel: number, stereo: boolean) => {
    paired.push({ channel, stereo });
  },
}));

const logs: string[] = [];
const refusals: string[] = [];
const told: { channel: number; stereo: boolean }[] = [];

/** `engine` false is a host with no link — the case the verb still half-answers. */
const host = (engine = true) =>
  ({
    songPath: "",
    project: () => ({ tracks: [], groups: [] }),
    baseModules: [],
    log: (l: string[]) => logs.push(...l),
    refuse: (l: string[]) => refusals.push(...l),
    reload: () => {},
    ...(engine
      ? {
          setInputStereo: (channel: number, stereo: boolean) => {
            told.push({ channel, stereo });
            return true;
          },
        }
      : {}),
  }) as never;

const reset = (): void => {
  logs.length = 0;
  refusals.length = 0;
  paired.length = 0;
  told.length = 0;
};

describe("system channel type", () => {
  it("writes the rig's memory AND tells the engine", async () => {
    reset();
    await runCommand("system channel type 3 stereo", host(), "cli");
    expect(paired).toEqual([{ channel: 3, stereo: true }]);
    expect(told).toEqual([{ channel: 3, stereo: true }]);
    // Said as the PAIR, whichever half was named: 3 and 4 are one device or two.
    expect(logs.join(" ")).toMatch(/in 3\+4 is one stereo device/);
  });

  it("takes either half of the pair", async () => {
    reset();
    await runCommand("system channel type 4 mono", host(), "cli");
    // Passed on as TYPED: `setInputPair` normalises to the odd channel, and the engine rounds too.
    expect(paired).toEqual([{ channel: 4, stereo: false }]);
    expect(logs.join(" ")).toMatch(/in 3\+4 is two mono devices/);
  });

  it("remembers it with no engine, and says which half it did", async () => {
    reset();
    await runCommand("system channel type 1 stereo", host(false), "cli");
    expect(paired).toEqual([{ channel: 1, stereo: true }]);
    // Not a refusal: the durable half is done, and "it did nothing" would be the wrong reading.
    expect(refusals).toEqual([]);
    expect(logs.join(" ")).toMatch(
      /remembered; the engine hears it on its next connect/,
    );
  });

  it("refuses a mode that is neither, and writes nothing", async () => {
    reset();
    await runCommand("system channel type 3 loud", host(), "cli");
    expect(refusals.join(" ")).toMatch(/usage: system channel type/);
    expect(paired).toEqual([]);
    expect(told).toEqual([]);
  });

  it("refuses a channel that is not one — they count from 1", async () => {
    reset();
    await runCommand("system channel type 0 stereo", host(), "cli");
    expect(refusals.join(" ")).toMatch(/is not a channel/);
    expect(paired).toEqual([]);
  });
});
