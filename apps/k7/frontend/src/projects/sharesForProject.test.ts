import type { ShareSummary } from "@studio/web-protocol";
import { describe, expect, it } from "vitest";
import { liveCount, shareProjectName, sharesOf } from "./sharesForProject";

const share = (
  key: string,
  repo: string,
  project: string,
  revoked?: boolean,
): ShareSummary => ({
  key,
  token: revoked ? "" : `tok-${key}`,
  name: project,
  origin: { repo, project },
  createdAt: "2026-01-01T00:00:00.000Z",
  bytes: 1024,
  stems: 2,
  ...(revoked ? { revokedAt: "2026-02-01T00:00:00.000Z" } : {}),
});

describe("shareProjectName", () => {
  it("garde le dernier segment, suffixe compris", () => {
    // `origin.project` is a basename: that is what the file service writes, not the path.
    expect(shareProjectName("band", "chansons/hiver.k7")).toBe("hiver.k7");
    expect(shareProjectName("band", "hiver.k7")).toBe("hiver.k7");
  });

  it("un projet qui EST son espace prend le nom de l'espace", () => {
    // `dir === root` in the file service, so the same basename on both sides.
    expect(shareProjectName("leclip.k7", ".")).toBe("leclip.k7");
  });
});

describe("sharesOf", () => {
  const all = [
    share("a", "band", "hiver.k7"),
    share("b", "band", "été.k7"),
    share("c", "autre", "hiver.k7"),
    share("d", "band", "hiver.k7", true),
  ];

  it("ne retient que l'espace ET le projet", () => {
    // The same project name in another workspace is not the same project — "c" stays out.
    expect(
      sharesOf(all, "band", "chansons/hiver.k7").map((s) => s.key),
    ).toEqual(["a", "d"]);
  });

  it("garde les révoqués : la ligne datée est ce qui dit que ça a existé", () => {
    const rows = sharesOf(all, "band", "hiver.k7");
    expect(rows.map((s) => s.key)).toEqual(["a", "d"]);
    expect(liveCount(rows)).toBe(1);
  });

  it("rend une liste vide pour un projet qui n'a jamais été publié", () => {
    expect(sharesOf(all, "band", "automne.k7")).toEqual([]);
    expect(liveCount([])).toBe(0);
  });
});
