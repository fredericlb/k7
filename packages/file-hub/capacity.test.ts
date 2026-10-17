// capacity.test.ts — the file-service cap read from a cgroup v2 file, a v1 file, or none.

import { describe, expect, it } from "vitest";
import {
  BUDGET_MB,
  cgroupMemoryLimit,
  instanceCap,
  MAX_INSTANCES,
  RESERVE_MB,
} from "./capacity.ts";

const GB = 2 ** 30;

/** A filesystem holding only `files`; any other path throws ENOENT as readFileSync would. */
const fs = (files: Record<string, string>) => (path: string) => {
  const text = files[path];
  if (text === undefined) throw new Error(`ENOENT: ${path}`);
  return text;
};

describe("cgroupMemoryLimit", () => {
  it("reads cgroup v2's memory.max", () => {
    expect(
      cgroupMemoryLimit(fs({ "/sys/fs/cgroup/memory.max": "6442450944\n" })),
    ).toBe(6 * GB);
  });

  it("reads v2's `max` as no limit", () => {
    expect(
      cgroupMemoryLimit(fs({ "/sys/fs/cgroup/memory.max": "max\n" })),
    ).toBeNull();
  });

  it("falls back to cgroup v1's limit_in_bytes", () => {
    const v1 = "/sys/fs/cgroup/memory/memory.limit_in_bytes";
    expect(cgroupMemoryLimit(fs({ [v1]: "2147483648\n" }))).toBe(2 * GB);
    expect(cgroupMemoryLimit(fs({ [v1]: "9223372036854771712\n" }))).toBeNull();
  });

  it("is null with no cgroup at all", () => {
    expect(cgroupMemoryLimit(fs({}))).toBeNull();
  });
});

describe("instanceCap", () => {
  it("divides what the reserve leaves by the per-service budget", () => {
    expect(instanceCap({}, 6 * GB)).toBe(
      Math.floor((6 * 1024 - RESERVE_MB) / BUDGET_MB),
    );
    expect(instanceCap({}, 6 * GB)).toBe(12);
  });

  it("counts a service at its heap ceiling when that is below the budget", () => {
    expect(instanceCap({ STUDIO_FILE_SERVICE_HEAP_MB: "1024" }, 6 * GB)).toBe(
      12,
    );
    expect(instanceCap({ STUDIO_FILE_SERVICE_HEAP_MB: "128" }, 6 * GB)).toBe(
      18,
    );
  });

  it("keeps one service on a box smaller than the reserve, and MAX_INSTANCES with no limit", () => {
    expect(instanceCap({}, GB)).toBe(1);
    expect(instanceCap({}, null)).toBe(MAX_INSTANCES);
    expect(instanceCap({}, 1024 * GB)).toBe(MAX_INSTANCES);
  });

  it("obeys STUDIO_MAX_FILE_SERVICES over any limit", () => {
    expect(instanceCap({ STUDIO_MAX_FILE_SERVICES: "7" }, 6 * GB)).toBe(7);
    expect(instanceCap({ STUDIO_MAX_FILE_SERVICES: "7" }, null)).toBe(7);
    expect(instanceCap({ STUDIO_MAX_FILE_SERVICES: "zero" }, null)).toBe(
      MAX_INSTANCES,
    );
  });
});
