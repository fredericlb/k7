// textMerge.test.ts — two whole texts made from one base: merged when their lines do not meet, set aside when they do.

import { describe, expect, it } from "vitest";
import { blobRef } from "./blob.ts";
import { fileOpFor } from "./fileOp.ts";
import type { Batch, FileOp, Sequenced } from "./ops.ts";
import { Room } from "./room.ts";
import { textHash } from "./textHash.ts";
import { mergeTexts, TextBases } from "./textMerge.ts";

const BASE = "# Todo\n\n- bass\n- drums\n- vocals\n- mix\n";

const batch = (id: string, ops: FileOp[]): Batch => ({
  id,
  replica: id,
  local: 1,
  ts: 0,
  label: "edit",
  ops,
});

/** A room holding `base` at `file`, then two edits made from it ordered one after the other. */
function race(a: string, b: string, file = "s/TODOS.md", base = BASE) {
  const room = new Room();
  room.submit(batch("seed", [{ kind: "text", file, text: base }]));
  room.submit(batch("a", [fileOpFor(file, base, a) as FileOp]));
  const eb = room.submit(
    batch("b", [fileOpFor(file, base, b) as FileOp]),
  ).entry;
  return { room, eb, text: room.files.get(file) };
}

describe("mergeTexts", () => {
  it("joins changes to lines apart, and refuses changes to one line", () => {
    const a = BASE.replace("- bass", "- bass (done)");
    const b = BASE.replace("- mix", "- mix and master");
    expect(mergeTexts(BASE, a, b)).toBe(
      BASE.replace("- bass", "- bass (done)").replace(
        "- mix",
        "- mix and master",
      ),
    );
    expect(mergeTexts(BASE, a, BASE.replace("- bass", "- bass!"))).toBeNull();
    expect(mergeTexts(BASE, a, a)).toBe(a);
  });

  it("keeps a last line without its newline as it is", () => {
    expect(mergeTexts("a\nb\nc", "A\nb\nc", "a\nb\nC")).toBe("A\nb\nC");
  });
});

describe("a whole text whose file moved", () => {
  it("lands merged when the two edits touch different lines", () => {
    const { eb, text } = race(
      BASE.replace("- bass", "- bass (done)"),
      BASE.replace("- mix", "- mix and master"),
    );
    expect(eb.parked).toEqual([]);
    expect(text).toBe(
      "# Todo\n\n- bass (done)\n- drums\n- vocals\n- mix and master\n",
    );
    expect(eb.batch.ops).toEqual([
      {
        kind: "text",
        file: "s/TODOS.md",
        text,
        was: textHash(BASE.replace("- bass", "- bass (done)")),
      },
    ]);
  });

  it("is set aside when both change one line", () => {
    const a = BASE.replace("- drums", "- drums, live");
    const { eb, text } = race(
      a,
      BASE.replace("- drums", "- drums, programmed"),
    );
    expect(eb.parked).toHaveLength(1);
    expect(text).toBe(a);
  });

  it("is set aside when the room no longer knows the base", () => {
    const room = new Room();
    room.submit(batch("seed", [{ kind: "text", file: "x.md", text: "one\n" }]));
    const op: FileOp = {
      kind: "text",
      file: "x.md",
      text: "two\n",
      was: textHash("zero\n"),
    };
    expect(room.submit(batch("b", [op])).entry.parked).toHaveLength(1);
  });

  it("is never tried on k7x or on a blob ref", () => {
    const k7x = "a(1)\nb(2)\nc(3)\n";
    const y = race(
      "a(9)\nb(2)\nc(3)\n// x\n",
      "a(1)\nb(2)\nc(8)\n// y\n",
      "s/x.k7x",
      k7x,
    );
    expect(y.eb.parked).toHaveLength(1);
    const ref = blobRef("a".repeat(64), 3);
    const r = race(
      blobRef("b".repeat(64), 3),
      blobRef("c".repeat(64), 3),
      "s/a.wav",
      ref,
    );
    expect(r.eb.parked).toHaveLength(1);
  });

  it("finds its base in a room restored from its state, and in one rebuilt by replaying its log", () => {
    const first = new Room();
    first.submit(batch("seed", [{ kind: "text", file: "x.md", text: BASE }]));
    const saved = JSON.parse(JSON.stringify(first.state()));
    const a = BASE.replace("- bass", "- bass (done)");
    const entry: Sequenced = first.submit(
      batch("a", [fileOpFor("x.md", BASE, a) as FileOp]),
    ).entry;
    const late = fileOpFor(
      "x.md",
      BASE,
      BASE.replace("- mix", "- mixed"),
    ) as FileOp;
    const restored = Room.from(JSON.parse(JSON.stringify(first.state())));
    const replayed = Room.from(saved);
    replayed.replay(entry);
    for (const room of [first, restored, replayed]) {
      const { entry: e } = room.submit(batch("b", [late]));
      expect(e.parked).toEqual([]);
      expect(room.files.get("x.md")).toBe(a.replace("- mix", "- mixed"));
    }
  });
});

describe("TextBases", () => {
  it("keeps the last versions of a file only, and forgets a removed one", () => {
    const bases = new TextBases();
    for (let i = 0; i < 30; i++) bases.record("x.md", `v${i}\n`);
    expect(bases.find("x.md", textHash("v29\n"))).toBe("v29\n");
    expect(bases.find("x.md", textHash("v10\n"))).toBe("v10\n");
    expect(bases.find("x.md", textHash("v9\n"))).toBeNull();
    bases.record("x.md", null);
    expect(bases.find("x.md", textHash("v29\n"))).toBeNull();
  });
});
