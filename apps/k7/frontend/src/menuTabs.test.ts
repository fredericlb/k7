// The menu's tabs: one per kind of thing the rows act on, never an empty one, the clicked thing first.

import { describe, expect, it } from "vitest";
import type { MenuItem } from "./contextMenu";
import {
  dangerLast,
  isDestructive,
  menuTab,
  menuTabs,
  moveFocus,
} from "./menuTabs";

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

describe("dangerLast", () => {
  it("moves what takes something away after the rest, each half in order", () => {
    const { safe, danger } = dangerLast([
      row("track delete"),
      row("track mute"),
      row("track automation remove"),
      row("track solo"),
    ]);
    expect(safe.map((i) => i.verb)).toEqual(["track mute", "track solo"]);
    expect(danger.map((i) => i.verb)).toEqual([
      "track delete",
      "track automation remove",
    ]);
  });
  it("reads a confirm as destructive whatever the verb, and an unlink as one too", () => {
    expect(isDestructive({ verb: "track freeze", confirm: true })).toBe(true);
    expect(isDestructive({ verb: "graph unlink" })).toBe(true);
    expect(isDestructive({ verb: "node bypass" })).toBe(false);
  });
});

describe("moveFocus", () => {
  it("wraps Up and Down, starts from either end when nothing has the focus", () => {
    expect(moveFocus("ArrowDown", 2, 3)).toBe(0);
    expect(moveFocus("ArrowUp", 0, 3)).toBe(2);
    expect(moveFocus("ArrowDown", -1, 3)).toBe(0);
    expect(moveFocus("ArrowUp", -1, 3)).toBe(2);
  });
  it("jumps with Home and End, and ignores every other key", () => {
    expect(moveFocus("Home", 2, 3)).toBe(0);
    expect(moveFocus("End", 0, 3)).toBe(2);
    expect(moveFocus("a", 0, 3)).toBeNull();
    expect(moveFocus("ArrowDown", -1, 0)).toBeNull();
  });
});
