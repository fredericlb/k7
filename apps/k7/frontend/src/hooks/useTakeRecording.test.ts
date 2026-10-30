// What the takes view's stop switches back. The engine's arm is a TOGGLE: sent while the link is
// down, it lands on an engine that may have restarted, or queues and flips the lane later.

import { describe, expect, it } from "vitest";
import { type SwitchBack, switchesBack } from "./useTakeRecording";

const list = (): SwitchBack[] => [
  { engine: false, run: () => {} },
  { engine: true, run: () => {} },
];

describe("a take's stop", () => {
  it("switches everything back on a live link", () => {
    const all = list();
    expect(switchesBack(all, false)).toEqual(all);
  });

  it("switches back only the browser's own state while the link is down", () => {
    const all = list();
    expect(switchesBack(all, true)).toEqual([all[0]]);
  });
});
