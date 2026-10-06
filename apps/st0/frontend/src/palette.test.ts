// What the palette LISTS, and in what order — the one part of "type what you want" that can be
// tested without a browser. The claim is that a person who knows what they want done finds the
// command without knowing what it is called.

import { describe, expect, it } from "vitest";
import {
  buildPaletteCommands,
  commandNameOf,
  LOCAL_COMMANDS,
  LOCAL_READABLE,
  optionsFromCompletions,
  rankCommands,
  rankOptions,
  rankValues,
  toOptions,
} from "./palette";
import type { CommandInfo } from "./types";

const cmd = (
  command: string,
  en: string,
  fr: string,
  args: CommandInfo["args"] = [],
): CommandInfo => ({ command, args, readable: { en, fr } });

const CATALOGUE: CommandInfo[] = [
  cmd(
    "track mute",
    "Mute or unmute a track",
    "Couper ou rétablir le son d'une piste",
    [{ name: "track", kind: "track", hint: "" }],
  ),
  cmd("transport play", "Start playback", "Lancer la lecture"),
  cmd(
    "project marker new",
    "Add a marker to the timeline",
    "Ajouter un repère sur la timeline",
  ),
  cmd("track color", "Recolour a track", "Recolorer une piste"),
];

const build = (locale = "en") => buildPaletteCommands(CATALOGUE, locale);
const names = (q: string, locale = "en") =>
  rankCommands(build(locale), q).map((c) => c.canonical);

describe("the catalogue the palette lists", () => {
  it("carries the description in the reader's language", () => {
    expect(build("en")[0].readable).toBe("Mute or unmute a track");
    expect(build("fr")[0].readable).toBe(
      "Couper ou rétablir le son d'une piste",
    );
  });

  it("keeps the WHOLE table beside it, for the screen that names a command per language", () => {
    // The settings page places one field per locale and greys the catalogue's words into each — `readable` is one language by then.
    expect(build("en")[0].readableBy).toEqual({
      en: "Mute or unmute a track",
      fr: "Couper ou rétablir le son d'une piste",
    });
    // …and the same table whichever language built the list: it is the catalogue, not a view of it.
    expect(build("fr")[0].readableBy).toEqual(build("en")[0].readableBy);
  });

  it("falls back to the command's name rather than listing a blank row", () => {
    const bare = buildPaletteCommands(
      [{ command: "track solo", args: [] }],
      "en",
    );
    expect(bare[0].readable).toBe("track solo");
    // No table either: the line is not a translation, and a placeholder claiming to be one would offer English to the French field.
    expect(bare[0].readableBy).toBeUndefined();
  });

  it("adds the shell's own commands, described too", () => {
    const all = build();
    const local = all.find((c) => c.canonical === "ui help");
    expect(local?.readable).toContain("help");
    // Every shell command has a sentence: the palette cannot tell the two halves apart, so a missing one is an unfindable row.
    const missing = LOCAL_COMMANDS.filter((c) => !LOCAL_READABLE[c]);
    expect(missing).toEqual([]);
  });

  it("keeps every shell description inside the palette's row — 60 chars", () => {
    // The same cap `commandSpec.test.ts` holds commands.yaml to: the two halves are listed side by side, so a longer one truncates.
    const long = Object.entries(LOCAL_READABLE).flatMap(([name, r]) =>
      (["en", "fr"] as const)
        .filter((lang) => r[lang].length > 60)
        .map((lang) => `${name} (${lang}, ${r[lang].length}): ${r[lang]}`),
    );
    expect(long, "shell descriptions over 60 characters").toEqual([]);
  });

  it("does not list a shell command the backend already offers", () => {
    const twice = buildPaletteCommands(
      [cmd("event move", "Move a clip", "Déplacer un clip")],
      "en",
    ).filter((c) => c.canonical === "event move");
    expect(twice).toHaveLength(1);
  });
});

describe("finding a command by describing it", () => {
  it("matches the SENTENCE, not just the name", () => {
    // "silence" appears in no command name in this catalogue…
    expect(names("unmute")).toContain("track mute");
    expect(names("playback")).toContain("transport play");
  });

  it("matches in French when that is the language", () => {
    expect(names("couper", "fr")).toContain("track mute");
    expect(names("repère", "fr")).toContain("project marker new");
    // …and the command's NAME still works, because a name is not translated.
    expect(names("marker", "fr")).toContain("project marker new");
  });

  it("is fuzzy, not a prefix", () => {
    // Neither of these would match a `startsWith` filter on the name.
    expect(names("mute")).toContain("track mute");
    expect(names("tmut")).toContain("track mute");
  });

  it("puts the command whose NAME was typed first", () => {
    // Typing a verb means the verb: 'track color' beats a description that merely contains the same letters.
    expect(names("track color")[0]).toBe("track color");
  });

  it("keeps the catalogue's own order when nothing is typed", () => {
    // Everything the palette holds, in the catalogue's own order and capped like any other answer — the bar lists nothing until you type.
    const all = build();
    expect(names("")).toEqual(all.slice(0, 30).map((c) => c.canonical));
    expect(names("")[0]).toBe("track mute");
  });

  it("answers nothing for a query that matches nothing", () => {
    expect(names("zzzz")).toEqual([]);
  });

  it("honours the limit, so the list cannot outgrow the screen", () => {
    const many = Array.from({ length: 80 }, (_, i) =>
      cmd(`x${i}`, `Do the thing number ${i}`, `Faire la chose ${i}`),
    );
    expect(
      rankCommands(buildPaletteCommands(many, "en"), "thing"),
    ).toHaveLength(30);
  });
});

describe("finding a param's value the same way", () => {
  const TRACKS = ["ge.rythm", "ge.lead", "dr.kick", "vx.lead"];

  it("finds a track from the middle of its name", () => {
    // The backend's own completion narrows by PREFIX and cannot answer this one.
    expect(rankValues(TRACKS, "rythm")).toEqual(["ge.rythm"]);
  });

  it("ranks the closer match first", () => {
    expect(rankValues(TRACKS, "lead")[0]).toBe("ge.lead");
  });

  it("keeps the provider's order when nothing is typed", () => {
    expect(rankValues(TRACKS, "")).toEqual(TRACKS);
  });

  it("answers nothing rather than everything for a miss", () => {
    expect(rankValues(TRACKS, "qqq")).toEqual([]);
  });
});

describe("a node named by a uuid is found and listed by its module", () => {
  const WAH = "0b7c2f4e-1d2a-4c55-9a10-3e8f6a2b9d01";
  const COMP = "5f1e9a3c-7b42-4e0d-8c6a-2d9b1f4e7a30";
  const NODES = [
    { value: WAH, label: "@st0/auto-wah · fx · step 2" },
    { value: COMP, label: "@st0/comp · fx · step 1" },
    { value: "gtr" },
  ];

  it("matches what was typed against the label", () => {
    expect(rankOptions(NODES, "auto-wah")).toEqual([NODES[0]]);
  });

  it("still matches the value, so a pasted uuid finds its node", () => {
    expect(rankOptions(NODES, WAH)[0]).toEqual(NODES[0]);
  });

  it("matches an unlabelled option by its value alone", () => {
    expect(rankOptions(NODES, "gtr")).toEqual([NODES[2]]);
  });

  it("turns bare strings into options and leaves options alone", () => {
    expect(toOptions(["a", { value: WAH, label: "x" }])).toEqual([
      { value: "a" },
      { value: WAH, label: "x" },
    ]);
  });

  it("slices the sent prefix off each line, keeping the label and dropping a duplicate", () => {
    const prefix = "node bypass ";
    expect(
      optionsFromCompletions(
        [
          { line: `node bypass ${WAH}`, label: "@st0/auto-wah · fx · step 2" },
          { line: "node bypass gtr" },
          { line: "node bypass gtr" },
          { line: "node other" },
        ],
        prefix,
      ),
    ).toEqual([
      { value: WAH, label: "@st0/auto-wah · fx · step 2" },
      { value: "gtr" },
    ]);
  });
});

describe("what you used lately comes first", () => {
  const recent = (q: string, used: string[]) =>
    rankCommands(build(), q, used).map((c) => c.canonical);

  it("lifts a command you have run over an equally good match you have not", () => {
    // "track" matches both of these about as well; the one you ran last wins.
    expect(recent("track", [])[0]).not.toBe("track color");
    expect(recent("track", ["track color"])[0]).toBe("track color");
  });

  it("decays down the history, so the last thing you did beats the tenth", () => {
    const used = ["project marker new", ...Array(8).fill("x"), "track color"];
    expect(recent("track", used)[0]).toBe("track color");
    // …and the fresher one wins when both match.
    expect(recent("a", ["track color", "project marker new"])[0]).toBe(
      "track color",
    );
  });

  it("is a NUDGE, not an override — a clearly better match still wins", () => {
    // The history says `transport play`; the query plainly says the other one.
    expect(recent("Mute or unmute", ["transport play"])[0]).toBe("track mute");
  });

  it("never invents a match: history cannot make a command appear", () => {
    expect(recent("zzzz", ["track mute"])).toEqual([]);
  });

  it("ignores a remembered command the catalogue no longer has", () => {
    expect(() => recent("track", ["gone forever"])).not.toThrow();
  });
});

describe("which command a line ran", () => {
  const all = build();

  it("takes the LONGEST name, as the dispatcher does", () => {
    expect(commandNameOf("track mute gtr", all)).toBe("track mute");
    expect(commandNameOf("track mute", all)).toBe("track mute");
  });

  it("answers null for a line that names no command", () => {
    expect(commandNameOf("wat is this", all)).toBe(null);
    // A name that merely STARTS the same is not a match — `track mutex` is not `track mute`.
    expect(commandNameOf("track mutex", all)).toBe(null);
  });
});
