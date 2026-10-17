// The wire's version is one number written three times — here, and in the engine's and the
// supervisor's WireVersion.h — so this keeps them equal without building either.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  ENGINE_PROTOCOL,
  engineOutdated,
  engineProtocolOf,
  MIN_ENGINE_PROTOCOL,
} from "./version.ts";

const engine = join(dirname(fileURLToPath(import.meta.url)), "../../engine");

describe("ENGINE_PROTOCOL", () => {
  for (const file of [
    "k7-runtime/server/WireVersion.h",
    "k7-supervisor/src/WireVersion.h",
  ])
    it(`is the version ${file} states`, () => {
      const m = /constexpr int kEngineProtocol = (\d+);/.exec(
        readFileSync(join(engine, file), "utf8"),
      );
      expect(Number(m?.[1])).toBe(ENGINE_PROTOCOL);
    });

  it("is never below the minimum it serves", () => {
    expect(ENGINE_PROTOCOL).toBeGreaterThanOrEqual(MIN_ENGINE_PROTOCOL);
  });
});

describe("engineProtocolOf", () => {
  it("reads a number or a header's digits", () => {
    expect(engineProtocolOf(3)).toBe(3);
    expect(engineProtocolOf("2")).toBe(2);
  });

  it("reads anything else as 1, the version before the field", () => {
    for (const v of [undefined, null, "", "x", 0, -2, 1.5, "1.5", [2]])
      expect(engineProtocolOf(v)).toBe(1);
  });
});

describe("engineOutdated", () => {
  it("compares against the minimum given", () => {
    expect(engineOutdated(undefined, 2)).toBe(true);
    expect(engineOutdated("2", 2)).toBe(false);
    expect(engineOutdated(1)).toBe(false);
  });
});
