import { describe, expect, it, vi } from "vitest";
import { Memo } from "./shapeMemo";

describe("Memo", () => {
  it("keeps the freshest entries only", () => {
    const m = new Memo<number>(2);
    m.set("a", 1);
    m.set("b", 2);
    m.set("a", 3);
    m.set("c", 4);
    expect(m.has("b")).toBe(false);
    expect(m.get("a")).toBe(3);
    expect(m.get("c")).toBe(4);
  });

  it("tells its listeners of every write, until they leave", () => {
    const m = new Memo<number>(4);
    const fn = vi.fn();
    const off = m.subscribe(fn);
    m.set("a", 1);
    off();
    m.set("b", 2);
    expect(fn).toHaveBeenCalledTimes(1);
  });
});
