// a11y.test.ts — the vim mode as the status panel spells it.

import { describe, expect, it } from "vitest";
import { vimModeText } from "./a11y";

describe("vimModeText", () => {
  it("spells the mode as vim's own status line does", () => {
    expect(vimModeText({ mode: "normal" })).toBe("NORMAL");
    expect(vimModeText({ mode: "insert" })).toBe("INSERT");
    expect(vimModeText({ mode: "visual" })).toBe("VISUAL");
    expect(vimModeText({ mode: "visual", subMode: "linewise" })).toBe(
      "VISUAL LINE",
    );
    expect(vimModeText({ mode: "visual", subMode: "blockwise" })).toBe(
      "VISUAL BLOCK",
    );
  });
});
