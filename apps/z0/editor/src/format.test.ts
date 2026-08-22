// The `.z0` reader and its writers. The fixtures are trimmed copies of real files from
// session-2304.z0, because the shapes that matter here (a flat song, a `tracks:` song, an
// open-ended range, a bare `- pause:`) all occur in that session and none of them is obvious.

import { describe, expect, it } from "vitest";
import {
  addOrderCat,
  addOrderPause,
  addSong,
  addTrack,
  expandToTracks,
  moveOrderEntry,
  moveSong,
  newCategoryText,
  parseDocument,
  parseRange,
  readCategory,
  readSession,
  removeOrderEntry,
  removeSong,
  removeTrack,
  serialize,
  setCategoryField,
  setOrderCat,
  setOrderPause,
  setOrderRange,
  setSessionField,
  setSongEffect,
  setSongField,
  setTrackField,
  slugOf,
  songsInRange,
} from "./format";

const SESSION = `# Une session de blindtest : l'en-tête, puis l'ordre des manches.
name: session-2304
token: blue
password: blue
notice: "À TROUVER: ARTISTE ET TITRE"

order:
  - cat: la-chauffe
  - cat: stems
    songs: 1-5
  - pause:
  - cat: extraits
    songs: 6-
  - pause: Entracte
`;

const STEMS = `name: Stems
variant: stems
songs:
  - song: songs/Zaz/Album inconnu/Je veux
    start: 24.78
    end: 212.6
    status: valid
  - song: songs/Zouk Machine/Album inconnu/Maldon
    start: 65.16
    status: valid
`;

const FUSION = `name: Fusion
mode: fusion
liveOnly: true
songs:
  - label: The Senti-Nelly Furtado
    status: valid
    tracks:
      - song: songs/Nelly Furtado/Album inconnu/I'm like a bird
        start: 54.68
      - song: songs/Artiste inconnu/Album inconnu/The Sentinel
        start: 8.14
`;

describe("readSession", () => {
  const s = readSession(parseDocument(SESSION));

  it("reads the header", () => {
    expect(s.name).toBe("session-2304");
    expect(s.token).toBe("blue");
    expect(s.notice).toBe("À TROUVER: ARTISTE ET TITRE");
  });

  it("reads the order, keeping the ranges as written", () => {
    expect(s.order.map((e) => e.kind)).toEqual([
      "cat",
      "cat",
      "pause",
      "cat",
      "pause",
    ]);
    expect(s.order[1]).toEqual({ kind: "cat", cat: "stems", songs: "1-5" });
    expect(s.order[3]).toEqual({ kind: "cat", cat: "extraits", songs: "6-" });
  });

  it("tells a bare pause from a named one — the KEY decides, not the value", () => {
    // `- pause:` parses to null, so a value check would read it as "not a pause at all".
    expect(s.order[2]).toEqual({ kind: "pause", message: undefined });
    expect(s.order[4]).toEqual({ kind: "pause", message: "Entracte" });
  });
});

describe("readCategory", () => {
  it("reads a flat song as a one-track song", () => {
    const c = readCategory("stems", parseDocument(STEMS));
    expect(c.name).toBe("Stems");
    expect(c.variant).toBe("stems");
    expect(c.songs).toHaveLength(2);
    expect(c.songs[0].flat).toBe(true);
    expect(c.songs[0].status).toBe("valid");
    expect(c.songs[0].tracks).toEqual([
      {
        song: "songs/Zaz/Album inconnu/Je veux",
        start: 24.78,
        end: 212.6,
        file: undefined,
        youtube: undefined,
        artist: undefined,
        title: undefined,
      },
    ]);
  });

  it("reads a `tracks:` song without flattening it", () => {
    const c = readCategory("fusion", parseDocument(FUSION));
    expect(c.mode).toBe("fusion");
    expect(c.liveOnly).toBe(true);
    expect(c.songs[0].flat).toBe(false);
    expect(c.songs[0].label).toBe("The Senti-Nelly Furtado");
    expect(c.songs[0].tracks).toHaveLength(2);
    expect(c.songs[0].tracks[1].start).toBe(8.14);
  });

  it("survives a category with no songs at all", () => {
    const c = readCategory("vide", parseDocument("name: Vide\n"));
    expect(c.songs).toEqual([]);
  });
});

describe("parseRange", () => {
  it("reads the three shapes the format allows", () => {
    expect(parseRange("1-5")).toEqual({ from: 1, to: 5 });
    expect(parseRange("11-")).toEqual({ from: 11, to: null });
    expect(parseRange("7")).toEqual({ from: 7, to: 7 });
  });

  it("is null for an absent or malformed range, which means the whole category", () => {
    expect(parseRange(undefined)).toBeNull();
    expect(parseRange("")).toBeNull();
    expect(parseRange("beaucoup")).toBeNull();
  });
});

describe("songsInRange", () => {
  const songs = [1, 2, 3, 4, 5].map((n) => ({
    label: `s${n}`,
    tracks: [],
    flat: true,
  }));

  it("is 1-based and inclusive at both ends", () => {
    expect(songsInRange(songs, "2-4").map((s) => s.label)).toEqual([
      "s2",
      "s3",
      "s4",
    ]);
  });

  it("runs to the end when the range is open", () => {
    expect(songsInRange(songs, "4-").map((s) => s.label)).toEqual(["s4", "s5"]);
  });

  it("is the whole category when there is no range", () => {
    expect(songsInRange(songs, undefined)).toHaveLength(5);
  });
});

// The reason this file edits Documents rather than re-serialising values.
describe("writing keeps the file as it was written", () => {
  it("changes one scalar and nothing else — comments and quotes included", () => {
    const doc = parseDocument(SESSION);
    setSessionField(doc, "token", "rouge");
    const out = String(doc);
    expect(out).toContain("# Une session de blindtest");
    expect(out).toContain("token: rouge");
    expect(out).toContain('notice: "À TROUVER: ARTISTE ET TITRE"');
    expect(out).toContain("  - pause:\n");
  });

  it("sets a flat song's start where the flat song keeps it", () => {
    const doc = parseDocument(STEMS);
    const song = readCategory("stems", doc).songs[0];
    setTrackField(doc, song, 0, 0, "start", 30.5);
    expect(String(doc)).toContain("start: 30.5");
    expect(readCategory("stems", doc).songs[0].tracks[0].start).toBe(30.5);
  });

  it("sets a nested track's start on that track, not on the song", () => {
    const doc = parseDocument(FUSION);
    const song = readCategory("fusion", doc).songs[0];
    setTrackField(doc, song, 0, 1, "start", 9.5);
    const back = readCategory("fusion", doc).songs[0];
    expect(back.tracks[1].start).toBe(9.5);
    expect(back.tracks[0].start).toBe(54.68);
  });

  it("REMOVES a field rather than writing the format's own default back", () => {
    // Writing `end: 0` would add a line to every song the editor merely looked at, and 0 is
    // not what an absent `end` means anyway.
    const doc = parseDocument(STEMS);
    const song = readCategory("stems", doc).songs[0];
    setTrackField(doc, song, 0, 0, "end", undefined);
    expect(String(doc)).not.toContain("end:");
    expect(String(doc)).toContain("start: 24.78");
  });
});

describe("expandToTracks", () => {
  it("moves the track keys into a list and leaves the song's own keys alone", () => {
    const doc = parseDocument(STEMS);
    expandToTracks(doc, readCategory("stems", doc).songs[0], 0);
    const song = readCategory("stems", doc).songs[0];
    expect(song.flat).toBe(false);
    expect(song.status).toBe("valid");
    expect(song.tracks).toHaveLength(1);
    expect(song.tracks[0]).toMatchObject({
      song: "songs/Zaz/Album inconnu/Je veux",
      start: 24.78,
      end: 212.6,
    });
  });

  it("leaves a song that already has tracks alone", () => {
    const doc = parseDocument(FUSION);
    const before = String(doc);
    expandToTracks(doc, readCategory("fusion", doc).songs[0], 0);
    expect(String(doc)).toBe(before);
  });
});

describe("structural edits", () => {
  it("moves a song by carrying its node, comments and all", () => {
    const withComment = STEMS.replace(
      "  - song: songs/Zouk Machine/Album inconnu/Maldon",
      "  # celle-ci est à revoir\n  - song: songs/Zouk Machine/Album inconnu/Maldon",
    );
    const doc = parseDocument(withComment);
    moveSong(doc, 1, 0);
    const out = String(doc);
    expect(readCategory("stems", doc).songs[0].tracks[0].song).toContain(
      "Maldon",
    );
    expect(out).toContain("# celle-ci est à revoir");
    // The comment travelled with the song rather than staying where the song used to be.
    expect(out.indexOf("# celle-ci")).toBeLessThan(out.indexOf("Je veux"));
  });

  it("ignores a move that goes nowhere or off the end", () => {
    const doc = parseDocument(STEMS);
    const before = String(doc);
    moveSong(doc, 0, 0);
    moveSong(doc, 0, 9);
    moveSong(doc, -1, 0);
    expect(String(doc)).toBe(before);
  });

  it("removes a song", () => {
    const doc = parseDocument(STEMS);
    removeSong(doc, 0);
    const songs = readCategory("stems", doc).songs;
    expect(songs).toHaveLength(1);
    expect(songs[0].tracks[0].song).toContain("Maldon");
  });

  it("appends a song, and creates `songs:` for a category that had none", () => {
    const doc = parseDocument(STEMS);
    addSong(doc, "songs/A/B/C");
    const songs = readCategory("stems", doc).songs;
    expect(songs).toHaveLength(3);
    expect(songs[2].tracks[0].song).toBe("songs/A/B/C");

    const empty = parseDocument("name: Vide\n");
    addSong(empty, "songs/A/B/C");
    expect(readCategory("vide", empty).songs).toHaveLength(1);
  });

  it("promotes a flat song when a second track is added to it", () => {
    // `song:` and `tracks:` are exclusive, so the first track has to move down into the list.
    const doc = parseDocument(STEMS);
    addTrack(doc, readCategory("stems", doc).songs[0], 0, "songs/X/Y/Z");
    const song = readCategory("stems", doc).songs[0];
    expect(song.flat).toBe(false);
    expect(song.tracks).toHaveLength(2);
    expect(song.tracks[0].song).toContain("Je veux");
    expect(song.tracks[0].start).toBe(24.78);
    expect(song.tracks[1].song).toBe("songs/X/Y/Z");
  });

  it("removes one track of a `tracks:` song", () => {
    const doc = parseDocument(FUSION);
    removeTrack(doc, readCategory("fusion", doc).songs[0], 0, 0);
    const song = readCategory("fusion", doc).songs[0];
    expect(song.tracks).toHaveLength(1);
    expect(song.tracks[0].song).toContain("The Sentinel");
  });

  it("refuses to remove the track of a FLAT song", () => {
    // There is no track node to remove — the keys are the song's. Collapsing it here would
    // silently delete the song's own fields with it.
    const doc = parseDocument(STEMS);
    const before = String(doc);
    removeTrack(doc, readCategory("stems", doc).songs[0], 0, 0);
    expect(String(doc)).toBe(before);
  });
});

// Two shapes the real files have that the format page understates — both would be silently
// mangled by a naive setter, so they are pinned here.
describe("the shapes the migration actually wrote", () => {
  const ANSWERS = `name: Bandes originales
songs:
  - song: songs/OST/Album inconnu/Maman j'ai rate l'avion
    answer: |

      Maman j'ai raté l'avion,Home Alone
    status: valid
`;
  const EFFECTS = `name: Déformées
songs:
  - song: songs/Blondie/Album inconnu/Call me
    status: valid
    effects: { chorus: 37, lowpass: 57, overdrive: 1, pitch: 6 }
`;

  it("reads a block-scalar answer, newlines and all", () => {
    const c = readCategory("bo", parseDocument(ANSWERS));
    expect(c.songs[0].answer).toContain("Maman j'ai raté l'avion,Home Alone");
  });

  it("keeps a multi-line answer a BLOCK rather than folding it onto a quoted line", () => {
    const doc = parseDocument(ANSWERS);
    setSongField(doc, 0, "answer", "Première ligne\nSeconde ligne\n");
    const out = serialize(doc);
    expect(out).toContain("answer: |");
    expect(out).toContain("Seconde ligne");
    expect(out).not.toContain('answer: "');
  });

  it("reads per-song effects", () => {
    const c = readCategory("def", parseDocument(EFFECTS));
    expect(c.songs[0].effects).toEqual({
      chorus: 37,
      lowpass: 57,
      overdrive: 1,
      pitch: 6,
    });
  });

  it("changes one effect and drops the map when the last one goes", () => {
    const doc = parseDocument(EFFECTS);
    const song = readCategory("def", doc).songs[0];
    setSongEffect(doc, song, 0, "chorus", 50);
    expect(readCategory("def", doc).songs[0].effects?.chorus).toBe(50);

    let cur = readCategory("def", doc).songs[0];
    for (const k of ["chorus", "lowpass", "overdrive", "pitch"]) {
      setSongEffect(doc, cur, 0, k, undefined);
      cur = readCategory("def", doc).songs[0];
    }
    expect(cur.effects).toBeUndefined();
    expect(serialize(doc)).not.toContain("effects:");
  });

  it("removes a false boolean rather than writing `liveOnly: false`", () => {
    // Absent or true is all these files ever contain; false would be the only one of its kind.
    const doc = parseDocument("name: X\nliveOnly: true\n");
    setCategoryField(doc, "liveOnly", false);
    expect(serialize(doc)).not.toContain("liveOnly");
  });
});

describe("the order of the rounds", () => {
  it("moves an entry, carrying its node", () => {
    const doc = parseDocument(SESSION);
    moveOrderEntry(doc, 0, 1);
    const o = readSession(doc).order;
    expect(o[0]).toMatchObject({ cat: "stems", songs: "1-5" });
    expect(o[1]).toMatchObject({ cat: "la-chauffe" });
  });

  it("removes an entry", () => {
    const doc = parseDocument(SESSION);
    removeOrderEntry(doc, 2); // the bare pause
    const o = readSession(doc).order;
    expect(o).toHaveLength(4);
    expect(o.map((e) => e.kind)).toEqual(["cat", "cat", "cat", "pause"]);
  });

  it("appends a category round and a pause", () => {
    const doc = parseDocument(SESSION);
    addOrderCat(doc, "reprises");
    addOrderPause(doc, "Entracte 2");
    const o = readSession(doc).order;
    expect(o[5]).toEqual({ kind: "cat", cat: "reprises", songs: undefined });
    expect(o[6]).toEqual({ kind: "pause", message: "Entracte 2" });
  });

  it("writes a bare pause BARE, the way the migration spells it", () => {
    // yaml says `null` by default, which would put two spellings of one thing in one file.
    const doc = parseDocument(SESSION);
    addOrderPause(doc);
    const out = serialize(doc);
    expect(out).not.toContain("pause: null");
    expect(readSession(doc).order.at(-1)).toEqual({
      kind: "pause",
      message: undefined,
    });
  });

  it("sets and clears a range", () => {
    const doc = parseDocument(SESSION);
    setOrderRange(doc, 0, "2-6");
    expect(readSession(doc).order[0].songs).toBe("2-6");
    setOrderRange(doc, 1, "");
    expect(readSession(doc).order[1].songs).toBeUndefined();
    expect(serialize(doc)).toContain("# Une session de blindtest");
  });

  it("empties a pause's message back to a bare pause instead of losing the pause", () => {
    const doc = parseDocument(SESSION);
    setOrderPause(doc, 4, "");
    const o = readSession(doc).order;
    expect(o[4]).toEqual({ kind: "pause", message: undefined });
    expect(o).toHaveLength(5);
  });

  it("re-points a round at another category", () => {
    const doc = parseDocument(SESSION);
    setOrderCat(doc, 0, "moderne");
    expect(readSession(doc).order[0].cat).toBe("moderne");
  });
});

describe("newCategoryText", () => {
  it("parses back as an empty category with the given name", () => {
    const c = readCategory(
      "neuve",
      parseDocument(newCategoryText("Ma manche")),
    );
    expect(c.name).toBe("Ma manche");
    expect(c.songs).toEqual([]);
  });

  it("takes a song straight away", () => {
    const doc = parseDocument(newCategoryText("Ma manche"));
    addSong(doc, "songs/A/B/C");
    expect(readCategory("neuve", doc).songs).toHaveLength(1);
  });

  it("survives a name that would break the YAML", () => {
    const c = readCategory(
      "x",
      parseDocument(newCategoryText('Le "grand" : soir')),
    );
    expect(c.name).toBe('Le "grand" : soir');
  });
});

describe("slugOf", () => {
  it("is the file name without its folder or extension", () => {
    expect(slugOf("categories/stems.yaml")).toBe("stems");
    expect(slugOf("categories/a-l-envers.yml")).toBe("a-l-envers");
  });
});
