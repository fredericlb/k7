// k7xOps.test.ts — a .k7x file's change travels as path ops that replay byte for byte, and the room settles them like YAML's.

import { parseDocument } from "@studio/k7x/document";
import { describe, expect, it } from "vitest";
import { applyFileOp, fileOpFor, settleFileOp } from "./fileOp.ts";

const NODE = `// synth-pad
extends("@workspace/instruments/synth")
params({
  "Filter Freq": 40, // darker than the lead
  Level: -12,
})
`;

const NOTES = `notes([
  t(0).d(1).k(60),
  t(1).d(1).k(62),
  t(2).d(1).k(64),
])
`;

/** What a writer does through the bridge: one document, edited in place. */
const edit = (
  text: string,
  f: (d: ReturnType<typeof parseDocument>) => void,
): string => {
  const d = parseDocument(text);
  f(d);
  return d.toString();
};

describe("a .k7x file's change", () => {
  it("is one path op for a knob drag, replaying exactly", () => {
    const after = edit(NODE, (d) => d.setIn(["params", "Filter Freq"], 55));
    const op = fileOpFor("nodes/pad.k7x", NODE, after);
    expect(op).toEqual({
      kind: "k7x",
      file: "nodes/pad.k7x",
      ops: [
        { op: "set", path: ["params", "Filter Freq"], k7x: "55", was: "40" },
      ],
    });
    expect(applyFileOp(NODE, op!)).toBe(after);
  });

  it("travels as text when only a comment changed", () => {
    const after = NODE.replace("darker", "much darker");
    expect(fileOpFor("nodes/pad.k7x", NODE, after)?.kind).toBe("text");
  });

  it("names a note by its key when one is added, edited or removed", () => {
    const added = edit(NOTES, (d) =>
      d.insertIn(["notes"], 1, { t: 0.5, d: 1, k: 61 }),
    );
    const op = fileOpFor("sequences/m.k7x", NOTES, added);
    expect(op?.kind).toBe("k7x");
    expect(op?.kind === "k7x" && op.ops).toEqual([
      {
        op: "set",
        path: ["notes", "[t=0.5,k=61]"],
        k7x: "t(0.5).d(1).k(61)",
        was: null,
        after: "[t=0,k=60]",
      },
    ]);
    expect(applyFileOp(NOTES, op!)).toBe(added);

    const edited = edit(NOTES, (d) => d.setIn(["notes", 1, "d"], 2));
    const e = fileOpFor("sequences/m.k7x", NOTES, edited);
    expect(e?.kind === "k7x" && e.ops[0].path).toEqual([
      "notes",
      "[t=1,k=62]",
      "d",
    ]);
    expect(applyFileOp(NOTES, e!)).toBe(edited);

    const removed = edit(NOTES, (d) => d.deleteIn(["notes", 2]));
    const r = fileOpFor("sequences/m.k7x", NOTES, removed);
    expect(r?.kind === "k7x" && r.ops).toEqual([
      { op: "delete", path: ["notes", "[t=2,k=64]"], was: "t(2).d(1).k(64)" },
    ]);
    expect(applyFileOp(NOTES, r!)).toBe(removed);
  });

  it("is set aside when the value it replaced moved meanwhile, and applied when it did not", () => {
    const mine = fileOpFor(
      "nodes/pad.k7x",
      NODE,
      edit(NODE, (d) => d.setIn(["params", "Level"], -6)),
    )!;
    const theirs = edit(NODE, (d) => d.setIn(["params", "Level"], -3));
    const clash = settleFileOp(theirs, mine);
    expect(clash.apply).toBeNull();
    expect(clash.aside).toEqual([{ op: mine, kept: "-3" }]);

    const elsewhere = edit(NODE, (d) => d.setIn(["params", "Filter Freq"], 70));
    const fine = settleFileOp(elsewhere, mine);
    expect(fine.aside).toEqual([]);
    expect(applyFileOp(elsewhere, fine.apply!)).toBe(
      edit(elsewhere, (d) => d.setIn(["params", "Level"], -6)),
    );
  });

  it("converges when two replicas edit two values of one file", () => {
    const a = fileOpFor(
      "nodes/pad.k7x",
      NODE,
      edit(NODE, (d) => d.setIn(["params", "Level"], -6)),
    )!;
    const b = fileOpFor(
      "nodes/pad.k7x",
      NODE,
      edit(NODE, (d) => d.setIn(["params", "Filter Freq"], 70)),
    )!;
    const ab = applyFileOp(applyFileOp(NODE, a), b);
    const ba = applyFileOp(applyFileOp(NODE, b), a);
    expect(ab).toBe(ba);
    expect(ab).toContain("// darker than the lead");
  });
});
