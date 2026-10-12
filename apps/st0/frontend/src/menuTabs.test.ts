// The menu's tabs: one per kind of thing the rows act on, never an empty one, the clicked thing first.

import { describe, expect, it } from "vitest";
import type { MenuItem } from "./contextMenu";
import { menuTab, menuTabs } from "./menuTabs";

const row = (verb: string): MenuItem => ({
  label: verb,
  description: "",
  command: `${verb} x`,
  complete: true,
  verb,
});

describe("menuTabs", () => {
  it("groups rows by their command's first word, the shell's ui tab last", () => {
    const tabs = menuTabs([
      row("ui file"),
      row("event move"),
      row("track mute"),
      row("event remove"),
    ]);
    expect(tabs.map((t) => t.tab)).toEqual(["event", "track", "ui"]);
    expect(tabs[0].items.map((i) => i.verb)).toEqual([
      "event move",
      "event remove",
    ]);
  });
  it("puts the plural range verbs on the event's tab", () => {
    expect(menuTab(row("events move"))).toBe("event");
  });
  it("makes no tab nothing falls in", () => {
    expect(menuTabs([row("track mute")]).map((t) => t.tab)).toEqual(["track"]);
    expect(menuTabs([])).toEqual([]);
  });
});
