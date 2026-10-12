import { describe, expect, it } from "vitest";
import type { Page, Release } from "../types";
import { groupReleases } from "./PublicationsList";

const release = (id: string) => ({ id, title: id, artist: "" }) as Release;
const page = (id: string, releaseIds: string[]) =>
  ({ id, nametag: id, releaseIds, versionIds: {}, createdAt: "" }) as Page;

describe("groupReleases", () => {
  const releases = ["r1", "r2", "r3", "r4"].map(release);
  const pages = [page("p1", ["r3", "r1"]), page("p2", ["r1", "gone"])];

  it("lists each page's releases in the page's order, skipping ids that no longer exist", () => {
    const { groups } = groupReleases(pages, releases);
    expect(groups.map((g) => g.releases.map((r) => r.id))).toEqual([
      ["r3", "r1"],
      ["r1"],
    ]);
  });

  it("puts the releases no page lists at the end", () => {
    const { unlinked } = groupReleases(pages, releases);
    expect(unlinked.map((r) => r.id)).toEqual(["r2", "r4"]);
  });
});
