// syncEvict.test.ts — a room nobody is joined to is saved and dropped from memory, and loads whole on the next use.
// See docs/syncRelay.md.

import { mkdtempSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HUB_SECRET_HEADER } from "@studio/web-protocol";
import { afterAll, describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import { attachSyncRelay, SYNC_PATH } from "./syncRelay.ts";

const SECRET = "hub-secret";
const cleanup: (() => void)[] = [];
afterAll(() => {
  for (const f of cleanup.splice(0).reverse()) f();
});

async function until(f: () => boolean, ms = 5000): Promise<void> {
  const end = Date.now() + ms;
  while (!f()) {
    if (Date.now() > end) throw new Error("timed out");
    await new Promise((r) => setTimeout(r, 20));
  }
}

describe("the sync relay's rooms", () => {
  it("drops a room nobody holds once it is idle, and loads it back with every entry", async () => {
    const dataRoot = mkdtempSync(join(tmpdir(), "syncevict-"));
    const server: Server = createServer();
    const relay = attachSyncRelay(server, {
      accountDir: (slug) => join(dataRoot, slug),
      accountOf: async (s) => (s === SECRET ? "acct" : null),
      log: () => {},
      checkpointIdleMs: 40,
      evictIdleMs: 80,
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
    cleanup.push(() => {
      relay();
      server.close();
      server.closeAllConnections();
    });
    const url = `ws://127.0.0.1:${(server.address() as AddressInfo).port}${SYNC_PATH}`;

    const ws = new WebSocket(url, { headers: { [HUB_SECRET_HEADER]: SECRET } });
    const seqs: number[] = [];
    ws.on("message", (d) => {
      const m = JSON.parse(String(d));
      if (m.t === "seq") seqs.push(m.entry.seq);
    });
    await new Promise((r) => ws.once("open", r));
    ws.send(JSON.stringify({ t: "hello", workspace: "songs", since: 0 }));
    for (const n of [1, 2])
      ws.send(
        JSON.stringify({
          t: "batch",
          workspace: "songs",
          batch: {
            id: `b${n}`,
            replica: "r",
            local: n,
            ts: Date.now(),
            label: "",
            ops: [{ kind: "text", file: `n${n}.txt`, text: `v${n}` }],
          },
        }),
      );
    await until(() => seqs.length === 2);
    const before = relay.room("acct", "songs").room;

    // While a replica is joined the room stays, however long it is idle.
    await new Promise((r) => setTimeout(r, 200));
    expect(relay.room("acct", "songs").room).toBe(before);

    ws.close();
    await new Promise((r) => ws.once("close", r));
    // Looked at ONCE: reaching the room through `room()` is a use, and would keep it.
    await new Promise((r) => setTimeout(r, 400));
    const after = relay.room("acct", "songs").room;
    expect(after).not.toBe(before);
    expect(after.head).toBe(2);
    expect(Object.fromEntries(after.files)).toEqual({
      "n1.txt": "v1",
      "n2.txt": "v2",
    });
  });
});
