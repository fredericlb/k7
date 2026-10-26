import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Store = typeof import("./downloads");
let s: Store;

beforeEach(async () => {
  vi.useFakeTimers();
  vi.resetModules();
  s = await import("./downloads");
});
afterEach(() => vi.useRealTimers());

const deferred = () => {
  let resolve!: () => void;
  let reject!: (e: Error) => void;
  const p = new Promise<void>((y, n) => {
    resolve = y;
    reject = n;
  });
  return { p, resolve, reject };
};
const flush = () => vi.advanceTimersByTimeAsync(0);
const phases = () => s.downloadsSnapshot().map((d) => `${d.key}:${d.phase}`);

describe("queueDownload", () => {
  it("runs two at a time and queues the rest", async () => {
    const runs = [deferred(), deferred(), deferred()];
    for (const [i, r] of runs.entries())
      s.queueDownload({ key: `k${i}`, kind: "song", label: `${i}` }, () => r.p);
    expect(phases()).toEqual(["k0:running", "k1:running", "k2:queued"]);
    runs[0].resolve();
    await flush();
    expect(phases()).toEqual(["k0:done", "k1:running", "k2:running"]);
  });

  it("answers the same promise for a key already in flight", () => {
    const run = vi.fn(() => new Promise<void>(() => {}));
    const a = s.queueDownload({ key: "x", kind: "song", label: "x" }, run);
    const b = s.queueDownload({ key: "x", kind: "song", label: "x" }, run);
    expect(a).toBe(b);
    expect(run).toHaveBeenCalledTimes(1);
    expect(s.isDownloading(s.downloadsSnapshot(), "x")).toBe(true);
  });

  it("keeps a failure after the finished rows linger out", async () => {
    const ok = deferred();
    const bad = deferred();
    s.queueDownload({ key: "ok", kind: "song", label: "" }, () => ok.p);
    s.queueDownload({ key: "bad", kind: "song", label: "" }, () => bad.p).catch(
      () => {},
    );
    ok.resolve();
    bad.reject(new Error("gone"));
    await flush();
    expect(phases()).toEqual(["ok:done", "bad:failed"]);
    await vi.advanceTimersByTimeAsync(s.LINGER_MS);
    expect(s.downloadsSnapshot()).toEqual([
      expect.objectContaining({ key: "bad", error: "gone" }),
    ]);
    s.clearFinished();
    expect(s.downloadsSnapshot()).toEqual([]);
  });
});

describe("syncDownloads", () => {
  it("adds, updates, and ends what left the source's list", () => {
    const row = (received: number) => ({
      key: "instrument:piano",
      kind: "engine" as const,
      label: "Piano",
      phase: "running" as const,
      received,
      total: 10,
    });
    s.syncDownloads("instrument:", [row(1)]);
    const first = s.downloadsSnapshot();
    s.syncDownloads("instrument:", [row(1)]);
    expect(s.downloadsSnapshot()).toBe(first);
    s.syncDownloads("instrument:", [row(5)]);
    expect(s.downloadsSnapshot()[0].received).toBe(5);
    s.syncDownloads("instrument:", []);
    expect(phases()).toEqual(["instrument:piano:done"]);
  });
});

describe("trackDownload", () => {
  it("reports progress then its end", () => {
    const t = s.trackDownload({ key: "model:1", kind: "engine", label: "m" });
    t.progress(3, 9);
    expect(s.downloadsSnapshot()[0]).toMatchObject({ received: 3, total: 9 });
    t.end("refused");
    expect(phases()).toEqual(["model:1:failed"]);
  });
});
