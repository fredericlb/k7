import { describe, expect, it } from "vitest";
import { projectLoading, startupStep } from "./StartupBar";

const base = {
  searching: false,
  hasEngine: true,
  load: null,
  sync: null,
  connecting: false,
};

describe("startupStep", () => {
  it("says an engine is being looked for, and nothing once the look is over with none", () => {
    expect(
      startupStep({ ...base, hasEngine: false, searching: true })?.pct,
    ).toBeNull();
    expect(startupStep({ ...base, hasEngine: false })).toBeNull();
  });

  it("measures the copy when the bytes are known", () => {
    const sync = { files: 2, filesDone: 1, bytes: 400, bytesDone: 100 };
    expect(startupStep({ ...base, load: "copying", sync })?.pct).toBe(25);
    expect(startupStep({ ...base, load: "copying" })?.pct).toBeNull();
  });

  it("measures the plugin scan once it has a total, and says it is listing before", () => {
    const scan = { done: 30, total: 120, current: "" };
    expect(startupStep({ ...base, load: "scanning", scan })?.pct).toBe(25);
    expect(startupStep({ ...base, load: "scanning" })?.pct).toBeNull();
    expect(
      startupStep({ ...base, load: "scanning", scan: { ...scan, total: 0 } })
        ?.pct,
    ).toBeNull();
  });

  it("names applying and warming, then the dial, then nothing", () => {
    expect(startupStep({ ...base, load: "applying" })).not.toBeNull();
    expect(startupStep({ ...base, load: "warming" })).not.toBeNull();
    expect(startupStep({ ...base, connecting: true })).not.toBeNull();
    expect(startupStep(base)).toBeNull();
  });
});

describe("projectLoading", () => {
  it("holds Play while the project is copied, applied or warmed, however connected the engine is", () => {
    for (const load of ["scanning", "copying", "applying", "warming"] as const)
      expect(projectLoading(load, false)).toBe(true);
  });

  it("frees Play once the project is playable, and never waits on a snapshot", () => {
    expect(projectLoading(null, false)).toBe(false);
    expect(projectLoading("copying", true)).toBe(false);
  });

  it("holds Play until the file service has said where the project stands", () => {
    expect(projectLoading(undefined, false)).toBe(true);
    expect(projectLoading(undefined, true)).toBe(false);
  });
});
