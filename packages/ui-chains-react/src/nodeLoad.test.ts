// The badge a card draws for what its plugin costs: rounded so a frame that moves nothing says nothing
// new, silent for a plugin too cheap to mention, and honest about a plugin that reports no memory.

import { describe, expect, it } from "vitest";
import { formatBytes, loadBadge } from "./nodeLoad";

describe("formatBytes", () => {
  it("reads as a person would say it", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(1536)).toBe("1.5 KB");
    expect(formatBytes(45 * 1024 * 1024)).toBe("45 MB");
    expect(formatBytes(1.25 * 1024 ** 3)).toBe("1.3 GB");
  });
});

describe("loadBadge", () => {
  it("says nothing for a plugin under 1 % and under 1 MB", () => {
    expect(loadBadge({ cpu: 0.004 })).toBeNull();
    expect(loadBadge({ cpu: 0.004, bytes: 1000 })).toBeNull();
    expect(loadBadge(undefined)).toBeNull();
  });

  it("shows the share, rounded, and the memory only where the plugin holds some", () => {
    expect(loadBadge({ cpu: 0.032 })?.text).toBe("3%");
    expect(loadBadge({ cpu: 0.032, bytes: 45 * 1024 * 1024 })?.text).toBe(
      "3% · 45 MB",
    );
    expect(loadBadge({ cpu: 0.001, bytes: 45 * 1024 * 1024 })?.text).toBe(
      "45 MB",
    );
  });

  it("says in the tooltip when a plugin cannot report its memory", () => {
    expect(loadBadge({ cpu: 0.05 })?.title).toBe(
      "CPU 5.0% of each audio block · memory: not reported by this plugin",
    );
  });
});
