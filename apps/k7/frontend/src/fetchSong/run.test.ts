// The two fetches against a pl8 that answers from a script: what each step does, and what it refuses.

import type { MediatekEntry } from "@studio/mediatek/types";
import type { HuntRecord } from "@studio/web-protocol/hunt";
import { describe, expect, it, vi } from "vitest";
import type { Song } from "../types";
import type { Pl8Client } from "./pl8";
import { fetchSong, makeInstrumental, runPipeline } from "./run";

const entry = (artist: string, title: string): MediatekEntry =>
  ({
    family: "songs",
    id: `songs/${artist}/Album/${title}`,
    name: title,
    path: `songs/${artist}/Album/${title}`,
    kind: "",
    mtime: 0,
    meta: { catalogued: true, artist, master: "original.flac" },
  }) as MediatekEntry;

const song = (over: Partial<Song> = {}): Song =>
  ({
    id: "s1",
    artist: "Nina Simone",
    title: "Sinnerman",
    lyrics: "",
    audio: null,
    instrumental: null,
    fetchStatus: {
      phase: "",
      progress: null,
      error: "",
      huntId: "",
      jobId: "",
    },
    lyricsMatch: "",
    ...over,
  }) as Song;

const hunt = (over: Partial<HuntRecord> = {}): HuntRecord =>
  ({
    id: "h1",
    query: "q",
    status: "done",
    startedAt: 0,
    ...over,
  }) as HuntRecord;

/** A pl8 whose answers are given per test; everything unused throws if it is reached. */
function fakePl8(over: Partial<Pl8Client> = {}): Pl8Client {
  const refuse = (name: string) => () => {
    throw new Error(`unexpected call: ${name}`);
  };
  return {
    listSongs: async () => [],
    startHunt: refuse("startHunt"),
    hunts: refuse("hunts"),
    engines: async () => [],
    prepareStems: refuse("prepareStems"),
    separation: refuse("separation"),
    stemsHeld: refuse("stemsHeld"),
    ...over,
  } as Pl8Client;
}

const steps = (pl8: Pl8Client, extra: Record<string, unknown> = {}) => ({
  pl8,
  onPhase: () => {},
  sleep: async () => {},
  ...extra,
});

describe("fetchSong", () => {
  it("copies the master of the song it finds, without hunting", async () => {
    const copyTrack = vi.fn(async () => song());
    const pl8 = fakePl8({
      listSongs: async () => [entry("Nina Simone", "Sinnerman")],
    });
    await fetchSong(song(), steps(pl8, { copyTrack }) as never);
    expect(copyTrack).toHaveBeenCalledWith(
      "songs/Nina Simone/Album/Sinnerman/original.flac",
    );
  });

  it("hunts a song the library does not have, then copies what was filed", async () => {
    const copyTrack = vi.fn(async () => song());
    let filed = false;
    const pl8 = fakePl8({
      listSongs: async () => (filed ? [entry("Nina Simone", "Sinnerman")] : []),
      startHunt: async () => {
        filed = true;
        return hunt({
          status: "done",
          artist: "Nina Simone",
          title: "Sinnerman",
        });
      },
    });
    await fetchSong(song(), steps(pl8, { copyTrack }) as never);
    expect(copyTrack).toHaveBeenCalledTimes(1);
  });

  it("gives Soulseek's own reason when the hunt fails", async () => {
    const pl8 = fakePl8({
      startHunt: async () => hunt({ status: "failed", error: "aucun morceau" }),
    });
    await expect(
      fetchSong(song(), steps(pl8, { copyTrack: async () => song() }) as never),
    ).rejects.toThrow("aucun morceau");
  });

  it("copies nothing when the song already has its track", async () => {
    const copyTrack = vi.fn(async () => song());
    const pl8 = fakePl8({
      listSongs: async () => [entry("Nina Simone", "Sinnerman")],
    });
    await fetchSong(
      song({ audio: { name: "t.flac", mime: "audio/flac" } }),
      steps(pl8, { copyTrack }) as never,
    );
    expect(copyTrack).not.toHaveBeenCalled();
  });

  it("resumes an already-running hunt instead of starting a new one", async () => {
    const copyTrack = vi.fn(async () => song());
    const pl8 = fakePl8({
      listSongs: async () => [entry("Nina Simone", "Sinnerman")],
      hunts: async () => [
        hunt({
          id: "h1",
          status: "done",
          artist: "Nina Simone",
          title: "Sinnerman",
        }),
      ],
      // startHunt is left at fakePl8's default (throws) — resuming must never call it.
    });
    await fetchSong(song(), steps(pl8, { copyTrack }) as never, "h1");
    expect(copyTrack).toHaveBeenCalledTimes(1);
  });
});

describe("makeInstrumental", () => {
  const found = fakePl8({
    listSongs: async () => [entry("Nina Simone", "Sinnerman")],
  });

  it("never hunts: a song the library does not have is refused", async () => {
    await expect(
      makeInstrumental(
        song(),
        steps(fakePl8(), {
          mixInstrumental: async () => song(),
        }) as never,
      ),
    ).rejects.toThrow(/not in pl8's library/);
  });

  it("says so when no engine is online, and mixes nothing", async () => {
    const mixInstrumental = vi.fn(async () => song());
    const outcome = await makeInstrumental(
      song(),
      steps(found, { mixInstrumental }) as never,
    );
    expect(outcome).toMatchObject({ instrumental: false });
    expect(outcome.note).toMatch(/No engine/);
    expect(mixInstrumental).not.toHaveBeenCalled();
  });

  it("mixes the folder once pl8 holds the stems", async () => {
    const mixInstrumental = vi.fn(async () => song());
    const pl8 = fakePl8({
      listSongs: found.listSongs,
      engines: async () => [{ id: "e1" } as never],
      prepareStems: async () => ({ ready: true, job: null }),
    });
    const outcome = await makeInstrumental(
      song(),
      steps(pl8, { mixInstrumental }) as never,
    );
    expect(outcome.instrumental).toBe(true);
    expect(mixInstrumental).toHaveBeenCalledWith(
      "songs/Nina Simone/Album/Sinnerman",
    );
  });

  it("resumes an already-running separation instead of starting a new one", async () => {
    const mixInstrumental = vi.fn(async () => song());
    const pl8 = fakePl8({
      listSongs: found.listSongs,
      separation: async () => ({ failed: false, done: true }) as never,
      // prepareStems is left at fakePl8's default (throws) — resuming must never call it.
    });
    const outcome = await makeInstrumental(
      song(),
      steps(pl8, { mixInstrumental }) as never,
      "j1",
    );
    expect(outcome.instrumental).toBe(true);
    expect(mixInstrumental).toHaveBeenCalledTimes(1);
  });

  it("waits for a running separation, and passes its failure on", async () => {
    const pl8 = fakePl8({
      listSongs: found.listSongs,
      engines: async () => [{ id: "e1" } as never],
      prepareStems: async () => ({
        ready: false,
        job: { id: "j1", percent: null } as never,
      }),
      separation: async () =>
        ({ failed: true, done: false, error: "model missing" }) as never,
    });
    await expect(
      makeInstrumental(
        song(),
        steps(pl8, {
          mixInstrumental: async () => song(),
        }) as never,
      ),
    ).rejects.toThrow("model missing");
  });
});

describe("runPipeline", () => {
  // Instrumental already made, so the pipeline has nothing left but lyrics to try.
  const withTrack = song({
    audio: { name: "t.flac", mime: "audio/flac" },
    instrumental: { name: "i.flac", mime: "audio/flac" },
  });

  it("auto-applies a confident lyrics match once a track exists", async () => {
    const onLrc = vi.fn(async () => withTrack);
    const pl8 = fakePl8({ listSongs: async () => [] });
    const found = await runPipeline(
      withTrack,
      "continue",
      steps(pl8, {
        mixInstrumental: async () => withTrack,
        findLrc: async () => [
          {
            id: 1,
            trackName: "Sinnerman",
            artistName: "Nina Simone",
            albumName: "",
            duration: 0,
            syncedLyrics: "[00:00.00]la la la",
          },
        ],
        onLrc,
      }) as never,
    );
    expect(onLrc).toHaveBeenCalledWith("la la la", [
      { line: 0, text: "la la la", t: 0 },
    ]);
    expect(found).toBe(withTrack);
  });

  it("leaves lyrics unmatched rather than guess, and does not call onLrc", async () => {
    const onLrc = vi.fn(async () => withTrack);
    const onStatus = vi.fn();
    const pl8 = fakePl8({ listSongs: async () => [] });
    await runPipeline(
      withTrack,
      "continue",
      steps(pl8, {
        mixInstrumental: async () => withTrack,
        findLrc: async () => [],
        onLrc,
        onStatus,
      }) as never,
    );
    expect(onLrc).not.toHaveBeenCalled();
    expect(onStatus).toHaveBeenCalledWith({ lyricsMatch: "unmatched" });
  });

  it("never touches lyrics a person already wrote", async () => {
    const findLrc = vi.fn(async () => []);
    const pl8 = fakePl8({ listSongs: async () => [] });
    await runPipeline(
      song({ ...withTrack, lyrics: "already here" }),
      "continue",
      steps(pl8, {
        mixInstrumental: async () => withTrack,
        findLrc,
        onLrc: async () => withTrack,
      }) as never,
    );
    expect(findLrc).not.toHaveBeenCalled();
  });
});
