// Takes — the other lists of placements a lane keeps. Recording over what a lane holds moves
// those events into a take rather than throwing them away, and `track take select` swaps the two
// back. These files are hand-edited and in git, so what is pinned as hard as the values is the
// SHAPE: a take must read exactly like the arrangement it holds, comments and spelling included.

import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { ModuleSchema } from "./moduleSchema";
import {
  addPlacement,
  pushEventsToTake,
  removeAllTakes,
  removeTake,
  selectTake,
  takeValues,
} from "./trackFile";

const LANE = `extends: "@studio/track"
events:
  - { ref: gtr_1, start: "1:1" }
  - { ref: gtr_2, start: "5:1" }
`;

const parsed = (text: string) => parse(text, { version: "1.2" });
const valid = (text: string) => ModuleSchema.safeParse(parsed(text)).success;

describe("pushEventsToTake", () => {
  it("moves what the lane plays into a take, leaving it empty", () => {
    const after = pushEventsToTake(LANE);
    const m = parsed(after);
    expect(m.events).toEqual([]);
    expect(m.takes).toHaveLength(1);
    expect(m.takes[0].events).toEqual([
      { ref: "gtr_1", start: "1:1" },
      { ref: "gtr_2", start: "5:1" },
    ]);
    expect(valid(after)).toBe(true);
  });

  it("keeps each placement on its own line, as the file had them", () => {
    // A take is the arrangement put aside: it should not arrive as one 400-character row.
    expect(pushEventsToTake(LANE)).toContain('{ ref: gtr_1, start: "1:1" }');
  });

  it("stacks a second take beside the first", () => {
    const one = pushEventsToTake(LANE);
    const two = pushEventsToTake(
      one.replace("events: []", 'events:\n  - { ref: gtr_3, start: "1:1" }'),
    );
    const m = parsed(two);
    expect(m.takes).toHaveLength(2);
    expect(m.takes[1].events[0].ref).toBe("gtr_3");
  });

  it("makes NO take of a lane holding nothing", () => {
    // An empty take is a row that says nothing, and an empty lane is not recorded OVER.
    const empty = 'extends: "@studio/track"\nevents: []\n';
    expect(pushEventsToTake(empty)).toBe(empty);
  });
});

// A take holds what a pass DISPLACED, so the caller names the placements — docs/laneEdits.md.
describe("pushEventsToTake, narrowed", () => {
  const refs = (list: { ref: string }[] | undefined) =>
    (list ?? []).map((c) => c.ref);

  it("sets aside ONLY the placements named, the rest playing on", () => {
    const m = parsed(pushEventsToTake(LANE, undefined, [1]));
    expect(refs(m.events)).toEqual(["gtr_1"]);
    expect(m.takes[0].events).toEqual([{ ref: "gtr_2", start: "5:1" }]);
    expect(valid(pushEventsToTake(LANE, undefined, [1]))).toBe(true);
  });

  it("keeps a set-aside placement on its own line, as the file had it", () => {
    expect(pushEventsToTake(LANE, undefined, [1])).toContain(
      '      - { ref: gtr_2, start: "5:1" }',
    );
  });

  it("sets them aside in the order the lane played them", () => {
    const m = parsed(pushEventsToTake(LANE, undefined, [1, 0]));
    expect(refs(m.takes[0].events)).toEqual(["gtr_1", "gtr_2"]);
    expect(m.events).toEqual([]);
  });

  it("makes NO take when nothing was displaced, nor when the index is not there", () => {
    expect(pushEventsToTake(LANE, undefined, [])).toBe(LANE);
    expect(pushEventsToTake(LANE, undefined, [7])).toBe(LANE);
  });
});

describe("selectTake", () => {
  it("SWAPS the take with what the lane plays, so it is reversible", () => {
    const staged = pushEventsToTake(LANE).replace(
      "events: []",
      'events:\n  - { ref: gtr_3, start: "1:1" }',
    );
    const after = selectTake(staged, 1);
    const m = parsed(after);
    expect(m.events.map((c: { ref: string }) => c.ref)).toEqual([
      "gtr_1",
      "gtr_2",
    ]);
    expect(m.takes[0].events.map((c: { ref: string }) => c.ref)).toEqual([
      "gtr_3",
    ]);
    // Running it again puts everything back where it was.
    expect(
      parsed(selectTake(after, 1)).events.map((c: { ref: string }) => c.ref),
    ).toEqual(["gtr_3"]);
    expect(valid(after)).toBe(true);
  });

  it("refuses a take that is not there rather than emptying the lane", () => {
    const staged = pushEventsToTake(LANE);
    expect(() => selectTake(staged, 2)).toThrow(/no take/);
    expect(() => selectTake(staged, 0)).toThrow(/no take/);
  });

  it("leaves `keep` on the lane, and exchanges only the rest", () => {
    // gtr_1 is elsewhere in the song; gtr_3 is the pass that landed on gtr_2's ground.
    const staged = pushEventsToTake(LANE, undefined, [1]);
    const withPass = addPlacement(staged, { ref: "gtr_3", start: "5:1" });
    const after = selectTake(withPass, 1, [0]);
    const m = parsed(after);
    expect(m.events.map((c: { ref: string }) => c.ref)).toEqual([
      "gtr_1",
      "gtr_2",
    ]);
    expect(m.takes[0].events.map((c: { ref: string }) => c.ref)).toEqual([
      "gtr_3",
    ]);
    // Still its own undo, because the two passes cover the same ground.
    expect(selectTake(after, 1, [0])).toBe(withPass);
    expect(valid(after)).toBe(true);
  });
});

describe("removeTake", () => {
  it("takes the one asked for, and its events with it", () => {
    const one = pushEventsToTake(LANE);
    const two = pushEventsToTake(
      one.replace("events: []", 'events:\n  - { ref: gtr_3, start: "1:1" }'),
    );
    const after = removeTake(two, 1);
    const m = parsed(after);
    expect(m.takes).toHaveLength(1);
    expect(m.takes[0].events[0].ref).toBe("gtr_3");
  });

  it("leaves NO empty list behind when the last one goes", () => {
    // Absent is how a lane with no takes reads — `takes: []` would be a row of nothing.
    const after = removeTake(pushEventsToTake(LANE), 1);
    expect(after).not.toContain("takes");
    expect(valid(after)).toBe(true);
  });

  it("refuses one that is not there", () => {
    expect(() => removeTake(LANE, 1)).toThrow(/no take/);
  });
});

describe("removeAllTakes", () => {
  it("keeps what the lane plays and drops every take", () => {
    const two = pushEventsToTake(
      pushEventsToTake(LANE).replace(
        "events: []",
        'events:\n  - { ref: gtr_3, start: "1:1" }',
      ),
    );
    const after = removeAllTakes(two);
    expect(parsed(after).events).toEqual([]); // …whatever it was; here the second push emptied it
    expect(after).not.toContain("takes");
    expect(valid(after)).toBe(true);
  });

  it("keeps the arrangement itself untouched", () => {
    const staged = pushEventsToTake(LANE).replace(
      "events: []",
      'events:\n  - { ref: gtr_3, start: "1:1" }',
    );
    expect(parsed(removeAllTakes(staged)).events).toEqual([
      { ref: "gtr_3", start: "1:1" },
    ]);
  });

  it("leaves a lane with no takes exactly as it was", () => {
    expect(removeAllTakes(LANE)).toBe(LANE);
  });
});

describe("takeValues", () => {
  it("reads them back, in order", () => {
    expect(takeValues(LANE)).toEqual([]);
    const one = takeValues(pushEventsToTake(LANE));
    expect(one).toHaveLength(1);
    expect(one[0].events).toHaveLength(2);
  });
});

// An ALTERNATIVE may carry `takes:`, so a take belongs to the set it was played in (docs/laneEdits.md).
describe("takes inside an alternative", () => {
  const WITH_SET = `extends: "@studio/track"
events:
  - { ref: gtr_1, start: "1:1" }
alternative: loud
alternatives:
  - name: loud
    events:
      - { ref: loud_1, start: "1:1" }
`;

  it("goes to the SET that is on, leaving the module's own alone", () => {
    const after = pushEventsToTake(WITH_SET);
    const m = parsed(after);
    expect(m.takes).toBeUndefined(); // not the module's
    expect(m.alternatives[0].takes[0].events[0].ref).toBe("loud_1");
    expect(m.events[0].ref).toBe("gtr_1"); // set 1 untouched
    expect(valid(after)).toBe(true);
  });

  it("swaps within that set too", () => {
    const staged = pushEventsToTake(WITH_SET);
    const after = selectTake(staged, 1);
    const m = parsed(after);
    expect(m.alternatives[0].events[0].ref).toBe("loud_1");
    expect(m.events[0].ref).toBe("gtr_1"); // still untouched
  });
});
