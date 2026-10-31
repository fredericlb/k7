// The gate's claim rules: never before the address resolved, never over someone else's, and the banner's choice of words.

import { describe, expect, it } from "vitest";
import { holdsClaim, takenBanner } from "./engineTaken";

const ready = { engine: true, resolved: true, asleep: false, taken: false };

describe("holdsClaim", () => {
  it("holds once there is an engine and a resolved project", () => {
    expect(holdsClaim(ready)).toBe(true);
  });

  it("claims nothing for an address not resolved yet, or that names nothing", () => {
    expect(holdsClaim({ ...ready, resolved: false })).toBe(false);
  });

  it("lets go while asleep, with no engine, and once somebody else took it", () => {
    expect(holdsClaim({ ...ready, asleep: true })).toBe(false);
    expect(holdsClaim({ ...ready, engine: false })).toBe(false);
    expect(holdsClaim({ ...ready, taken: true })).toBe(false);
  });
});

describe("takenBanner", () => {
  it("offers the engine back when another project took it", () => {
    expect(
      takenBanner({ heldBy: "a@b", why: "engine", tookFor: "lib/other.k7" }),
    ).toEqual({ says: "engine", takeBack: "engine" });
  });

  it("offers the project back when someone opened it elsewhere, named or not", () => {
    expect(
      takenBanner({ heldBy: "a@b", why: "project", tookFor: null }),
    ).toEqual({ says: "project", takeBack: "project" });
    expect(takenBanner({ heldBy: "", why: "project", tookFor: null })).toEqual({
      says: "projectAnon",
      takeBack: "project",
    });
  });

  it("offers nothing back on an engine that is not ours", () => {
    expect(
      takenBanner({ heldBy: "", why: "refused", tookFor: null }).takeBack,
    ).toBeNull();
  });
});
