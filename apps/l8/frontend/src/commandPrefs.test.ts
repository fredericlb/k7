import { describe, expect, it } from "vitest";
import {
  type CommandPrefs,
  commandHeads,
  entitiesOf,
  entityGroup,
  entityOf,
  isPluralCommand,
  labelOf,
  moveCommand,
  orderCommands,
  setCommandPref,
} from "./commandPrefs";

// What a person has made of the command catalogue. The catalogue is the app's and the same for
// everyone; this is the layer over it, and the reason it is pure is that the settings page and
// every menu have to apply it identically — a menu that ordered commands its own way would make
// the page a lie.

const CMDS = [
  { canonical: "clip trim", readable: "Trim a clip" },
  { canonical: "clip process", readable: "Bounce a clip through a chain" },
  { canonical: "track mute", readable: "Mute a track" },
  { canonical: "ui help", readable: "Help" },
];

describe("the entity a command acts on", () => {
  it("is the first word of its line", () => {
    // Carried by the line already, so a command added to the catalogue is filterable the day it
    // exists — nothing new to author, nothing that can drift.
    expect(entityOf("clip onset move")).toBe("clip");
    expect(entityOf("track mute")).toBe("track");
  });

  it("is the whole line when the command is one word", () => {
    expect(entityOf("undo")).toBe("undo");
  });

  it("lists what a catalogue actually contains, sorted, without repeats", () => {
    expect(entitiesOf(CMDS)).toEqual(["clip", "track", "ui"]);
  });
});

// A PLURAL verb — `events move`, which moves every event in a range — is the same subject taken
// several at a time, not another subject. A group of its own held one command, said nothing the
// singular's group did not, and hid it from the only filter anyone would look under.
describe("a plural verb", () => {
  const WITH_PLURAL = [
    ...CMDS,
    { canonical: "event add", readable: "Put a clip on a track" },
    { canonical: "events move", readable: "Move every event in a range" },
  ];
  const heads = commandHeads(WITH_PLURAL);

  it("lists under its SINGULAR", () => {
    expect(entityGroup("events move", heads)).toBe("event");
    expect(entitiesOf(WITH_PLURAL)).toEqual(["clip", "event", "track", "ui"]);
  });

  it("says it is the plural one, so a row can be marked", () => {
    expect(isPluralCommand("events move", heads)).toBe(true);
    expect(isPluralCommand("event add", heads)).toBe(false);
  });

  it("keeps its own group when nothing SINGULAR answers to it", () => {
    // Derived, not tabulated — but a fold is only a fold when there is something to fold into.
    // A plural whose singular nobody wrote would otherwise invent a subject out of a suffix.
    const alone = commandHeads([{ canonical: "chains organize" }]);
    expect(entityGroup("chains organize", alone)).toBe("chains");
    expect(isPluralCommand("chains organize", alone)).toBe(false);
  });

  it("does not fold a word that merely ENDS in s", () => {
    const h = commandHeads([{ canonical: "process all" }]);
    expect(entityGroup("process all", h)).toBe("process");
  });
});

describe("what a command is called", () => {
  it("prefers the person's own name", () => {
    expect(labelOf(CMDS[0], { "clip trim": { label: "Rogner" } })).toBe(
      "Rogner",
    );
  });

  it("falls back to the catalogue, then to the line itself", () => {
    expect(labelOf(CMDS[0], {})).toBe("Trim a clip");
    expect(labelOf({ canonical: "x y" }, {})).toBe("x y");
  });

  it("treats a blank override as no override, not as a blank name", () => {
    // A menu row with no text is worse than one with the catalogue's own words.
    expect(labelOf(CMDS[0], { "clip trim": { label: "   " } })).toBe(
      "Trim a clip",
    );
  });
});

describe("the order", () => {
  it("puts the placed ones first, and leaves the rest as the catalogue had them", () => {
    // The rule that matters: you can pull three commands to the top without numbering the other
    // two hundred, and a command added to the app later does not land inside somebody's list.
    const prefs: CommandPrefs = { "ui help": { order: 0 } };
    expect(orderCommands(CMDS, prefs).map((c) => c.canonical)).toEqual([
      "ui help",
      "clip trim",
      "clip process",
      "track mute",
    ]);
  });

  it("is stable when two commands claim the same place", () => {
    const prefs: CommandPrefs = {
      "track mute": { order: 1 },
      "clip trim": { order: 1 },
    };
    expect(orderCommands(CMDS, prefs).map((c) => c.canonical)).toEqual([
      "clip trim", // catalogue order breaks the tie
      "track mute",
      "clip process",
      "ui help",
    ]);
  });

  it("changes nothing when nobody has arranged anything", () => {
    expect(orderCommands(CMDS, {}).map((c) => c.canonical)).toEqual(
      CMDS.map((c) => c.canonical),
    );
  });
});

describe("moving one", () => {
  it("swaps it with its neighbour and numbers the whole list", () => {
    const next = moveCommand(CMDS, {}, "track mute", -1);
    expect(orderCommands(CMDS, next).map((c) => c.canonical)).toEqual([
      "clip trim",
      "track mute",
      "clip process",
      "ui help",
    ]);
  });

  it("does nothing at either end", () => {
    expect(moveCommand(CMDS, {}, "clip trim", -1)).toEqual({});
    expect(moveCommand(CMDS, {}, "ui help", 1)).toEqual({});
  });

  it("does nothing for a command that is not in the list", () => {
    expect(moveCommand(CMDS, {}, "nope nope", 1)).toEqual({});
  });
});

describe("setting a field", () => {
  it("merges rather than replaces", () => {
    const a = setCommandPref({}, "clip trim", { label: "Rogner" });
    const b = setCommandPref(a, "clip trim", { icon: "Scissors" });
    expect(b["clip trim"]).toEqual({ label: "Rogner", icon: "Scissors" });
  });

  it("drops the entry when the last override is taken back", () => {
    // An override undone must leave the document as it was, not grow a row of empty objects that
    // every later read has to step over.
    const a = setCommandPref({}, "clip trim", { label: "Rogner" });
    expect(setCommandPref(a, "clip trim", { label: "" })).toEqual({});
  });

  it("leaves the other commands alone", () => {
    const a = setCommandPref({ "ui help": { order: 3 } }, "clip trim", {
      icon: "Scissors",
    });
    expect(a["ui help"]).toEqual({ order: 3 });
  });
});
