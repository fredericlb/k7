// engineControl.test.ts — the outbox, bounded in size and in age. This client had neither
// bound while the browser's twin had both, and it is the one on the critical path: the file
// service compiles the song and sends it through here. Drives a REAL ws server, because the
// replay only happens on a real 'open' — a mocked socket would test the mock.

import type { AddressInfo } from "node:net";
import { ENGINE_OUTBOX_MAX, ENGINE_OUTBOX_TTL_MS } from "@studio/web-protocol";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { WebSocketServer } from "ws";
import { EngineControl } from "./engineControl.ts";

// `send` is protected — the queue is an implementation detail every verb goes through, so the
// test reaches it the way a subclass would rather than through twenty public verbs.
class Probe extends EngineControl {
  say(o: object): void {
    this.send(o);
  }
}

let server: WebSocketServer;
let url: string;
let received: string[];

beforeEach(async () => {
  received = [];
  server = new WebSocketServer({ port: 0 });
  await new Promise((r) => server.once("listening", r));
  url = `ws://127.0.0.1:${(server.address() as AddressInfo).port}`;
  server.on("connection", (ws) =>
    ws.on("message", (d) => received.push(d.toString())),
  );
});

afterEach(async () => {
  vi.useRealTimers();
  await new Promise((r) => server.close(r));
});

/** Wait for the replay to land. Real timers: only Date is ever faked here. */
async function until(ok: () => boolean, ms = 3000): Promise<void> {
  const deadline = Date.now.call(null) + ms;
  while (!ok()) {
    if (Date.now.call(null) > deadline) throw new Error("timed out waiting");
    await new Promise((r) => setTimeout(r, 10));
  }
}

it("holds at most ENGINE_OUTBOX_MAX commands, and the oldest is the one that goes", async () => {
  const c = new Probe(url, "s1");
  const overflow = 50;
  for (let n = 0; n < ENGINE_OUTBOX_MAX + overflow; n++)
    c.say({ type: "t", n });

  c.connect();
  await until(() => received.length >= ENGINE_OUTBOX_MAX);
  // A beat, so a message arriving late would still fail the count below.
  await new Promise((r) => setTimeout(r, 50));

  expect(received.length).toBe(ENGINE_OUTBOX_MAX);
  // The newest command is the one that still describes what the person wants, so `overflow`
  // is where the replay starts — not 0.
  expect(JSON.parse(received[0]).n).toBe(overflow);
  expect(JSON.parse(received[received.length - 1]).n).toBe(
    ENGINE_OUTBOX_MAX + overflow - 1,
  );
  c.close();
});

it("does not replay a command older than the TTL", async () => {
  // Only Date is faked: the socket below needs real timers to ever open.
  vi.useFakeTimers({ toFake: ["Date"] });
  const c = new Probe(url, "s1");

  c.say({ type: "t", tag: "stale" });
  vi.setSystemTime(Date.now() + ENGINE_OUTBOX_TTL_MS + 1_000);
  c.say({ type: "t", tag: "fresh" });

  c.connect();
  await until(() => received.length >= 1);
  await new Promise((r) => setTimeout(r, 50));

  expect(received.map((r) => JSON.parse(r).tag)).toEqual(["fresh"]);
  c.close();
});

it("addresses the replayed command to its own session", async () => {
  const c = new Probe(url, "deux");
  c.say({ type: "t" });

  c.connect();
  await until(() => received.length >= 1);

  // The bug this guards: a queue that replays without the session leaves the engine applying
  // one project's command to whatever it holds by default.
  expect(JSON.parse(received[0]).session).toBe("deux");
  c.close();
});
