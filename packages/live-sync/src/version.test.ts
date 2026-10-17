// version.test.ts — the sync level a hello announces, the refusals it earns, and an op kind from a newer k7.

import { describe, expect, it } from "vitest";
import { applyFileOp } from "./fileOp.ts";
import { type FileOp, NeedsUpdate, type Sequenced } from "./ops.ts";
import {
  protoRefusal,
  readToRelay,
  SYNC_PROTO,
  SYNC_PROTO_MIN,
} from "./protocol.ts";
import { Replica } from "./replica.ts";

const frame = (v: unknown) => JSON.stringify(v);

const batch = (ops: unknown[]) => ({
  id: "b1",
  replica: "r",
  local: 1,
  ts: 0,
  label: "edit",
  ops,
});

describe("hello", () => {
  it("reads a hello without proto as level 1", () => {
    expect(
      readToRelay(frame({ t: "hello", workspace: "w", since: 3 })),
    ).toEqual({ msg: { t: "hello", workspace: "w", since: 3, proto: 1 } });
  });

  it("keeps the proto and build a hello carries", () => {
    const read = readToRelay(
      frame({ t: "hello", workspace: "w", since: 0, proto: 7, build: "v1.2" }),
    );
    expect(read).toEqual({
      msg: { t: "hello", workspace: "w", since: 0, proto: 7, build: "v1.2" },
    });
  });

  it("names why a hello is malformed", () => {
    for (const proto of [0, 1.5, "1"])
      expect(
        readToRelay(frame({ t: "hello", workspace: "w", since: 0, proto })),
        String(proto),
      ).toMatchObject({ reason: "malformed", workspace: "w" });
    expect(readToRelay(frame({ t: "hello", workspace: "w" }))).toMatchObject({
      reason: "malformed",
      error: "hello without since",
    });
  });
});

describe("protoRefusal", () => {
  it("serves every level from the minimum to its own", () => {
    for (let p = SYNC_PROTO_MIN; p <= SYNC_PROTO; p++)
      expect(protoRefusal("w", p)).toBeNull();
  });

  it("asks a replica below the minimum to update", () => {
    expect(protoRefusal("w", 1, 3, 2)).toEqual({
      t: "refused",
      workspace: "w",
      reason: "update",
      min: 2,
      server: 3,
    });
  });

  it("refuses a replica above its own level: the server is older", () => {
    expect(protoRefusal("w", SYNC_PROTO + 1)).toMatchObject({
      t: "refused",
      reason: "server-older",
      server: SYNC_PROTO,
    });
  });
});

describe("a frame the relay cannot read", () => {
  it("says an op kind is unknown rather than malformed", () => {
    const read = readToRelay(
      frame({
        t: "batch",
        workspace: "w",
        batch: batch([{ kind: "json", file: "a.json", ops: [] }]),
      }),
    );
    expect(read).toMatchObject({ reason: "unknown-op", workspace: "w" });
    expect("error" in read && read.error).toContain('"json"');
  });

  it("tells malformed frames and unknown messages apart", () => {
    expect(readToRelay("not json")).toMatchObject({ reason: "malformed" });
    expect(readToRelay(frame({ t: "hello" }))).toMatchObject({
      reason: "malformed",
    });
    expect(
      readToRelay(frame({ t: "batch", workspace: "w", batch: batch([1]) })),
    ).toMatchObject({ reason: "malformed" });
    expect(readToRelay(frame({ t: "ping", workspace: "w" }))).toMatchObject({
      reason: "unknown-message",
    });
  });
});

describe("an op kind from a newer k7", () => {
  const future = { kind: "json", file: "a.yaml", ops: [] } as unknown as FileOp;

  it("is never replayed as YAML", () => {
    expect(() => applyFileOp("a: 1\n", future)).toThrow(NeedsUpdate);
  });

  it("leaves a replica's head where it was", () => {
    const files = new Map<string, string | null>([["a.yaml", "a: 1\n"]]);
    const replica = new Replica("me", {
      read: (f) => files.get(f) ?? null,
      write: (f, t) => void files.set(f, t),
    });
    const entry: Sequenced = {
      seq: 1,
      batch: { ...batch([future]), ops: [future] },
      parked: [],
    };
    expect(() => replica.remote(entry)).toThrow(NeedsUpdate);
    expect(replica.head).toBe(0);
    expect(files.get("a.yaml")).toBe("a: 1\n");
  });
});
