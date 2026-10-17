// syncVersion.test.ts — the relay refusing a level it does not serve, a link that stops on it, and the log's `v`.

import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { LiveCapture } from "@studio/file-service/src/liveCapture.ts";
import { RelayLink } from "@studio/file-service/src/liveRelay.ts";
import { NeedsUpdate, type Sequenced } from "@studio/live-sync/ops";
import { SYNC_PROTO } from "@studio/live-sync/protocol";
import { Replica } from "@studio/live-sync/replica";
import { afterEach, describe, expect, it } from "vitest";
import { WebSocket, WebSocketServer } from "ws";
import {
  ENTRIES,
  entryLine,
  filesAt,
  parseEntryLine,
  parseState,
  stateText,
} from "./historyLog.ts";
import { attachSyncRelay, roomDir, SYNC_PATH } from "./syncRelay.ts";

const cleanup: (() => void)[] = [];
afterEach(() => {
  for (const f of cleanup.splice(0)) f();
});

async function relay(dataRoot: string) {
  const server: Server = createServer();
  const stop = attachSyncRelay(server, {
    accountDir: (slug) => join(dataRoot, slug),
    accountOf: async (s) => (s === "secret" ? "acct" : null),
    log: () => {},
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  cleanup.push(() => {
    stop();
    server.close();
    server.closeAllConnections();
  });
  return (server.address() as AddressInfo).port;
}

/** A socket on the relay, and the first frame each sent frame earns. */
async function replica(port: number) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}${SYNC_PATH}`, {
    headers: { "x-studio-hub-secret": "secret" },
  });
  cleanup.push(() => ws.close());
  const got: Record<string, unknown>[] = [];
  ws.on("message", (d) => got.push(JSON.parse(d.toString())));
  await new Promise((r) => ws.on("open", r));
  return async (frame: unknown) => {
    const n = got.length;
    ws.send(JSON.stringify(frame));
    const end = Date.now() + 3000;
    while (got.length === n && Date.now() < end)
      await new Promise((r) => setTimeout(r, 5));
    return got[n];
  };
}

const entry = (seq: number, text: string): Sequenced => ({
  seq,
  batch: {
    id: `b${seq}`,
    replica: "r",
    local: seq,
    ts: seq,
    label: "e",
    ops: [{ kind: "text", file: "x.md", text }],
  },
  parked: [],
});

describe("the relay, against replicas of another level", () => {
  it("welcomes a hello with or without proto", async () => {
    const ask = await replica(await relay(mkdtempSync(join(tmpdir(), "ver-"))));
    expect(await ask({ t: "hello", workspace: "w", since: 0 })).toMatchObject({
      t: "welcome",
    });
    expect(
      await ask({ t: "hello", workspace: "v", since: 0, proto: SYNC_PROTO }),
    ).toMatchObject({ t: "welcome" });
  });

  it("refuses a replica newer than the server, and lets it send nothing", async () => {
    const ask = await replica(await relay(mkdtempSync(join(tmpdir(), "ver-"))));
    expect(
      await ask({
        t: "hello",
        workspace: "w",
        since: 0,
        proto: SYNC_PROTO + 1,
      }),
    ).toEqual({
      t: "refused",
      workspace: "w",
      reason: "server-older",
      min: 1,
      server: SYNC_PROTO,
    });
    expect(
      await ask({
        t: "batch",
        workspace: "w",
        batch: entry(1, "x").batch,
      }),
    ).toMatchObject({ t: "error", error: "hello first" });
  });

  it("answers an unknown op kind and an unknown message with their reason", async () => {
    const ask = await replica(await relay(mkdtempSync(join(tmpdir(), "ver-"))));
    await ask({ t: "hello", workspace: "w", since: 0 });
    const future = {
      ...entry(1, "x").batch,
      ops: [{ kind: "json", file: "a.json" }],
    };
    expect(
      await ask({ t: "batch", workspace: "w", batch: future }),
    ).toMatchObject({ t: "error", reason: "unknown-op", workspace: "w" });
    expect(await ask({ t: "ping", workspace: "w" })).toMatchObject({
      t: "error",
      reason: "unknown-message",
    });
  });
});

describe("a link the relay refuses", () => {
  it("stops reconnecting and reads as refused", async () => {
    const wss = new WebSocketServer({ port: 0, host: "127.0.0.1" });
    cleanup.push(() => wss.close());
    let sockets = 0;
    let proto: unknown;
    wss.on("connection", (ws) => {
      sockets++;
      ws.on("message", (d) => {
        const hello = JSON.parse(d.toString());
        proto = hello.proto;
        ws.send(
          JSON.stringify({
            t: "refused",
            workspace: hello.workspace,
            reason: "update",
            min: 9,
            server: 9,
          }),
        );
      });
    });
    await new Promise((r) => wss.on("listening", r));
    const url = `ws://127.0.0.1:${(wss.address() as AddressInfo).port}`;
    const logged: string[] = [];
    const link = new RelayLink(url, { secret: "s" }, (m) => logged.push(m));
    cleanup.push(() => link.close());
    const replica = new Replica("me", { read: () => null, write: () => {} });
    link.add(
      {
        name: "w",
        capture: {} as LiveCapture,
        replica,
        written: [],
        onRemote: () => {},
      },
      mkdtempSync(join(tmpdir(), "ver-log-")),
    );
    const end = Date.now() + 3000;
    while (link.textState("w") !== "refused" && Date.now() < end)
      await new Promise((r) => setTimeout(r, 10));
    expect(proto).toBe(SYNC_PROTO);
    expect(link.textState("w")).toBe("refused");
    expect(link.refusal()).toBe("update");
    // Longer than the first retry: a refused link makes no second socket.
    await new Promise((r) => setTimeout(r, 1500));
    expect(sockets).toBe(1);
    expect(logged.filter((m) => m.includes("update k7"))).toHaveLength(1);
  });
});

describe("the log's version", () => {
  it("stamps each entry with v, and reads entries with and without one", () => {
    const line = entryLine(entry(1, "a"));
    expect(JSON.parse(line).v).toBe(1);
    expect(parseEntryLine(line)).toEqual(entry(1, "a"));
    expect(parseEntryLine(JSON.stringify(entry(2, "b")))).toEqual(
      entry(2, "b"),
    );
  });

  it("refuses an entry or a state of a newer version rather than replaying it", () => {
    const newer = JSON.stringify({ v: 2, ...entry(1, "a") });
    expect(() => parseEntryLine(newer)).toThrow(NeedsUpdate);
    const futureOp = JSON.stringify({
      ...entry(1, "a"),
      batch: { ...entry(1, "a").batch, ops: [{ kind: "json", file: "a" }] },
    });
    expect(() => parseEntryLine(futureOp)).toThrow(NeedsUpdate);
    expect(() => parseState(JSON.stringify({ v: 2, head: 0 }))).toThrow(
      NeedsUpdate,
    );
    expect(parseState(stateText({ head: 3 }))).toEqual({ head: 3 });
    expect(parseState(JSON.stringify({ head: 3 }))).toEqual({ head: 3 });
  });

  it("skips a torn line or one that is no entry", () => {
    expect(parseEntryLine('{"seq":1,"bat')).toBeNull();
    expect(parseEntryLine('{"v":1,"seq":1}')).toBeNull();
  });

  it("refuses to rebuild history across a newer entry", () => {
    const dir = mkdtempSync(join(tmpdir(), "ver-hist-"));
    writeFileSync(
      join(dir, ENTRIES),
      entryLine(entry(1, "a")) +
        `${JSON.stringify({ v: 2, ...entry(2, "b") })}\n`,
    );
    expect(() => filesAt(dir, 2)).toThrow(NeedsUpdate);
  });

  it("does not load a room whose log a newer k7 wrote", async () => {
    const data = mkdtempSync(join(tmpdir(), "ver-room-"));
    const dir = roomDir(join(data, "acct"), "w");
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, ENTRIES),
      `${JSON.stringify({ v: 2, ...entry(1, "a") })}\n`,
    );
    const ask = await replica(await relay(data));
    expect(await ask({ t: "hello", workspace: "w", since: 0 })).toMatchObject({
      t: "error",
    });
    expect(readFileSync(join(dir, ENTRIES), "utf8")).toContain('"v":2');
  });

  it("writes the room's saved state with v", async () => {
    const data = mkdtempSync(join(tmpdir(), "ver-save-"));
    const ask = await replica(await relay(data));
    await ask({ t: "hello", workspace: "w", since: 0 });
    await ask({ t: "batch", workspace: "w", batch: entry(1, "a").batch });
    cleanup.splice(0).forEach((f) => {
      f();
    });
    const dir = roomDir(join(data, "acct"), "w");
    expect(JSON.parse(readFileSync(join(dir, "room.json"), "utf8")).v).toBe(1);
    expect(
      JSON.parse(readFileSync(join(dir, "log", "1.jsonl"), "utf8")).v,
    ).toBe(1);
    expect(
      JSON.parse(readFileSync(join(dir, "log", "index.json"), "utf8")).v,
    ).toBe(1);
  });
});
