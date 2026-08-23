import { describe, expect, it } from "vitest";
import { loadCommandSpecs } from "./commandSpec";
import { SID_HANDLERS } from "./commands";

// commands.yaml names a `sid` and SID_HANDLERS holds it: a drift fails here, not at runtime.
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
