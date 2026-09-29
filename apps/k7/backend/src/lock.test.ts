import { describe, expect, it } from "vitest";
import { serialized } from "./lock.ts";

const later = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("serialized", () => {
  it("runs work on one key in arrival order, even when the first is slower", async () => {
    const log: string[] = [];
    await Promise.all([
      serialized("k", async () => {
        await later(20);
        log.push("first");
      }),
      serialized("k", async () => {
        log.push("second");
      }),
    ]);
    expect(log).toEqual(["first", "second"]);
  });

  it("lets a failure free the key for the next caller", async () => {
    const failed = serialized("f", async () => {
      throw new Error("no");
    });
    await expect(failed).rejects.toThrow("no");
    expect(await serialized("f", async () => "next")).toBe("next");
  });

  it("does not hold different keys behind each other", async () => {
    const log: string[] = [];
    await Promise.all([
      serialized("a", async () => {
        await later(20);
        log.push("a");
      }),
      serialized("b", async () => {
        log.push("b");
      }),
    ]);
    expect(log).toEqual(["b", "a"]);
  });
});
