import { describe, expect, it } from "vitest";
import {
  applyOffer,
  type CaretAim,
  canRun,
  caretAnswers,
  emptyValues,
  enterAction,
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

// What Enter does in the form. The reported bug: with a suggestion highlighted, Enter did
// nothing at all — it took the suggestion, the list kept showing it (an exact match still
// ranks first), and the next Enter took it again, for ever. A command whose LAST field has a
// vocabulary could therefore never be submitted, which is exactly `node replace`'s shape.
describe("enterAction", () => {
  // `node replace <node> <extends-ref>` — both required, the last one completing.
  const REPLACE: PaletteArg[] = [
    arg("module", "module"),
    arg("extends-ref", "module"),
  ];

  it("takes a highlighted suggestion that would change the field", () => {
    expect(enterAction(REPLACE, ["lead", ""], 1, "audio/cab")).toEqual({
      kind: "take",
      value: "audio/cab",
    });
  });

  it("RUNS once the field already holds it — the bug", () => {
    // Same suggestion still highlighted, now equal to the answer. Taking it again would be a
    // no-op, and it is what ate every Enter.
    expect(enterAction(REPLACE, ["lead", "audio/cab"], 1, "audio/cab")).toEqual(
      {
        kind: "run",
      },
    );
  });

  it("runs when the field lists no vocabulary at all", () => {
    expect(enterAction(REPLACE, ["lead", "audio/cab"], 1, undefined)).toEqual({
      kind: "run",
    });
  });

  it("goes to the question that is actually missing, rather than sulking", () => {
    expect(enterAction(REPLACE, ["", "audio/cab"], 1, "audio/cab")).toEqual({
      kind: "goto",
      index: 0,
    });
  });

  it("still takes a DIFFERENT suggestion over running", () => {
    // Completion is the validation: arrowing to another entry and pressing Enter answers the
    // field, it does not dispatch the line that was runnable a moment ago.
    expect(enterAction(REPLACE, ["lead", "audio/cab"], 1, "audio/ir")).toEqual({
      kind: "take",
      value: "audio/ir",
    });
  });
});

/**
 * What the CARET answers, and what it deliberately does not.
 *
 * `event split` asked for a track, an event and a cut — three things you had just parked on and
 * had to type back. These pin that it now answers all three, and that the answering is opt-in:
 * a caret is always somewhere, so a rule that filled anything called `track` would quietly
 * pre-answer every destructive verb in the catalogue.
 */
describe("caretAnswers", () => {
  // `event split <track> <timecode> <at>`, as commands.yaml declares it: the event is addressed
  // by its START, and the cut is the third argument.
  const SPLIT: PaletteArg[] = [
    arg("track", "track"),
    arg("timecode", "timecode"),
    arg("at", "timecode"),
  ];
  const on = (over: Partial<CaretAim> = {}): CaretAim => ({
    track: "drums",
    at: "3:1:1",
    eventStart: "2:1:1",
    ...over,
  });

  it("answers every field of a split, so nothing is asked back", () => {
    const answers = caretAnswers("event split", on());
    expect(answers).toEqual({ track: "drums", timecode: "2:1:1", at: "3:1:1" });
    // …and that is a runnable line, which is what lets the bar dispatch without opening a form.
    const filled = applyOffer(SPLIT, answers, emptyValues(SPLIT), 0);
    expect(filled?.values).toEqual(["drums", "2:1:1", "3:1:1"]);
    expect(canRun(SPLIT, filled!.values)).toBe(true);
  });

  it("distinguishes WHERE the caret is from WHERE the event starts", () => {
    // The two are different timecodes and land in different fields. Feeding the caret's own
    // position as the event's address would split whatever starts under the cut, or nothing.
    const answers = caretAnswers("event split", on());
    expect(answers.timecode).not.toBe(answers.at);
    expect(answers.timecode).toBe("2:1:1");
  });

  it("leaves the field it cannot answer empty, rather than guessing", () => {
    // Parked on bare lane: the track and the cut are known, the event is not. The form must open
    // on that hole — inventing an event start here would cut a clip nobody pointed at.
    const answers = caretAnswers("event split", on({ eventStart: null }));
    expect(answers).toEqual({ track: "drums", at: "3:1:1" });
    const filled = applyOffer(SPLIT, answers, emptyValues(SPLIT), 0);
    expect(canRun(SPLIT, filled!.values)).toBe(false);
    expect(firstMissing(SPLIT, filled!.values)).toBe(1);
  });

  it("says nothing on a row's label, where there is no moment", () => {
    // The caret parked on a track name is on a ROW, not at a time. `tc` is null there and the
    // whole point of carrying null rather than beat -1 is that it cannot become a timecode.
    expect(
      caretAnswers("event split", on({ at: null, eventStart: null })),
    ).toEqual({
      track: "drums",
    });
  });

  it("answers NOTHING for a command that did not ask", () => {
    // The opt-in. `event remove` takes a track and a timecode by the same names, and a caret that
    // filled them would put a destructive line one Enter away from a cursor that merely moved.
    expect(caretAnswers("event remove", on())).toEqual({});
    expect(caretAnswers("track delete", on())).toEqual({});
  });

  it("answers nothing when there is no caret at all", () => {
    // A project with no arrangement surface draws no timeline, so there is no caret to read.
    expect(caretAnswers("event split", null)).toEqual({});
  });
});
