// Two reads of one thing, answered out of order: the later-STARTED one wins, whichever lands last.

import { describe, expect, it } from "vitest";
import { latestAnswer } from "./latestAnswer";

describe("latestAnswer", () => {
  it("drops an answer older than one already shown", () => {
    const seen: string[] = [];
    const ask = latestAnswer<string>((v) => seen.push(v));
    const first = ask();
    const second = ask();
    second("new");
    first("old");
    expect(seen).toEqual(["new"]);
  });
  it("shows answers that land in order", () => {
    const seen: string[] = [];
    const ask = latestAnswer<string>((v) => seen.push(v));
    const a = ask();
    const b = ask();
    a("a");
    b("b");
    expect(seen).toEqual(["a", "b"]);
  });
});
