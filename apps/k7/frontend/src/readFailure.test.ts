// A blip must not erase a view, and a real answer must: the line between them is the status.

import { describe, expect, it } from "vitest";
import { isAnswer } from "./readFailure";

const err = (status?: number) => Object.assign(new Error("x"), { status });

describe("isAnswer", () => {
  it("reads a 4xx as the project's answer", () => {
    expect(isAnswer(err(400))).toBe(true);
    expect(isAnswer(err(404))).toBe(true);
  });
  it("reads a server error, a timeout or no response as a blip", () => {
    expect(isAnswer(err(500))).toBe(false);
    expect(isAnswer(err(503))).toBe(false);
    expect(isAnswer(err(408))).toBe(false);
    expect(isAnswer(err(429))).toBe(false);
    expect(isAnswer(err())).toBe(false);
    expect(isAnswer(new TypeError("Failed to fetch"))).toBe(false);
    expect(isAnswer(null)).toBe(false);
  });
});
