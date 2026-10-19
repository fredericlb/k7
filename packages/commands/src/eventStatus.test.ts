// `event status mute|warp` — the POLARITY, through the dispatcher and asserted on the file.
//
// The writers are each right on their own; what needs covering is the command's TRANSLATION
// between them, where a stray `!` lives. A test on the writer alone can never see it.
//
// The FILE is deliberately the opposite way round from the command, which is why this goes wrong
// quietly: an absent `warp` means "it warps, because the clip does", so `warp on` must leave
// NOTHING behind and `warp off` must write `false`.

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeDoc } from "@studio/song/testSupport";
import { wsData, wsText } from "@studio/song/yaml/workspaceDoc";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runCommand } from "./commandSpec";

let dir: string;
const logs: string[] = [];

function song(): string {
  const d = mkdtempSync(join(tmpdir(), "td-status-"));
  writeDoc(join(d, "project.k7x"), {
    project: { name: "t", tempo: 120, sampleRate: 48000 },
  });
  // One lane, one event on beat 1 — addressed as `1:1:1`.
  writeDoc(join(d, "nodes", "drums.k7x"), {
    extends: "@meta/track",
    events: [{ ref: "kick", start: "1:1:1" }],
  });
  return d;
}

const laneFile = () => join(dir, "nodes", "drums.k7x");
const laneText = () => wsText(laneFile());
const event = () => (wsData(laneFile()).events as Record<string, unknown>[])[0];

/** Built from the file each time, so a second command sees what the first wrote — hence `toggle`. */
const host = () =>
  ({
    songPath: dir,
    project: () => {
      const e = event();
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
                disabled: e.disabled === true,
                // As nodeProject does: `warp: false` present ⇒ this placement declines the map.
                warpOff: e.warp === false || undefined,
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
    expect(event().warp).toBe(false);
    await run("event status warp drums 1:1:1 on");
    // Not `warp: true`: the default is never written, so following the map is the ABSENCE.
    expect(event()).not.toHaveProperty("warp");
  });

  it("`off` is what declines the map, and says so", async () => {
    await run("event status warp drums 1:1:1 off");
    expect(event().warp).toBe(false);
    expect(logs.join(" ")).toContain("unwarped");
  });

  it("toggles from following to declining and back, leaving the file as it was", async () => {
    const before = laneText();
    await run("event status warp drums 1:1:1");
    expect(event().warp).toBe(false);
    await run("event status warp drums 1:1:1");
    expect(laneText()).toBe(before);
  });
});

describe("event status mute", () => {
  it("`on` silences it — the positive spelling, written", async () => {
    await run("event status mute drums 1:1:1 on");
    expect(event().disabled).toBe(true);
    expect(logs.join(" ")).toContain("muted");
  });

  it("`off` removes the field rather than writing the default", async () => {
    await run("event status mute drums 1:1:1 on");
    await run("event status mute drums 1:1:1 off");
    expect(event()).not.toHaveProperty("disabled");
  });

  it("the two aspects now read the same way round", async () => {
    // The point of the rename: `on` means the word after the verb is true, in both.
    await run("event status mute drums 1:1:1 on");
    await run("event status warp drums 1:1:1 on");
    expect(event().disabled).toBe(true);
    expect(event()).not.toHaveProperty("warp");
  });
});
