import { describe, expect, it } from "vitest";
import { seal, unseal } from "./secret.ts";

describe("the sealed password", () => {
  it("comes back out, which is the whole point", () => {
    expect(unseal(seal("hunter2 — é 🎸"))).toBe("hunter2 — é 🎸");
  });

  it("never seals the same way twice", () => {
    expect(seal("same")).not.toBe(seal("same"));
  });

  it("does not look like the password", () => {
    expect(seal("hunter2")).not.toContain("hunter2");
  });

  it("refuses a value that was tampered with", () => {
    const sealed = seal("hunter2");
    const [iv, tag, body] = sealed.split(".");
    const flipped = `${body.slice(0, -2)}${body.slice(-2) === "AA" ? "AB" : "AA"}`;
    expect(() => unseal(`${iv}.${tag}.${flipped}`)).toThrow();
  });

  it("refuses a value that is not one", () => {
    expect(() => unseal("nonsense")).toThrow();
  });
});
