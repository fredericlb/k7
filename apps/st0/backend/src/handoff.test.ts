import { isHandoffReturn } from "@studio/web-protocol/handoff";
import { describe, expect, it } from "vitest";
import { challengeOf, openCode, signCode } from "./handoff.ts";

const KEY = "k";
const user = { sub: "u1", name: "Ana", email: "ana@example.com", groups: [] };
const verifier = "the-app-keeps-this";
const fresh = () =>
  signCode(KEY, { u: user, c: challengeOf(verifier), e: Date.now() + 60_000 });

describe("handoff code", () => {
  it("opens with its verifier", () => {
    expect(openCode(KEY, fresh(), verifier)).toEqual(user);
  });

  it("is useless without the verifier", () => {
    expect(openCode(KEY, fresh(), "guessed")).toBeNull();
  });

  it("refuses another key, a tampered body and an expired code", () => {
    expect(openCode("other", fresh(), verifier)).toBeNull();
    const [, sig] = fresh().split(".");
    const forged = Buffer.from(
      JSON.stringify({
        u: { sub: "admin" },
        c: challengeOf(verifier),
        e: Date.now() + 60_000,
      }),
    ).toString("base64url");
    expect(openCode(KEY, `${forged}.${sig}`, verifier)).toBeNull();
    expect(openCode(KEY, fresh(), verifier, Date.now() + 120_000)).toBeNull();
  });
});

describe("isHandoffReturn", () => {
  it("allows loopback http and the app's scheme only", () => {
    expect(isHandoffReturn("http://127.0.0.1:5123/done")).toBe(true);
    expect(isHandoffReturn("se.frediver.st0://auth")).toBe(true);
    expect(isHandoffReturn("https://evil.example/x")).toBe(false);
    expect(isHandoffReturn("http://192.168.1.2/done")).toBe(false);
    expect(isHandoffReturn("javascript:alert(1)")).toBe(false);
  });
});
