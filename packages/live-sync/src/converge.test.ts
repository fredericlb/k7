// converge.test.ts — replicas editing at random, messages delivered late and interleaved: all end as the room.

import { describe, expect, it } from "vitest";
import { parseDocument } from "yaml";
import { fileOpFor } from "./fileOp.ts";
import type { Batch, Sequenced } from "./ops.ts";
import { MemoryConfirmed, Replica } from "./replica.ts";
import { Room } from "./room.ts";

/** A confirmed store holding `files`, as a replica current with a room holding them would. */
function confirmedOf(files: Record<string, string>): MemoryConfirmed {
  const c = new MemoryConfirmed();
  for (const [f, t] of Object.entries(files)) c.set(f, t);
  return c;
}

/** A seeded generator, so a failure replays. */
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const START: Record<string, string> = {
  "s/mix.yaml": "plugin: mixer\nparams:\n  gain: 0.5\n  pan: 0\n  width: 1\n",
  "s/eq.yaml": "plugin: eq\nparams:\n  low: 0\n  high: 0\nbands: [1, 2]\n",
  "s/TODOS.md": "- nothing\n",
};
const KEYS = [
  ["s/mix.yaml", ["params", "gain"]],
  ["s/mix.yaml", ["params", "pan"]],
  ["s/mix.yaml", ["params", "width"]],
  ["s/eq.yaml", ["params", "low"]],
  ["s/eq.yaml", ["params", "high"]],
  ["s/eq.yaml", ["bands"]],
] as const;

interface Sim {
  r: Replica;
  disk: Map<string, string>;
  inbox: Sequenced[];
  local: number;
}

function simulate(seed: number, replicas: number, steps: number) {
  const rand = rng(seed);
  const room = new Room();
  room.submit({
    id: "seed",
    replica: "seed",
    local: 0,
    ts: 0,
    label: "seed",
    ops: Object.entries(START).map(([file, text]) => ({
      kind: "text" as const,
      file,
      text,
    })),
  });
  const toServer: { from: Sim; batch: Batch }[] = [];
  const sims: Sim[] = [];
  let parked = 0;
  for (let i = 0; i < replicas; i++) {
    const disk = new Map(Object.entries(START));
    const host = {
      read: (f: string) => disk.get(f) ?? null,
      write: (f: string, t: string | null) =>
        t === null ? disk.delete(f) : disk.set(f, t),
    };
    sims.push({
      r: new Replica(`r${i}`, host, confirmedOf(START), 1),
      disk,
      inbox: [],
      local: 0,
    });
  }

  const edit = (s: Sim) => {
    const roll = rand();
    let file: string;
    let after: string | null;
    const before = (f: string) => s.disk.get(f) ?? null;
    if (roll < 0.1) {
      file = "s/TODOS.md";
      after = `- task ${Math.floor(rand() * 100)}\n`;
    } else if (roll < 0.15) {
      file = "s/new.yaml";
      after = s.disk.has(file) ? null : "plugin: delay\n";
    } else if (roll < 0.2) {
      // Removing a file others are editing values in: the server sets their ops aside, and they must follow.
      file = "s/eq.yaml";
      after = s.disk.has(file) ? null : START[file];
    } else {
      const [f, path] = KEYS[Math.floor(rand() * KEYS.length)];
      file = f;
      const text = s.disk.get(f);
      if (text === undefined) return;
      const doc = parseDocument(text, { version: "1.2" });
      const value =
        path[0] === "bands"
          ? [Math.floor(rand() * 9)]
          : Math.round(rand() * 100) / 100;
      doc.setIn([...path], doc.createNode(value));
      after = doc.toString({ lineWidth: 0 });
    }
    const op = fileOpFor(file, before(file), after);
    if (!op) return;
    if (after === null) s.disk.delete(file);
    else s.disk.set(file, after);
    const batch: Batch = {
      id: `${s.r.id}-${++s.local}`,
      replica: s.r.id,
      local: s.local,
      ts: 0,
      label: "edit",
      ops: [op],
    };
    s.r.local(batch);
    toServer.push({ from: s, batch });
  };

  const deliverToServer = () => {
    const i = Math.floor(rand() * toServer.length);
    // Per-replica FIFO: take the OLDEST batch of the replica picked.
    const from = toServer[i].from;
    const j = toServer.findIndex((m) => m.from === from);
    const [msg] = toServer.splice(j, 1);
    const { entry, fresh } = room.submit(msg.batch);
    // As the relay does: a batch seen before is answered to its sender only.
    for (const s of fresh ? sims : [from]) s.inbox.push(entry);
  };

  // A replica that fell further behind than the room's log: it adopts the whole state, then re-sends.
  const fallBehind = (s: Sim) => {
    s.inbox = [];
    s.r.adopt(room.head, Object.fromEntries(room.files));
    for (const batch of s.r.unconfirmed()) toServer.push({ from: s, batch });
  };

  const deliverToReplica = (s: Sim) => {
    const entry = s.inbox.shift();
    if (entry) expect(s.r.remote(entry)).toEqual([]);
    if (entry) parked += entry.parked.length;
  };

  for (let step = 0; step < steps; step++) {
    const s = sims[Math.floor(rand() * sims.length)];
    const roll = rand();
    if (roll < 0.4) edit(s);
    else if (roll < 0.43) fallBehind(s);
    else if (roll < 0.7 && toServer.length) deliverToServer();
    else deliverToReplica(s);
  }
  while (toServer.length) deliverToServer();
  for (const s of sims) while (s.inbox.length) deliverToReplica(s);
  return { room, sims, parked };
}

let totalParked = 0;

describe("convergence", () => {
  for (const seed of Array.from({ length: 50 }, (_, i) => i + 1)) {
    it(`three replicas, 400 random steps, seed ${seed}: every replica ends as the room`, () => {
      const { room, sims, parked } = simulate(seed, 3, 400);
      totalParked += parked;
      const canonical = Object.fromEntries(room.files);
      for (const s of sims) {
        expect(Object.fromEntries(s.disk)).toEqual(canonical);
        expect(s.r.unconfirmed()).toEqual([]);
      }
    });
  }

  it("went through the server setting ops aside, not only applying them", () => {
    expect(totalParked).toBeGreaterThan(0);
  });

  it("keeps the value in place and sets the late edit aside, everywhere", () => {
    const room = new Room();
    const text = START["s/mix.yaml"];
    room.submit({
      id: "seed",
      replica: "x",
      local: 0,
      ts: 0,
      label: "seed",
      ops: [{ kind: "text", file: "s/mix.yaml", text }],
    });
    const disks = [
      new Map([["s/mix.yaml", text]]),
      new Map([["s/mix.yaml", text]]),
    ];
    const reps = disks.map(
      (d, i) =>
        new Replica(
          `r${i}`,
          {
            read: (f) => d.get(f) ?? null,
            write: (f, t) => (t === null ? d.delete(f) : d.set(f, t)),
          },
          confirmedOf({ "s/mix.yaml": text }),
          1,
        ),
    );
    const edits = ["0.1", "0.9"].map((v, i) => {
      const after = text.replace("gain: 0.5", `gain: ${v}`);
      const op = fileOpFor("s/mix.yaml", text, after);
      disks[i].set("s/mix.yaml", after);
      const batch: Batch = {
        id: `b${i}`,
        replica: `r${i}`,
        local: 1,
        ts: 0,
        label: "edit",
        ops: op ? [op] : [],
      };
      reps[i].local(batch);
      return batch;
    });
    const first = room.submit(edits[0]).entry;
    const second = room.submit(edits[1]).entry;
    // r1 sees r0's edit while its own is still pending: it keeps showing its own until the room answers.
    reps[1].remote(first);
    expect(disks[1].get("s/mix.yaml")).toContain("gain: 0.9");
    reps[1].remote(second);
    expect(second.parked).toMatchObject([{ replica: "r1", kept: "0.1\n" }]);
    reps[0].remote(first);
    reps[0].remote(second);
    for (const d of disks)
      expect(d.get("s/mix.yaml")).toBe(room.files.get("s/mix.yaml"));
    expect(room.files.get("s/mix.yaml")).toContain("gain: 0.1");
    for (const r of reps)
      expect(r.conflicts.list().map((c) => c.id)).toEqual([
        second.parked[0].id,
      ]);
  });
});
