// history.test.ts — the relay's whole log over a real socket: segments and snapshots, an older room,
// checkpoints, the HTTP routes, and a restore every connected replica hears.

import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Batch, FileOp, Sequenced } from "@studio/live-sync/ops";
import type { FromRelay } from "@studio/live-sync/protocol";
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
  return { port, stop, http: `http://127.0.0.1:${port}/h` };
}

/** A bare replica: says hello, sends batches, and keeps every entry it hears. */
async function client(port: number) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}${SYNC_PATH}`, {
    headers: { "x-studio-hub-secret": "secret" },
  });
  const heard: Sequenced[] = [];
  ws.on("message", (d) => {
    const msg = JSON.parse(d.toString()) as FromRelay;
    if (msg.t === "seq") heard.push(msg.entry);
  });
  await new Promise((r) => ws.on("open", r));
  ws.send(JSON.stringify({ t: "hello", workspace: WS, since: 0 }));
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
    a.send([text("song.yaml", "gain: 1\n"), text("notes.md", "hi")]);
    await until(() => b.heard.length === 1);
    const cp = await post(`${relay.http}/${WS}/checkpoints`, { name: "mixed" });
    expect(cp.body).toMatchObject({
      seq: 1,
      name: "mixed",
      by: "me@example.org",
    });
    a.send([
      text("song.yaml", "gain: 2\n"),
      { kind: "remove", file: "notes.md" },
    ]);
    a.send([text("extra.md", "new")]);
    await until(() => b.heard.length === 3);

    const res = await post(`${relay.http}/${WS}/restore`, { seq: 1 });
    expect(res.body.entry).toMatchObject({
      seq: 4,
      replica: "history",
      label: "restore to mixed",
      files: ["extra.md", "notes.md", "song.yaml"],
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
});
