import { describe, expect, it } from "vitest";
import {
  isRollMode,
  laneDraws,
  noteIsEditable,
  ROLL_MODES,
  ROLL_PRESS,
  rollCondition,
} from "./rollMode";

describe("the roll's vocabulary", () => {
  it("recognises its own names and nothing else", () => {
    for (const m of ROLL_MODES) expect(isRollMode(m)).toBe(true);
    expect(isRollMode("draw")).toBe(false);
    expect(isRollMode("")).toBe(false);
  });

  it("opens on SELECT, which is the one that writes nothing by itself", () => {
    expect(ROLL_MODES[0]).toBe("select");
  });

  it("names one condition per mode, and no two the same", () => {
    expect(rollCondition("create")).toBe("roll_create");
    const names = ROLL_MODES.map(rollCondition);
    expect(new Set(names).size).toBe(names.length);
  });

  it("says what a press does in every one of them", () => {
    for (const m of ROLL_MODES) expect(ROLL_PRESS[m]()).toBeTruthy();
    expect(new Set(ROLL_MODES.map((m) => ROLL_PRESS[m]())).size).toBe(
      ROLL_MODES.length,
    );
  });
});

describe("what a press lands on", () => {
  it("lets a note be moved, stretched and set only in SELECT", () => {
    expect(noteIsEditable("select")).toBe(true);
    expect(noteIsEditable("create")).toBe(false);
    expect(noteIsEditable("remove")).toBe(false);
  });

  it("draws on a bare lane only in CREATE", () => {
    expect(laneDraws("create")).toBe(true);
    expect(laneDraws("select")).toBe(false);
    expect(laneDraws("remove")).toBe(false);
  });

  /** The two are never both true: one press cannot both lay a note down and pick one up. */
  it("never lets one mode both draw and edit", () => {
    for (const m of ROLL_MODES)
      expect(noteIsEditable(m) && laneDraws(m)).toBe(false);
  });
});
