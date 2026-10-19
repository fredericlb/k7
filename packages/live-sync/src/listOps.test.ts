// listOps.test.ts — a keyed list's items as ops of their own: the diff, the exact replay, and two edits meeting in a room.

import { K7Document, parse } from "@studio/k7x/document";
import { describe, expect, it } from "vitest";
import { applyFileOp, fileOpFor } from "./fileOp.ts";
import type { Batch, FileOp, K7xOp } from "./ops.ts";
import { Room } from "./room.ts";

const SEQ = `notes([
  t(0).d(1).k(60).v(0.8),
  t(1).d(1).k(62),
  t(2).d(0.5).k(64),
])
from("1:1")
`;

const LANE = `plugin("lane")
events([
  ref("kick").start("1:1").gain(0),
  ref("snare").start("2:1"),
])
`;

/** What a song writer does: one document, edited in place. */
function writer(text: string, edit: (doc: K7Document) => void): string {
  const doc = new K7Document(text);
  edit(doc);
  return doc.toString();
}

function pathOps(op: FileOp | null): K7xOp[] {
  if (op?.kind !== "k7x") throw new Error(`not path ops: ${op?.kind}`);
  return op.ops;
}

/** The notes of a k7x text, as [t, k] pairs in order. */
const keys = (text: string) =>
  (parse(text).notes as { t: number; k: number }[]).map((n) => [n.t, n.k]);

describe("a keyed list", () => {
  it("sends an added note as one insert after the note before it", () => {
    const after = writer(SEQ, (d) =>
      d.insertIn(["notes"], 2, { t: 1.5, d: 1, k: 61 }),
    );
    const op = fileOpFor("s.k7x", SEQ, after);
    expect(pathOps(op)).toEqual([
      {
        op: "set",
        path: ["notes", "[t=1.5,k=61]"],
        k7x: "t(1.5).d(1).k(61)",
        was: null,
        after: "[t=1,k=62]",
      },
    ]);
    expect(applyFileOp(SEQ, op as FileOp)).toBe(after);
  });

  it("sends a velocity change inside one note, and a removed note by its key", () => {
    const after = writer(SEQ, (d) => {
      d.setIn(["notes", 0, "v"], 0.5);
      d.deleteIn(["notes", 1]);
    });
    const op = fileOpFor("s.k7x", SEQ, after);
    expect(pathOps(op).map((o) => [o.op, o.path])).toEqual([
      ["delete", ["notes", "[t=1,k=62]"]],
      ["set", ["notes", "[t=0,k=60]", "v"]],
    ]);
    expect(applyFileOp(SEQ, op as FileOp)).toBe(after);
  });

  it("sends a moved note as its removal and its insertion", () => {
    const after = writer(SEQ, (d) => d.setIn(["notes", 2, "t"], 3));
    const ops = pathOps(fileOpFor("s.k7x", SEQ, after));
    expect(ops.map((o) => [o.op, o.path[1]])).toEqual([
      ["delete", "[t=2,k=64]"],
      ["set", "[t=3,k=64]"],
    ]);
  });

  it("descends into a placement and keeps a timecode a string", () => {
    const edited = writer(LANE, (d) => d.setIn(["events", 0, "gain"], 2));
    expect(pathOps(fileOpFor("l.k7x", LANE, edited))).toEqual([
      {
        op: "set",
        path: ["events", '[ref="kick",start="1:1"]', "gain"],
        k7x: "2",
        was: "0",
      },
    ]);
    const added = writer(LANE, (d) =>
      d.insertIn(["events"], 2, { ref: "hat", start: "3:1" }),
    );
    const op = fileOpFor("l.k7x", LANE, added);
    expect(pathOps(op)[0]).toMatchObject({
      path: ["events", '[ref="hat",start="3:1"]'],
      after: '[ref="snare",start="2:1"]',
    });
    expect(applyFileOp(LANE, op as FileOp)).toBe(added);
  });

  it("sends a reordered list, a list with a duplicate key, or one whose item has no key field whole", () => {
    const swapped = writer(SEQ, (d) => d.moveIn(["notes"], 0, 1));
    const dup = writer(SEQ, (d) =>
      d.insertIn(["notes"], 3, { t: 2, d: 0.5, k: 64 }),
    );
    const keyless = "notes([{ d: 1 }])\n";
    for (const [before, after] of [
      [SEQ, swapped],
      [SEQ, dup],
      [keyless, "notes([{ d: 2 }])\n"],
    ]) {
      const ops = pathOps(fileOpFor("s.k7x", before, after));
      expect(ops.map((o) => o.path)).toEqual([["notes"]]);
      expect(applyFileOp(before, { kind: "k7x", file: "s.k7x", ops })).toBe(
        after,
      );
    }
  });

  it("names an item by a segment that stays an ordinary key under a map", () => {
    const text = 'params({ "[t=0,k=60]": 1 })\n';
    const after = writer(text, (d) => d.setIn(["params", "[t=0,k=60]"], 2));
    const op = fileOpFor("m.k7x", text, after);
    expect(pathOps(op)[0].path).toEqual(["params", "[t=0,k=60]"]);
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
  room.submit(batch("seed", [{ kind: "text", file: "s.k7x", text: SEQ }]));
  const ea = room.submit(
    batch("a", [fileOpFor("s.k7x", SEQ, a) as FileOp]),
  ).entry;
  const eb = room.submit(
    batch("b", [fileOpFor("s.k7x", SEQ, b) as FileOp]),
  ).entry;
  return { text: room.files.get("s.k7x") ?? "", ea, eb };
}

describe("two edits to one keyed list", () => {
  const add = (note: Record<string, number>, at: number) =>
    writer(SEQ, (d) => d.insertIn(["notes"], at, note));
  const velocity = (v: number) =>
    writer(SEQ, (d) => d.setIn(["notes", 0, "v"], v));

  it("both land when both add a note, in the room's order", () => {
    const { text, eb } = race(
      add({ t: 1.5, d: 1, k: 61 }, 2),
      add({ t: 1.25, d: 1, k: 63 }, 2),
    );
    expect(eb.parked).toEqual([]);
    expect(keys(text)).toEqual([
      [0, 60],
      [1, 62],
      [1.25, 63],
      [1.5, 61],
      [2, 64],
    ]);
  });

  it("merge when they change different notes", () => {
    const { text, eb } = race(
      velocity(0.3),
      writer(SEQ, (d) => d.setIn(["notes", 2, "d"], 2)),
    );
    expect(eb.parked).toEqual([]);
    const notes = parse(text).notes as Record<string, number>[];
    expect(notes[0].v).toBe(0.3);
    expect(notes[2]).toEqual({ t: 2, d: 2, k: 64 });
  });

  it("collide on one note's value, and on an edit inside a note the other removed", () => {
    const same = race(velocity(0.3), velocity(0.1));
    expect(same.eb.parked).toMatchObject([{ kept: "0.3" }]);
    const removed = writer(SEQ, (d) => d.deleteIn(["notes", 0]));
    const gone = race(removed, velocity(0.1));
    expect(gone.eb.parked).toMatchObject([{ kept: null }]);
    expect(keys(gone.text)).not.toContainEqual([0, 60]);
    const late = race(velocity(0.1), removed);
    expect(late.eb.parked).toHaveLength(1);
    expect((parse(late.text).notes as { v?: number }[])[0].v).toBe(0.1);
  });

  it("puts a note whose anchor was removed meanwhile at the end", () => {
    const removed = writer(SEQ, (d) => d.deleteIn(["notes", 1]));
    const { text, eb } = race(removed, add({ t: 1.5, d: 1, k: 61 }, 2));
    expect(eb.parked).toEqual([]);
    expect(keys(text)).toEqual([
      [0, 60],
      [2, 64],
      [1.5, 61],
    ]);
  });

  it("sets aside an item op once its list is sent whole", () => {
    const swapped = writer(SEQ, (d) => {
      d.moveIn(["notes"], 0, 1);
      d.insertIn(["notes"], 2, { t: 1, d: 1, k: 62 });
    });
    const { text, eb } = race(swapped, add({ t: 1.5, d: 1, k: 61 }, 2));
    expect(eb.parked).toHaveLength(1);
    expect(text).toBe(swapped);
  });
});
