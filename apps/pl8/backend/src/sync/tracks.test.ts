import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { reset } from "@studio/mediatek/catalogue";
import { ensureLayout } from "@studio/mediatek/layout";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SyncError, tracksOf } from "./push.ts";

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "pl8-sync-"));
  process.env.STUDIO_MEDIATEK = root;
  reset();
  ensureLayout();
});
afterEach(() => {
  delete process.env.STUDIO_MEDIATEK;
  rmSync(root, { recursive: true, force: true });
  reset();
});

const write = (rel: string, body = "x") => {
  const abs = join(root, rel);
  mkdirSync(join(abs, ".."), { recursive: true });
  writeFileSync(abs, body, "utf8");
};

/** One catalogued song, with a master and optionally a variant beside it. */
const song = (path: string, yaml: string, files: string[]) => {
  write(`songs/${path}/song.yaml`, yaml);
  for (const f of files) write(`songs/${path}/${f}`, "RIFF");
};

const playlist = (name: string, body: string) =>
  write(`playlists/${name}.yaml`, body);

describe("resolving a set list into tracks", () => {
  it("takes artist, album and title, and the master's own path", () => {
    song(
      "AC-DC/Back in Black/Hells Bells",
      "title: Hells Bells\nartist: AC-DC\nmaster: original.mp3\n",
      ["original.mp3"],
    );
    playlist("ete", "items:\n  - AC-DC/Back in Black/Hells Bells\n");
    expect(tracksOf("ete").tracks).toEqual([
      {
        path: "songs/AC-DC/Back in Black/Hells Bells/original.mp3",
        artist: "AC-DC",
        album: "Back in Black",
        title: "Hells Bells",
      },
    ]);
  });

  it("IGNORES a variant and copies the original — one file per song on a target", () => {
    // The master is whatever the SCAN calls one: the first audio file in the folder, so the
    // variant is named to sort after it. That rule is the médiathèque's, and sync follows it
    // rather than holding a second opinion — packages/mediatek/docs/songs.md.
    song(
      "Nirvana/Nevermind/Lithium",
      "title: Lithium\nartist: Nirvana\nvariants:\n  instru: vocals-off.mp3\n",
      ["original.mp3", "vocals-off.mp3"],
    );
    playlist(
      "ete",
      "items:\n  - song: Nirvana/Nevermind/Lithium\n    variant: instru\n",
    );
    const [only] = tracksOf("ete").tracks;
    // The line names `instru`; what travels is still the master.
    expect(only?.path).toBe("songs/Nirvana/Nevermind/Lithium/original.mp3");
  });

  it("skips a line naming no song here, and says which — never refusing the whole list", () => {
    song("A/B/C", "title: C\nartist: A\nmaster: original.mp3\n", [
      "original.mp3",
    ]);
    playlist("ete", "items:\n  - A/B/C\n  - Nobody/No Album/No Song\n");
    const { tracks, skipped } = tracksOf("ete");
    expect(tracks).toHaveLength(1);
    expect(skipped).toEqual(["Nobody/No Album/No Song"]);
  });

  it("skips a catalogued folder with no audio, which the scan allows", () => {
    write("songs/A/B/Empty/song.yaml", "title: Empty\nartist: A\n");
    playlist("ete", "items:\n  - A/B/Empty\n");
    expect(tracksOf("ete").tracks).toEqual([]);
    expect(tracksOf("ete").skipped).toEqual(["A/B/Empty"]);
  });

  it("falls back to the path when the sidecar names no artist", () => {
    song("Miles Davis/Kind of Blue/So What", "title: So What\n", ["a.mp3"]);
    playlist("ete", "items:\n  - Miles Davis/Kind of Blue/So What\n");
    const [only] = tracksOf("ete").tracks;
    expect(only).toMatchObject({
      artist: "Miles Davis",
      album: "Kind of Blue",
      title: "So What",
    });
  });

  it("refuses a playlist that is not there, or does not parse", () => {
    expect(() => tracksOf("nope")).toThrow(SyncError);
    playlist("broken", "items: [unclosed\n");
    expect(() => tracksOf("broken")).toThrow(SyncError);
    // A name that would leave the zone is refused before any read.
    expect(() => tracksOf("../../etc/passwd")).toThrow(SyncError);
  });
});
