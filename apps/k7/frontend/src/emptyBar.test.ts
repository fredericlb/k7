// What the empty command bar offers: recents first, capped, then starters the catalogue holds.

import { describe, expect, it } from "vitest";
import type { PaletteCommand } from "./components/CommandBar";
import { EMPTY_RECENT_MAX, emptyBarRows } from "./emptyBar";

const c = (canonical: string): PaletteCommand => ({
  canonical,
  label: canonical,
  names: [],
  readable: canonical,
  args: [],
});

const CATALOGUE = [
  "track new",
  "ui file",
  "ui help",
  "track mute",
  "event split",
  "ui zoom",
  "transport loop",
  "node new",
].map(c);

const names = (rows: ReturnType<typeof emptyBarRows>) =>
  rows.map((r) => `${r.recent ? "R" : "S"}:${r.command.canonical}`);

describe("emptyBarRows", () => {
  it("lists only starters when nothing was run, skipping those the catalogue lacks", () => {
    expect(
      names(emptyBarRows(CATALOGUE, [], ["track new", "ui mixer", "ui help"])),
    ).toEqual(["S:track new", "S:ui help"]);
  });

  it("puts recents first and never repeats one as a starter", () => {
    expect(
      names(emptyBarRows(CATALOGUE, ["ui help", "track mute"], ["ui help"])),
    ).toEqual(["R:ui help", "R:track mute"]);
  });

  it("caps the recents and drops names the catalogue no longer has", () => {
    const recent = [
      "gone verb",
      "track mute",
      "event split",
      "ui zoom",
      "transport loop",
      "node new",
      "ui file",
    ];
    const rows = emptyBarRows(CATALOGUE, recent, []);
    expect(rows).toHaveLength(EMPTY_RECENT_MAX);
    expect(rows[0].command.canonical).toBe("track mute");
    expect(rows.every((r) => r.recent)).toBe(true);
  });
});
