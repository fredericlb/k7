// `<owner>_<what>_<n>` — the one rule three places mint a name by (docs/names.md).

import { describe, expect, it } from "vitest";
import { instanceName, namePart, renamedInstance } from "./instanceName";

const free = () => false;

describe("namePart", () => {
  it("keeps what the module vocabulary accepts", () => {
    expect(namePart("tape-delay")).toBe("tape-delay");
    expect(namePart("bs_lead")).toBe("bs_lead");
  });

  it("folds everything else into underscores — a lane is called vo.jo", () => {
    expect(namePart("vo.jo")).toBe("vo_jo");
    expect(namePart("da.main")).toBe("da_main");
    expect(namePart("a b")).toBe("a_b");
  });

  it("does not leave an underscore at either end", () => {
    expect(namePart(".lead.")).toBe("lead");
    expect(namePart("--x--")).toBe("--x--"); // '-' is legal, so it stays
  });

  it("answers something for a name that survives as nothing", () => {
    // Otherwise `_1` would be the whole name, which is a file called nothing.
    expect(namePart("...")).toBe("x");
    expect(namePart("")).toBe("x");
  });
});

describe("instanceName", () => {
  it("names a use after the lane it is for", () => {
    expect(instanceName("reverb", "vo.jo", free)).toBe("vo_jo_reverb_1");
  });

  it("drops the prefix when nothing owns it yet", () => {
    // A node on the bare canvas, or a module no chain plays — moduleFork's own answer.
    expect(instanceName("4osc", null, free)).toBe("4osc_1");
    expect(instanceName("4osc", undefined, free)).toBe("4osc_1");
    expect(instanceName("4osc", "", free)).toBe("4osc_1");
  });

  it("writes the counter on the FIRST one too", () => {
    // `vo_reverb` beside `vo_reverb_2` would read as two KINDS of thing (docs/names.md).
    expect(instanceName("reverb", "vo", free)).toBe("vo_reverb_1");
  });

  it("takes the first FREE number, not the next one after the count", () => {
    const taken = new Set(["vo_reverb_1", "vo_reverb_3"]);
    expect(instanceName("reverb", "vo", (n) => taken.has(n))).toBe(
      "vo_reverb_2",
    );
  });

  it("keeps counting past a run of taken names", () => {
    const taken = new Set(["eq_1", "eq_2", "eq_3"]);
    expect(instanceName("eq", null, (n) => taken.has(n))).toBe("eq_4");
  });

  it("cleans both halves, not just the lane", () => {
    expect(instanceName("tape delay", "bs.lead", free)).toBe(
      "bs_lead_tape_delay_1",
    );
  });
});

// --- following the module a node now extends: only a name this convention made is ours to move ---

describe("renamedInstance", () => {
  it("follows the module, keeping the lane", () => {
    expect(
      renamedInstance("vo_jo_reverb_1", "reverb", "delay", "vo.jo", free),
    ).toBe("vo_jo_delay_1");
  });

  it("keeps the SHAPE it had — a node born with no lane stays without one", () => {
    // Growing a prefix it never had would be a second change nobody asked for (docs/names.md).
    expect(renamedInstance("reverb_1", "reverb", "delay", "vo.jo", free)).toBe(
      "delay_1",
    );
  });

  it("leaves a name somebody chose completely alone", () => {
    // The whole point of the null: renaming `wash` would rewrite every chain to undo a decision.
    expect(
      renamedInstance("wash", "reverb", "delay", "vo.jo", free),
    ).toBeNull();
    expect(
      renamedInstance("reverb", "reverb", "delay", "vo.jo", free),
    ).toBeNull();
    // No counter, so not one of ours; and the counter is DIGITS.
    expect(
      renamedInstance("vo_jo_reverb", "reverb", "delay", "vo.jo", free),
    ).toBeNull();
    expect(
      renamedInstance("reverb_two", "reverb", "delay", null, free),
    ).toBeNull();
  });

  it("refuses a name built from a DIFFERENT module, however conventional it looks", () => {
    // `vo_jo_amp_1` is one of ours, but not one made from `reverb`.
    expect(
      renamedInstance("vo_jo_amp_1", "reverb", "delay", "vo.jo", free),
    ).toBeNull();
  });

  it("does nothing when the module's NAME did not change", () => {
    // A different module and the same word; without this the counter walks up and says nothing.
    expect(
      renamedInstance("vo_jo_reverb_1", "reverb", "reverb", "vo.jo", free),
    ).toBeNull();
  });

  it("takes the first free counter for the new stem, not the old one's number", () => {
    const taken = new Set(["vo_jo_delay_1"]);
    expect(
      renamedInstance("vo_jo_reverb_7", "reverb", "delay", "vo.jo", (n) =>
        taken.has(n),
      ),
    ).toBe("vo_jo_delay_2");
  });

  it("cleans the lane the same way the name was made", () => {
    expect(renamedInstance("da_main_eq_3", "eq", "comp", "da.main", free)).toBe(
      "da_main_comp_1",
    );
  });
});
