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

// A slice of the real commands.yaml, kept to the shapes that decide something here.
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
    // The catalogue's own sentence, in both languages — `help` is the CLI's fuller line and stays the fallback.
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
    // Takes the module FIRST — the node clicked on — then the ONE thing the menu cannot know: what to point it at.
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
    command: "node external-ui",
    help: "open the plugin's own UI window for one instance",
    args: [a("module", "module", "nodes")],
  },
  {
    // The SAME argument shape as `node param`: only the argument's name separates them, which is why the param slot pins one.
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
    args: [a("ref", "module", "engineModules")],
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
  {
    command: "sequence note remove",
    help: "remove one note from a sequence",
    args: [a("sequence", "file"), a("note", "note"), a("start", "number")],
  },
  {
    command: "sequence note split",
    help: "cut one note in two",
    args: [
      a("sequence", "file"),
      a("note", "note"),
      a("start", "number"),
      a("at", "number"),
    ],
  },
  {
    command: "sequence notes remove",
    help: "remove every note in a region",
    args: [
      a("sequence", "file"),
      a("loNote", "note"),
      a("hiNote", "note"),
      a("from", "number"),
      a("to", "number"),
    ],
  },
  {
    command: "sequence notes transpose",
    help: "shift every note in a region by n semitones",
    args: [
      a("sequence", "file"),
      a("loNote", "note"),
      a("hiNote", "note"),
      a("from", "number"),
      a("to", "number"),
      a("semitones", "number"),
    ],
  },
];

const lines = (items: { command: string }[]) => items.map((i) => i.command);
const labels = (items: { label: string }[]) => items.map((i) => i.label);
const says = (items: { label: string; description: string }[], label: string) =>
  items.find((i) => i.label === label)?.description;

/** A PAD's two effects, written out rather than derived: every `sequence note` verb has that shape, so the catalogue would offer the wrong rows. */
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
    // Named by the VALUE, since two rows share a verb — 'repeat' twice would be a menu you cannot choose from.
    expect(labels(pad())).toEqual([
      "repeat ×2",
      "repeat ×4",
      "skip 1/2",
      "skip 1/4",
    ]);
  });

  // Every row RUNS: the click already knows the sequence, the note, the beat and the value.
  it("leaves nothing for the bar to ask", () => {
    expect(pad().every((i) => i.complete)).toBe(true);
  });

  /** The value it is already ON is not offered, and an `off` row appears instead — else an effect would be a one-way decision. */
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

/** A NOTE on the piano roll: its own two, then the RECTANGLE's, when the click landed in one. */
describe("a roll note", () => {
  const note = (over: Record<string, unknown> = {}) =>
    contextMenu(
      {
        kind: "note",
        sequence: "melody",
        note: 60,
        start: 4,
        end: 6,
        ...over,
      } as never,
      CATALOGUE,
    );

  it("offers the removal, already filled in", () => {
    expect(lines(note())).toEqual(["sequence note remove melody 60 4"]);
    expect(note().every((i) => i.complete)).toBe(true);
  });

  it("offers the split only where the caret would leave TWO notes", () => {
    expect(lines(note({ at: 5 }))).toContain(
      "sequence note split melody 60 4 5",
    );
    // On either edge a cut would leave a note of no length, so it is not offered at all.
    expect(lines(note({ at: 4 }))).toHaveLength(1);
    expect(lines(note({ at: 6 }))).toHaveLength(1);
  });

  it("adds the rectangle's verbs when the click landed in one", () => {
    const menu = note({ region: { lo: 60, hi: 72, from: 0, to: 8 } });
    expect(lines(menu)).toContain("sequence notes remove melody 60 72 0 8");
    expect(lines(menu)).toContain("sequence notes transpose melody 60 72 0 8 ");
  });

  /** The box is spelt for them; the VALUE is not, so those rows go to the bar rather than running. */
  it("leaves the value owed to the bar, and only that", () => {
    const menu = note({ region: { lo: 60, hi: 72, from: 0, to: 8 } });
    const by = (c: string) => menu.find((i) => i.command.startsWith(c));
    expect(by("sequence notes remove")?.complete).toBe(true);
    expect(by("sequence notes transpose")?.complete).toBe(false);
  });

  it("offers none of them when there is no rectangle", () => {
    expect(lines(note()).some((l) => l.startsWith("sequence notes"))).toBe(
      false,
    );
  });
});

/** A SHOT on a picture lane — the menu picture.md said could not exist, because there was nothing to derive. */
describe("a picture shot", () => {
  const menu = contextMenu(
    { kind: "picture-shot", lane: "main", at: "12.5", name: "shot_a" },
    [
      {
        command: "picture move",
        help: "move a shot",
        args: [
          a("lane", "file", "pictureLanes"),
          a("at", "text"),
          a("to", "text"),
        ],
      },
      {
        command: "picture delete",
        help: "drop a placement",
        args: [a("lane", "file", "pictureLanes"), a("at", "text")],
      },
    ],
  );

  it("addresses the shot by its LANE and its START, in seconds", () => {
    // Not by ref: one source may be placed twice on a lane, and the position is what tells the two apart.
    expect(lines(menu)).toContain("picture delete main 12.5");
  });

  it("leaves the destination owed, so the row goes to the bar", () => {
    // `move` still needs somewhere to go; the trailing space is what puts the caret on that argument.
    expect(lines(menu)).toContain("picture move main 12.5 ");
  });

  it("drops the head, so the rows read as what they do", () => {
    // Written out rather than derived, as `warp-point` and `pad` are: the four are a gesture set, not everything a lane answers.
    expect(labels(menu)).toEqual([
      "move",
      "head",
      "length",
      "silence",
      "delete",
    ]);
  });
});

/** A picture LANE's gutter: the copy between timelines, and the song lane's two toggles. */
describe("a picture lane", () => {
  const catalogue = [
    {
      command: "timeline lane copy",
      help: "copy a lane",
      args: [a("lane", "track", "tracks"), a("to", "choice", "laneTargets")],
      menu: ["track" as const, "picture" as const],
    },
    {
      command: "picture mute",
      help: "hide a lane",
      args: [a("lane", "file", "pictureLanes")],
    },
    {
      command: "picture solo",
      help: "solo a lane",
      args: [a("lane", "file", "pictureLanes")],
    },
  ];

  it("asks where to copy the song's lane, and toggles it", () => {
    const menu = contextMenu({ kind: "picture-lane", lane: "cam" }, catalogue);
    expect(lines(menu)).toEqual([
      "timeline lane copy cam ",
      "picture mute cam",
      "picture solo cam",
    ]);
  });

  it("offers a timeline's lane the copy alone — its frame and visibility are the song lane's", () => {
    const menu = contextMenu(
      { kind: "picture-lane", lane: "verse>cam" },
      catalogue,
    );
    expect(lines(menu)).toEqual(["timeline lane copy verse>cam "]);
  });
});

describe("a track among several shift-clicked", () => {
  it("offers to GROUP them first, then what the clicked one answers", () => {
    const menu = contextMenu(
      { kind: "track", id: "gtr", picked: ["gtr", "bass"] },
      CATALOGUE,
    );
    expect(lines(menu)[0]).toBe("track group gtr,bass");
    expect(lines(menu)).toContain("track mute gtr");
  });
});

describe("a track", () => {
  const menu = contextMenu({ kind: "track", id: "gtr" }, CATALOGUE);

  it("offers EVERY command a track can answer, not a chosen few", () => {
    // The point of deriving it: `track pan` was never in the hand-written menu, and nobody has to add the next one.
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
    // That space is where the caret lands, and what tells the bar to complete the next ARGUMENT rather than the command name.
    expect(lines(menu)).toContain("track mute gtr"); // nothing left to say
    expect(lines(menu)).toContain("track gain gtr "); // a dB is
  });

  it("names each command, and drops the word that names what was clicked", () => {
    // You aimed at the track: repeating it down six rows puts a column of the word you know before the one that differs.
    expect(labels(menu)).toEqual([
      "mute",
      "gain",
      "pan",
      // …and a head naming something ELSE stays: a rectangle of placements, or the file behind the track, is what its head says.
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
    // `readable` is written for a person reading a list; the NAME stays the CLI's in both languages.
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
    // A group is not a value the `tracks` provider lists, so deriving would hand it verbs that do not reach it.
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

describe("a module node", () => {
  it("offers what takes a module, and not what takes a CATEGORY", () => {
    // Both are class `module` on the wire — matching on that instead of the provider would offer `module new` on every module.
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
    // `module clone` and `module cc` act on the module BEHIND the node — a different subject, and its head is what says so.
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
    // Derived too: an `@engine/…` id IS an engine ref, which is what the command takes.
    const l = lines(
      contextMenu(
        { kind: "module", id: "@engine/audio/verb", ambient: true },
        CATALOGUE,
      ),
    );
    expect(l).toContain("module own @engine/audio/verb");
    expect(l.join(" ")).not.toContain("ui file");
  });

  it("offers Download model FIRST when the node's model can be fetched, and only then", () => {
    // Nothing else on the node can work until the file is here; `model` is set only when a model_url says where it lives.
    const items = contextMenu(
      { kind: "module", id: "split", model: true },
      CATALOGUE,
    );
    expect(items[0]).toMatchObject({
      label: "Download model",
      command: "ui model split",
      complete: true,
    });
    expect(
      lines(contextMenu({ kind: "module", id: "split" }, CATALOGUE)),
    ).not.toContain("ui model split");
  });

  it("offers the plugin's own window on an external plugin (VST, AU…), and nowhere else", () => {
    // `native` is the graph's own corner-button test, so the menu and the button agree.
    expect(
      lines(
        contextMenu({ kind: "module", id: "lead", native: true }, CATALOGUE),
      ),
    ).toContain("node external-ui lead");
    expect(
      lines(contextMenu({ kind: "module", id: "lead" }, CATALOGUE)),
    ).not.toContain("node external-ui lead");
  });

  it("shrinks to the verbs that survive a DANGLING node", () => {
    // A name nothing answers to: these touch graph.k7x alone, and `node replace` is not among them.
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
    // The rows read 'remove', 'move'; `ui file` and `selection consolidate` keep their heads, reaching past this placement.
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
    // The bug this pins: consolidate arrived one argument short while the rectangle was holding the answer.
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
    // …and ONCE: the placement-shaped derivation matches its leading arguments too, so without the filter it appeared twice.
    expect(l.filter((x) => x.startsWith("selection consolidate"))).toHaveLength(
      1,
    );
  });

  it("still asks for the range when no rectangle is drawn", () => {
    // The other half of the rule: a caret on an event says nothing about how far to reach, so the bar collects the rest.
    const l = lines(
      contextMenu(
        { kind: "clip", id: "riff", track: "gtr", tc: "2:1:1" },
        CATALOGUE,
      ),
    );
    expect(l).toContain("selection consolidate gtr 2:1:1 ");
  });

  it("never offers the `clip …` family — an event is a placement, not the material", () => {
    // The material may sit on other lanes too, so `clip process` here would act on every placement of the file.
    const l = lines(
      contextMenu(
        { kind: "clip", id: "riff", track: "gtr", tc: "2:1:1" },
        CATALOGUE,
      ),
    ).join(" ");
    expect(l).not.toContain("clip process");
  });

  it("offers `event process`, which bounces THIS event and leaves the chain to the bar", () => {
    const withProcess: CommandInfo[] = [
      ...CATALOGUE,
      {
        command: "event process",
        help: "bounce one event's file through a chain",
        args: [
          a("track", "track", "tracks"),
          a("timecode", "timecode"),
          a("chain", "choice", "chains"),
        ],
      },
    ];
    const l = lines(
      contextMenu(
        { kind: "clip", id: "riff", track: "gtr", tc: "2:1:1" },
        withProcess,
      ),
    );
    expect(l).toContain("event process gtr 2:1:1 ");
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
    // `module clone <module> <newName>` fills a (module, text) pair exactly as `node param` does — types alone were not enough.
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
    // `node param`, `module cc`, `ui midi learn`, `ui automate`: several heads and subjects, and a param is none of them.
    expect(labels(menu)).toEqual([
      "ui midi learn",
      "ui automate",
      "node param",
    ]);
  });

  it("offers to remove the automation only on a param a curve drives, naming its curve-keeping unbind", () => {
    expect(labels(menu)).not.toContain("remove automation");
    const driven = contextMenu(
      {
        kind: "param",
        id: "amp",
        param: "Filter Freq",
        label: "Filter Freq",
        automated: true,
      },
      CATALOGUE,
    );
    expect(labels(driven)).toContain("remove automation");
    expect(driven.find((i) => i.label === "remove automation")?.command).toBe(
      "node automate amp Filter Freq none",
    );
  });

  it("names the unbind apart from the bind, which is the same verb", () => {
    // `none` is a literal the entry writes, not a value you are being asked for, so it belongs in the name.
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

describe("a curve card", () => {
  it("opens the curve editor on the param it drives, and offers to unbind it", () => {
    const menu = contextMenu(
      { kind: "curve-card", curve: "wob", module: "amp", param: "Filter Freq" },
      CATALOGUE,
    );
    expect(lines(menu)).toEqual([
      'ui automate amp "Filter Freq"',
      "node automate amp Filter Freq none",
    ]);
    expect(labels(menu)).toEqual(["ui automate", "remove automation"]);
  });

  it("opens a FREE card's curve on its own, having no param to automate", () => {
    expect(
      lines(contextMenu({ kind: "curve-card", curve: "wob" }, CATALOGUE)),
    ).toEqual(["ui curve wob"]);
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

  it("offers `transport loop` only when it would do something, named for what it does", () => {
    const set = contextMenu(
      { kind: "marker-add", tc: "5:1", loop: "set" },
      CATALOGUE,
    );
    expect(lines(set)).toEqual(["project marker new 5:1 ", "transport loop"]);
    expect(labels(set)).toEqual(["marker new", "Loop selection"]);
    expect(set[1].complete).toBe(true);
    expect(
      labels(
        contextMenu(
          { kind: "marker-add", tc: "5:1", loop: "clear" },
          CATALOGUE,
        ),
      ),
    ).toEqual(["marker new", "Clear loop"]);
  });

  it("obeys what the person turned off, like every other menu", () => {
    // Every entry passes through the one filter, this case included: nothing goes straight to `build` around it.
    expect(
      contextMenu({ kind: "marker", name: "Chorus" }, CATALOGUE, {
        "project marker delete": { menu: false },
      }),
    ).toEqual([]);
  });
});

/** A STRETCH POINT in the warp view: placing and moving are GESTURES, so the menu carries only dropping the point it is on. */
describe("a warp point", () => {
  const ctx = { kind: "warp-point", clip: "break", src: "1.9400" } as const;

  it("names the point by the FILE second it pins, complete", () => {
    const items = contextMenu(ctx, CATALOGUE);
    expect(lines(items)).toEqual(["clip warp remove break 1.9400"]);
    // Nothing left for the bar to collect: the pointer was ON the point, so the row RUNS rather than pre-writing.
    expect(items[0].complete).toBe(true);
  });

  it("drops `clip` from the name — the row is about the point, not the material", () => {
    expect(labels(contextMenu(ctx, CATALOGUE))).toEqual(["warp remove"]);
  });

  it("offers no way to PLACE one: that is the double-click, not a row", () => {
    // Asserted on the LINES: `toContain` compares by reference, so an asymmetric matcher inside it never matches.
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

/** `menu:` in commands.yaml — the one thing that NARROWS the derivation, naming what the click is ON. */
describe("what the catalogue says a command's menu is", () => {
  const ON_EVENTS = new Set([
    "event remove",
    "event move",
    "selection consolidate",
  ]);
  const SAID: CommandInfo[] = CATALOGUE.map((c) =>
    ON_EVENTS.has(c.command) ? { ...c, menu: ["event" as const] } : c,
  );

  it("keeps an event's verbs off the LANE that carries it", () => {
    // A track answers their first argument, which is the whole reason they were being offered there.
    expect(lines(contextMenu({ kind: "track", id: "gtr" }, SAID))).toEqual([
      "track mute gtr",
      "track gain gtr ",
      "track pan gtr ",
      "ui file gtr",
    ]);
  });

  it("leaves them where the click IS one", () => {
    const menu = contextMenu(
      { kind: "clip", id: "riff", track: "gtr", tc: "1:1:1" },
      SAID,
    );
    expect(lines(menu)).toContain("event remove gtr 1:1:1");
  });

  it("narrows and never invents: an entity named still has to answer the arguments", () => {
    // `menu:` is a filter over the derivation, so naming a menu the arguments do not fit adds no row.
    const WRONG: CommandInfo[] = CATALOGUE.map((c) =>
      c.command === "track mute" ? { ...c, menu: ["note" as const] } : c,
    );
    expect(
      lines(
        contextMenu(
          { kind: "note", sequence: "lead", note: 60, start: 0, end: 1 },
          WRONG,
        ),
      ),
    ).not.toContain("track mute");
  });

  it("gives way to the person's own list", () => {
    const menu = contextMenu({ kind: "track", id: "gtr" }, SAID, {
      "event remove": { menu: ["track"] },
    });
    expect(lines(menu)).toContain("event remove gtr ");
  });

  it("is still overruled by the plain off switch", () => {
    const menu = contextMenu(
      { kind: "clip", id: "riff", track: "gtr", tc: "1:1:1" },
      SAID,
      {
        "event remove": { menu: false },
      },
    );
    expect(lines(menu)).not.toContain("event remove gtr 1:1:1");
  });
});

// The list is DERIVED, so the shortening is all or nothing — one clash and every row keeps its full name.
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

describe("a row that asks first", () => {
  it("carries `confirm` when the catalogue marks the command, and only then", () => {
    const cat: CommandInfo[] = [
      {
        command: "track delete",
        args: [a("track", "track", "tracks")],
        confirm: true,
      },
      {
        command: "track mute",
        args: [a("track", "track", "tracks")],
      },
    ];
    const items = contextMenu({ kind: "track", id: "gtr" }, cat);
    expect(items.find((i) => i.verb === "track delete")?.confirm).toBe(true);
    expect(
      "confirm" in (items.find((i) => i.verb === "track mute") ?? {}),
    ).toBe(false);
  });
});

describe("the menu's contract", () => {
  it("carries a name, a sentence, a line, the verb behind it, and whether the line is finished — nothing else", () => {
    // No handlers and no ids to dispatch on: every entry is text the bar could have been typed into, `verb` included.
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
        // The sentence is always THERE, even when it is empty: a row carrying none would leave the previous row's standing.
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
    // The host runs a finished line and opens the bar on an unfinished one; `complete` is stated, not sniffed off a trailing space.
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
    // The shell's own commands are not in the catalogue; each carries its own sentence, so a row can never come out blank.
    const l = contextMenu({ kind: "track", id: "gtr" }, []);
    expect(l).toEqual([
      {
        label: "ui file",
        description: "open the track's own file, tracks/<id>.k7x",
        command: "ui file gtr",
        complete: true,
        // The verb without the entity — two entries for the same verb on two tracks are one command, and wear one icon.
        verb: "ui file",
      },
    ]);
  });

  it("opens no menu on the sink", () => {
    expect(contextMenu({ kind: "sink", id: "OUT" }, CATALOGUE)).toEqual([]);
  });
});

// A person may take a verb OFF the right-click (commandPrefs.ts's `menu`): the menu is derived, so this can only ever remove.
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
    // `ui file` is written by hand, not derived — the filter sits at the one place every entry passes so those obey too.
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

describe("a rack pad", () => {
  const TAP_VERBS: CommandInfo[] = [
    "node tap note",
    "node tap sample",
    "node tap rename",
    "node tap remove",
    "node tap insert",
  ].map((command) => ({
    command,
    help: command,
    args: [a("node", "module", "nodes"), a("symbol", "text")],
    menu: ["tap"],
  }));

  it("offers the seven edits by name, in the order a kit is edited", () => {
    const items = contextMenu(
      { kind: "tap", id: "kit", symbol: "BD" },
      TAP_VERBS,
    );
    expect(items.map((i) => i.label)).toEqual([
      "Change note…",
      "Change sample…",
      "Rename…",
      "Remove",
      "Add one before",
      "Add one after",
      "Edit chain…",
    ]);
  });

  it("runs what is whole, and hands the bar what still owes a value", () => {
    const items = contextMenu(
      { kind: "tap", id: "my kit", symbol: "BD" },
      TAP_VERBS,
    );
    const byLabel = Object.fromEntries(items.map((i) => [i.label, i]));
    expect(byLabel["Change note…"]).toMatchObject({
      command: 'node tap note "my kit" BD ',
      complete: false,
    });
    expect(byLabel.Remove).toMatchObject({
      command: 'node tap remove "my kit" BD',
      complete: true,
    });
    expect(byLabel["Add one after"]).toMatchObject({
      command: 'node tap insert "my kit" after BD',
      complete: true,
    });
  });
});
