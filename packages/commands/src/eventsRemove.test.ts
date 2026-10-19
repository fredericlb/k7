// `events remove` — the bulk form of `event remove`, through the dispatcher, asserting the FILES:
// every named event goes in one command and one reload, and a refusal leaves every file as it was.

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  clipDoc as clip,
  emptyDoc,
  trackDoc as track,
} from "@studio/engine-protocol/build";
import { writeLane } from "@studio/song/testSupport";
import { wsData, wsText } from "@studio/song/yaml/workspaceDoc";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runCommand } from "./commandSpec";

let dir: string;
const logs: string[] = [];
let reloads = 0;
let refused = false;

/** Two real lanes on disk; the compiled doc below mirrors their starts in beats (4/4). */
function song(): string {
  const d = mkdtempSync(join(tmpdir(), "td-eventsremove-"));
  writeLane(d, "drums", "track", {
    events: [
      { ref: "kick", start: "2:1" },
      { ref: "snare", start: "4:1" },
    ],
  });
  writeLane(d, "bass", "track", {
    events: [
      { ref: "b1", start: "1:1" },
      { ref: "b2", start: "3:1" },
    ],
  });
  return d;
}
const file = (name: string) => join(dir, "nodes", `${name}.k7x`);
const read = (name: string) => wsText(file(name));
const refs = (name: string) =>
  (wsData(file(name)).events as { ref: string }[]).map((e) => e.ref);

// The generated lane has NO file in nodes/ on purpose: `all` must skip it without looking.
const proj = () =>
  emptyDoc({
    name: "t",
    tracks: [
      track("drums", {
        clips: [
          clip({ id: "kick", type: "audio", start: 4 }),
          clip({ id: "snare", type: "audio", start: 12 }),
        ],
      }),
      track("bass", {
        clips: [
          clip({ id: "b1", type: "audio", start: 0 }),
          clip({ id: "b2", type: "audio", start: 8 }),
        ],
      }),
      track("orbit", {
        generated: true,
        clips: [clip({ id: "g", type: "midi", start: 4 })],
      }),
    ],
  });

const host = () =>
  ({
    songPath: dir,
    project: proj,
    baseModules: [],
    log: (l: string[]) => logs.push(...l),
    refuse: (l: string[]) => {
      refused = true;
      logs.push(...l);
    },
    reload: () => {
      reloads++;
    },
  }) as never;

beforeEach(() => {
  dir = song();
  logs.length = 0;
  refused = false;
  reloads = 0;
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("events remove", () => {
  it("removes every named event, across lanes, with one reload", async () => {
    const line = `events remove ${JSON.stringify([
      { track: "drums", start: "2:1" },
      { track: "bass", start: "3:1" },
    ])}`;
    await runCommand(line, host(), "cli");
    expect(refs("drums")).toEqual(["snare"]);
    expect(refs("bass")).toEqual(["b1"]);
    expect(logs.join(" ")).toContain("removed 2 events from drums, bass");
    expect(refused).toBe(false);
    expect(reloads).toBe(1);
  });

  it("refuses the lot when one event is not there, and writes nothing", async () => {
    const before = [read("drums"), read("bass")];
    const line = `events remove ${JSON.stringify([
      { track: "drums", start: "2:1" },
      { track: "bass", start: "2:1" },
    ])}`;
    await runCommand(line, host(), "cli");
    expect(refused).toBe(true);
    expect(logs.join(" ")).toContain("no event on 'bass' at 2:1");
    expect([read("drums"), read("bass")]).toEqual(before);
    expect(reloads).toBe(0);
  });

  it("refuses a payload that is not a list of events", async () => {
    await runCommand("events remove drums 2:1", host(), "cli");
    expect(refused).toBe(true);
    expect(logs.join(" ")).toContain("usage: events remove");
  });
});
