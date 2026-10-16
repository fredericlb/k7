import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createLimiter, runTool } from "./ffmpeg.ts";

const later = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("createLimiter", () => {
  it("runs N tasks with at most K in flight, all of them to the end", async () => {
    const limiter = createLimiter(2);
    let inFlight = 0;
    let peak = 0;
    const results = await Promise.all(
      Array.from({ length: 7 }, (_, i) =>
        limiter.run(async () => {
          inFlight++;
          peak = Math.max(peak, inFlight);
          await later(10);
          inFlight--;
          return i;
        }),
      ),
    );
    expect(peak).toBe(2);
    expect(results).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(limiter.active).toBe(0);
    expect(limiter.waiting).toBe(0);
  });

  it("frees a slot when a task fails", async () => {
    const limiter = createLimiter(1);
    await expect(
      limiter.run(async () => {
        throw new Error("no");
      }),
    ).rejects.toThrow("no");
    expect(await limiter.run(async () => "next")).toBe("next");
  });
});

describe("runTool", () => {
  it("SIGKILLs a child past its deadline and rejects with a clear error", async () => {
    const pidFile = path.join(os.tmpdir(), `ffmpeg-test-${process.pid}.pid`);
    const limiter = createLimiter(1);
    // A child that ignores SIGTERM, so only a SIGKILL ends it.
    const script = `require("fs").writeFileSync(${JSON.stringify(pidFile)}, String(process.pid)); process.on("SIGTERM", () => {}); setInterval(() => {}, 1000);`;
    await expect(
      runTool(process.execPath, ["-e", script], {
        timeoutMs: 500,
        what: "stuck child",
        limiter,
      }),
    ).rejects.toThrow(/stuck child took longer than .* and was killed/);
    expect(limiter.active).toBe(0);
    const pid = Number(fs.readFileSync(pidFile, "utf8"));
    fs.unlinkSync(pidFile);
    await later(100);
    expect(() => process.kill(pid, 0)).toThrow();
  });

  it("resolves on exit 0 and reports stderr on a failure", async () => {
    const limiter = createLimiter(1);
    await runTool(process.execPath, ["-e", ""], {
      timeoutMs: 5000,
      what: "ok",
      limiter,
    });
    await expect(
      runTool(
        process.execPath,
        ["-e", 'process.stderr.write("boom"); process.exit(3)'],
        { timeoutMs: 5000, what: "bad", limiter },
      ),
    ).rejects.toThrow("bad failed: boom");
  });

  it("rejects when the tool cannot be spawned", async () => {
    await expect(
      runTool("definitely-not-a-binary-k7", [], {
        timeoutMs: 5000,
        what: "x",
        limiter: createLimiter(1),
      }),
    ).rejects.toThrow();
  });
});
