import { describe, expect, it } from "vitest";
import { loadCommandSpecs } from "./commandSpec";
import { SID_HANDLERS } from "./commands";

// A command in commands.yaml names a `sid`; the handler for it lives in
// SID_HANDLERS. This asserts the two never drift apart — adding a command without a
// handler, or renaming a sid on one side only, fails here instead of at runtime on
// whichever surface (CLI or web) types the command.
describe("command registry integrity (commands.yaml <-> SID_HANDLERS)", () => {
  const specs = loadCommandSpecs();
  const yamlSids = [...new Set(specs.map((s) => s.sid))];

  it("loads the command specs", () => {
    expect(specs.length).toBeGreaterThan(0);
  });

  it("every command's sid has a registered handler", () => {
    expect(yamlSids.filter((sid) => !(sid in SID_HANDLERS))).toEqual([]);
  });

  it("every registered handler is referenced by a command (no dead handlers)", () => {
    expect(
      Object.keys(SID_HANDLERS).filter((k) => !yamlSids.includes(k)),
    ).toEqual([]);
  });
});
