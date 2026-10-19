// print.test.ts — stringify's options: a header on top, and the nodes a caller wants on one line kept there.

import { describe, expect, it } from "vitest";
import { parse } from "./edit.ts";
import { stringify } from "./print.ts";

const WIDE = {
  steps: Array.from({ length: 12 }, (_, i) => ({ t: i, d: 1, k: 60 + i })),
  params: { a: 1 },
};

describe("stringify", () => {
  it("prints as before when given no options", () => {
    expect(stringify({ a: 1, b: [1, 2] })).toBe("a(1)\nb([1, 2])\n");
    expect(stringify({ a: 1 }, {})).toBe("a(1)\n");
  });

  it("writes the header's lines first, an empty one as a bare //", () => {
    const text = stringify({ a: 1 }, { header: ["synth pad", "", "v2"] });
    expect(text).toBe("// synth pad\n//\n// v2\na(1)\n");
    expect(parse(text)).toEqual({ a: 1 });
    expect(stringify({}, { header: ["only"] })).toBe("// only\n");
  });

  it("keeps the nodes `inline` names on one line, whatever their width", () => {
    const broken = stringify(WIDE);
    expect(broken.split("\n").length).toBeGreaterThan(5);
    const text = stringify(WIDE, {
      inline: (path) => path.length === 1 && path[0] === "steps",
    });
    expect(text.split("\n")[0].length).toBeGreaterThan(100);
    expect(text.startsWith("steps([t(0).d(1).k(60), ")).toBe(true);
    expect(parse(text)).toEqual(WIDE);
  });

  it("hands `inline` each node's path and value", () => {
    const seen: string[] = [];
    stringify(
      { a: { b: [1] } },
      {
        inline: (path, value) => {
          seen.push(`${path.join(".")}=${JSON.stringify(value)}`);
          return false;
        },
      },
    );
    expect(seen).toEqual([
      '={"a":{"b":[1]}}',
      'a={"b":[1]}',
      "a.b=[1]",
      "a.b.0=1",
    ]);
  });
});
