import { describe, expect, it } from "vitest";
import { downNotice, RateLimit, snapshotNotice } from "./engineNotices.ts";

const s = (
  status: "stopped" | "running" | "error",
  extra: { error?: string; userStopped?: boolean } = {},
) => ({
  status,
  userStopped: false,
  ...extra,
});

describe("engine notices", () => {
  it("tells of an engine that failed, once per failure", () => {
    expect(
      snapshotNotice(s("running"), s("error", { error: "crashed" }))?.body,
    ).toBe("crashed");
    expect(snapshotNotice(s("error"), s("error"))).toBeNull();
    expect(snapshotNotice(null, s("error"))?.key).toBe("engine-error");
  });

  it("is quiet about a plain stop, which may be the person's own", () => {
    expect(snapshotNotice(s("running"), s("stopped"))).toBeNull();
    expect(snapshotNotice(null, s("stopped"))).toBeNull();
    expect(snapshotNotice(s("stopped"), s("running"))).toBeNull();
  });

  it("tells of the engine's return after a failure", () => {
    expect(snapshotNotice(s("error"), s("running"))?.key).toBe("engine-back");
  });

  it("tells of the supervisor going, not of it coming back", () => {
    expect(downNotice("supervisor restarting…")?.key).toBe("supervisor-down");
    expect(downNotice(null)).toBeNull();
  });

  it("lets a key through once per window", () => {
    const l = new RateLimit(1000);
    expect(l.allow("a", 0)).toBe(true);
    expect(l.allow("a", 500)).toBe(false);
    expect(l.allow("b", 500)).toBe(true);
    expect(l.allow("a", 1000)).toBe(true);
  });
});
