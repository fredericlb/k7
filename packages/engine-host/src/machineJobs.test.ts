// machineJobs.test.ts — the two jobs that only answer: `log` hands the machine's merged log back
// untouched under `raw`, seeded by a tail and continued by offset, and `prefetch` counts what the
// channel already brought down rather than fetching anything itself.

import { appendFileSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mergedLogPath } from "@studio/engine-client/paths";
import { beforeEach, describe, expect, it } from "vitest";
import { machineJobs } from "./machineJobs.ts";

async function ask(req: Record<string, unknown>) {
  const replies: Record<string, unknown>[] = [];
  await machineJobs[String(req.type)](req as never, (r) => replies.push(r), {
    fetch: async () => false,
  } as never);
  return replies;
}

describe("the machine's small jobs", () => {
  beforeEach(() => {
    process.env.STUDIO_HOME = mkdtempSync(join(tmpdir(), "jobs-home-"));
  });

  it("seeds the log with its tail, then gives only the new whole lines", async () => {
    writeFileSync(mergedLogPath(), "a\nb\nc\n");
    const [seed] = await ask({ type: "log", tail: 2 });
    expect(seed).toEqual({
      type: "log",
      raw: { offset: 6, lines: ["b", "c"] },
    });
    appendFileSync(mergedLogPath(), "d\npartial");
    const [next] = await ask({ type: "log", offset: 6 });
    expect(next).toEqual({ type: "log", raw: { offset: 8, lines: ["d"] } });
  });

  it("reads an absent log as empty", async () => {
    const [r] = await ask({ type: "log", tail: 10 });
    expect(r).toEqual({ type: "log", raw: { offset: 0, lines: [] } });
  });

  it("counts the prefetched songs that are on this disk", async () => {
    const home = process.env.STUDIO_HOME as string;
    writeFileSync(join(home, "song.flac"), "x");
    const [r] = await ask({
      type: "prefetch",
      files: [join(home, "song.flac"), join(home, "gone.flac")],
    });
    expect(r).toEqual({ type: "prefetched", count: 1 });
  });
});
