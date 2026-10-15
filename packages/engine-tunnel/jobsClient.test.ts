// jobsClient.test.ts — a job that never finishes is given up and its channel closed: after a
// silence, or after its whole budget however chatty it is.

import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { JobError, type JobSocket, requestJob } from "./jobsClient.ts";

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
