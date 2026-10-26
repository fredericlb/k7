// history.test.ts — the relay's whole log over a real socket: segments and snapshots, an older room,
// checkpoints, the HTTP routes, a restore every connected replica hears and that settles the conflicts
// on what it restores, and a page that reads only the segments it needs.

import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { textHash } from "@studio/live-sync/file-op";
import type { Batch, FileOp, Sequenced } from "@studio/live-sync/ops";
import { type FromRelay, SYNC_PROTO } from "@studio/live-sync/protocol";
import express from "express";
import { afterEach, describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import { readCheckpoints } from "./historyLog.ts";
import { historyRouter } from "./historyRoutes.ts";
import { attachSyncRelay, roomDir, SYNC_PATH } from "./syncRelay.ts";

const WS = "band";
const cleanup: (() => void)[] = [];
afterEach(() => {
  for (const f of cleanup.splice(0).reverse()) f();
});

async function until(f: () => boolean, ms = 5000): Promise<void> {
  const end = Date.now() + ms;
  while (!f()) {
    if (Date.now() > end) throw new Error("timed out");
    await new Promise((r) => setTimeout(r, 10));
  }
}

async function relayOn(
  dataRoot: string,
  extra: { checkpointIdleMs?: number } = {},
) {
  const server = createServer();
  const app = express();
  const relay = attachSyncRelay(server, {
    accountDir: (slug) => join(dataRoot, slug),
    accountOf: async (s) => (s === "secret" ? "acct" : null),
    log: () => {},
    snapshotEvery: 3,
    historyEvery: 5,
    ...extra,
  });
  app.use(
    "/h",
    historyRouter({
      accountDir: (slug) => join(dataRoot, slug),
      slugOf: () => "acct",
      userOf: () => "me@example.org",
      live: (slug, ws) => relay.room(slug, ws),
    }),
  );
  server.on("request", app);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  const port = (server.address() as AddressInfo).port;
  const stop = () => {
    relay();
    server.close();
    server.closeAllConnections();
  };
  cleanup.push(stop);
  return { port, stop, relay, http: `http://127.0.0.1:${port}/h` };
}

/** A bare replica: says hello and waits to be welcomed, sends batches, and keeps every entry it hears. */
async function client(port: number) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}${SYNC_PATH}`, {
    headers: { "x-studio-hub-secret": "secret" },
  });
  const heard: Sequenced[] = [];
  let welcomed = false;
  ws.on("message", (d) => {
    const msg = JSON.parse(d.toString()) as FromRelay;
    if (msg.t === "seq") heard.push(msg.entry);
    if (msg.t === "welcome") welcomed = true;
  });
  await new Promise((r) => ws.on("open", r));
  ws.send(
    JSON.stringify({ t: "hello", workspace: WS, since: 0, proto: SYNC_PROTO }),
  );
  // In the room before anyone sends: an entry ordered before this hello arrives in the welcome, not as a `seq`.
  await until(() => welcomed);
  cleanup.push(() => ws.terminate());
  let n = 0;
  const send = (ops: FileOp[], label = "edit"): Batch => {
    const batch: Batch = {
      id: `${Math.random()}`,
      replica: "r1",
      local: ++n,
      ts: Date.now(),
      label,
      ops,
    };
    ws.send(JSON.stringify({ t: "batch", workspace: WS, batch }));
    return batch;
  };
  return { heard, send };
}

const text = (file: string, t: string): FileOp => ({
  kind: "text",
  file,
  text: t,
});

/** Whatever a history route answers; each test reads the fields of the route it called. */
interface Body {
  head: number;
  entries: { seq: number }[];
  checkpoints: unknown[];
  files: unknown[];
  entry: unknown;
}

const get = async (url: string) => {
  const r = await fetch(url);
  return { status: r.status, body: (await r.json().catch(() => null)) as Body };
};
const post = async (url: string, body: unknown) => {
  const r = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: r.status, body: (await r.json()) as Body };
};

describe("the sync history", () => {
  it("keeps every entry across saves and restarts, and rebuilds the files at any point", async () => {
    const data = mkdtempSync(join(tmpdir(), "hist-"));
    let relay = await relayOn(data);
    let a = await client(relay.port);
    for (let i = 1; i <= 12; i++) a.send([text("a.md", `v${i}`)]);
    a.send([{ kind: "remove", file: "a.md" }, text("b.md", "\u0000blob:abc")]);
    await until(() => a.heard.length === 13);
    relay.stop();
    relay = await relayOn(data);
    a = await client(relay.port);
    a.send([text("a.md", "back")]);
    await until(() => a.heard.length === 1);

    const dir = roomDir(join(data, "acct"), WS);
    expect(readdirSync(join(dir, "log")).length).toBeGreaterThan(2);
    expect(readdirSync(join(dir, "snapshots")).length).toBeGreaterThan(1);
    const all = await get(`${relay.http}/${WS}?limit=500`);
    expect(all.body.head).toBe(14);
    expect(all.body.entries.map((e: { seq: number }) => e.seq)).toEqual(
      Array.from({ length: 14 }, (_, i) => 14 - i),
    );
    const page = await get(`${relay.http}/${WS}?before=10&limit=3`);
    expect(page.body.entries.map((e: { seq: number }) => e.seq)).toEqual([
      9, 8, 7,
    ]);

    const d = await get(`${relay.http}/${WS}/diff?from=7&to=13`);
    expect(d.body.files).toEqual([
      { file: "a.md", before: "v7", after: null },
      { file: "b.md", before: null, after: "\u0000blob:abc", binary: true },
    ]);
    const one = await get(`${relay.http}/${WS}/diff?from=0&to=1`);
    expect(one.body.files).toEqual([
      { file: "a.md", before: null, after: "v1" },
    ]);
  }, 20_000);

  it("loads a room saved before it had segments, and gives its log one", async () => {
    const data = mkdtempSync(join(tmpdir(), "hist-"));
    const dir = roomDir(join(data, "acct"), WS);
    mkdirSync(dir, { recursive: true });
    const entry = (seq: number, t: string): Sequenced => ({
      seq,
      batch: {
        id: `b${seq}`,
        replica: "r",
        local: seq,
        ts: seq,
        label: "e",
        ops: [text("x.md", t)],
      },
      parked: [],
    });
    writeFileSync(
      join(dir, "room.json"),
      JSON.stringify({
        head: 2,
        files: { "x.md": "two" },
        log: [entry(1, "one"), entry(2, "two")],
      }),
    );
    writeFileSync(
      join(dir, "entries.jsonl"),
      `${JSON.stringify(entry(3, "three"))}\n`,
    );
    const relay = await relayOn(data);
    const all = await get(`${relay.http}/${WS}`);
    expect(all.body.head).toBe(3);
    expect(existsSync(join(dir, "log", "1.jsonl"))).toBe(true);
    const d = await get(`${relay.http}/${WS}/diff?from=1&to=3`);
    expect(d.body.files).toEqual([
      { file: "x.md", before: "one", after: "three" },
    ]);
  });

  it("restores a point as one batch every replica hears, and names checkpoints", async () => {
    const data = mkdtempSync(join(tmpdir(), "hist-"));
    const relay = await relayOn(data);
    const a = await client(relay.port);
    const b = await client(relay.port);
    a.send([text("song.k7x", "gain(1)\n"), text("notes.md", "hi")]);
    await until(() => b.heard.length === 1);
    const cp = await post(`${relay.http}/${WS}/checkpoints`, { name: "mixed" });
    expect(cp.body).toMatchObject({
      seq: 1,
      name: "mixed",
      by: "me@example.org",
    });
    a.send([
      text("song.k7x", "gain(2)\n"),
      { kind: "remove", file: "notes.md" },
    ]);
    a.send([text("extra.md", "new")]);
    await until(() => b.heard.length === 3);

    const res = await post(`${relay.http}/${WS}/restore`, { seq: 1 });
    expect(res.body.entry).toMatchObject({
      seq: 4,
      replica: "history",
      label: "restore to mixed",
      files: ["extra.md", "notes.md", "song.k7x"],
      parked: 0,
    });
    await until(() => b.heard.length === 4);
    expect(b.heard[3].batch.ops).toHaveLength(3);
    const d = await get(`${relay.http}/${WS}/diff?from=1&to=4`);
    expect(d.body.files).toEqual([]);
    const again = await post(`${relay.http}/${WS}/restore`, { seq: 4 });
    expect(again.body.entry).toBeNull();
    const list = await get(`${relay.http}/${WS}`);
    expect(list.body.checkpoints).toHaveLength(1);
  });

  it("takes one automatic checkpoint per idle period", async () => {
    const data = mkdtempSync(join(tmpdir(), "hist-"));
    const relay = await relayOn(data, { checkpointIdleMs: 50 });
    const a = await client(relay.port);
    a.send([text("a.md", "1")]);
    const dir = roomDir(join(data, "acct"), WS);
    await until(() => readCheckpoints(dir).length === 1);
    await new Promise((r) => setTimeout(r, 200));
    expect(readCheckpoints(dir)).toMatchObject([
      { seq: 1, name: "auto", by: "auto" },
    ]);
    a.send([text("a.md", "2")]);
    await until(() => readCheckpoints(dir).length === 2);
    expect(readCheckpoints(dir)[1].seq).toBe(2);
  });

  it("refuses a name that is not a single folder, and a room that does not exist", async () => {
    const relay = await relayOn(mkdtempSync(join(tmpdir(), "hist-")));
    expect((await get(`${relay.http}/a%5Cb`)).status).toBe(400);
    expect((await get(`${relay.http}/a%2Fb`)).status).toBe(400);
    expect((await get(`${relay.http}/nope`)).status).toBe(404);
  });

  it("settles the open conflicts on the files a restore rewrites, and only those", async () => {
    const data = mkdtempSync(join(tmpdir(), "hist-"));
    const relay = await relayOn(data);
    const a = await client(relay.port);
    const b = await client(relay.port);
    const stale = textHash("not what is there");
    a.send([text("song.k7x", "gain(1)\n"), text("notes.md", "n")]);
    a.send([text("song.k7x", "gain(2)\n")]);
    a.send([
      { kind: "text", file: "song.k7x", text: "gain(3)\n", was: stale },
      { kind: "text", file: "notes.md", text: "m", was: stale },
    ]);
    await until(() => b.heard.length === 3);
    const live = relay.relay.room("acct", WS).room;
    expect(live.conflicts.list().map((c) => c.id)).toEqual(["3.0", "3.1"]);

    const res = await post(`${relay.http}/${WS}/restore`, { seq: 1 });
    expect(res.status).toBe(200);
    await until(() => b.heard.length === 4);
    expect(b.heard[3].batch.resolves).toEqual(["3.0"]);
    expect(live.conflicts.list().map((c) => c.id)).toEqual(["3.1"]);
    expect(live.files.get("song.k7x")).toBe("gain(1)\n");
  });

  it("pages through many segments reading only the ones a page needs, and rebuilds a missing index", async () => {
    const data = mkdtempSync(join(tmpdir(), "hist-"));
    const relay = await relayOn(data);
    const a = await client(relay.port);
    for (let i = 1; i <= 60; i++) a.send([text("a.md", `v${i}`)]);
    await until(() => a.heard.length === 60);
    const dir = roomDir(join(data, "acct"), WS);
    const segments = readdirSync(join(dir, "log"))
      .filter((f) => f.endsWith(".jsonl"))
      .sort((x, y) => Number.parseInt(x, 10) - Number.parseInt(y, 10));
    expect(segments.length).toBe(20);
    const seqs = async (q: string) => {
      const r = await get(`${relay.http}/${WS}?${q}`);
      if (!r.body.entries) throw new Error(JSON.stringify(r));
      return r.body.entries.map((e) => e.seq);
    };
    // Build the index, then make every segment but the last two unreadable: the newest page must not open them.
    expect(await seqs("limit=3")).toEqual([60, 59, 58]);
    const locked = segments.slice(0, -2).map((f) => join(dir, "log", f));
    for (const f of locked) chmodSync(f, 0);
    try {
      expect(await seqs("before=58&limit=3")).toEqual([57, 56, 55]);
    } finally {
      for (const f of locked) chmodSync(f, 0o644);
    }
    // An old page reads neither the working log nor the later segments.
    const late = [
      join(dir, "entries.jsonl"),
      ...segments.slice(4).map((f) => join(dir, "log", f)),
    ];
    for (const f of late) chmodSync(f, 0);
    try {
      expect(await seqs("before=10&limit=3")).toEqual([9, 8, 7]);
    } finally {
      for (const f of late) chmodSync(f, 0o644);
    }
    rmSync(join(dir, "log", "index.json"));
    expect(await seqs("before=31&limit=2")).toEqual([30, 29]);
    expect(existsSync(join(dir, "log", "index.json"))).toBe(true);
  }, 20_000);
});
