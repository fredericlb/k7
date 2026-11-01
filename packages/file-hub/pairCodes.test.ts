import { describe, expect, it } from "vitest";
import {
  challengeOf,
  newVerifier,
  PAIR_CODE_MS,
  PairCodes,
} from "./pairCodes.ts";

const grant = { user: "a@example.org", sub: "sub-a", name: "laptop" };

describe("PairCodes", () => {
  it("trades a code for its grant with the matching verifier, once", () => {
    const codes = new PairCodes();
    const verifier = newVerifier();
    const code = codes.issue(grant, challengeOf(verifier)) as string;
    expect(codes.redeem(code, verifier)).toEqual(grant);
    expect(codes.redeem(code, verifier)).toBeNull();
  });

  it("refuses another verifier, and the code is gone after the try", () => {
    const codes = new PairCodes();
    const verifier = newVerifier();
    const code = codes.issue(grant, challengeOf(verifier)) as string;
    expect(codes.redeem(code, newVerifier())).toBeNull();
    expect(codes.redeem(code, verifier)).toBeNull();
  });

  it("refuses a code past its two minutes", () => {
    let now = 1_000;
    const codes = new PairCodes(() => now);
    const verifier = newVerifier();
    const code = codes.issue(grant, challengeOf(verifier)) as string;
    now += PAIR_CODE_MS + 1;
    expect(codes.redeem(code, verifier)).toBeNull();
  });

  it("issues nothing for a challenge that is not S256", () => {
    expect(new PairCodes().issue(grant, "plain")).toBeNull();
  });
});
