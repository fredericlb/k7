// jobsClient.test.ts — a job that never finishes is given up and its channel closed: after a
// silence, or after its whole budget however chatty it is.

import { EventEmitter } from "node:events";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WebSocketServer } from "ws";
import {
  JobError,
  type JobSocket,
  requestJob,
  requestJobAt,
} from "./jobsClient.ts";

class FakeSocket extends EventEmitter {
  readyState = 1;
  sent: string[] = [];
  closed = false;
  send(data: string): void {
    this.sent.push(data);
  }
  close(): void {
    this.closed = true;
  }
  reply(m: object): void {
    const id = JSON.parse(this.sent[0] ?? "{}").id;
    this.emit("message", Buffer.from(JSON.stringify({ ...m, id })));
  }
}

describe("a job's time limits", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("gives up after a silence, and closes the channel", async () => {
    const sock = new FakeSocket();
    const p = requestJob(
      sock as unknown as JobSocket,
      { type: "x" },
      (r) => r.type === "done",
      undefined,
      { idleMs: 1000, totalMs: 10_000 },
    );
    const settled = expect(p).rejects.toBeInstanceOf(JobError);
    vi.advanceTimersByTime(800);
    sock.reply({ type: "progress" });
    vi.advanceTimersByTime(800);
    expect(sock.closed).toBe(false);
    vi.advanceTimersByTime(300);
    await settled;
    expect(sock.closed).toBe(true);
  });

  it("gives up after its whole budget, however often it says something", async () => {
    const sock = new FakeSocket();
    const p = requestJob(
      sock as unknown as JobSocket,
      { type: "x" },
      (r) => r.type === "done",
      undefined,
      { idleMs: 1000, totalMs: 3000 },
    );
    const settled = expect(p).rejects.toThrow(/did not finish/);
    for (let i = 0; i < 4; i++) {
      vi.advanceTimersByTime(800);
      sock.reply({ type: "progress" });
    }
    await settled;
    expect(sock.closed).toBe(true);
  });

  it("resolves on the last reply and leaves the channel open", async () => {
    const sock = new FakeSocket();
    const p = requestJob(
      sock as unknown as JobSocket,
      { type: "x" },
      (r) => r.type === "done",
    );
    sock.reply({ type: "done" });
    await expect(p).resolves.toMatchObject({ type: "done" });
    vi.advanceTimersByTime(24 * 60 * 60_000);
    expect(sock.closed).toBe(false);
  });
});

describe("requestJobAt", () => {
  let server: WebSocketServer;
  let url: string;
  beforeEach(async () => {
    server = new WebSocketServer({ port: 0, host: "127.0.0.1" });
    await new Promise((r) => server.once("listening", r));
    url = `ws://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterEach(() => new Promise((r) => server.close(r)));

  it("dials, answers with the last reply, and closes its socket", async () => {
    const closed = new Promise<void>((resolve) =>
      server.on("connection", (c) => {
        c.on("message", (d) => {
          const { id } = JSON.parse(d.toString());
          c.send(JSON.stringify({ type: "progress", id }));
          c.send(JSON.stringify({ type: "done", id }));
        });
        c.on("close", () => resolve());
      }),
    );
    const seen: string[] = [];
    const reply = await requestJobAt(
      url,
      { type: "x" },
      (r) => r.type === "done",
      (r) => seen.push(r.type),
    );
    expect(reply.type).toBe("done");
    expect(seen).toEqual(["progress", "done"]);
    await closed;
  });

  it("rejects with a JobError when nothing listens there", async () => {
    await new Promise((r) => server.close(r));
    server = new WebSocketServer({ noServer: true });
    await expect(
      requestJobAt(url, { type: "x" }, () => true),
    ).rejects.toBeInstanceOf(JobError);
  });
});
