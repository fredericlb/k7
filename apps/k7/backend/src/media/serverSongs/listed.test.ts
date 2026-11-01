import type { SyncedSong } from "@studio/mediatek/synced";
import { describe, expect, it } from "vitest";
import { keptAfter } from "./download.ts";
import {
  isListed,
  type LocalSong,
  onlyServerFiles,
  planListed,
} from "./listed.ts";

const BASE = "https://srv.example";
const synced = (over: Partial<SyncedSong> = {}): SyncedSong => ({
  server: BASE,
  rev: "1",
  files: [],
  ...over,
});
const song = (path: string, s: SyncedSong | null): LocalSong => ({
  path,
  synced: s,
});

describe("isListed", () => {
  it("holds a song listed itself or through a folder above it", () => {
    const lists = new Set(["songs/A/Album", "songs/B/X/T"]);
    expect(isListed(lists, "songs/A/Album/T1")).toBe(true);
    expect(isListed(lists, "songs/B/X/T")).toBe(true);
    expect(isListed(lists, "songs/B/X/T2")).toBe(false);
    expect(isListed(lists, "songs/A/Album2/T")).toBe(false);
  });
});

describe("planListed", () => {
  it("brings down the listed songs the server has and this machine lacks", () => {
    const plan = planListed(
      BASE,
      new Set(["songs/A/Album"]),
      ["songs/A/Album/T1", "songs/A/Album/T2", "songs/C/D/E"],
      [song("songs/A/Album/T1", synced())],
    );
    expect(plan.download).toEqual(["songs/A/Album/T2"]);
  });

  it("lets go only of the copies the lists brought from that server", () => {
    const plan = planListed(
      BASE,
      new Set(),
      [],
      [
        song("songs/auto", synced({ kept: "lists" })),
        song("songs/byHand", synced()),
        song("songs/madeHere", null),
        song(
          "songs/otherServer",
          synced({ server: "https://b", kept: "lists" }),
        ),
      ],
    );
    expect(plan.remove).toEqual(["songs/auto"]);
    expect(plan.follow).toEqual([]);
  });

  it("checks for updates only the listed songs that follow that server", () => {
    const plan = planListed(
      BASE,
      new Set(["songs/A"]),
      [],
      [
        song("songs/A/x/1", synced({ kept: "lists" })),
        song("songs/A/x/2", synced()),
        song("songs/A/x/3", null),
        song("songs/B/x/4", synced()),
      ],
    );
    expect(plan.follow.map((s) => s.path)).toEqual([
      "songs/A/x/1",
      "songs/A/x/2",
    ]);
    expect(plan.remove).toEqual([]);
  });
});

describe("onlyServerFiles", () => {
  it("refuses a copy holding a file the server never sent", () => {
    const s = synced({ files: [{ path: "songs/S/a", bytes: 1, mtime: 1 }] });
    expect(
      onlyServerFiles([{ path: "songs/S/a", bytes: 2, mtime: 9 }], s),
    ).toBe(true);
    expect(
      onlyServerFiles([{ path: "songs/S/b", bytes: 1, mtime: 1 }], s),
    ).toBe(false);
  });
});

describe("keptAfter", () => {
  it("marks a new copy the lists', clears it by hand, and keeps it on a refresh", () => {
    expect(keptAfter("lists", null)).toBe("lists");
    expect(keptAfter("lists", synced())).toBeUndefined();
    expect(keptAfter("hand", synced({ kept: "lists" }))).toBeUndefined();
    expect(keptAfter(undefined, synced({ kept: "lists" }))).toBe("lists");
    expect(keptAfter(undefined, null)).toBeUndefined();
  });
});
