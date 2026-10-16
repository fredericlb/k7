// engineShares.test.ts — the Engines card's badge for what an account is to an engine, and the
// share list as an owner types it, refused before a round trip when an entry is not an email.

import { describe, expect, it } from "vitest";
import { accessLabel, parseShares } from "./engineShares";
import type { LibraryLabels } from "./labels";

const l = {
  yours: "yours",
  sharedBy: (o: string) => `shared by ${o}`,
  server: "server",
  unowned: "unclaimed",
  someone: "someone",
} as unknown as LibraryLabels["engines"];

describe("accessLabel", () => {
  it("names each role, the owner to a shared account, and nothing from an older registry", () => {
    expect(accessLabel({ access: "owner" }, l)).toBe("yours");
    expect(accessLabel({ access: "shared", ownedBy: "ann@x" }, l)).toBe(
      "shared by ann@x",
    );
    expect(accessLabel({ access: "shared" }, l)).toBe("shared by someone");
    expect(accessLabel({ access: "server" }, l)).toBe("server");
    expect(accessLabel({ access: "unowned" }, l)).toBe("unclaimed");
    expect(accessLabel({}, l)).toBeNull();
  });
});

describe("parseShares", () => {
  it("splits on commas, spaces and lines, lowercases and drops repeats", () => {
    expect(parseShares(" Bob@X.org,\nann@y.fr ; bob@x.org\n\n")).toEqual({
      ok: true,
      emails: ["bob@x.org", "ann@y.fr"],
    });
    expect(parseShares("")).toEqual({ ok: true, emails: [] });
  });

  it("names the first entry that is not an email", () => {
    expect(parseShares("ann@y.fr bob")).toEqual({ ok: false, bad: "bob" });
  });
});
