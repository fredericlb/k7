// What a right-click offers, and the two rules the whole menu rests on: the list is DERIVED
// from the catalogue — everything a clicked thing's type can answer, nothing chosen by hand —
// and an entry PRE-WRITES a command line, it never runs one.

import { describe, expect, it } from "vitest";
import { contextMenu } from "./contextMenu";
import type { ArgClass, ArgProvider, CommandArg, CommandInfo } from "./types";

const a = (
  name: string,
  kind: ArgClass,
  provider?: ArgProvider,
  optional?: boolean,
): CommandArg => ({ name, kind, provider, hint: "", optional });

// A slice of the real commands.yaml, kept to the shapes that decide something here: a track
// first, a track then a timecode, a module, a category (which is NOT this module), a base-module
// ref, a clip, a timecode, a marker.
const CATALOGUE: CommandInfo[] = [
  {
    command: "track mute",
    help: "toggle a track's (or group's) mute",
    args: [a("track", "track", "tracks")],
  },
  {
    command: "track gain",
    help: "set a track's gain in dB on its mixer strip (e.g. track gain melody -6)",
    args: [a("track", "track", "tracks"), a("dB", "number")],
  },
  {
    command: "track low",
    help: "set a track's low band on its mixer strip, in dB",
    args: [a("track", "track", "tracks"), a("dB", "number")],
  },
  {
    command: "event remove",
    help: "remove a clip/sequence placement from a track (e.g. event remove drums 2:1:1)",
    args: [a("track", "track", "tracks"), a("timecode", "timecode")],
  },
  {
    command: "event move",
    help: "move a clip/sequence to a new timecode, optionally onto another track",
    args: [
      a("track", "track", "tracks"),
      a("timecode", "timecode"),
      a("newTimecode", "timecode"),
      a("toTrack", "track", "tracks", true),
    ],
  },
  {
    command: "module bypass",
    help: "bypass a module so it passes sound through untouched (bare: toggles)",
    args: [a("module", "module", "modules"), a("state", "choice")],
  },
  {
    command: "module instance unlink",
    help: "take an instance out of its chain, rejoining what fed it to what it fed (e.g. module instance unlink lead)",
    args: [a("instance", "module", "modules")],
  },
  {
    // Takes a module FIRST, then two things it does not know yet — so it is derived here like
    // everything else, and stops at a trailing space.
    command: "module replace",
    help: "replace a module in place, keeping its position in every chain (e.g. module replace echo audio/wah @engine/audio/filter/auto-wah)",
    args: [
      a("module", "module", "modules"),
      a("category/name", "module", "categories"),
      a("extends-ref", "module", "baseModules"),
    ],
  },
  {
    command: "module param",
    help: "set a module's plugin param",
    args: [
      a("module", "module", "modules"),
      a("param", "text"),
      a("value", "number"),
    ],
  },
  {
    // The SAME argument shape as `module param` — a module, then free text. Only the argument's
    // name separates them, which is why the param slot pins one.
    command: "module clone",
    help: "clone a module folder (e.g. module clone instruments/bass bass2)",
    args: [a("category/name", "module", "modules"), a("newName", "text")],
  },
  {
    command: "module nam",
    help: "load a Neural Amp Modeler model the module carries",
    args: [a("module", "module", "modules"), a("file", "file", "assetFiles")],
  },
  {
    command: "module new",
    help: "create a module",
    args: [a("category/name", "module", "categories")],
  },
  {
    command: "module own",
    help: "give an engine module a folder of its own",
    args: [a("ref", "module", "baseModules")],
  },
  {
    command: "clip process",
    help: "bounce one clip's file through a chain and keep the result",
    args: [a("clip", "file", "clipTargets"), a("chain", "choice", "chains")],
  },
  {
    command: "marker new",
    help: "drop a named marker at a timecode",
    args: [a("timecode", "timecode"), a("name", "text")],
  },
  {
    command: "marker delete",
    help: "remove a marker by name (e.g. marker delete Chorus)",
    args: [a("name", "marker", "markerNames")],
  },
];

const lines = (items: { command: string }[]) => items.map((i) => i.command);
const labels = (items: { label: string }[]) => items.map((i) => i.label);

describe("a track", () => {
  const menu = contextMenu({ kind: "track", id: "gtr" }, CATALOGUE);

  it("offers EVERY command a track can answer, not a chosen few", () => {
    // The point of deriving it: `track low` was never in the hand-written menu, and nobody has
    // to remember to add the next one either.
    expect(lines(menu)).toEqual([
      "track mute gtr",
      "track gain gtr ",
      "track low gtr ",
      "event remove gtr ",
      "event move gtr ",
      "ui file gtr",
    ]);
  });

  it("leaves a trailing space exactly when a value is still owed", () => {
    // That space is where the caret lands, and it is also what tells the bar to complete the
    // next ARGUMENT rather than the command name.
    expect(lines(menu)).toContain("track mute gtr"); // nothing left to say
    expect(lines(menu)).toContain("track gain gtr "); // a dB is
  });

  it("says what each command DOES", () => {
    expect(labels(menu)[0]).toBe("toggle a track's (or group's) mute");
  });

  it("drops the (e.g. …) tail, which the pre-written line already answers", () => {
    expect(labels(menu)).toContain(
      "set a track's gain in dB on its mixer strip",
    );
  });

  it("offers nothing a track cannot answer", () => {
    const l = lines(menu).join(" ");
    expect(l).not.toContain("module");
    expect(l).not.toContain("marker");
    expect(l).not.toContain("clip process");
  });
});

describe("a group", () => {
  it("is NOT the track list — it answers only two of them", () => {
    // A group is not a value the `tracks` provider lists, so deriving would hand it a freeze, a
    // gain and the `event` family, none of which reach it.
    expect(
      lines(contextMenu({ kind: "group", id: "drums" }, CATALOGUE)),
    ).toEqual(["track mute drums", "track solo drums"]);
  });
});

describe("a module node", () => {
  it("offers what takes a module, and not what takes a CATEGORY", () => {
    // Both are class `module` on the wire — the colour they are drawn in. Matching on that
    // instead of the provider would offer `module new` on every module in the graph.
    const l = lines(contextMenu({ kind: "module", id: "lead" }, CATALOGUE));
    expect(l).toEqual([
      "module bypass lead ",
      "module instance unlink lead",
      "module replace lead ",
      "module param lead ",
      "module clone lead ",
      "module nam lead ",
      "ui file lead",
    ]);
  });

  it("offers `module own` for an engine module, instead of a file it has not got", () => {
    // Derived too: an `@engine/…` id IS a base-module ref, which is what the command takes.
    const l = lines(
      contextMenu(
        { kind: "module", id: "@engine/audio/verb", ambient: true },
        CATALOGUE,
      ),
    );
    expect(l).toContain("module own @engine/audio/verb");
    expect(l.join(" ")).not.toContain("ui file");
  });

  it("shrinks to the verbs that survive a DANGLING node", () => {
    // A name nothing answers to: no file to open, no param to set. These touch chains.yaml
    // alone, which the catalogue cannot say — it describes arguments, not what a handler writes.
    // `module replace` is the repair that KEEPS the node: it needs no file behind the old name,
    // and leaves everything that fed it wired to the one it swaps in.
    expect(
      lines(
        contextMenu({ kind: "module", id: "gone", missing: true }, CATALOGUE),
      ),
    ).toEqual([
      "module bypass gone ",
      "module instance unlink gone",
      "module replace gone ", // trailing space: the module to swap in is still owed
    ]);
  });
});

describe("a clip", () => {
  it("offers the event family once it knows WHICH placement", () => {
    const l = lines(
      contextMenu(
        { kind: "clip", id: "riff", midi: false, track: "gtr", tc: "2:1:1" },
        CATALOGUE,
      ),
    );
    expect(l).toEqual([
      "ui file riff",
      "event remove gtr 2:1:1",
      "event move gtr 2:1:1 ",
      "clip process riff ",
    ]);
  });

  it("says nothing about a placement it was not told the address of", () => {
    expect(
      lines(contextMenu({ kind: "clip", id: "riff", midi: false }, CATALOGUE)),
    ).toEqual(["ui file riff", "clip process riff "]);
  });

  it("never offers `clip process` on a MIDI clip", () => {
    // `clipTargets` lists no MIDI and the handler refuses one by name: never offer what the
    // command would reject.
    expect(
      lines(contextMenu({ kind: "clip", id: "lead", midi: true }, CATALOGUE)),
    ).toEqual(["ui file lead"]);
  });
});

describe("a param", () => {
  const menu = contextMenu(
    { kind: "param", id: "amp", param: "Filter Freq", label: "Filter Freq" },
    CATALOGUE,
  );

  it("quotes a name with spaces, so it survives as one argument", () => {
    expect(lines(menu)).toContain('module param amp "Filter Freq" ');
  });

  it("offers only what takes a module AND a free-text param", () => {
    // `module bypass` takes a choice second and `module nam` a file: neither is this param.
    const l = lines(menu).join(" ");
    expect(l).not.toContain("bypass");
    expect(l).not.toContain("nam");
  });

  it("is not fooled by a command of the same SHAPE", () => {
    // `module clone <module> <newName>` fills a (module, text) pair exactly as `module param`
    // does. Offering it here would pre-write a right-clicked knob's name as a folder name — the
    // one case in this file where matching on types alone was not enough.
    expect(lines(menu).join(" ")).not.toContain("module clone");
  });

  it("offers the unbind only when there is a binding to remove", () => {
    expect(lines(menu).join(" ")).not.toContain("none");
    const bound = contextMenu(
      {
        kind: "param",
        id: "amp",
        param: "Cutoff",
        label: "Cutoff",
        cc: { ch: 1, cc: 74 },
      },
      CATALOGUE,
    );
    expect(lines(bound)).toContain("module cc amp Cutoff none");
  });
});

describe("the ruler and its markers", () => {
  it("derives `marker new` from a bare timecode", () => {
    expect(
      lines(contextMenu({ kind: "marker-add", tc: "5:1" }, CATALOGUE)),
    ).toEqual(["marker new 5:1 "]);
  });

  it("derives `marker delete` from a marker's name", () => {
    expect(
      lines(contextMenu({ kind: "marker", name: "Chorus" }, CATALOGUE)),
    ).toEqual(["marker delete Chorus"]);
  });
});

describe("the menu's contract", () => {
  it("carries a label and a line, and nothing else", () => {
    // No handlers, no ids to dispatch on: every entry is text the bar could have been typed into,
    // which is what stops the menu growing a vocabulary of its own.
    for (const ctx of [
      { kind: "track", id: "gtr" },
      { kind: "module", id: "lead" },
      { kind: "clip", id: "riff", midi: false, track: "gtr", tc: "1:1:1" },
      { kind: "marker", name: "Chorus" },
    ] as const)
      for (const item of contextMenu(ctx, CATALOGUE)) {
        expect(typeof item.command).toBe("string");
        expect(item.command.length).toBeGreaterThan(0);
        expect(item.label.length).toBeGreaterThan(0);
        expect(Object.keys(item).sort()).toEqual(["command", "label"]);
      }
  });

  it("falls back to the command's name when the catalogue has no line for it", () => {
    // The shell's own commands are not in the catalogue; each carries its own description, and a
    // row must never come out blank if one is ever forgotten.
    const l = contextMenu({ kind: "track", id: "gtr" }, []);
    expect(l).toEqual([
      {
        label: "open the track's own file, tracks/<id>.yaml",
        command: "ui file gtr",
      },
    ]);
  });

  it("opens no menu on the sink", () => {
    expect(contextMenu({ kind: "sink", id: "OUT" }, CATALOGUE)).toEqual([]);
  });
});
