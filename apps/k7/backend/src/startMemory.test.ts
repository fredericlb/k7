// startMemory.test.ts — the collection after the start runs on this node, rather than warn that it cannot.

import { afterEach, describe, expect, it, vi } from "vitest";
import { collectAfterStart } from "./startMemory.ts";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("collectAfterStart", () => {
  it("collects without a flag on the command line", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    collectAfterStart(0);
    await new Promise((r) => setTimeout(r, 50));
    expect(warn).not.toHaveBeenCalled();
  });
});
