// hubUploads.test.ts — what an engine may upload through its tunnel: so many at once, so many
// bytes each, and an upload left without a chunk is aborted and its part file deleted.

import { EventEmitter } from "node:events";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { WebSocket } from "ws";
import { encodeBinary } from "./frames.ts";
import type { UploadLimits } from "./hubFiles.ts";
import { HubTunnel } from "./hubTunnel.ts";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "hub-uploads-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

function tunnel(limits: Partial<UploadLimits>) {
  const ws = Object.assign(new EventEmitter(), {
    readyState: 1,
    sent: [] as unknown[],
    send(d: unknown, done?: () => void) {
      this.sent.push(d);
      done?.();
    },
    terminate() {},
  });
  const t = new HubTunnel("e1", ws as unknown as WebSocket, () => {}, limits);
  const ch = t.open([{ remote: dir, name: "ws", writable: true }]).ch;
  const put = (req: number, name: string, bytes: number, last: boolean) =>
    t.onBinary(
      encodeBinary(
        { t: "put", req, ch, path: join(dir, name), last },
        Buffer.alloc(bytes, 7),
      ),
    );
  const replies = () =>
    ws.sent
      .filter((s): s is string => typeof s === "string")
      .map((s) => JSON.parse(s) as { t: string; req?: number; error?: string })
      .filter((m) => m.t === "put-reply");
  return { put, replies };
}

// A deadline rather than a fixed pause: a loaded CI machine lands a write later than 30 ms.
async function until(f: () => boolean, ms = 5000): Promise<void> {
  const end = Date.now() + ms;
  while (!f()) {
    if (Date.now() > end) throw new Error("timed out");
    await new Promise((r) => setTimeout(r, 10));
  }
}

describe("uploads through a tunnel", () => {
  it("lands a file whole, under its own name", async () => {
    const { put, replies } = tunnel({});
    put(1, "take.wav", 5, false);
    put(1, "take.wav", 5, true);
    await until(() => replies().length > 0);
    expect(replies()).toMatchObject([{ req: 1 }]);
    expect(replies()[0].error).toBeUndefined();
    expect(readFileSync(join(dir, "take.wav")).length).toBe(10);
    expect(readdirSync(dir).filter((f) => f.endsWith(".part"))).toEqual([]);
  });

  it("refuses an upload past the number open at once", async () => {
    const { put, replies } = tunnel({ maxOpen: 2 });
    put(1, "a", 1, false);
    put(2, "b", 1, false);
    put(3, "c", 1, false);
    await until(() => replies().length > 0);
    expect(replies()).toMatchObject([{ req: 3, error: expect.any(String) }]);
  });

  it("aborts an upload past its size, deletes its part file and ignores its later chunks", async () => {
    const { put, replies } = tunnel({ maxBytes: 10 });
    put(1, "big", 8, false);
    put(1, "big", 8, false);
    put(1, "big", 8, true);
    await until(() => replies().length > 0 && readdirSync(dir).length === 0);
    expect(replies()).toMatchObject([{ req: 1, error: expect.any(String) }]);
    expect(readdirSync(dir)).toEqual([]);
  });

  it("aborts an upload that went quiet", async () => {
    const { put, replies } = tunnel({ idleMs: 300 });
    put(1, "slow", 4, false);
    await until(() => readdirSync(dir).some((f) => f.endsWith(".part")));
    await until(() => replies().length > 0 && readdirSync(dir).length === 0);
    expect(replies()).toMatchObject([{ req: 1, error: expect.any(String) }]);
    expect(readdirSync(dir)).toEqual([]);
  });

  it("stops at the hourly budget of the tunnel", async () => {
    const { put, replies } = tunnel({ bytesPerHour: 12 });
    put(1, "a", 8, true);
    put(2, "b", 8, true);
    await until(() => replies().length >= 2);
    expect(replies().find((r) => r.req === 2)?.error).toBeDefined();
    expect(replies().find((r) => r.req === 1)?.error).toBeUndefined();
  });
});
