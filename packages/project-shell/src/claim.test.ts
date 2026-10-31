// The order a host claims in: resolve the address first, so a project that is not there claims nothing.

import { describe, expect, it } from "vitest";
import { projectResolved } from "./claim.ts";
import type { GatePhase } from "./gateTypes.ts";

const every: GatePhase["k"][] = [
  "resolving",
  "cloning",
  "error",
  "missing",
  "no-libraries",
  "empty",
  "idle",
  "syncing",
  "loading",
  "open",
];

describe("projectResolved", () => {
  it("holds only once the project is found and opened", () => {
    expect(every.filter(projectResolved)).toEqual(["loading", "open"]);
  });

  it("never lets a missing address claim the engine", () => {
    expect(projectResolved("missing")).toBe(false);
    expect(projectResolved("resolving")).toBe(false);
  });
});
