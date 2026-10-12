// listOps.test.ts — a keyed list's items as ops of their own: the diff, the exact replay, and two edits meeting in a room.

import { describe, expect, it } from "vitest";
import { type Document, parseDocument, type YAMLSeq } from "yaml";
import { applyFileOp, fileOpFor } from "./fileOp.ts";
import type { Batch, FileOp, YamlOp } from "./ops.ts";
import { Room } from "./room.ts";

const SEQ = `notes:
  - { t: 0, d: 1, k: 60, v: 0.8 }
  - { t: 1, d: 1, k: 62 }
  - { t: 2, d: 0.5, k: 64 }
from: "1:1"
`;

const LANE = `plugin: lane
events:
  - ref: kick
    start: "1:1"
    gain: 0
  - ref: snare
    start: "2:1"
`;

/** What a song writer does: parse, change, print with lineWidth 0. */
function writer(text: string, edit: (notes: YAMLSeq, doc: Document) => void) {
  const doc = parseDocument(text, { version: "1.2" });
  edit(doc.get("notes", true) as YAMLSeq, doc);
  return doc.toString({ lineWidth: 0 });
}

function flowNote(text: string, note: Record<string, number>) {
  const doc = parseDocument(text, { version: "1.2" });
  const node = doc.createNode(note);
  node.flow = true;
  return node;
}

function yamlOps(op: FileOp | null): YamlOp[] {
  if (op?.kind !== "yaml") throw new Error(`not path ops: ${op?.kind}`);
  return op.ops;
}

describe("a keyed list", () => {
  it("sends an added note as one insert after the note before it", () => {
    const after = writer(SEQ, (n) =>
      n.items.splice(2, 0, flowNote(SEQ, { t: 1.5, d: 1, k: 61 })),
    );
    const op = fileOpFor("s.yaml", SEQ, after);
    expect(yamlOps(op)).toEqual([
      {
        op: "set",
        path: ["notes", "[t=1.5,k=61]"],
        yaml: "{ t: 1.5, d: 1, k: 61 }\n",
        was: null,
        after: "[t=1,k=62]",
      },
    ]);
    expect(applyFileOp(SEQ, op as FileOp)).toBe(after);
  });

  it("sends a velocity change inside one note, and a removed note by its key", () => {
    const after = writer(SEQ, (n, doc) => {
      doc.setIn(["notes", 0, "v"], doc.createNode(0.5));
      n.items.splice(1, 1);
    });
    const op = fileOpFor("s.yaml", SEQ, after);
    expect(yamlOps(op).map((o) => [o.op, o.path])).toEqual([
      ["delete", ["notes", "[t=1,k=62]"]],
      ["set", ["notes", "[t=0,k=60]", "v"]],
    ]);
    expect(applyFileOp(SEQ, op as FileOp)).toBe(after);
  });

  it("sends a moved note as its removal and its insertion", () => {
    const after = SEQ.replace(
      "{ t: 2, d: 0.5, k: 64 }",
      "{ t: 3, d: 0.5, k: 64 }",
    );
    const ops = yamlOps(fileOpFor("s.yaml", SEQ, after));
    expect(ops.map((o) => [o.op, o.path[1]])).toEqual([
      ["delete", "[t=2,k=64]"],
      ["set", "[t=3,k=64]"],
    ]);
  });

  it("descends into a block placement and keeps a timecode's quotes", () => {
    const edited = LANE.replace("gain: 0", "gain: 2");
    expect(yamlOps(fileOpFor("l.yaml", LANE, edited))).toEqual([
      {
        op: "set",
        path: ["events", '[ref="kick",start="1:1"]', "gain"],
        yaml: "2\n",
        was: "0\n",
      },
    ]);
    const added = `${LANE}  - ref: hat\n    start: "3:1"\n`;
    const op = fileOpFor("l.yaml", LANE, added);
    expect(yamlOps(op)[0]).toMatchObject({
      path: ["events", '[ref="hat",start="3:1"]'],
      after: '[ref="snare",start="2:1"]',
    });
    expect(applyFileOp(LANE, op as FileOp)).toBe(added);
  });

  it("sends a reordered list, a list with a duplicate key, or one whose item has no key field whole", () => {
    const swapped = SEQ.replace(
      "  - { t: 0, d: 1, k: 60, v: 0.8 }\n  - { t: 1, d: 1, k: 62 }\n",
      "  - { t: 1, d: 1, k: 62 }\n  - { t: 0, d: 1, k: 60, v: 0.8 }\n",
    );
    const dup = `${SEQ.split("from")[0]}  - { t: 2, d: 0.5, k: 64 }\nfrom: "1:1"\n`;
    const keyless = "notes:\n  - { d: 1 }\n";
    for (const [before, after] of [
      [SEQ, swapped],
      [SEQ, dup],
      [keyless, "notes:\n  - { d: 2 }\n"],
    ]) {
      const ops = yamlOps(fileOpFor("s.yaml", before, after));
      expect(ops.map((o) => o.path)).toEqual([["notes"]]);
      expect(applyFileOp(before, { kind: "yaml", file: "s.yaml", ops })).toBe(
        after,
      );
    }
  });

  it("names an item by a segment that stays an ordinary key under a map", () => {
    const text = 'params:\n  "[t=0,k=60]": 1\n';
    const after = text.replace(": 1", ": 2");
    const op = fileOpFor("m.yaml", text, after);
    expect(yamlOps(op)[0].path).toEqual(["params", "[t=0,k=60]"]);
    expect(applyFileOp(text, op as FileOp)).toBe(after);
  });
});

const batch = (id: string, ops: FileOp[]): Batch => ({
  id,
  replica: id,
  local: 1,
  ts: 0,
  label: "edit",
  ops,
});

/** A room holding SEQ, and two replicas' edits of it ordered one after the other. */
function race(a: string, b: string) {
  const room = new Room();
  room.submit(batch("seed", [{ kind: "text", file: "s.yaml", text: SEQ }]));
  const ea = room.submit(
    batch("a", [fileOpFor("s.yaml", SEQ, a) as FileOp]),
  ).entry;
  const eb = room.submit(
    batch("b", [fileOpFor("s.yaml", SEQ, b) as FileOp]),
  ).entry;
  return { text: room.files.get("s.yaml") ?? "", ea, eb };
}

describe("two edits to one keyed list", () => {
  const add = (note: Record<string, number>, at: number) =>
    writer(SEQ, (n) => n.items.splice(at, 0, flowNote(SEQ, note)));

  it("both land when both add a note, in the room's order", () => {
    const { text, eb } = race(
      add({ t: 1.5, d: 1, k: 61 }, 2),
      add({ t: 1.25, d: 1, k: 63 }, 2),
    );
    expect(eb.parked).toEqual([]);
    expect(text).toContain(
      "  - { t: 1, d: 1, k: 62 }\n  - { t: 1.25, d: 1, k: 63 }\n  - { t: 1.5, d: 1, k: 61 }\n",
    );
  });

  it("merge when they change different notes", () => {
    const { text, eb } = race(
      SEQ.replace("v: 0.8", "v: 0.3"),
      SEQ.replace("d: 0.5", "d: 2"),
    );
    expect(eb.parked).toEqual([]);
    expect(text).toContain("v: 0.3");
    expect(text).toContain("{ t: 2, d: 2, k: 64 }");
  });

  it("collide on one note's value, and on an edit inside a note the other removed", () => {
    const same = race(
      SEQ.replace("v: 0.8", "v: 0.3"),
      SEQ.replace("v: 0.8", "v: 0.1"),
    );
    expect(same.eb.parked).toMatchObject([{ kept: "0.3\n" }]);
    const removed = writer(SEQ, (n) => n.items.splice(0, 1));
    const gone = race(removed, SEQ.replace("v: 0.8", "v: 0.1"));
    expect(gone.eb.parked).toMatchObject([{ kept: null }]);
    expect(gone.text).not.toContain("k: 60");
    const late = race(SEQ.replace("v: 0.8", "v: 0.1"), removed);
    expect(late.eb.parked).toHaveLength(1);
    expect(late.text).toContain("v: 0.1");
  });

  it("puts a note whose anchor was removed meanwhile at the end", () => {
    const removed = writer(SEQ, (n) => n.items.splice(1, 1));
    const { text, eb } = race(removed, add({ t: 1.5, d: 1, k: 61 }, 2));
    expect(eb.parked).toEqual([]);
    expect(text).toContain(
      "  - { t: 2, d: 0.5, k: 64 }\n  - { t: 1.5, d: 1, k: 61 }\n",
    );
  });

  it("sets aside an item op once its list is sent whole", () => {
    const swapped = SEQ.replace(
      "  - { t: 0, d: 1, k: 60, v: 0.8 }\n  - { t: 1, d: 1, k: 62 }\n",
      "  - { t: 1, d: 1, k: 62 }\n  - { t: 0, d: 1, k: 60, v: 0.8 }\n  - { t: 1, d: 1, k: 62 }\n",
    );
    const { text, eb } = race(swapped, add({ t: 1.5, d: 1, k: 61 }, 2));
    expect(eb.parked).toHaveLength(1);
    expect(text).toBe(swapped);
  });
});
