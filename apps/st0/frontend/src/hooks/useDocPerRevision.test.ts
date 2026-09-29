import { describe, expect, it, vi } from "vitest";
import { docPerRevision } from "./useDocPerRevision";

describe("docPerRevision", () => {
  it("asks once per change token, however many times it is called", async () => {
    const fetchDoc = vi.fn(async () => ({ n: fetchDoc.mock.calls.length }));
    const get = docPerRevision(fetchDoc);
    const a = get("r1");
    const b = get("r1");
    expect(a).toBe(b);
    expect(fetchDoc).toHaveBeenCalledTimes(1);
    get("r2");
    expect(fetchDoc).toHaveBeenCalledTimes(2);
  });

  it("forgets a failure, so the next caller on the same token asks again", async () => {
    let fail = true;
    const fetchDoc = vi.fn(async () => {
      if (fail) throw new Error("down");
      return "doc";
    });
    const get = docPerRevision(fetchDoc);
    await expect(get("r1")).rejects.toThrow("down");
    fail = false;
    await expect(get("r1")).resolves.toBe("doc");
    expect(fetchDoc).toHaveBeenCalledTimes(2);
  });
});
