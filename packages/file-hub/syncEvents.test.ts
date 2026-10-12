// syncEvents.test.ts — the change notices over a real HTTP server and a real fetch reading the
// stream: one account's events only, the session gate, the cap, the heartbeat, and cleanup.

import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import type { Sequenced } from "@studio/live-sync/ops";
import express from "express";
import { afterEach, describe, expect, it } from "vitest";
import {
  eventsRouter,
  noticeOf,
  publishSyncEvent,
  subscriberCount,
} from "./syncEvents.ts";

const cleanup: (() => void)[] = [];
afterEach(() => {
  for (const f of cleanup.splice(0).reverse()) f();
});

async function until(f: () => boolean, ms = 3000): Promise<void> {
  const end = Date.now() + ms;
  while (!f()) {
    if (Date.now() > end) throw new Error("timed out");
    await new Promise((r) => setTimeout(r, 10));
  }
}

async function serve(opts: { heartbeatMs?: number; max?: number } = {}) {
  const app = express();
  app.use(
    "/events",
    eventsRouter((req) => (req.headers["x-user"] as string) || null, opts),
  );
  const server: Server = createServer(app);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  cleanup.push(() => {
    server.closeAllConnections();
    server.close();
  });
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}/events`;
}

/** Open a stream as `user`; `next()` resolves with the text received since the last call that contains `want`. */
async function open(url: string, user: string) {
  const ctl = new AbortController();
  cleanup.push(() => ctl.abort());
  const res = await fetch(url, {
    headers: { "x-user": user },
    signal: ctl.signal,
  });
  let buf = "";
  const reader = res.body?.getReader();
  const decoder = new TextDecoder();
  void (async () => {
    try {
      for (;;) {
        const chunk = await reader?.read();
        if (!chunk || chunk.done) return;
        buf += decoder.decode(chunk.value);
      }
    } catch {
      // aborted
    }
  })();
  return {
    res,
    ctl,
    text: () => buf,
    next: async (want: string) => {
      await until(() => buf.includes(want));
      const out = buf;
      buf = "";
      return out;
    },
  };
}

const entry = (seq: number): Sequenced => ({
  seq,
  batch: {
    id: `b${seq}`,
    replica: "r1",
    local: seq,
    ts: 1,
    label: "edit",
    ops: [
      {
        kind: "yaml",
        file: "song/song.yaml",
        ops: [{ op: "set", path: ["bpm"], yaml: "120" }],
      },
      { kind: "text", file: "notes.md", text: "secret contents" },
    ],
    resolves: ["3.0"],
  },
  parked: [
    {
      id: `${seq}.0`,
      seq,
      replica: "r1",
      ts: 1,
      label: "edit",
      op: { kind: "remove", file: "old.yaml" },
    },
  ],
});

describe("sync events", () => {
  it("summarises an entry without its contents", () => {
    expect(noticeOf("band", entry(7))).toEqual({
      workspace: "band",
      seq: 7,
      files: ["song/song.yaml", "notes.md", "old.yaml"],
      parked: 1,
      settled: 1,
    });
  });

  it("streams an account's entries to its pages, and to nobody else's", async () => {
    const url = await serve();
    const a = await open(url, "acct-a");
    const b = await open(url, "acct-b");
    expect(a.res.status).toBe(200);
    expect(a.res.headers.get("content-type")).toMatch(/^text\/event-stream/);
    await a.next(": open");
    await b.next(": open");
    publishSyncEvent("acct-a", "band", entry(4));
    const got = await a.next("\n\n");
    expect(got).toContain("event: ordered\n");
    const data = JSON.parse(got.split("data: ")[1].split("\n")[0]);
    expect(data).toMatchObject({ workspace: "band", seq: 4, parked: 1 });
    expect(got).not.toContain("secret contents");
    await new Promise((r) => setTimeout(r, 50));
    expect(b.text()).toBe("");
  });

  it("answers 401 without a session, and 429 past the cap", async () => {
    const url = await serve({ max: 1 });
    expect((await fetch(url)).status).toBe(401);
    const a = await open(url, "acct-c");
    await a.next(": open");
    const over = await fetch(url, { headers: { "x-user": "acct-c" } });
    expect(over.status).toBe(429);
  });

  it("sends a heartbeat, and forgets a page that closed", async () => {
    const url = await serve({ heartbeatMs: 30 });
    const a = await open(url, "acct-d");
    await a.next(": open");
    await a.next(": hb");
    expect(subscriberCount("acct-d")).toBe(1);
    a.ctl.abort();
    await until(() => subscriberCount("acct-d") === 0);
  });
});
