import type { MediatekEntry } from "@studio/mediatek/types";
import { describe, expect, it } from "vitest";
import { DECK, deckDoc } from "./deck";
import { playablePath } from "./service";

const entry = (over: Partial<MediatekEntry> = {}): MediatekEntry => ({
  family: "morceaux",
  id: "morceaux/recorded/song",
  name: "Song",
  path: "morceaux/recorded/song",
  kind: "recorded",
  mtime: 0,
  meta: { catalogued: true, master: "master.wav" },
  ...over,
});

describe("turning a catalogue entry into something the engine can open", () => {
  it("joins the cache root, the entry's folder and the master file", () => {
    expect(playablePath("/home/flb/.lanes/mediatek", entry())).toBe(
      "/home/flb/.lanes/mediatek/morceaux/recorded/song/master.wav",
    );
  });

  it("keeps a Windows root's separator instead of normalising it", () => {
    // The service reports a NATIVE root while entry paths are POSIX, and the engine takes
    // either. Picking one shape here would be this app deciding something it does not own.
    expect(playablePath("C:\\Users\\flb\\.lanes\\mediatek", entry())).toBe(
      "C:\\Users\\flb\\.lanes\\mediatek\\morceaux/recorded/song\\master.wav",
    );
  });

  it("answers null for a folder catalogued with no audio", () => {
    // A real state, not a malformed entry: a mirror that failed halfway, or a folder made
    // by hand. The UI disables Play and says which of the two problems it is.
    expect(
      playablePath("/root", entry({ meta: { catalogued: true } })),
    ).toBeNull();
  });

  it("answers null for an entry with no meta at all", () => {
    expect(playablePath("/root", entry({ meta: undefined }))).toBeNull();
  });
});

describe("the deck's document", () => {
  it("puts the file on one track, one clip", () => {
    const doc = deckDoc("/m/song/master.wav", "Song");
    expect(doc.tracks).toHaveLength(1);
    expect(doc.tracks[0].id).toBe(DECK);
    expect(doc.tracks[0].clips[0].source).toBe("/m/song/master.wav");
    expect(doc.tracks[0].clips[0].type).toBe("audio");
  });

  it("uses ONE chain name, so loading a second song is a diff and not a new track", () => {
    expect(deckDoc("/a.wav", "A").tracks[0].id).toBe(
      deckDoc("/b.wav", "B").tracks[0].id,
    );
  });

  it("refuses to arm, by carrying no record directory", () => {
    // A deck plays and never records; a made-up path is one the engine would eventually
    // try to write into. See emptyDoc.
    expect(deckDoc("/a.wav", "A").recordDir).toBe("");
  });

  it("carries no video and no groups, so it can be sent unfolded", () => {
    const doc = deckDoc("/a.wav", "A");
    expect(doc.groups).toEqual([]);
    expect(doc.video).toBe(false);
  });
});
