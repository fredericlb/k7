// room.test.ts — what a replica gets on hello, a batch sent twice, and a room restored from its saved state.

import { describe, expect, it } from "vitest";
import { fileOpFor, textHash } from "./fileOp.ts";
import type { Batch, FileOp } from "./ops.ts";
import { Room } from "./room.ts";

const batch = (id: string, ops: Batch["ops"]): Batch => ({
  id,
  replica: "r",
  local: 1,
  ts: 0,
  label: "edit",
  ops,
});

describe("Room", () => {
  it("asks its first replica for everything", () => {
    expect(new Room().catchUp(0)).toEqual({ mode: "seed" });
  });

  it("answers the entries after `since`, and the whole state past what it keeps or ahead of it", () => {
    const room = new Room();
    room.submit(batch("a", [{ kind: "text", file: "x.md", text: "1" }]));
    room.submit(batch("b", [{ kind: "text", file: "x.md", text: "2" }]));
    const up = room.catchUp(1);
    expect(up.mode === "entries" && up.entries.map((e) => e.seq)).toEqual([2]);
    expect(room.catchUp(2)).toEqual({
      mode: "entries",
      entries: [],
      conflicts: [],
    });
    expect(room.catchUp(7)).toEqual({
      mode: "snapshot",
      head: 2,
      files: { "x.md": "2" },
      conflicts: [],
    });
  });

  it("gives a replica with no history the whole state, even when it keeps every entry", () => {
    const room = new Room();
    room.submit(batch("a", [{ kind: "text", file: "x.md", text: "1" }]));
    expect(room.catchUp(0)).toEqual({
      mode: "snapshot",
      head: 1,
      files: { "x.md": "1" },
      conflicts: [],
    });
  });

  it("orders a batch sent twice once", () => {
    const room = new Room();
    const b = batch("a", [{ kind: "text", file: "x.md", text: "1" }]);
    const first = room.submit(b);
    const again = room.submit(b);
    expect(again.fresh).toBe(false);
    expect(again.entry).toBe(first.entry);
    expect(room.head).toBe(1);
  });

  it("sets aside an op that cannot apply to its text, and relays the rest", () => {
    const room = new Room();
    const { entry } = room.submit(
      batch("a", [
        {
          kind: "yaml",
          file: "gone.yaml",
          ops: [{ op: "delete", path: ["a"] }],
        },
        { kind: "text", file: "x.md", text: "1" },
      ]),
    );
    expect(entry.parked.map((c) => c.op.file)).toEqual(["gone.yaml"]);
    expect(entry.batch.ops.map((o) => o.file)).toEqual(["x.md"]);
  });

  it("comes back from its saved state as it was", () => {
    const room = new Room();
    room.submit(batch("a", [{ kind: "text", file: "x.yaml", text: "a: 1\n" }]));
    const back = Room.from(JSON.parse(JSON.stringify(room.state())));
    expect(back.head).toBe(1);
    expect(back.files.get("x.yaml")).toBe("a: 1\n");
    expect(back.submit(batch("a", [])).fresh).toBe(false);
  });

  it("replays an entry it ordered before a restart, once", () => {
    const room = new Room();
    const { entry } = room.submit(
      batch("a", [{ kind: "text", file: "x.md", text: "1" }]),
    );
    const back = new Room();
    back.replay(entry);
    back.replay(entry);
    expect(back.head).toBe(1);
    expect(back.files.get("x.md")).toBe("1");
  });
});

const MIX = "params:\n  gain: 0.5\n  pan: 0\n";

/** A room holding MIX, and the op a replica that saw MIX makes when it rewrites `from` as `to`. */
function mixRoom(): {
  room: Room;
  edit: (from: string, to: string, base?: string) => FileOp;
} {
  const room = new Room();
  room.submit(batch("seed", [{ kind: "text", file: "m.yaml", text: MIX }]));
  const edit = (from: string, to: string, base = MIX): FileOp => {
    const op = fileOpFor("m.yaml", base, base.replace(from, to));
    if (!op) throw new Error("no change");
    return op;
  };
  return { room, edit };
}

describe("Room conflicts", () => {
  it("merges two edits to different values of one file", () => {
    const { room, edit } = mixRoom();
    room.submit(batch("a", [edit("gain: 0.5", "gain: 0.9")]));
    const { entry } = room.submit(batch("b", [edit("pan: 0", "pan: 1")]));
    expect(entry.parked).toEqual([]);
    expect(room.files.get("m.yaml")).toBe("params:\n  gain: 0.9\n  pan: 1\n");
  });

  it("keeps the value in place and sets aside an edit made against an older one", () => {
    const { room, edit } = mixRoom();
    room.submit(batch("a", [edit("gain: 0.5", "gain: 0.9")]));
    const late = {
      ...batch("b", [edit("gain: 0.5", "gain: 0.1")]),
      replica: "phone",
      ts: 7,
    };
    const { entry } = room.submit(late);
    expect(room.files.get("m.yaml")).toContain("gain: 0.9");
    expect(entry.batch.ops).toEqual([]);
    expect(entry.parked).toMatchObject([
      { id: "3.0", replica: "phone", ts: 7, kept: "0.9\n" },
    ]);
    expect(room.conflicts.list().map((c) => c.id)).toEqual(["3.0"]);
  });

  it("sees no conflict when both made the same change", () => {
    const { room, edit } = mixRoom();
    room.submit(batch("a", [edit("gain: 0.5", "gain: 0.9")]));
    const { entry } = room.submit(batch("b", [edit("gain: 0.5", "gain: 0.9")]));
    expect(entry.parked).toEqual([]);
  });

  it("sets aside an edit inside a part someone removed", () => {
    const { room, edit } = mixRoom();
    room.submit(batch("a", [edit("  gain: 0.5\n", "")]));
    const { entry } = room.submit(batch("b", [edit("gain: 0.5", "gain: 0.1")]));
    expect(entry.parked).toMatchObject([{ kept: null }]);
  });

  it("sets aside a whole text written over a version it never saw", () => {
    const room = new Room();
    room.submit(batch("a", [{ kind: "text", file: "x.md", text: "1" }]));
    room.submit(batch("b", [fileOpFor("x.md", "1", "2") as FileOp]));
    const { entry } = room.submit(
      batch("c", [fileOpFor("x.md", "1", "3") as FileOp]),
    );
    expect(room.files.get("x.md")).toBe("2");
    expect(entry.parked.map((c) => c.op)).toEqual([
      { kind: "text", file: "x.md", text: "3", was: textHash("1") },
    ]);
  });

  it("closes a conflict with the batch that resolves it, taking the alternative or not", () => {
    const { room, edit } = mixRoom();
    room.submit(batch("a", [edit("gain: 0.5", "gain: 0.9")]));
    room.submit(batch("b", [edit("gain: 0.5", "gain: 0.1")]));
    const [c] = room.conflicts.list();
    const take = edit("gain: 0.9", "gain: 0.1", room.files.get("m.yaml"));
    const { entry } = room.submit({ ...batch("c", [take]), resolves: [c.id] });
    expect(entry.parked).toEqual([]);
    expect(room.files.get("m.yaml")).toContain("gain: 0.1");
    expect(room.conflicts.list()).toEqual([]);
  });

  it("keeps one alternative per replica and value: the newest", () => {
    const { room, edit } = mixRoom();
    room.submit(batch("a", [edit("gain: 0.5", "gain: 0.9")]));
    const offline = (id: string, from: string, to: string) => ({
      ...batch(id, [
        edit(`gain: ${from}`, `gain: ${to}`, MIX.replace("0.5", from)),
      ]),
      replica: "phone",
    });
    room.submit(offline("b", "0.5", "0.2"));
    room.submit(offline("c", "0.2", "0.3"));
    expect(
      room.conflicts
        .list()
        .map((c) => (c.op.kind === "yaml" ? c.op.ops[0] : null)),
    ).toMatchObject([{ yaml: "0.3\n" }]);
  });

  it("comes back from its saved state with its open conflicts", () => {
    const { room, edit } = mixRoom();
    room.submit(batch("a", [edit("gain: 0.5", "gain: 0.9")]));
    room.submit(batch("b", [edit("gain: 0.5", "gain: 0.1")]));
    const back = Room.from(JSON.parse(JSON.stringify(room.state())));
    expect(back.conflicts.list()).toEqual(room.conflicts.list());
    const restarted = new Room();
    for (const e of room.state().log) restarted.replay(e);
    expect(restarted.conflicts.list()).toEqual(room.conflicts.list());
  });
});
