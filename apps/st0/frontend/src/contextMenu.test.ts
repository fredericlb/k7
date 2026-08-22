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
    command: "track pan",
    help: "set a track's pan on its mixer strip, -1 left … +1 right",
    // The catalogue's own sentence, in both languages — what the status line says when there is
    // one. `help` is the CLI's fuller line and stays the fallback.
    readable: { en: "Pan a track", fr: "Panoramiquer une piste" },
    args: [a("track", "track", "tracks"), a("-1..1", "number")],
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
    command: "selection consolidate",
    help: "write one new clip over a range (e.g. selection consolidate drums 2:1 6:1)",
    args: [
      a("tracks", "track", "tracks"),
      a("from", "timecode"),
      a("to", "timecode"),
    ],
  },
  {
    command: "node bypass",
    help: "bypass a module so it passes sound through untouched (bare: toggles)",
    args: [a("node", "module", "nodes"), a("state", "choice")],
  },
  {
    command: "graph unlink",
    help: "take a node out of its chain, rejoining what fed it to what it fed (e.g. graph unlink lead)",
    args: [a("node", "module", "nodes")],
  },
  {
    // Takes the module FIRST — the node clicked on — then the ONE thing the menu cannot know:
    // what to point it at. Derived here like everything else, stopping at a trailing space.
    command: "node replace",
    help: "replace what a node is, keeping its name and its place (e.g. node replace echo @engine/audio/filter/auto-wah)",
    args: [
      a("node", "module", "nodes"),
      a("extends-ref", "module", "baseModules"),
    ],
  },
  {
    command: "node param",
    help: "set a module's plugin param",
    args: [
      a("node", "module", "nodes"),
      a("param", "text"),
      a("value", "number"),
    ],
  },
  {
    // The SAME argument shape as `node param` — a module, then free text. Only the argument's
    // name separates them, which is why the param slot pins one.
    command: "module clone",
    help: "clone a module folder (e.g. module clone instruments/bass bass2)",
    args: [a("category/name", "module", "modules"), a("newName", "text")],
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
    command: "project marker new",
    help: "drop a named marker at a timecode",
    args: [a("timecode", "timecode"), a("name", "text")],
  },
  {
    command: "project marker delete",
    help: "remove a marker by name (e.g. project marker delete Chorus)",
    args: [a("name", "marker", "markerNames")],
  },
  {
    command: "clip warp remove",
    help: "drop one stretch point (e.g. clip warp remove break 1.94)",
    args: [a("clip", "file", "clipTargets"), a("sec", "number")],
  },
];

const lines = (items: { command: string }[]) => items.map((i) => i.command);
const labels = (items: { label: string }[]) => items.map((i) => i.label);
const says = (items: { label: string; description: string }[], label: string) =>
  items.find((i) => i.label === label)?.description;

/**
 * A PAD's two effects.
 *
 * Written out rather than derived, for the reason a take's verbs are: `<sequence> <note> <start>`
 * is the shape of EVERY `sequence note` verb, so asking the catalogue for "commands taking these
 * three" would offer to remove the note and set its velocity — the things the pad is already under
 * your hand for. These rows are a menu somebody chose.
 */
describe("a pad", () => {
  const pad = (has: { repeat?: number; skip?: number } = {}) =>
    contextMenu(
      { kind: "pad", sequence: "beat", note: 36, start: 2, ...has },
      CATALOGUE,
    );

  it("offers both values of both effects, fully filled in", () => {
    expect(lines(pad())).toEqual([
      "sequence note repeat beat 36 2 2",
      "sequence note repeat beat 36 2 4",
      "sequence note skip beat 36 2 2",
      "sequence note skip beat 36 2 4",
    ]);
    // Named by the VALUE, since two rows share a verb — "repeat" twice would be a menu you
    // cannot choose from.
    expect(labels(pad())).toEqual([
      "repeat ×2",
      "repeat ×4",
      "skip 1/2",
      "skip 1/4",
    ]);
  });

  // Every row RUNS: the click already knows the sequence, the note, the beat and the value, so
  // there is nothing left for the command bar to collect.
  it("leaves nothing for the bar to ask", () => {
    expect(pad().every((i) => i.complete)).toBe(true);
  });

  /**
   * The value it is already ON is not offered, and an `off` row appears instead.
   *
   * A row that sets a pad to what it already is would do nothing, and a menu with no way back off
   * would make an effect a one-way decision.
   */
  it("drops the value already set, and offers the way off", () => {
    const menu = lines(pad({ repeat: 4 }));
    expect(menu).not.toContain("sequence note repeat beat 36 2 4");
    expect(menu).toContain("sequence note repeat beat 36 2 2");
    expect(menu).toContain("sequence note repeat beat 36 2 off");
    // …and the OTHER effect is untouched by that: both are still on offer.
    expect(menu).toContain("sequence note skip beat 36 2 2");
    expect(menu).not.toContain("sequence note skip beat 36 2 off");
  });

  it("offers no way off an effect that is not on", () => {
    expect(lines(pad())).not.toContain("sequence note repeat beat 36 2 off");
  });
});

describe("a track", () => {
  const menu = contextMenu({ kind: "track", id: "gtr" }, CATALOGUE);

  it("offers EVERY command a track can answer, not a chosen few", () => {
    // The point of deriving it: `track pan` was never in the hand-written menu, and nobody has
    // to remember to add the next one either.
    expect(lines(menu)).toEqual([
      "track mute gtr",
      "track gain gtr ",
      "track pan gtr ",
      "event remove gtr ",
      "event move gtr ",
      "selection consolidate gtr ",
      "ui file gtr",
    ]);
  });

  it("leaves a trailing space exactly when a value is still owed", () => {
    // That space is where the caret lands, and it is also what tells the bar to complete the
    // next ARGUMENT rather than the command name.
    expect(lines(menu)).toContain("track mute gtr"); // nothing left to say
    expect(lines(menu)).toContain("track gain gtr "); // a dB is
  });

  it("names each command, and drops the word that names what was clicked", () => {
    // You aimed at the track: repeating "track" down six rows puts a column of the word you
    // already know between the eye and the only word that differs.
    expect(labels(menu)).toEqual([
      "mute",
      "gain",
      "pan",
      // …and a head naming something ELSE stays: the two `event` rows are about one placement on
      // the lane, `selection consolidate` about a rectangle of them, and `ui file` about the
      // file behind the track. That is exactly what each head is saying.
      "event remove",
      "event move",
      "selection consolidate",
      "ui file",
    ]);
  });

  it("says what each command DOES in its description, for the status line", () => {
    expect(says(menu, "mute")).toBe("toggle a track's (or group's) mute");
  });

  it("drops the (e.g. …) tail, which the pre-written line already answers", () => {
    expect(says(menu, "gain")).toBe(
      "set a track's gain in dB on its mixer strip",
    );
  });

  it("prefers the catalogue's sentence, in the language being read", () => {
    // `readable` is written for a person reading a list; `help` is the CLI's line and carries
    // caveats. The NAME stays the CLI's in both languages — only the sentence is translated.
    expect(says(menu, "pan")).toBe("Pan a track");
    const fr = contextMenu({ kind: "track", id: "gtr" }, CATALOGUE, {}, "fr");
    expect(says(fr, "pan")).toBe("Panoramiquer une piste");
    expect(labels(fr)).toEqual(labels(menu));
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

  it("drops the same head a track's menu does — it is a track's two verbs", () => {
    expect(
      labels(contextMenu({ kind: "group", id: "drums" }, CATALOGUE)),
    ).toEqual(["mute", "solo"]);
  });
});

describe("a take", () => {
  const TAKES: CommandInfo[] = [
    ...CATALOGUE,
    {
      command: "track take select",
      help: "move a take onto the track (e.g. track take select gtr 2) — what was playing becomes that take",
      args: [a("track", "track", "tracks"), a("n", "number")],
    },
    {
      command: "track take delete",
      help: "delete this take, and the events it held (e.g. track take delete gtr 2)",
      args: [a("track", "track", "tracks"), a("n", "number")],
    },
  ];

  it("offers its two verbs, both already filled in", () => {
    const items = contextMenu({ kind: "take", track: "gtr", n: 2 }, TAKES);
    expect(lines(items)).toEqual([
      "track take select gtr 2",
      "track take delete gtr 2",
    ]);
    // A click that answered every argument leaves nothing for the bar to collect: both run.
    expect(items.every((i) => i.complete)).toBe(true);
    // The take is a row UNDER a track, so "track" is the word you already know.
    expect(labels(items)).toEqual(["take select", "take delete"]);
  });

  it("is NOT derived — `<track> <number>` is also a gain", () => {
    // The reason this one is written out by hand: `track gain` and `track pan` have exactly that
    // shape, so asking the catalogue would offer to set a take's level.
    expect(
      lines(contextMenu({ kind: "take", track: "gtr", n: 1 }, TAKES)),
    ).not.toContain("track gain gtr 1");
  });
});

describe("a module node", () => {
  it("offers what takes a module, and not what takes a CATEGORY", () => {
    // Both are class `module` on the wire — the colour they are drawn in. Matching on that
    // instead of the provider would offer `module new` on every module in the graph.
    const l = lines(contextMenu({ kind: "module", id: "lead" }, CATALOGUE));
    expect(l).toEqual([
      "node bypass lead ",
      "graph unlink lead",
      "node replace lead ",
      "node param lead ",
      "module clone lead ",
      "ui file lead",
    ]);
  });

  it("drops `node`, and only `node` — what you clicked is the USE", () => {
    // `module clone` and `module cc` act on the module BEHIND the node, and follow it into every
    // project that loads it. That is a different subject, and its head is what says so.
    expect(
      labels(contextMenu({ kind: "module", id: "lead" }, CATALOGUE)),
    ).toEqual([
      "bypass",
      "graph unlink",
      "replace",
      "param",
      "module clone",
      "ui file",
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
    // A name nothing answers to: no file to open, no param to set. These touch graph.yaml
    // alone, which the catalogue cannot say — it describes arguments, not what a handler writes.
    // `node replace` is NOT among them any more: it repoints an `extends:`, and a dangling
    // name has no file to repoint — offering it would offer a certain failure.
    expect(
      lines(
        contextMenu({ kind: "module", id: "gone", missing: true }, CATALOGUE),
      ),
    ).toEqual(["node bypass gone ", "graph unlink gone"]);
  });
});

describe("a clip", () => {
  it("offers the event family once it knows WHICH placement", () => {
    const l = lines(
      contextMenu(
        { kind: "clip", id: "riff", track: "gtr", tc: "2:1:1" },
        CATALOGUE,
      ),
    );
    expect(l).toEqual([
      "ui file riff",
      "event remove gtr 2:1:1",
      "event move gtr 2:1:1 ",
      "selection consolidate gtr 2:1:1 ",
    ]);
  });

  it("drops `event`, which is what you right-clicked", () => {
    // The rows read "remove", "move". `ui file` keeps its head: it is about the material's
    // file, not about this placement — and `selection consolidate` keeps its own, which is what
    // says that row reaches past the one event you clicked.
    const l = labels(
      contextMenu(
        { kind: "clip", id: "riff", track: "gtr", tc: "2:1:1" },
        CATALOGUE,
      ),
    );
    expect(l).toEqual(["ui file", "remove", "move", "selection consolidate"]);
  });

  it("says nothing about a placement it was not told the address of", () => {
    expect(lines(contextMenu({ kind: "clip", id: "riff" }, CATALOGUE))).toEqual(
      ["ui file riff"],
    );
  });

  it("fills a RANGE verb from the rectangle the click landed in", () => {
    // The bug this pins, reported from the app: right-click inside a selection, pick consolidate,
    // and the bar asked for `to`. The placement says where it STARTS and nothing more, so a verb
    // taking a span arrived one argument short — while the rectangle was holding the answer, and
    // the palette was already reading it (commandFill).
    const l = lines(
      contextMenu(
        {
          kind: "clip",
          id: "riff",
          track: "gtr",
          tc: "2:1:1",
          sel: { tracks: "gtr", from: "2:1:1", to: "6:1:1" },
        },
        CATALOGUE,
      ),
    );
    expect(l).toContain("selection consolidate gtr 2:1:1 6:1:1");
    // …and ONCE. The placement-shaped derivation matches its leading arguments too, so without
    // the filter it appeared twice — the second half-filled, which is the one that asks.
    expect(l.filter((x) => x.startsWith("selection consolidate"))).toHaveLength(
      1,
    );
  });

  it("still asks for the range when no rectangle is drawn", () => {
    // The other half of the rule: a caret on an event says nothing about how far to reach, so the
    // verb arrives short and the bar collects the rest. Its trailing space is that question.
    const l = lines(
      contextMenu(
        { kind: "clip", id: "riff", track: "gtr", tc: "2:1:1" },
        CATALOGUE,
      ),
    );
    expect(l).toContain("selection consolidate gtr 2:1:1 ");
  });

  it("never offers the `clip …` family — an event is a placement, not the material", () => {
    // The material may sit on other lanes too: `clip process riff` here read as "process this
    // event" while acting on every placement of the file. Those verbs stay the bar's.
    const l = lines(
      contextMenu(
        { kind: "clip", id: "riff", track: "gtr", tc: "2:1:1" },
        CATALOGUE,
      ),
    ).join(" ");
    expect(l).not.toContain("clip process");
  });
});

describe("a param", () => {
  const menu = contextMenu(
    { kind: "param", id: "amp", param: "Filter Freq", label: "Filter Freq" },
    CATALOGUE,
  );

  it("quotes a name with spaces, so it survives as one argument", () => {
    expect(lines(menu)).toContain('node param amp "Filter Freq" ');
  });

  it("offers only what takes a module AND a free-text param", () => {
    // `node bypass` takes a CHOICE second, not free text — so it is not this param.
    const l = lines(menu).join(" ");
    expect(l).not.toContain("bypass");
  });

  it("is not fooled by a command of the same SHAPE", () => {
    // `module clone <module> <newName>` fills a (module, text) pair exactly as `node param`
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

  it("keeps every head — none of them names the control you clicked", () => {
    // `node param`, `module cc`, `ui midi learn`: three heads, three different subjects, and a
    // param is none of them. There is no word here that repeating would be noise.
    expect(labels(menu)).toEqual(["ui midi learn", "node param"]);
  });

  it("names the unbind apart from the bind, which is the same verb", () => {
    // `none` is a literal the entry writes, not a value you are being asked for — so it belongs
    // in the name, rather than being asked for.
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
    expect(labels(bound)).toContain("module cc none");
    expect(says(bound, "module cc none")).toBe(
      "remove the MIDI binding on this param",
    );
  });
});

describe("the ruler and its markers", () => {
  it("derives `project marker new` from a bare timecode", () => {
    expect(
      lines(contextMenu({ kind: "marker-add", tc: "5:1" }, CATALOGUE)),
    ).toEqual(["project marker new 5:1 "]);
  });

  it("derives `project marker delete` from a marker's name", () => {
    expect(
      lines(contextMenu({ kind: "marker", name: "Chorus" }, CATALOGUE)),
    ).toEqual(["project marker delete Chorus"]);
  });

  it("drops `project` from both — the ruler is the project's", () => {
    expect(
      labels(contextMenu({ kind: "marker-add", tc: "5:1" }, CATALOGUE)),
    ).toEqual(["marker new"]);
    expect(
      labels(contextMenu({ kind: "marker", name: "Chorus" }, CATALOGUE)),
    ).toEqual(["marker delete"]);
  });

  it("obeys what the person turned off, like every other menu", () => {
    // This case used to go straight to `build`, around the one filter every entry passes
    // through, so a verb taken off the right-click came back on this menu alone.
    expect(
      contextMenu({ kind: "marker", name: "Chorus" }, CATALOGUE, {
        "project marker delete": { menu: false },
      }),
    ).toEqual([]);
  });
});

/**
 * A STRETCH POINT in the clip editor's warp view.
 *
 * Placing one and moving it are GESTURES — a double-click and a drag — so the menu carries the
 * one act a hand cannot express: dropping the point it is already on.
 */
describe("a warp point", () => {
  const ctx = { kind: "warp-point", clip: "break", src: "1.9400" } as const;

  it("names the point by the FILE second it pins, complete", () => {
    const items = contextMenu(ctx, CATALOGUE);
    expect(lines(items)).toEqual(["clip warp remove break 1.9400"]);
    // Nothing left for the bar to collect: the pointer was ON the point, so both arguments
    // are already known and the row RUNS rather than pre-writing.
    expect(items[0].complete).toBe(true);
  });

  it("drops `clip` from the name — the row is about the point, not the material", () => {
    expect(labels(contextMenu(ctx, CATALOGUE))).toEqual(["warp remove"]);
  });

  it("offers no way to PLACE one: that is the double-click, not a row", () => {
    // A menu entry for it would ask for a beat in the command bar, which is the gesture's own
    // job and worse at it — you are pointing at the beat already.
    //
    // Asserted on the LINES rather than with `not.toContain(expect.stringContaining(…))`, which
    // is how this was first written and passes on anything: `toContain` compares by reference,
    // so an asymmetric matcher inside it never matches and the negation is always true.
    const got = lines(contextMenu(ctx, CATALOGUE));
    expect(got.filter((l) => l.startsWith("clip warp"))).toEqual([
      "clip warp remove break 1.9400",
    ]);
  });

  it("obeys what the person turned off, like every other menu", () => {
    expect(
      contextMenu(ctx, CATALOGUE, { "clip warp remove": { menu: false } }),
    ).toEqual([]);
  });
});

// The list is DERIVED: the command written tomorrow lands on a menu without anyone looking at
// it. Two rows reading alike is worse than a head repeated ten times, so the shortening is all
// or nothing — one clash and every row keeps its full name.
describe("two rows that would read alike", () => {
  it("keeps every head rather than draw one name twice", () => {
    const CLASH: CommandInfo[] = [
      ...CATALOGUE,
      // A verb that IS its own head. Shortening `track mute` would spell it the same way.
      {
        command: "mute",
        help: "mute a track",
        args: [a("t", "track", "tracks")],
      },
    ];
    const l = labels(contextMenu({ kind: "track", id: "gtr" }, CLASH));
    expect(l).toContain("track mute");
    expect(l).toContain("mute");
    expect(new Set(l).size).toBe(l.length);
  });
});

describe("the menu's contract", () => {
  it("carries a name, a sentence, a line, the verb behind it, and whether the line is finished — nothing else", () => {
    // No handlers, no ids to dispatch on: every entry is text the bar could have been typed into,
    // which is what stops the menu growing a vocabulary of its own.
    //
    // `verb` is the fourth and is still text: the command WITHOUT the entity, untranslated. It is
    // what `commandPrefs` is keyed by, so it is what lets the renderer draw the icon and the name
    // this person chose — and keeping it here rather than re-deriving it from `command` means the
    // menu never has to un-localize a line to find out which command it is.
    for (const ctx of [
      { kind: "track", id: "gtr" },
      { kind: "module", id: "lead" },
      { kind: "clip", id: "riff", track: "gtr", tc: "1:1:1" },
      { kind: "marker", name: "Chorus" },
    ] as const)
      for (const item of contextMenu(ctx, CATALOGUE)) {
        expect(typeof item.command).toBe("string");
        expect(item.command.length).toBeGreaterThan(0);
        expect(item.label.length).toBeGreaterThan(0);
        // The sentence is always THERE, even when it is empty: the status line reads it on every
        // hover, and a row that carried none would leave the previous row's still standing.
        expect(typeof item.description).toBe("string");
        expect(typeof item.verb).toBe("string");
        expect(item.command.startsWith(item.verb)).toBe(true);
        expect(Object.keys(item).sort()).toEqual([
          "command",
          "complete",
          "description",
          "label",
          "verb",
        ]);
      }
  });

  it("says which lines are finished, so the host knows what to RUN", () => {
    // The host runs a finished line and opens the bar on an unfinished one. `complete` is stated
    // rather than sniffed off the trailing space, which is only a caret position.
    const menu = contextMenu({ kind: "track", id: "gtr" }, CATALOGUE);
    const by = (line: string) =>
      menu.find((i) => i.command.trimEnd() === line)?.complete;
    expect(by("track mute gtr")).toBe(true); // nothing left to ask
    expect(by("track gain gtr")).toBe(false); // a dB is
    expect(by("event move gtr")).toBe(false);
  });

  it("never calls a line finished while it still ends in a space", () => {
    // The two must agree: one of them decides what runs, and the other is what the caret sees.
    for (const item of contextMenu({ kind: "track", id: "gtr" }, CATALOGUE))
      expect(item.complete).toBe(!item.command.endsWith(" "));
  });

  it("names a command the catalogue has never heard of", () => {
    // The shell's own commands are not in the catalogue; each carries its own sentence, and the
    // name is the line's own, so a row can never come out blank.
    const l = contextMenu({ kind: "track", id: "gtr" }, []);
    expect(l).toEqual([
      {
        label: "ui file",
        description: "open the track's own file, tracks/<id>.yaml",
        command: "ui file gtr",
        complete: true,
        // The verb without the entity — `ui file`, not `ui file gtr`. Two entries for the same
        // verb on two different tracks are one command, and wear one icon.
        verb: "ui file",
      },
    ]);
  });

  it("opens no menu on the sink", () => {
    expect(contextMenu({ kind: "sink", id: "OUT" }, CATALOGUE)).toEqual([]);
  });
});

// A person may take a verb OFF the right-click (commandPrefs.ts's `menu`). The menu is derived,
// so this can only ever remove: there is no arrangement of prefs that puts a command on a menu
// its arguments do not fit.
describe("what the person has turned off", () => {
  it("drops a verb marked `menu: false`, and leaves the rest alone", () => {
    const all = lines(contextMenu({ kind: "module", id: "lead" }, CATALOGUE));
    expect(all).toContain("graph unlink lead");
    const some = lines(
      contextMenu({ kind: "module", id: "lead" }, CATALOGUE, {
        "graph unlink": { menu: false },
      }),
    );
    expect(some).not.toContain("graph unlink lead");
    expect(some).toEqual(all.filter((l) => l !== "graph unlink lead"));
  });

  it("reaches the entries the CATALOGUE does not hold either", () => {
    // `ui file` is written by hand in contextMenu.ts, not derived — the filter sits at the one
    // place every entry passes through precisely so those obey too.
    const off = lines(
      contextMenu({ kind: "module", id: "lead" }, CATALOGUE, {
        "ui file": { menu: false },
      }),
    );
    expect(off).not.toContain("ui file lead");
  });

  it("treats an absent entry, and an explicit true, as ON", () => {
    const on = lines(
      contextMenu({ kind: "module", id: "lead" }, CATALOGUE, {}),
    );
    const yes = lines(
      contextMenu({ kind: "module", id: "lead" }, CATALOGUE, {
        "graph unlink": { menu: true },
      }),
    );
    expect(yes).toEqual(on);
  });
});
