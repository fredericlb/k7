// Editing a lane that is playing one of its ALTERNATIVES must edit that one.
//
// A lane is a module node and its takes are that module's attribute sets, so `events:` exists in
// two places at once: the module's own (which is set "1") and one per entry under
// `alternatives:`. Every edit here used to write the module's own list whichever set was on, so
// moving a clip while on take 2 silently rewrote take 1 — the arrangement you were NOT looking
// at. See docs/alternatives.md and the `eventsIn`/`eventsToEdit` pair in trackFile.ts.

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
import { parse } from "yaml";
import { newModuleAlternative } from "../projectEdit";
import { writeLane, writeNode } from "../testSupport";
import { addAlternative } from "./alternativeFile";
import { parseModule } from "./moduleFile";
import {
  addPlacement,
  findPlacement,
  movePlacement,
  placementValues,
  removePlacement,
  setPlacementField,
} from "./trackFile";

/** A lane on its SECOND set, which states nothing — so it plays the module's own arrangement. */
const INHERITING = `extends: "@studio/track"
events:
  - { ref: take1_a, start: "1:1" }
  - { ref: take1_b, start: "5:1" }
alternatives:
  - {}
alternative: "2"
`;

/** The same lane on a second set that states an arrangement of its OWN. */
const OWN = `extends: "@studio/track"
events:
  - { ref: take1_a, start: "1:1" }
alternatives:
  - events:
      - { ref: take2_a, start: "9:1" }
alternative: "2"
`;

const own = (text: string) => parse(text, { version: "1.2" }).events;
const alt = (text: string, i = 0) =>
  parse(text, { version: "1.2" }).alternatives[i].events;

describe("a lane playing an alternative", () => {
  it("reads through to the arrangement it inherits", () => {
    // What is on screen is the merged view, so what an edit ADDRESSES has to be that too.
    expect(placementValues(INHERITING).map((p) => p.ref)).toEqual([
      "take1_a",
      "take1_b",
    ]);
    expect(findPlacement(INHERITING, "5:1")).toBe(1);
  });

  it("reads its OWN arrangement when it states one", () => {
    expect(placementValues(OWN).map((p) => p.ref)).toEqual(["take2_a"]);
    expect(findPlacement(OWN, "9:1")).toBe(0);
    expect(findPlacement(OWN, "1:1")).toBe(-1); // set 1's clip is not this set's
  });

  it("moves a clip into the SET, leaving the module's own arrangement alone", () => {
    const after = movePlacement(INHERITING, "1:1", "3:1");
    // The bug: this used to be [3:1, 5:1] — take 1 rewritten by an edit made on take 2.
    expect(own(after)).toEqual([
      { ref: "take1_a", start: "1:1" },
      { ref: "take1_b", start: "5:1" },
    ]);
    expect(alt(after)).toEqual([
      { ref: "take1_a", start: "3:1" },
      { ref: "take1_b", start: "5:1" },
    ]);
    expect(parseModule(after).issues).toEqual([]);
  });

  it("forks ONCE: a second edit lands on the set's own list, not on a copy of a copy", () => {
    const after = movePlacement(
      movePlacement(INHERITING, "1:1", "3:1"),
      "5:1",
      "7:1",
    );
    expect(own(after)).toHaveLength(2);
    expect(alt(after)).toEqual([
      { ref: "take1_a", start: "3:1" },
      { ref: "take1_b", start: "7:1" },
    ]);
    expect(parse(after, { version: "1.2" }).alternatives).toHaveLength(1);
  });

  it("removes, appends and flags inside the set", () => {
    const removed = removePlacement(INHERITING, "1:1");
    expect(own(removed)).toHaveLength(2);
    expect(alt(removed).map((p: { ref: string }) => p.ref)).toEqual([
      "take1_b",
    ]);

    const added = addPlacement(OWN, { ref: "take2_b", start: "13:1" });
    expect(own(added)).toHaveLength(1);
    expect(alt(added).map((p: { ref: string }) => p.ref)).toEqual([
      "take2_a",
      "take2_b",
    ]);

    const flagged = setPlacementField(OWN, 0, "disabled", true);
    expect(alt(flagged)[0].disabled).toBe(true);
    expect(own(flagged)[0].disabled).toBeUndefined();
  });

  it("forks in the file's own idiom, not as one long flow row", () => {
    // An empty set is written `- {}`, and a flow map keeps everything inside it on one line: the
    // forked arrangement arrived as a single 400-character row. These files are read by people.
    const after = movePlacement(INHERITING, "1:1", "3:1");
    expect(after).toContain("  - events:\n");
    expect(after).toContain('      - { ref: take1_a, start: "3:1" }\n');
    expect(after.split("\n").every((l) => l.length < 120)).toBe(true);
  });

  it("still edits the module's own list when the FIRST set is on", () => {
    // The ordinary case, and the one that must not have moved: no `alternative:` key at all.
    const plain = `extends: "@studio/track"
events:
  - { ref: a, start: "1:1" }
`;
    const after = movePlacement(plain, "1:1", "2:1");
    expect(own(after)).toEqual([{ ref: "a", start: "2:1" }]);
    expect(after).not.toContain("alternatives");
  });
});

/** A lane on its own, no sets yet — what `create` is asked about most. */
const PLAIN = `extends: "@studio/track"
events:
  - { ref: take1_a, start: "1:1" }
  - { ref: take1_b, start: "5:1" }
`;

describe("creating an alternative", () => {
  it("blanks a LANE's clips, so a new take is a new take", () => {
    // A set states only what it changes, so an empty entry would inherit the arrangement and the
    // new take would open holding the old one's placements. `events: []` says it outright — a list
    // is a scalar to the merge, which is what a lane's takes need.
    const { text, name } = addAlternative(PLAIN, undefined, {
      blankEvents: true,
    });
    expect(name).toBe("2");
    expect(alt(text)).toEqual([]);
    expect(own(text)).toHaveLength(2); // set 1 keeps everything it had
    expect(parseModule(text).issues).toEqual([]);
  });

  it("does NOT blank anything on a module that is not a lane", () => {
    const amp = `extends: "@project/audio/amp"
params: { Gain: 3 }
`;
    const { text } = addAlternative(amp);
    expect(parse(text, { version: "1.2" }).alternatives[0]).toEqual({});
  });

  it("a COPY still starts from what is playing, blankEvents or not", () => {
    const { text } = addAlternative(OWN, "third", {
      copy: true,
      blankEvents: true,
    });
    expect(alt(text, 1)).toEqual([{ ref: "take2_a", start: "9:1" }]);
  });

  it("the new take is EDITABLE without touching the old one", () => {
    // The two halves together, which is the whole report: create, then place a clip.
    const created = addAlternative(PLAIN, undefined, {
      blankEvents: true,
    }).text;
    const after = addPlacement(created, { ref: "take2_a", start: "1:1" });
    expect(own(after).map((p: { ref: string }) => p.ref)).toEqual([
      "take1_a",
      "take1_b",
    ]);
    expect(alt(after)).toEqual([{ ref: "take2_a", start: "1:1" }]);
  });
});

// The layer that decides `blankEvents`, since whether a module is a LANE is a question about what
// it extends — and only the loader can answer it.
describe("newModuleAlternative, through the real loader", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "td-lane-alt-"));
    mkdirSync(join(dir, "modules", "audio", "amp"), { recursive: true });
    writeFileSync(join(dir, "project.yaml"), 'project:\n  name: "song"\n');
    writeFileSync(
      join(dir, "modules", "audio", "amp", "module.yaml"),
      "plugin: { type: internal, name: Chorus }\nparams: { Gain: 1 }\n",
    );
    writeLane(dir, "gtr", "track", {
      events: [{ ref: "take1_a", start: "1:1" }],
    });
    writeNode(dir, "ampli", { extends: "@project/audio/amp", params: {} });
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  const read = (node: string) =>
    parse(readFileSync(join(dir, "nodes", `${node}.yaml`), "utf8"), {
      version: "1.2",
    });

  it("gives a lane an empty arrangement", () => {
    newModuleAlternative(dir, "gtr");
    const f = read("gtr");
    expect(f.alternatives[0].events).toEqual([]);
    expect(f.events).toHaveLength(1);
    expect(f.alternative).toBe("2");
  });

  it("gives a plain module a truly empty set", () => {
    newModuleAlternative(dir, "ampli");
    expect(read("ampli").alternatives[0]).toEqual({});
  });
});
