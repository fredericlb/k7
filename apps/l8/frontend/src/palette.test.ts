// What the palette LISTS, and in what order — the one part of "type what you want" that can be
// tested without a browser. The claim is that a person who knows what they want done finds the
// command without knowing what it is called.

import { describe, expect, it } from "vitest";
import {
  buildPaletteCommands,
  LOCAL_COMMANDS,
  LOCAL_READABLE,
  rankCommands,
  rankValues,
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
    "marker new",
    "Add a marker to the timeline",
    "Ajouter un repère sur la timeline",
  ),
  cmd(
    "track freeze",
    "Freeze or unfreeze a track",
    "Geler ou dégeler une piste",
  ),
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

  it("falls back to the command's name rather than listing a blank row", () => {
    const bare = buildPaletteCommands(
      [{ command: "track solo", args: [] }],
      "en",
    );
    expect(bare[0].readable).toBe("track solo");
  });

  it("adds the shell's own commands, described too", () => {
    const all = build();
    const local = all.find((c) => c.canonical === "ui help");
    expect(local?.readable).toContain("help");
    // Every shell command has a sentence: the palette cannot tell the two halves apart, so a
    // missing one would be one unfindable row among sixty findable ones.
    const missing = LOCAL_COMMANDS.filter((c) => !LOCAL_READABLE[c]);
    expect(missing).toEqual([]);
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
    expect(names("repère", "fr")).toContain("marker new");
    // …and the command's NAME still works, because a name is not translated.
    expect(names("marker", "fr")).toContain("marker new");
  });

  it("is fuzzy, not a prefix", () => {
    // The old bar filtered by `startsWith` on the name; neither of these would have matched.
    expect(names("mute")).toContain("track mute");
    expect(names("tmut")).toContain("track mute");
  });

  it("puts the command whose NAME was typed first", () => {
    // Typing a verb means the verb: "track freeze" beats a description that merely contains
    // the same letters.
    expect(names("track freeze")[0]).toBe("track freeze");
  });

  it("lists the whole catalogue when nothing is typed", () => {
    // Everything the palette holds: the backend's, plus the shell's own.
    expect(names("")).toHaveLength(build().length);
    // …in the catalogue's own order, which groups by area rather than by alphabet.
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
