// path.test.ts — the paths a replica may name, the frames the relay parses, and a room refusing an escape.

import { describe, expect, it } from "vitest";
import type { Batch } from "./ops.ts";
import { isSyncPath } from "./path.ts";
import { parseToRelay } from "./protocol.ts";
import { Room } from "./room.ts";

const batch = (ops: unknown[]): Record<string, unknown> => ({
  id: "b",
  replica: "r",
  local: 1,
  ts: 0,
  label: "edit",
  ops,
});

const frame = (b: unknown): string =>
  JSON.stringify({ t: "batch", workspace: "w", batch: b });

describe("isSyncPath", () => {
  it("accepts a relative POSIX path", () => {
    for (const p of ["a.yaml", "song.k7/tracks/1.yaml", ".k7/x", "a..b/c"])
      expect(isSyncPath(p), p).toBe(true);
  });

  it("refuses anything that could leave the workspace", () => {
    for (const p of [
      "",
      "/etc/passwd",
      "../x",
      "a/../../x",
      "a/./b",
      ".",
      "a//b",
      "a/",
      "a\\..\\b",
      "C:/x",
      "c:x",
      "a\u0000b",
      "a\nb",
      null,
      3,
    ])
      expect(isSyncPath(p), String(p)).toBe(false);
  });
});

describe("parseToRelay", () => {
  it("parses a well-formed batch of every kind", () => {
    const ok = batch([
      { kind: "text", file: "a.md", text: "x", was: null },
      { kind: "remove", file: "b.md" },
      {
        kind: "yaml",
        file: "c.yaml",
        ops: [{ op: "set", path: ["k"], yaml: "1" }],
      },
      { kind: "k7x", file: "d.k7x", ops: [{ op: "delete", path: ["k"] }] },
    ]);
    expect(parseToRelay(frame(ok))?.t).toBe("batch");
  });

  it("refuses a malformed batch rather than throwing", () => {
    const bad: unknown[] = [
      batch([null]),
      batch([1]),
      batch([{ kind: "text", text: "x" }]),
      batch([{ kind: "text", file: "a.md" }]),
      batch([{ kind: "nope", file: "a.md" }]),
      batch([{ kind: "yaml", file: "a.yaml", ops: [null] }]),
      batch([
        { kind: "yaml", file: "a.yaml", ops: [{ op: "set", path: [1] }] },
      ]),
      batch([
        {
          kind: "k7x",
          file: "a.k7x",
          ops: [{ op: "set", path: [], yaml: "1" }],
        },
      ]),
      batch([{ kind: "text", file: "../x", text: "x" }]),
      { ...batch([]), id: 3 },
      { ...batch([]), ops: {} },
      null,
      [],
    ];
    for (const b of bad)
      expect(parseToRelay(frame(b)), JSON.stringify(b)).toBeNull();
    expect(parseToRelay("null")).toBeNull();
    expect(parseToRelay("42")).toBeNull();
    expect(parseToRelay('{"t":"hello","workspace":"w"}')).toBeNull();
  });
});

describe("Room", () => {
  it("refuses a batch naming a path outside the workspace, and orders nothing", () => {
    const room = new Room();
    const climbing = batch([
      { kind: "text", file: "../x", text: "x" },
    ]) as unknown as Batch;
    expect(() => room.submit(climbing)).toThrow(/refused sync path/);
    expect(room.head).toBe(0);
    expect(room.files.size).toBe(0);
  });
});
