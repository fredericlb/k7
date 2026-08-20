// `events move` — the bulk form of `event move`, through the dispatcher, asserting the FILES:
// the range decides which placements move, the tracks argument names the lanes (or `all`),
// and a refusal must leave every file byte-identical — a partial bulk write would be worse
// than either doing the work or not.

import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  clipDoc as clip,
  emptyDoc,
  trackDoc as track,
} from "@studio/engine-protocol/build";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runCommand } from "./commandSpec";

let dir: string;
const logs: string[] = [];
let reloads = 0;
let refused = false;

/** Two real lanes on disk; the compiled doc below mirrors their starts in beats (4/4). */
function song(): string {
  const d = mkdtempSync(join(tmpdir(), "td-eventsmove-"));
  mkdirSync(join(d, "nodes"), { recursive: true });
  writeFileSync(
    join(d, "nodes", "drums.yaml"),
    'extends: "@studio/track"\nevents:\n  - { ref: kick, start: "2:1" }\n  - { ref: snare, start: "4:1" }\n',
    "utf8",
  );
  writeFileSync(
    join(d, "nodes", "bass.yaml"),
    'extends: "@studio/track"\nevents:\n  - { ref: b1, start: "1:1" }\n  - { ref: b2, start: "3:1" }\n',
    "utf8",
  );
  return d;
}
const read = (name: string) =>
  readFileSync(join(dir, "nodes", `${name}.yaml`), "utf8");

// The generated lane has NO file in nodes/ on purpose: `all` must skip it without looking,
// and a named refusal must come before any write — either slip would throw or corrupt.
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

describe("events move", () => {
  it("moves every event in the range on each named lane, one reload for all of it", async () => {
    // Range 2:1..4:1 == beats [4, 12]: kick and snare on drums, b2 on bass — not b1 at 1:1.
    await runCommand("events move drums,bass 2:1 4:1 +1:0", host(), "cli");
    expect(read("drums")).toContain('start: "3:1"');
    expect(read("drums")).toContain('start: "5:1"');
    expect(read("bass")).toContain('start: "4:1"');
    expect(read("bass")).toContain('start: "1:1"'); // b1 stayed
    expect(logs.join(" ")).toContain("moved 3 events on drums, bass by +1:0");
    expect(refused).toBe(false); // a report, not a refusal — the flag separates them
    expect(reloads).toBe(1);
  });

  it("'all' is every lane that can hold placements — the generated one is skipped, not visited", async () => {
    await runCommand("events move all 1:1 9:1 +0:1", host(), "cli");
    // orbit has no file; reaching for it would have thrown before this line.
    expect(logs.join(" ")).toContain("moved 4 events on drums, bass");
    expect(reloads).toBe(1);
  });

  it("swaps a backwards range rather than refusing it", async () => {
    await runCommand("events move drums 4:1 2:1 +1:0", host(), "cli");
    expect(logs.join(" ")).toContain("moved 2 events");
  });

  it("refuses a NAMED generated lane outright", async () => {
    const before = read("drums");
    await runCommand("events move orbit,drums 1:1 9:1 +0:1", host(), "cli");
    expect(logs.join(" ")).toContain("generated");
    expect(refused).toBe(true);
    expect(read("drums")).toBe(before);
    expect(reloads).toBe(0);
  });

  it("refuses a delta that would push an event before 1:1:1, writing nothing anywhere", async () => {
    const drums = read("drums");
    const bass = read("bass");
    // b1 sits at 1:1; a bar left is refused for the WHOLE command, drums included.
    await runCommand("events move drums,bass 1:1 4:1 -1:0", host(), "cli");
    expect(logs.join(" ")).toContain("before 1:1:1");
    expect(refused).toBe(true);
    expect(read("drums")).toBe(drums);
    expect(read("bass")).toBe(bass);
    expect(reloads).toBe(0);
  });

  it("says so when the range holds nothing", async () => {
    await runCommand("events move drums 9:1 12:1 +1:0", host(), "cli");
    expect(logs.join(" ")).toContain("no events between 9:1 and 12:1");
    expect(refused).toBe(true);
    expect(reloads).toBe(0);
  });

  it("names the unknown track and offers the real ones", async () => {
    await runCommand("events move nope 1:1 2:1 +1:0", host(), "cli");
    expect(logs.join(" ")).toContain('no track "nope"');
    expect(refused).toBe(true);
  });

  it("a zero delta is a no-op, said plainly", async () => {
    await runCommand("events move drums 1:1 9:1 +0:0", host(), "cli");
    expect(logs.join(" ")).toContain("nothing to do");
    expect(refused).toBe(true);
    expect(reloads).toBe(0);
  });
});
