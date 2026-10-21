import {
  type Download,
  EMPTY_SNAPSHOT,
} from "@studio/supervisor-host/hostProtocol";
import { describe, expect, it } from "vitest";
import { downloadsLine, trayStatus } from "./trayStatus.ts";

const dl = (over: Partial<Download>): Download =>
  ({
    name: "piano",
    label: "Piano",
    received: 0,
    total: 0,
    phase: "queued",
    ...over,
  }) as Download;

describe("trayStatus", () => {
  it("says why the supervisor is away before anything else", () => {
    expect(
      trayStatus({ snapshot: null, down: "supervisor restarting…" }),
    ).toEqual({
      icon: "error",
      line: "⚠ supervisor restarting…",
      downloads: null,
    });
  });

  it("spins while the engine scans or downloads, and is green once ready", () => {
    const running = { ...EMPTY_SNAPSHOT, status: "running" as const };
    expect(trayStatus({ snapshot: running, down: null }).icon).toBe("loading");
    expect(
      trayStatus({ snapshot: { ...running, pluginCount: 12 }, down: null }),
    ).toEqual({
      icon: "running",
      line: "● Engine running · :8765",
      downloads: null,
    });
  });

  it("tells a stop the person asked for from one still starting", () => {
    expect(
      trayStatus({
        snapshot: { ...EMPTY_SNAPSHOT, userStopped: true },
        down: null,
      }).line,
    ).toBe("○ Engine stopped");
  });
});

describe("downloadsLine", () => {
  it("names the one running, how far, and how many wait", () => {
    expect(
      downloadsLine([
        dl({ phase: "downloading", received: 50, total: 200 }),
        dl({ name: "drums", label: "Drums" }),
      ]),
    ).toBe("↓ Downloading Piano… 25% (+1 more)");
  });

  it("says a failure when nothing else runs, and nothing when idle", () => {
    expect(downloadsLine([dl({ phase: "failed" })])).toBe(
      "⚠ Piano: download failed",
    );
    expect(downloadsLine([])).toBeNull();
  });
});
