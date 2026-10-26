// processes.test.ts — the bar's process list: the service's rows and this page's own merged by start,
// a poll answering the same list costing no re-render, and an ended export kept a moment then dropped.

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  LINGER_MS,
  processesSnapshot,
  runningCount,
  setServiceProcesses,
  subscribeProcesses,
  trackProcess,
} from "./processes";

afterEach(() => {
  vi.useRealTimers();
  setServiceProcesses([]);
});

describe("the process list", () => {
  it("merges the service's processes with this page's, oldest first", () => {
    vi.useFakeTimers();
    vi.setSystemTime(2000);
    const exp = trackProcess("export MP4");
    setServiceProcesses([
      {
        id: "p1",
        label: "track transcribe cam subs",
        state: "running",
        startedAt: 1000,
      },
    ]);
    expect(processesSnapshot().map((p) => p.label)).toEqual([
      "track transcribe cam subs",
      "export MP4",
    ]);
    expect(runningCount(processesSnapshot())).toBe(2);
    exp.progress(0.5, "frame 900 / 1800");
    expect(processesSnapshot()[1]).toMatchObject({
      progress: 0.5,
      local: true,
    });
    exp.end();
    expect(runningCount(processesSnapshot())).toBe(1);
    expect(processesSnapshot()[1]).toMatchObject({ state: "done" });
    vi.advanceTimersByTime(LINGER_MS + 1);
    expect(processesSnapshot().map((p) => p.label)).toEqual([
      "track transcribe cam subs",
    ]);
  });

  it("tells no one when a poll answers the same list", () => {
    const list = [
      {
        id: "p2",
        label: "picture render",
        state: "running" as const,
        startedAt: 1,
      },
    ];
    setServiceProcesses(list);
    const heard = vi.fn();
    const off = subscribeProcesses(heard);
    setServiceProcesses(list.map((p) => ({ ...p })));
    expect(heard).not.toHaveBeenCalled();
    off();
  });
});
