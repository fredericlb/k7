// Tests for the shared reconnect ladder: doubling from the minimum, and never past the cap.

import { describe, expect, it } from "vitest";
import {
  backoffMs,
  ENGINE_RECONNECT_MAX_MS,
  ENGINE_RECONNECT_MIN_MS,
} from "./engineAccess.ts";

describe("backoffMs", () => {
  it("doubles from the minimum", () => {
    expect(backoffMs(0)).toBe(ENGINE_RECONNECT_MIN_MS);
    expect(backoffMs(1)).toBe(ENGINE_RECONNECT_MIN_MS * 2);
  });

  it("stops at the cap, however many attempts", () => {
    expect(backoffMs(40)).toBe(ENGINE_RECONNECT_MAX_MS);
    expect(backoffMs(40, 5000)).toBe(5000);
  });
});
