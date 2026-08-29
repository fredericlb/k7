// The two things about the merged log that fail SILENTLY: a truncate that lands after the
// append handle opened (a sparse file whose head reads as blanks in st0's Logs panel), and
// a hand-joined path that ignores $STUDIO_HOME (which is how WSL shares the host's dir).

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let home: string;
const saved = process.env.STUDIO_HOME;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "capot-log-"));
  process.env.STUDIO_HOME = home;
});

afterEach(() => {
  if (saved === undefined) delete process.env.STUDIO_HOME;
  else process.env.STUDIO_HOME = saved;
  rmSync(home, { recursive: true, force: true });
});

// Imported per test: logbus keeps one append stream per module instance, so a shared one
// would go on writing to the previous test's temp dir.
async function fresh(): Promise<typeof import("./logbus.ts")> {
  vi.resetModules();
  return await import("./logbus.ts");
}

/** The log so far, or "" while it does not exist yet. */
function read(): string {
  try {
    return readFileSync(join(home, ".studio.log"), "utf8");
  } catch {
    return "";
  }
}

/** Wait for a value rather than for a duration; a fixed sleep is the flake this file had. */
async function until<T>(get: () => T | null, ms = 5000): Promise<T> {
  const stop = Date.now() + ms;
  for (;;) {
    const v = get();
    if (v !== null) return v;
    if (Date.now() > stop) throw new Error("the merged log never got its line");
    await new Promise((r) => setTimeout(r, 5));
  }
}

describe("the merged log", () => {
  it("truncates a previous session's file, leaving no NUL padding", async () => {
    const log = join(home, ".studio.log");
    writeFileSync(log, `${"old session\n".repeat(200)}`, "utf8");

    const { initMergedLog } = await fresh();
    initMergedLog();

    const after = readFileSync(log);
    expect(after.length).toBe(0);
    expect(after.includes(0)).toBe(false);
  });

  it("writes HH:MM:SS [tag] text — the shape the Logs panel offsets into", async () => {
    const { initMergedLog, line } = await fresh();
    initMergedLog();
    line("host", "supervisor up");

    // POLLED, not slept on. The stream opens lazily on first write, and a fixed delay is a
    // race that only loses on a busy machine — which is exactly when a suite runs.
    const text = await until(() => {
      const t = read();
      return t.length > 0 ? t : null;
    });
    expect(text).toMatch(/^\d{2}:\d{2}:\d{2} \[host] supervisor up\n$/);
  });

  it("honours $STUDIO_HOME rather than hand-joining a path under the real home", async () => {
    const { initMergedLog } = await fresh();
    initMergedLog();
    expect(() => readFileSync(join(home, ".studio.log"))).not.toThrow();
  });
});
