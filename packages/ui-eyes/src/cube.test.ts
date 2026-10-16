// A `.cube` read as a 3D texture takes it: what would go wrong silently is the entries read in the
// wrong order (red is the FASTEST axis), a non-0..1 domain left as it is, and a file one row
// short read as a LUT of the wrong size.

import { describe, expect, it } from "vitest";
import { parseCube } from "./cube";

// The identity at size 2: eight entries, red varying fastest, then green, then blue.
const IDENTITY = `# made by hand
TITLE "identity"
LUT_3D_SIZE 2
0 0 0
1 0 0
0 1 0
1 1 0
0 0 1
1 0 1
0 1 1
1 1 1
`;

describe("parseCube", () => {
  it("reads the size and every entry, red fastest, as RGBA", () => {
    const lut = parseCube(IDENTITY);
    expect(lut.size).toBe(2);
    expect(lut.data.length).toBe(8 * 4);
    expect([...lut.data.slice(4, 8)]).toEqual([1, 0, 0, 1]);
    expect([...lut.data.slice(8, 12)]).toEqual([0, 1, 0, 1]);
  });

  it("folds a domain other than 0..1 back onto it", () => {
    const lut = parseCube(
      IDENTITY.replace(
        "LUT_3D_SIZE 2",
        "LUT_3D_SIZE 2\nDOMAIN_MIN 0 0 0\nDOMAIN_MAX 2 2 2",
      ),
    );
    expect([...lut.data.slice(4, 8)]).toEqual([0.5, 0, 0, 1]);
  });

  it("refuses a 1D LUT, a missing size and a short file, by name", () => {
    expect(() => parseCube("LUT_1D_SIZE 4\n0 0 0\n")).toThrow(/1D LUT/);
    expect(() => parseCube("0 0 0\n")).toThrow(/LUT_3D_SIZE missing/);
    expect(() => parseCube(IDENTITY.replace("1 1 1\n", ""))).toThrow(
      /7 entries for a 2³ LUT/,
    );
  });
});
