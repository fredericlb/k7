import { describe, expect, it } from "vitest";
import { applyOffer, requiredCount, runsAfter, wantsKind } from "./commandFill";
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
    // `track new audio` with no name: the handler picks audio-N, which is the documented behaviour.
    expect(requiredCount([arg("name", "text", true)])).toBe(0);
  });

  it("only drops a TRAILING run — an optional param before a required one still counts", () => {
    // Skipping it would shift the next value into its place, so the command would receive an
    // answer for a param nobody gave. Required is the index after the last mandatory one.
    expect(requiredCount([arg("a"), arg("b", "text", true), arg("c")])).toBe(3);
  });

  it("survives an empty param list", () => {
    expect(requiredCount([])).toBe(0);
  });
});

describe("applyOffer", () => {
  it("fills the fields before the last one it knows and puts that one in the input", () => {
    // The drag knows three of the four: the line reads `event move gtr 1:1:1` and the input
    // carries the timecode that moves under the pointer.
    expect(
      applyOffer(
        MOVE,
        { track: "gtr", timecode: "1:1:1", newTimecode: "5:1:1" },
        [],
      ),
    ).toEqual({ args: ["gtr", "1:1:1"], value: "5:1:1" });
  });

  it("puts a trailing optional in the input when the gesture knows it", () => {
    // Dropped on ANOTHER lane: the fourth param is answered too, so it is the one being edited.
    expect(
      applyOffer(
        MOVE,
        {
          track: "gtr",
          timecode: "1:1:1",
          newTimecode: "5:1:1",
          toTrack: "gtr2",
        },
        [],
      ),
    ).toEqual({ args: ["gtr", "1:1:1", "5:1:1"], value: "gtr2" });
  });

  it("never rewrites an answer already given — it fills FORWARD from the open field", () => {
    // `event move ge.rythm` typed by hand, then the clip dragged: the track you chose stays,
    // and the gesture answers the two timecodes after it. Replacing `ge.rythm` with whatever
    // clip the pointer happened to touch would be the opposite of answering a question.
    expect(
      applyOffer(
        MOVE,
        { track: "other", timecode: "1:1:1", newTimecode: "5:1:1" },
        ["ge.rythm"],
      ),
    ).toEqual({ args: ["ge.rythm", "1:1:1"], value: "5:1:1" });
  });

  it("returns null when everything it knows is already answered", () => {
    // Nothing left to say: the fields it could fill are behind the open one.
    expect(
      applyOffer(MOVE, { track: "gtr" }, ["ge.rythm", "1:1:1"]),
    ).toBeNull();
  });

  it("returns null when the offer names nothing this command asks for", () => {
    // A gesture and a command with nothing to say to each other — the common case, not an error.
    expect(applyOffer(MOVE, { module: "reverb" }, [])).toBeNull();
  });

  it("is empty-safe on a command with no params", () => {
    expect(applyOffer([], { track: "gtr" }, [])).toBeNull();
  });
});

describe("wantsKind", () => {
  it("matches the class the OPEN field declares", () => {
    // `event move ge.rythm` → the field open is `timecode`, so a ruler click belongs in it.
    expect(wantsKind(MOVE, 1, "timecode")).toBe(true);
  });

  it("refuses a value the open field did not ask for", () => {
    // Field 0 is a track: a timecode landing there would be a stray click writing nonsense.
    expect(wantsKind(MOVE, 0, "timecode")).toBe(false);
  });

  it("refuses once every field is answered", () => {
    expect(wantsKind(MOVE, 4, "timecode")).toBe(false);
  });
});

// Typed by hand as far as the timecode, then answered by pointing — the second half of the
// gesture story: the ruler knows a timecode and nothing about which command wanted one.
describe("a ruler click answering the open field", () => {
  it("lands in the timecode `event move ge.rythm` is waiting for", () => {
    const filled = ["ge.rythm"];
    expect(wantsKind(MOVE, filled.length, "timecode")).toBe(true);
    // …and answering it leaves one required param, so this is not yet the last Enter.
    expect(runsAfter(MOVE, filled.length + 1, false)).toBe(false);
  });

  it("completes the line when it answers the LAST required field", () => {
    const filled = ["ge.rythm", "1:1:1"];
    expect(wantsKind(MOVE, filled.length, "timecode")).toBe(true);
    expect(runsAfter(MOVE, filled.length + 1, false)).toBe(true);
  });
});

describe("runsAfter", () => {
  it("dispatches once the required params are in, without waiting for the optional one", () => {
    expect(runsAfter(MOVE, 3, false)).toBe(true);
  });

  it("holds the line open for Tab, so the optional param stays reachable", () => {
    expect(runsAfter(MOVE, 3, false)).toBe(true);
    expect(runsAfter(MOVE, 3, true)).toBe(false);
  });

  it("dispatches on the very last param even under Tab — there is nothing left to step to", () => {
    expect(runsAfter(MOVE, 4, true)).toBe(true);
  });

  it("does not dispatch while a required param is missing", () => {
    expect(runsAfter(MOVE, 2, false)).toBe(false);
  });
});

// The gesture the whole thing was built for, traced end to end: trigger `event move`, drag a
// clip within its lane, press Enter. The claim under test is ONE keystroke, not two.
describe("a clip drag answering the bar", () => {
  const drag = (toTc: string) =>
    applyOffer(
      MOVE,
      { track: "gtr", timecode: "1:1:1", newTimecode: toTc },
      [],
    );

  it("shows the moving timecode in the field while the pointer is down", () => {
    // Three frames of a drag: the line in front stays still, one field rewrites.
    for (const tc of ["2:1:1", "4:1:1", "5:1:1"])
      expect(drag(tc)).toEqual({ args: ["gtr", "1:1:1"], value: tc });
  });

  it("runs on a single Enter when the drag ends", () => {
    const fed = drag("5:1:1")!;
    // Enter validates the field being shown…
    const filled = [...fed.args, fed.value];
    expect(filled).toEqual(["gtr", "1:1:1", "5:1:1"]);
    // …and that completes the line, because `toTrack` is optional and was not offered.
    expect(runsAfter(MOVE, filled.length, false)).toBe(true);
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
      [],
    )!;
    const filled = [...fed.args, fed.value];
    expect(filled).toEqual(["gtr", "1:1:1", "5:1:1", "gtr2"]);
    expect(runsAfter(MOVE, filled.length, false)).toBe(true);
  });
});
