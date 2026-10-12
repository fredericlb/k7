// blob.test.ts — a binary file's ref: its shape, and a room and two replicas carrying one like any whole text.

import { describe, expect, it } from "vitest";
import { blobRef, blobsOf, isBlobRef, parseBlobRef } from "./blob.ts";
import { fileOpFor, textHash } from "./fileOp.ts";
import type { Batch } from "./ops.ts";
import { MemoryConfirmed, Replica } from "./replica.ts";
import { Room } from "./room.ts";

const H1 = "a".repeat(64);
const H2 = "b".repeat(64);

describe("blob refs", () => {
  it("round-trip, and refuse what is not one", () => {
    const ref = blobRef(H1, 1234);
    expect(ref.startsWith("\u0000")).toBe(true);
    expect(parseBlobRef(ref)).toEqual({ hash: H1, size: 1234 });
    expect(isBlobRef(ref)).toBe(true);
    expect(isBlobRef("plugin: mixer\n")).toBe(false);
    expect(isBlobRef(null)).toBe(false);
    expect(parseBlobRef(`${ref}x`)).toBeNull();
    expect(parseBlobRef(`\u0000st0fs-blob ${"g".repeat(64)} 1\n`)).toBeNull();
    expect(() => blobRef("abc", 1)).toThrow();
  });

  it("are listed once per hash from a batch's ops", () => {
    const ops = [
      { kind: "text" as const, file: "a.wav", text: blobRef(H1, 1) },
      { kind: "text" as const, file: "b.wav", text: blobRef(H1, 1) },
      { kind: "text" as const, file: "c.md", text: "- x\n" },
      { kind: "remove" as const, file: "d.wav" },
    ];
    expect(blobsOf(ops)).toEqual([{ hash: H1, size: 1 }]);
  });

  it("travel through a room as whole texts: replaced, set aside on a stale `was`, and converged", () => {
    const room = new Room();
    const first = blobRef(H1, 10);
    room.submit({
      id: "seed",
      replica: "x",
      local: 0,
      ts: 0,
      label: "seed",
      ops: [{ kind: "text", file: "take.wav", text: first }],
    });
    const disks = [0, 1].map(() => new Map([["take.wav", first]]));
    const reps = disks.map((d, i) => {
      const c = new MemoryConfirmed();
      c.set("take.wav", first);
      return new Replica(
        `r${i}`,
        {
          read: (f) => d.get(f) ?? null,
          write: (f, t) => (t === null ? d.delete(f) : d.set(f, t)),
        },
        c,
        1,
      );
    });
    const edit = (i: number, after: string): Batch => {
      const op = fileOpFor("take.wav", first, after);
      expect(op).toEqual({
        kind: "text",
        file: "take.wav",
        text: after,
        was: textHash(first),
      });
      disks[i].set("take.wav", after);
      const b: Batch = {
        id: `b${i}`,
        replica: `r${i}`,
        local: 1,
        ts: 0,
        label: "edit",
        ops: op ? [op] : [],
      };
      reps[i].local(b);
      return b;
    };
    const fromA = room.submit(edit(0, blobRef(H2, 20))).entry;
    const fromB = room.submit(edit(1, blobRef("c".repeat(64), 30))).entry;
    expect(fromB.parked).toHaveLength(1);
    for (const r of reps) for (const e of [fromA, fromB]) r.remote(e);
    for (const d of disks) expect(d.get("take.wav")).toBe(blobRef(H2, 20));
    expect(room.files.get("take.wav")).toBe(blobRef(H2, 20));
  });
});
