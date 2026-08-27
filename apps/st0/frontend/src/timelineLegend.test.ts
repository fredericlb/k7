import { describe, expect, it } from "vitest";
import { shortcutsByCommand } from "./keys";
import { LEGEND, legendRows } from "./timelineLegend";

/** The real table, which is the point: a row naming a command no key binds must not be drawn. */
const REAL = shortcutsByCommand();
const whats = (rows: { what: string }[]) => rows.map((r) => r.what);

describe("legendRows", () => {
  it("keeps the pane's own keys, which name no command by design", () => {
    const rows = legendRows("move", {});
    expect(whats(rows)).toEqual(["nudge", "commit", "cancel"]);
  });

  it("DROPS a row whose command nothing binds", () => {
    // An empty table binds nothing, so only the literal keys survive.
    expect(whats(legendRows("normal", {}))).toEqual([
      "move",
      "at beat 1 selects the row",
    ]);
  });

  it("writes the key that actually binds", () => {
    expect(legendRows("select", { "ui select": "q" })).toContainEqual({
      key: "q",
      what: "cancel",
    });
  });

  it("follows a REBOUND key without an edit here", () => {
    const a = legendRows("select", { "ui select": "v" });
    const b = legendRows("select", { "ui select": "§" });
    expect(a.find((r) => r.what === "cancel")?.key).toBe("v");
    expect(b.find((r) => r.what === "cancel")?.key).toBe("§");
  });

  it("appends the way back to the arrow only when a tool is held", () => {
    const held = legendRows("normal", REAL, true);
    expect(whats(held)).toContain("back to the arrow");
    expect(whats(legendRows("normal", REAL))).not.toContain(
      "back to the arrow",
    );
  });

  it("says something different in every mode — which is what naming them bought", () => {
    const n = whats(legendRows("normal", REAL));
    const s = whats(legendRows("select", REAL));
    const m = whats(legendRows("move", REAL));
    expect(n).not.toEqual(s);
    expect(s).not.toEqual(m);
  });
});

describe("against the real keymap", () => {
  it("binds every command the legend names — a row that never draws is a row that lies by omission", () => {
    const unbound = Object.values(LEGEND)
      .flat()
      .filter((r) => r.command && !REAL[r.command])
      .map((r) => r.command);
    expect(unbound).toEqual([]);
  });

  it("gives normal mode the two tools and the way back", () => {
    const rows = whats(legendRows("normal", REAL, true));
    expect(rows).toContain("blade");
    expect(rows).toContain("erase");
    expect(rows).toContain("back to the arrow");
  });
});
