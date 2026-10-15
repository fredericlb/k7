import { describe, expect, it } from "vitest";
import {
  type CommandPrefs,
  commandHeads,
  entitiesOf,
  entityGroup,
  entityOf,
  inMenu,
  isPluralCommand,
  labelIn,
  labelOf,
  moveCommand,
  orderCommands,
  setCommandLabel,
  setCommandPref,
  setMenuEntities,
} from "./commandPrefs";
import { MENU_ENTITIES } from "./types";

// What a person has made of the command catalogue: pure, because the settings page and every menu have to apply it identically.

const CMDS = [
  { canonical: "clip trim", readable: "Trim a clip" },
  { canonical: "clip process", readable: "Bounce a clip through a chain" },
  { canonical: "track mute", readable: "Mute a track" },
  { canonical: "ui help", readable: "Help" },
];

describe("the entity a command acts on", () => {
  it("is the first word of its line", () => {
    // Carried by the line already, so a command added to the catalogue is filterable the day it exists.
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

// A PLURAL verb is the same subject taken several at a time: a group of its own held one command and hid it from the only filter.
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
  it("prefers the person's own name, in the language being read", () => {
    const prefs = { "clip trim": { label: { en: "Trim", fr: "Rogner" } } };
    expect(labelOf(CMDS[0], prefs, "fr")).toBe("Rogner");
    expect(labelOf(CMDS[0], prefs, "en")).toBe("Trim");
  });

  it("falls back to the catalogue, then to the line itself", () => {
    expect(labelOf(CMDS[0], {}, "fr")).toBe("Trim a clip");
    expect(labelOf({ canonical: "x y" }, {}, "fr")).toBe("x y");
  });

  it("does NOT borrow another language's name", () => {
    // The whole point of a field per language: a command named only in French shows the catalogue's own sentence in English.
    const frOnly = { "clip trim": { label: { fr: "Rogner" } } };
    expect(labelOf(CMDS[0], frOnly, "fr")).toBe("Rogner");
    expect(labelOf(CMDS[0], frOnly, "en")).toBe("Trim a clip");
  });

  it("treats a blank override as no override, not as a blank name", () => {
    // A menu row with no text is worse than one with the catalogue's own words.
    expect(
      labelOf(CMDS[0], { "clip trim": { label: { fr: "   " } } }, "fr"),
    ).toBe("Trim a clip");
  });

  it("still reads a name saved BEFORE there was a field per language", () => {
    // A bare string was one name with no language attached, so it stands for every locale, and nothing rewrites it on load.
    const legacy = { "clip trim": { label: "Rogner" } };
    expect(labelOf(CMDS[0], legacy, "fr")).toBe("Rogner");
    expect(labelOf(CMDS[0], legacy, "en")).toBe("Rogner");
  });
});

/** The space bar did not work in the settings page's name fields, and this is where it broke: `labelIn` trimmed a CONTROLLED input's value. */
describe("the text a field is handed back", () => {
  it("is what was typed, space and all", () => {
    const p = setCommandLabel({}, "clip trim", "fr", "Rogner ", ["en", "fr"]);
    expect(labelIn(p["clip trim"].label, "fr")).toBe("Rogner ");
  });

  it("is empty for a language nobody named, and for no override at all", () => {
    expect(labelIn({ fr: "Rogner" }, "en")).toBe("");
    expect(labelIn(undefined, "fr")).toBe("");
  });

  it("does not put the half-typed space in a MENU — that is displayed, not edited", () => {
    expect(
      labelOf(CMDS[0], { "clip trim": { label: { fr: "Rogner " } } }, "fr"),
    ).toBe("Rogner");
  });
});

describe("naming a command in one language", () => {
  const LOCALES = ["en", "fr"];

  it("leaves the other languages alone", () => {
    const one = setCommandLabel({}, "clip trim", "fr", "Rogner", LOCALES);
    expect(one["clip trim"].label).toEqual({ fr: "Rogner" });
    const both = setCommandLabel(one, "clip trim", "en", "Trim", LOCALES);
    expect(both["clip trim"].label).toEqual({ fr: "Rogner", en: "Trim" });
  });

  it("EXPANDS a legacy name across the languages before editing one", () => {
    // The migration, and the reason `locales` is a parameter: without it, renaming in French drops the name English was showing.
    const legacy: CommandPrefs = { "clip trim": { label: "Rogner" } };
    const next = setCommandLabel(
      legacy,
      "clip trim",
      "fr",
      "Rogner un clip",
      LOCALES,
    );
    expect(next["clip trim"].label).toEqual({
      en: "Rogner", // kept: it is what English was showing
      fr: "Rogner un clip",
    });
  });

  it("keeps the command's other overrides", () => {
    const withIcon: CommandPrefs = { "clip trim": { icon: "Scissors" } };
    const next = setCommandLabel(
      withIcon,
      "clip trim",
      "fr",
      "Rogner",
      LOCALES,
    );
    expect(next["clip trim"]).toEqual({
      icon: "Scissors",
      label: { fr: "Rogner" },
    });
  });

  it("emptying the last field takes the override back entirely", () => {
    // An override given up must leave the document as it was — no `label: {}` behind, and no entry once nothing else is overridden.
    const one = setCommandLabel({}, "clip trim", "fr", "Rogner", LOCALES);
    expect(setCommandLabel(one, "clip trim", "fr", "", LOCALES)).toEqual({});
  });

  it("emptying ONE field leaves the other naming the command", () => {
    let p = setCommandLabel({}, "clip trim", "fr", "Rogner", LOCALES);
    p = setCommandLabel(p, "clip trim", "en", "Trim", LOCALES);
    p = setCommandLabel(p, "clip trim", "en", "  ", LOCALES);
    expect(p["clip trim"].label).toEqual({ fr: "Rogner" });
  });
});

describe("the order", () => {
  it("puts the placed ones first, and leaves the rest as the catalogue had them", () => {
    // The rule that matters: three commands pulled to the top without numbering the other two hundred.
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
    // An override undone must leave the document as it was, not grow a row of empty objects every later read steps over.
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

// WHERE a right-click offers a command: the catalogue says it, and a person may say otherwise.
describe("which right-clicks offer a command", () => {
  const ALL = MENU_ENTITIES;

  it("is the catalogue's word when nobody has touched it", () => {
    expect(inMenu("event remove", {}, "track", ["event"])).toBe(false);
    expect(inMenu("event remove", {}, "event", ["event"])).toBe(true);
  });

  it("is every menu when the catalogue narrows nothing", () => {
    // The derivation, which is the rule: a command written today lands on the menus its arguments fit.
    expect(inMenu("track mute", {}, "track")).toBe(true);
    expect(inMenu("track mute", {}, "note")).toBe(true);
  });

  it("lets a person put one back where the catalogue took it away", () => {
    const prefs: CommandPrefs = { "event remove": { menu: ["track"] } };
    expect(inMenu("event remove", prefs, "track", ["event"])).toBe(true);
    expect(inMenu("event remove", prefs, "event", ["event"])).toBe(false);
  });

  it("still reads the plain off switch a person saved before there were entities", () => {
    expect(
      inMenu("track mute", { "track mute": { menu: false } }, "track"),
    ).toBe(false);
  });

  it("says the SHORTEST thing that means it", () => {
    // Nothing to say ⇒ no entry at all, which is the rule the label, the icon and the key all follow.
    expect(
      setMenuEntities({}, "event remove", ["event"], ["event"], ALL),
    ).toEqual({});
    expect(setMenuEntities({}, "track mute", undefined, ALL, ALL)).toEqual({});
    // …and the two ends: nowhere, and everywhere against a catalogue that narrows.
    expect(setMenuEntities({}, "event remove", ["event"], [], ALL)).toEqual({
      "event remove": { menu: false },
    });
    expect(setMenuEntities({}, "event remove", ["event"], ALL, ALL)).toEqual({
      "event remove": { menu: true },
    });
  });

  it("keeps the command's other overrides", () => {
    const a = setCommandPref({}, "event remove", { icon: "Scissors" });
    expect(
      setMenuEntities(a, "event remove", ["event"], ["track"], ALL)[
        "event remove"
      ],
    ).toEqual({ icon: "Scissors", menu: ["track"] });
  });
});
