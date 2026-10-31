// A journal step read as a sentence: the catalogue's own, in the language being read, with its subject named as the screen names it.

import { describe, expect, it } from "vitest";
import { stepSentence } from "./stepSentence";
import type { ArgClass, ArgProvider, CommandArg, CommandInfo } from "./types";

const a = (
  name: string,
  kind: ArgClass,
  provider?: ArgProvider,
): CommandArg => ({
  name,
  kind,
  provider,
  hint: "",
});

const CATALOGUE: CommandInfo[] = [
  {
    command: "sequence note velocity",
    readable: {
      en: "Set a note's velocity",
      fr: "Régler la vélocité d'une note",
    },
    args: [a("sequence", "file", "sequenceFiles"), a("note", "text")],
  },
  {
    command: "event move",
    readable: {
      en: "Move a clip to another position or track",
      fr: "Déplacer un clip à une autre position ou piste",
    },
    args: [a("track", "track", "tracks"), a("timecode", "timecode")],
  },
  {
    command: "event",
    readable: { en: "Too short to win", fr: "Trop court" },
    args: [],
  },
  { command: "node bypass", args: [a("node", "module", "nodes")] },
  {
    command: "transport stop",
    readable: { en: "Stop playback", fr: "Arrêter la lecture" },
    args: [],
  },
  {
    command: "track rename",
    readable: { en: "Rename a track", fr: "Renommer une piste" },
    args: [a("track", "track", "tracks"), a("name", "text")],
  },
];

const names = {
  lane: (id: string) => (id === "da.drums" ? "drums" : id),
  clip: (ref: string) => (ref === "track-7-seq-1" ? "keys sequence 1" : ref),
};

describe("stepSentence", () => {
  it("reads a step as its command's sentence and its subject, in English", () => {
    expect(
      stepSentence(
        "sequence note velocity track-7-seq-1 47 7.5",
        CATALOGUE,
        "en",
        names,
      ),
    ).toBe("Set a note's velocity · keys sequence 1");
    expect(
      stepSentence("event move da.drums 29:1 19:1", CATALOGUE, "en", names),
    ).toBe("Move a clip to another position or track · drums");
  });

  it("…and in French, the subject named the same way", () => {
    expect(
      stepSentence(
        "sequence note velocity track-7-seq-1 47 7.5",
        CATALOGUE,
        "fr",
        names,
      ),
    ).toBe("Régler la vélocité d'une note · keys sequence 1");
    expect(
      stepSentence("event move da.drums 29:1 19:1", CATALOGUE, "fr", names),
    ).toBe("Déplacer un clip à une autre position ou piste · drums");
  });

  it("keeps the longest command matching the line, not its first word", () => {
    expect(stepSentence("event move gtr 1:1 2:1", CATALOGUE, "en")).toBe(
      "Move a clip to another position or track · gtr",
    );
  });

  it("unquotes a subject holding a space", () => {
    expect(
      stepSentence('track rename "lead gtr" solo', CATALOGUE, "en", names),
    ).toBe("Rename a track · lead gtr");
  });

  it("says no subject when the command takes no argument", () => {
    expect(stepSentence("transport stop", CATALOGUE, "fr")).toBe(
      "Arrêter la lecture",
    );
  });

  it("returns the line as written when no sentence describes it", () => {
    expect(stepSentence("edit tracks/gtr.k7x", CATALOGUE, "en")).toBe(
      "edit tracks/gtr.k7x",
    );
    expect(stepSentence("node bypass amp on", CATALOGUE, "en")).toBe(
      "node bypass amp on",
    );
    expect(stepSentence("", CATALOGUE, "en")).toBe("");
  });
});
