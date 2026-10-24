import { K7Document, type K7Scope, parse } from "@studio/k7x/document";
import { describe, expect, it } from "vitest";
import { ModuleSchema } from "./moduleSchema";
import {
  addPlacement,
  findPlacement,
  halveSequenceLoops,
  movePlacement,
  removePlacement,
  setTrackField,
  spliceTime,
} from "./trackFile";

// The file the app writes most: a lane is a MODULE, edited placement by placement.

// A lane as the app leaves it: one placement per line.
const AUTHORED = `color("#739814")
extends("@meta/track")
disabled(false)
events([
  ref("bass_3_0").start("25:1").fadeIn("8:0:3:0:0:1:1:2"),
  ref("bass_3_1").start("54:1").fadeIn("8:0:3:0:0:1:1:2"),
])
`;

const edit = (text: string, fn: (doc: K7Scope) => unknown): string => {
  const doc = new K7Document(text);
  fn(doc.at([]));
  return doc.toString();
};
const scope = (text: string) => new K7Document(text).at([]);
const issuesOf = (text: string) => {
  const r = ModuleSchema.safeParse(parse(text));
  return r.success ? [] : r.error.issues;
};

describe("a lane's timecodes", () => {
  it("reads a timecode as the string it is", () => {
    expect(issuesOf(AUTHORED)).toEqual([]);
    expect((parse(AUTHORED).events as unknown[])[0]).toEqual({
      ref: "bass_3_0",
      start: "25:1",
      fadeIn: "8:0:3:0:0:1:1:2",
    });
  });

  it("rejects something that isn't a timecode, at the key", () => {
    const issues = issuesOf(
      'extends("@meta/track")\nevents([ref("b").start("bar 25")])\n',
    );
    expect(issues[0].path.join(".")).toBe("events.0.start");
    expect(issues[0].message).toMatch(/timecode/);
  });
});

describe("the edits the app makes most", () => {
  const changed = (a: string, b: string): number => {
    const before = a.split("\n");
    return b.split("\n").filter((l, i) => l !== before[i]).length;
  };

  it("flips a flag in one line", () => {
    // A lane has no fader and no mute on its file — only its colour and whether it renders at all.
    const after = edit(AUTHORED, (d) => setTrackField(d, "disabled", true));
    expect(changed(AUTHORED, after)).toBe(1);
    expect(after).toContain("disabled(true)");
  });

  it("drags a clip in one line, keeping it on its own line", () => {
    const after = edit(AUTHORED, (d) => movePlacement(d, "54:1", "60:1"));
    expect(changed(AUTHORED, after)).toBe(1);
    expect(after).toContain(
      '  ref("bass_3_1").start("60:1").fadeIn("8:0:3:0:0:1:1:2"),\n',
    );
  });

  it("finds a placement by where it starts", () => {
    expect(findPlacement(scope(AUTHORED), "54:1")).toBe(1);
    expect(findPlacement(scope(AUTHORED), "99:1")).toBe(-1);
  });

  it("removes one placement and leaves the other alone", () => {
    const after = edit(AUTHORED, (d) => removePlacement(d, "25:1"));
    expect(after).not.toContain("bass_3_0");
    expect(after).toContain(
      '  ref("bass_3_1").start("54:1").fadeIn("8:0:3:0:0:1:1:2"),\n',
    );
    expect(issuesOf(after)).toEqual([]);
  });

  it("receives a placement moved from another lane, on a line of its own", () => {
    // The other half of a cross-lane clip move: removed there, appended here.
    const after = edit(AUTHORED, (d) =>
      addPlacement(d, { ref: "bass_3_2", start: "70:1", loop: 2 }),
    );
    expect(after).toContain('  ref("bass_3_2").start("70:1").loop(2),\n');
    expect(parse(after).events).toHaveLength(3);
  });

  it("creates the events list on a lane that has none", () => {
    const after = edit('extends("@meta/track")\n', (d) =>
      addPlacement(d, { ref: "x", start: "1:1" }),
    );
    expect(parse(after).events).toEqual([{ ref: "x", start: "1:1" }]);
  });

  it("keeps the colour, the extends and every other field byte-identical", () => {
    const after = edit(AUTHORED, (d) => setTrackField(d, "disabled", true));
    expect(after).toContain('color("#739814")');
    expect(after).toContain('extends("@meta/track")');
  });
});

describe("a lane on one of its alternatives", () => {
  const ALT = `extends("@meta/track")
alternative("quiet")
events([
  // the verse
  ref("a").start("1:1"),
  ref("b").start("5:1"),
])
alternatives([name("quiet")])
`;

  it("forks what the alternative PLAYS on its first edit, comments included, and leaves the module's own", () => {
    const after = edit(ALT, (d) => movePlacement(d, "5:1", "6:1"));
    const data = parse(after) as {
      events: unknown[];
      alternatives: { events: unknown[] }[];
    };
    expect(data.events).toEqual([
      { ref: "a", start: "1:1" },
      { ref: "b", start: "5:1" },
    ]);
    expect(data.alternatives[0].events).toEqual([
      { ref: "a", start: "1:1" },
      { ref: "b", start: "6:1" },
    ]);
    expect(after.match(/\/\/ the verse/g)).toHaveLength(2);
  });

  it("forks a list written as a call's own arguments", () => {
    const text =
      'alternative("quiet")\nevents(ref("a").start("1:1"), ref("b").start("5:1"))\nalternatives([name("quiet")])\n';
    const after = edit(text, (d) => removePlacement(d, "1:1"));
    const data = parse(after) as {
      events: unknown[];
      alternatives: { events: unknown[] }[];
    };
    expect(data.events).toHaveLength(2);
    expect(data.alternatives[0].events).toEqual([{ ref: "b", start: "5:1" }]);
  });
});

describe("the song's clock", () => {
  it("moves what follows inserted time, and drops what deleted time covers", () => {
    const doc = new K7Document(AUTHORED);
    expect(spliceTime(doc.at([]), 100, 4, "insert", 4, 4, 120)).toEqual({
      moved: 1,
      removed: 0,
    });
    expect((parse(doc.toString()).events as { start: string }[])[1].start).toBe(
      "55:1",
    );
    expect(spliceTime(doc.at([]), 96, 8, "delete", 4, 4, 120)).toEqual({
      moved: 1,
      removed: 1,
    });
    expect(parse(doc.toString()).events).toEqual([
      { ref: "bass_3_1", start: "53:1", fadeIn: "8:0:3:0:0:1:1:2" },
    ]);
  });

  it("halves an even loop, drops a loop of two, and keeps an odd or windowed one", () => {
    const lane = `events([
  ref("s").start("1:1").loop(4),
  ref("s").start("9:1").loop(2),
  ref("s").start("13:1").loop(3),
  ref("s").start("17:1").loop(2).from(0),
])
`;
    const doc = new K7Document(lane);
    const got = halveSequenceLoops(doc.at([]), "s");
    expect(got.halved).toBe(2);
    expect(got.kept.map((k) => k.why)).toEqual(["odd", "windowed"]);
    const events = parse(doc.toString()).events as Record<string, unknown>[];
    expect(events.map((e) => e.loop)).toEqual([2, undefined, 3, 2]);
  });
});

describe("the fields a lane carries", () => {
  it("takes a group's members and a strudel lane's pattern", () => {
    // Both are ordinary module fields; WHICH a lane may write is graph.ts's question (docs/moduleFile.md).
    expect(
      issuesOf('extends("@meta/group-track")\ntracks("a", "b")\n'),
    ).toEqual([]);
    expect(
      issuesOf(
        'extends("@meta/strudel-track")\nstrudel("algo/beat.strudel")\n',
      ),
    ).toEqual([]);
  });

  it("pins a strudel lane's pattern path", () => {
    const issues = issuesOf(
      'extends("@meta/strudel-track")\nstrudel("beat.txt")\n',
    );
    expect(issues[0].message).toMatch(/algo\//);
  });

  it("still refuses a key no module has", () => {
    // `.strict()`, so an unknown key is named rather than read and dropped.
    const issues = issuesOf('extends("@meta/track")\ncontentType("audio")\n');
    expect(
      issues.some((i) =>
        ((i as { keys?: string[] }).keys ?? []).includes("contentType"),
      ),
    ).toBe(true);
  });
});
