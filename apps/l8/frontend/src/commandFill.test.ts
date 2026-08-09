import { describe, expect, it } from "vitest";
import {
  applyOffer,
  canRun,
  emptyValues,
  firstMissing,
  lineArgs,
  nextField,
  requiredCount,
  wantsKind,
} from "./commandFill";
import type { PaletteArg } from "./components/CommandBar";

const arg = (
  name: string,
  kind: PaletteArg["kind"] = "text",
  optional?: boolean,
): PaletteArg => ({
  name,
  kind,
  hint: "",
  ...(optional ? { optional: true } : {}),
});

// `event move` as commands.yaml declares it — the command the whole gesture-feeds-the-bar path
// was built around. The KINDS are real, because that is what a kind-matched offer tests against.
const MOVE: PaletteArg[] = [
  arg("track", "track"),
  arg("timecode", "timecode"),
  arg("newTimecode", "timecode"),
  arg("toTrack", "track", true),
];

describe("requiredCount", () => {
  it("stops at the last non-optional param", () => {
    expect(requiredCount(MOVE)).toBe(3);
  });

  it("counts every param when none is optional", () => {
    expect(requiredCount([arg("a"), arg("b")])).toBe(2);
  });

  it("is zero when they are ALL optional — the line runs bare", () => {
    expect(
      requiredCount([arg("a", "text", true), arg("b", "text", true)]),
    ).toBe(0);
  });

  it("only drops a TRAILING run — an optional param before a required one still counts", () => {
    expect(requiredCount([arg("a"), arg("b", "text", true), arg("c")])).toBe(3);
  });

  it("survives an empty param list", () => {
    expect(requiredCount([])).toBe(0);
  });
});

describe("canRun", () => {
  it("waits for every required answer", () => {
    expect(canRun(MOVE, ["gtr", "", "", ""])).toBe(false);
    expect(canRun(MOVE, ["gtr", "1:1:1", "", ""])).toBe(false);
  });

  it("runs with the trailing optional left blank — blank IS the answer there", () => {
    expect(canRun(MOVE, ["gtr", "1:1:1", "5:1:1", ""])).toBe(true);
  });

  it("treats whitespace as unanswered", () => {
    expect(canRun(MOVE, ["gtr", "1:1:1", "   ", ""])).toBe(false);
  });

  it("runs a command with no params at all", () => {
    expect(canRun([], [])).toBe(true);
  });
});

describe("lineArgs", () => {
  it("drops the trailing blanks so an unanswered optional is not passed as empty", () => {
    expect(lineArgs(["gtr", "1:1:1", "5:1:1", ""])).toEqual([
      "gtr",
      "1:1:1",
      "5:1:1",
    ]);
  });

  it("KEEPS a blank in the middle, which would otherwise shift the params after it", () => {
    // `canRun` is what stops this line being dispatched; spelling it right is this one's job.
    expect(lineArgs(["gtr", "", "5:1:1"])).toEqual(["gtr", "", "5:1:1"]);
  });
});

describe("moving between fields", () => {
  it("stops at the last one, so Tab cannot walk off the form", () => {
    expect(nextField(MOVE, 0)).toBe(1);
    expect(nextField(MOVE, 3)).toBe(3);
  });

  it("names the first question still unanswered", () => {
    expect(firstMissing(MOVE, emptyValues(MOVE))).toBe(0);
    expect(firstMissing(MOVE, ["gtr", "", "", ""])).toBe(1);
    // The optional one is never "missing" — the form would never look finished.
    expect(firstMissing(MOVE, ["gtr", "1:1:1", "5:1:1", ""])).toBe(-1);
  });
});

describe("applyOffer", () => {
  it("fills every field the gesture knows, and the keys follow the last of them", () => {
    expect(
      applyOffer(
        MOVE,
        { track: "gtr", timecode: "1:1:1", newTimecode: "5:1:1" },
        emptyValues(MOVE),
        0,
      ),
    ).toEqual({ values: ["gtr", "1:1:1", "5:1:1", ""], active: 2 });
  });

  it("puts the keys on a trailing optional when the gesture knows it", () => {
    expect(
      applyOffer(
        MOVE,
        {
          track: "gtr",
          timecode: "1:1:1",
          newTimecode: "5:1:1",
          toTrack: "gtr2",
        },
        emptyValues(MOVE),
        0,
      ),
    ).toEqual({ values: ["gtr", "1:1:1", "5:1:1", "gtr2"], active: 3 });
  });

  it("never rewrites an answer BEHIND the keys — it fills forward", () => {
    // The track was chosen by hand and the keyboard has moved past it; the drag touched
    // another lane, and must not silently replace what was chosen.
    expect(
      applyOffer(
        MOVE,
        { track: "other", timecode: "1:1:1", newTimecode: "5:1:1" },
        ["gtr", "", "", ""],
        1,
      ),
    ).toEqual({ values: ["gtr", "1:1:1", "5:1:1", ""], active: 2 });
  });

  it("returns null when everything it knows is behind the keys", () => {
    expect(applyOffer(MOVE, { track: "gtr" }, ["gtr", "", "", ""], 1)).toBe(
      null,
    );
  });

  it("returns null when the offer names nothing this command asks for", () => {
    expect(applyOffer(MOVE, { module: "reverb" }, emptyValues(MOVE), 0)).toBe(
      null,
    );
  });

  it("is empty-safe on a command with no params", () => {
    expect(applyOffer([], { track: "gtr" }, [], 0)).toBe(null);
  });
});

describe("wantsKind", () => {
  it("matches the class the field with the keys declares", () => {
    expect(wantsKind(MOVE, 1, "timecode")).toBe(true);
    expect(wantsKind(MOVE, 0, "track")).toBe(true);
  });

  it("refuses a value that field did not ask for", () => {
    expect(wantsKind(MOVE, 0, "timecode")).toBe(false);
  });

  it("refuses a field that does not exist", () => {
    expect(wantsKind(MOVE, 9, "track")).toBe(false);
  });
});

// The gesture the whole thing was built for, traced end to end: trigger `event move`, drag a
// clip within its lane, press Enter. The claim under test is ONE keystroke, not two.
describe("a clip drag answering the form", () => {
  const drag = (toTc: string) =>
    applyOffer(
      MOVE,
      { track: "gtr", timecode: "1:1:1", newTimecode: toTc },
      emptyValues(MOVE),
      0,
    );

  it("rewrites one field per frame while the pointer is down", () => {
    for (const tc of ["2:1:1", "4:1:1", "5:1:1"])
      expect(drag(tc)).toEqual({
        values: ["gtr", "1:1:1", tc, ""],
        active: 2,
      });
  });

  it("runs on a single Enter when the drag ends", () => {
    const fed = drag("5:1:1")!;
    // Every required field is answered, so Enter is "that is my line" and not "next question".
    expect(canRun(MOVE, fed.values)).toBe(true);
    expect(lineArgs(fed.values)).toEqual(["gtr", "1:1:1", "5:1:1"]);
  });

  it("also runs on a single Enter after a drop on ANOTHER lane", () => {
    const fed = applyOffer(
      MOVE,
      {
        track: "gtr",
        timecode: "1:1:1",
        newTimecode: "5:1:1",
        toTrack: "gtr2",
      },
      emptyValues(MOVE),
      0,
    )!;
    expect(canRun(MOVE, fed.values)).toBe(true);
    expect(lineArgs(fed.values)).toEqual(["gtr", "1:1:1", "5:1:1", "gtr2"]);
  });

  it("still runs when a ruler click answers the field the keys are on", () => {
    // The other inlet: a click that knows a timecode and not a command.
    const values = ["gtr", "1:1:1", "", ""];
    expect(wantsKind(MOVE, 2, "timecode")).toBe(true);
    values[2] = "5:1:1";
    expect(canRun(MOVE, values)).toBe(true);
  });
});
