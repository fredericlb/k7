// `event status mute|warp` — the POLARITY, through the dispatcher and asserted on the file.
//
// Both writers had tests and were right; the command's translation between them had none, and
// that is where the stray `!` lived. A test on the writer alone could never see it.
//
// The FILE is deliberately the opposite way round from the command, which is why this goes wrong
// quietly: an absent `warp` means "it warps, because the clip does", so `warp on` must leave
// NOTHING behind and `warp off` must write `false`.

import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runCommand } from "./commandSpec";

let dir: string;
const logs: string[] = [];

/** One lane, one event on beat 1 — addressed as `1:1:1`. */
const LANE = `extends: "@studio/track"
events:
  - { ref: kick, start: "1:1:1" }
`;

function song(): string {
  const d = mkdtempSync(join(tmpdir(), "td-status-"));
  writeFileSync(
    join(d, "project.yaml"),
    "project:\n  name: t\n  tempo: 120\n  sampleRate: 48000\n",
    "utf8",
  );
  mkdirSync(join(d, "nodes"), { recursive: true });
  writeFileSync(join(d, "nodes", "drums.yaml"), LANE, "utf8");
  return d;
}

const laneText = () => readFileSync(join(dir, "nodes", "drums.yaml"), "utf8");

/**
 * The compiled event the command reads its CURRENT state from.
 *
 * Built from the file each time it is asked, so a second command in one test sees what the first
 * wrote — which is what makes `toggle` testable at all.
 */
const host = () =>
  ({
    songPath: dir,
    project: () => {
      const text = laneText();
      return {
        tempo: 120,
        timeSigNumerator: 4,
        timeSigDenominator: 4,
        tracks: [
          {
            id: "drums",
            name: "drums",
            clips: [
              {
                id: "kick",
                name: "kick",
                start: 0,
                disabled: /disabled:\s*true/.test(text),
                // The file's negative spelling, turned into the compiler's flag exactly as
                // nodeProject does: `warp: false` present ⇒ this placement declines the map.
                warpOff: /warp:\s*false/.test(text) || undefined,
              },
            ],
          },
        ],
      };
    },
    baseModules: [],
    log: (l: string[]) => logs.push(...l),
    refuse: (l: string[]) => logs.push(...l),
    reload: () => {},
    showNativePluginUI: () => {},
  }) as never;

const run = (line: string) => runCommand(line, host(), "cli");

beforeEach(() => {
  dir = song();
  logs.length = 0;
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("event status warp", () => {
  it("`on` makes the event FOLLOW the map — so it writes nothing", async () => {
    await run("event status warp drums 1:1:1 off");
    expect(laneText()).toMatch(/warp:\s*false/);
    await run("event status warp drums 1:1:1 on");
    // Not `warp: true`: the default is never written, so following the map is the ABSENCE.
    expect(laneText()).not.toMatch(/warp:/);
  });

  it("`off` is what declines the map, and says so", async () => {
    await run("event status warp drums 1:1:1 off");
    expect(laneText()).toMatch(/warp:\s*false/);
    expect(logs.join(" ")).toContain("unwarped");
  });

  it("toggles from following to declining and back, leaving the file as it was", async () => {
    const before = laneText();
    await run("event status warp drums 1:1:1");
    expect(laneText()).toMatch(/warp:\s*false/);
    await run("event status warp drums 1:1:1");
    expect(laneText()).toBe(before);
  });
});

describe("event status mute", () => {
  it("`on` silences it — the positive spelling, written", async () => {
    await run("event status mute drums 1:1:1 on");
    expect(laneText()).toMatch(/disabled:\s*true/);
    expect(logs.join(" ")).toContain("muted");
  });

  it("`off` removes the field rather than writing the default", async () => {
    await run("event status mute drums 1:1:1 on");
    await run("event status mute drums 1:1:1 off");
    expect(laneText()).not.toMatch(/disabled:/);
  });

  it("the two aspects now read the same way round", async () => {
    // The point of the rename, stated as a test: `on` means the word after the verb is true, in
    // both — one silences, the other follows the map — and neither is the odd one out.
    await run("event status mute drums 1:1:1 on");
    await run("event status warp drums 1:1:1 on");
    expect(laneText()).toMatch(/disabled:\s*true/);
    expect(laneText()).not.toMatch(/warp:/);
  });
});
