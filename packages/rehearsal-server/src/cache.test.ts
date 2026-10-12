import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { once, sweepRowCaches, trimDiskCache } from "./cache.ts";

describe("once", () => {
  it("shares one run between callers that arrive together, and forgets it after", async () => {
    const inflight = new Map<string, Promise<number>>();
    let runs = 0;
    const work = () =>
      new Promise<number>((r) => setTimeout(() => r(++runs), 10));
    const [a, b] = await Promise.all([
      once(inflight, "k", work),
      once(inflight, "k", work),
    ]);
    expect([a, b, runs]).toEqual([1, 1, 1]);
    expect(inflight.size).toBe(0);
    expect(await once(inflight, "k", work)).toBe(2);
  });
});

describe("sweepRowCaches", () => {
  it("drops what expired and keeps what did not", () => {
    const m = new Map([
      ["old", { exp: Date.now() - 1 }],
      ["new", { exp: Date.now() + 60_000 }],
    ]);
    sweepRowCaches([m]);
    expect([...m.keys()]).toEqual(["new"]);
  });

  it("caps a map, oldest entries first", () => {
    const m = new Map<string, { exp: number }>();
    for (let i = 0; i < 5_010; i++)
      m.set(`k${i}`, { exp: Date.now() + 60_000 });
    sweepRowCaches([m]);
    expect(m.size).toBe(5_000);
    expect(m.has("k0")).toBe(false);
    expect(m.has("k5009")).toBe(true);
  });
});

describe("trimDiskCache", () => {
  it("removes the oldest files past the size, never a temporary or a recent one", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "k7-cache-"));
    const put = (name: string, ageMin: number) => {
      const f = path.join(dir, name);
      fs.writeFileSync(f, Buffer.alloc(1000));
      const t = new Date(Date.now() - ageMin * 60_000);
      fs.utimesSync(f, t, t);
    };
    put("oldest.webm", 120);
    put("older.webm", 60);
    put("tmp-writing.webm", 300);
    put("recent.webm", 1);
    expect(trimDiskCache(dir, 1500)).toBe(2);
    expect(fs.readdirSync(dir).sort()).toEqual([
      "recent.webm",
      "tmp-writing.webm",
    ]);
    fs.rmSync(dir, { recursive: true });
  });
});
