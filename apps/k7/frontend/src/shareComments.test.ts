import type { ShareComment } from "@studio/web-protocol";
import { describe, expect, it } from "vitest";
import { formatAt, inState, newestFirst } from "./shareComments";

const at = (id: number, state: ShareComment["state"]): ShareComment => ({
  id,
  author: "",
  body: "x",
  at: null,
  state,
  createdAt: "",
  updatedAt: "",
});

describe("formatAt", () => {
  it("writes the clock the transport writes, and grows an hour when there is one", () => {
    expect(formatAt(0)).toBe("0:00");
    expect(formatAt(83.7)).toBe("1:23");
    expect(formatAt(3723)).toBe("1:02:03");
  });

  it("floors rather than rounds — a comment at 1:59.9 is not at 2:00", () => {
    expect(formatAt(119.9)).toBe("1:59");
  });

  it("clamps a negative playhead, which a count-in produces", () => {
    expect(formatAt(-2)).toBe("0:00");
  });
});

describe("the three lists", () => {
  const all = [at(1, "active"), at(2, "resolved"), at(3, "active")];

  it("reads newest first, whatever the timecodes say", () => {
    expect(newestFirst(all).map((c) => c.id)).toEqual([3, 2, 1]);
  });

  it("does not touch what it was given", () => {
    newestFirst(all);
    expect(all.map((c) => c.id)).toEqual([1, 2, 3]);
  });

  it("splits by state and keeps the order", () => {
    expect(inState(all, "active").map((c) => c.id)).toEqual([3, 1]);
    expect(inState(all, "ignored")).toEqual([]);
  });
});
