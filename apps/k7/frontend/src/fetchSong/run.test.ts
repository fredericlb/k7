// The two fetches against a pl8 that answers from a script: what each step does, and what it refuses.

import type { MediatekEntry } from "@studio/mediatek/types";
import type { HuntRecord } from "@studio/web-protocol/hunt";
import { describe, expect, it, vi } from "vitest";
import type { Song } from "../types";
import type { Pl8Client } from "./pl8";
import { fetchSong, makeInstrumental, runPipeline, syncLyrics } from "./run";

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
    fetchIgnored: false,
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
    // MusicBrainz names the song asked for, unless a test says otherwise.
    identify: async () => ({
      artist: "Nina Simone",
      title: "Sinnerman",
      album: null,
      date: null,
    }),
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

  it("downloads nothing when MusicBrainz names another song, and says which", async () => {
    // « Expedition 33 Lumières » was identified as the band Lumières' « Momentary », and hunted.
    const startHunt = vi.fn();
    const pl8 = fakePl8({
      identify: async () => ({
        artist: "Lumières",
        title: "Momentary",
        album: "Intervention Armée",
        date: null,
      }),
      startHunt,
    });
    await expect(
      fetchSong(
        song({ artist: "Expedition 33", title: "Lumières" }),
        steps(pl8, { copyTrack: async () => song() }) as never,
      ),
    ).rejects.toThrow(/Lumières – Momentary/);
    expect(startHunt).not.toHaveBeenCalled();
  });

  it("downloads nothing when nothing is identified at all", async () => {
    const startHunt = vi.fn();
    const pl8 = fakePl8({ identify: async () => null, startHunt });
    await expect(
      fetchSong(song(), steps(pl8, { copyTrack: async () => song() }) as never),
    ).rejects.toThrow(/Nina Simone Sinnerman/);
    expect(startHunt).not.toHaveBeenCalled();
  });

  it("hunts exactly the recording it checked, a typo away from the song", async () => {
    const startHunt = vi.fn(async () => hunt({ status: "failed", error: "x" }));
    const tags = {
      artist: "José González",
      title: "Heartbeats",
      album: "Veneer",
      date: null,
    };
    const pl8 = fakePl8({ identify: async () => tags, startHunt });
    await fetchSong(
      song({ artist: "José Gonzales", title: "Heartbeats" }),
      steps(pl8, { copyTrack: async () => song() }) as never,
    ).catch(() => {});
    expect(startHunt).toHaveBeenCalledWith("José Gonzales Heartbeats", tags);
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
      song({
        audio: {
          name: "t.flac",
          mime: "audio/flac",
          path: "songs/Nina Simone/Pastel Blues/Sinnerman/original.flac",
        },
      }),
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
  const found = fakePl8();
  // A song links a track of pl8's library: that recording is what its stems are cut from.
  const linked = () =>
    song({
      audio: {
        name: "t",
        mime: "audio/flac",
        path: "songs/Nina Simone/Album/Sinnerman/original.flac",
      },
    });

  it("never hunts: a song with no library track is refused", async () => {
    await expect(
      makeInstrumental(
        song(),
        steps(fakePl8(), {
          mixInstrumental: async () => song(),
        }) as never,
      ),
    ).rejects.toThrow(/no track from pl8's library/);
  });

  it("says so when no engine is online, and mixes nothing", async () => {
    const mixInstrumental = vi.fn(async () => song());
    const outcome = await makeInstrumental(
      linked(),
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
      linked(),
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
      linked(),
      steps(pl8, { mixInstrumental }) as never,
      "j1",
    );
    expect(outcome.instrumental).toBe(true);
    expect(mixInstrumental).toHaveBeenCalledTimes(1);
  });

  it("cuts the stems of the recording the song links, without looking it up by name", async () => {
    // The library's same-named song can be another take (a live one): the linked file is what plays.
    const mixInstrumental = vi.fn(async () => song());
    const prepareStems = vi.fn(async () => ({ ready: true, job: null }));
    const listSongs = vi.fn(async () => [entry("Nina Simone", "Sinnerman")]);
    const linked = "songs/Nina Simone/Pastel Blues/Sinnerman/original.flac";
    await makeInstrumental(
      song({ audio: { name: "t", mime: "audio/flac", path: linked } }),
      steps(
        fakePl8({
          listSongs,
          engines: async () => [{ id: "e1" } as never],
          prepareStems,
        }),
        { mixInstrumental },
      ) as never,
    );
    expect(listSongs).not.toHaveBeenCalled();
    expect(prepareStems).toHaveBeenCalledWith(linked, "e1", expect.anything());
    expect(mixInstrumental).toHaveBeenCalledWith(
      "songs/Nina Simone/Pastel Blues/Sinnerman",
    );
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
        linked(),
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
    audio: {
      name: "t.flac",
      mime: "audio/flac",
      path: "songs/Nina Simone/Pastel Blues/Sinnerman/original.flac",
    },
    instrumental: {
      name: "i.flac",
      mime: "audio/flac",
      path: "songs/Nina Simone/Pastel Blues/Sinnerman/stems/instrumental.wav",
    },
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
    // No lyrics yet: the fetched line becomes them, its time written in as `{{MM:SS.cc}}`.
    expect(onLrc).toHaveBeenCalledWith("{{00:00.00}} la la la");
    expect(found).toEqual({ ...withTrack, lyricsMatch: "matched" });
  });

  // A track, but no instrumental yet: stems are still to make.
  // A library track and no instrumental: the stems step starts by asking pl8 for an engine.
  const noStems = song({
    audio: {
      name: "t.flac",
      mime: "audio/flac",
      path: "songs/Nina Simone/Album/Sinnerman/original.flac",
    },
  });
  const lrc = (over: Record<string, unknown> = {}) => ({
    id: 1,
    trackName: "Sinnerman",
    artistName: "Nina Simone",
    albumName: "",
    duration: 0,
    syncedLyrics: "[00:12.50]Oh sinnerman",
    instrumental: false,
    ...over,
  });

  it("makes no stems for a song LRCLIB lists as instrumental", async () => {
    const engines = vi.fn(async () => []);
    const onStatus = vi.fn();
    const found = await runPipeline(
      noStems,
      "continue",
      steps(fakePl8({ engines }), {
        findLrc: async () => [lrc({ instrumental: true, syncedLyrics: "" })],
        onLrc: async () => noStems,
        onStatus,
      }) as never,
    );
    expect(found.lyricsMatch).toBe("instrumental");
    expect(onStatus).toHaveBeenCalledWith({ lyricsMatch: "instrumental" });
    // The stems step starts by asking pl8 for an engine: it never got there.
    expect(engines).not.toHaveBeenCalled();
  });

  it("looks for lyrics before making stems", async () => {
    const order: string[] = [];
    await runPipeline(
      noStems,
      "continue",
      steps(
        fakePl8({
          engines: async () => {
            order.push("stems");
            return [];
          },
        }),
        {
          findLrc: async () => {
            order.push("lyrics");
            return [lrc()];
          },
          onLrc: async () => noStems,
        },
      ) as never,
    );
    expect(order).toEqual(["lyrics", "stems"]);
  });

  it("still makes stems when LRCLIB cannot be reached", async () => {
    const engines = vi.fn(async () => []);
    await runPipeline(
      noStems,
      "continue",
      steps(fakePl8({ engines }), {
        findLrc: async () => {
          throw new Error("LRCLIB is down");
        },
        onLrc: async () => noStems,
      }) as never,
    );
    expect(engines).toHaveBeenCalled();
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

  it("times a sheet a person wrote, changing not a word of it", async () => {
    // The fetched lyrics only bring TIMES: the sheet keeps its own spelling ("sinerman"), its chords and its sections.
    const onLrc = vi.fn(async () => withTrack);
    const onStatus = vi.fn();
    await runPipeline(
      song({ ...withTrack, lyrics: "[Verse]\nC\nOh sinerman" }),
      "continue",
      steps(fakePl8(), {
        findLrc: async () => [
          {
            id: 1,
            trackName: "Sinnerman",
            artistName: "Nina Simone",
            albumName: "",
            duration: 0,
            syncedLyrics: "[00:12.50]Oh sinnerman",
          },
        ],
        onLrc,
        onStatus,
      }) as never,
    );
    expect(onLrc).toHaveBeenCalledWith("[Verse]\nC\n{{00:12.50}} Oh sinerman");
    expect(onStatus).toHaveBeenCalledWith({ lyricsMatch: "matched" });
  });

  it("leaves the sheet alone, and says so, when LRCLIB has no version of this song", async () => {
    // Another song's times are never written in: « unmatched » is what the insert then says.
    const onLrc = vi.fn(async () => withTrack);
    const onStatus = vi.fn();
    await runPipeline(
      song({ ...withTrack, lyrics: "[Verse]\nC\nOh sinnerman" }),
      "continue",
      steps(fakePl8(), {
        findLrc: async () => [
          {
            id: 1,
            trackName: "Feeling Good",
            artistName: "Nina Simone",
            albumName: "",
            duration: 0,
            syncedLyrics: "[00:01.00]Birds flying high",
          },
        ],
        onLrc,
        onStatus,
      }) as never,
    );
    expect(onLrc).not.toHaveBeenCalled();
    expect(onStatus).toHaveBeenCalledWith({ lyricsMatch: "unmatched" });
  });

  it("says nothing about lyrics that are already timed", async () => {
    const onStatus = vi.fn();
    await runPipeline(
      song({
        ...withTrack,
        lyrics: "la la la",
        lyricTimings: [{ line: 0, text: "la la la", t: 0 }],
      }),
      "continue",
      steps(fakePl8(), { findLrc: vi.fn(), onStatus }) as never,
    );
    expect(onStatus).not.toHaveBeenCalledWith(
      expect.objectContaining({ lyricsMatch: expect.anything() }),
    );
  });

  it("reports no engine online as a stored failure, after still trying lyrics", async () => {
    const onStatus = vi.fn();
    const findLrc = vi.fn(async () => []);
    const pl8 = fakePl8({
      listSongs: async () => [entry("Nina Simone", "Sinnerman")],
      engines: async () => [],
    });
    await runPipeline(
      song({ ...withTrack, instrumental: null }),
      "continue",
      steps(pl8, {
        mixInstrumental: async () => withTrack,
        findLrc,
        onLrc: async () => withTrack,
        onStatus,
      }) as never,
    );
    expect(findLrc).toHaveBeenCalled();
    expect(onStatus).toHaveBeenLastCalledWith(
      expect.objectContaining({
        phase: "failed",
        error: expect.stringMatching(/engine/i),
      }),
    );
  });

  it("starts a fresh hunt on a re-run rather than resuming the stored one", async () => {
    const startHunt = vi.fn(async () =>
      hunt({ id: "h2", status: "done", path: "" }),
    );
    let listed = 0;
    const pl8 = fakePl8({
      // Not in the library before the hunt, filed once it is done.
      listSongs: async () =>
        listed++ === 0 ? [] : [entry("Nina Simone", "Sinnerman")],
      startHunt,
    });
    const copied = song({ ...withTrack });
    await runPipeline(
      song({
        fetchStatus: {
          phase: "failed",
          progress: null,
          error: "gone",
          huntId: "h1",
          jobId: "",
        },
      }),
      "download",
      steps(pl8, {
        copyTrack: async () => copied,
        mixInstrumental: async () => copied,
        findLrc: async () => [],
        onLrc: async () => copied,
      }) as never,
    );
    expect(startHunt).toHaveBeenCalled();
  });

  it("never touches lyrics that are already timed", async () => {
    // Untimed ones get the fetched lyrics merged in; timed ones have had their LRC already.
    const findLrc = vi.fn(async () => []);
    const pl8 = fakePl8({ listSongs: async () => [] });
    await runPipeline(
      song({
        ...withTrack,
        lyrics: "already here",
        lyricTimings: [{ line: 0, text: "already here", t: 0 }],
      }),
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

describe("syncLyrics", () => {
  it("times lyrics that are already timed, the old codes replaced", async () => {
    // What « Resync lyrics » runs: the pipeline would skip these lyrics, this does not.
    const onLrc = vi.fn(async () => song());
    await syncLyrics(song({ lyrics: "Oh sinerman {{00:03}}" }), {
      onPhase: () => {},
      findLrc: async () => [
        {
          id: 1,
          trackName: "Sinnerman",
          artistName: "Nina Simone",
          albumName: "",
          duration: 0,
          syncedLyrics: "[00:12.50]Oh sinnerman",
          instrumental: false,
        },
      ],
      onLrc,
    });
    expect(onLrc).toHaveBeenCalledWith("{{00:12.50}} Oh sinerman");
  });

  it("skips a first answer credited to someone else, and times with the next one that is this song", async () => {
    // LRCLIB's first answer for Oasis was credited « Oasis/oasis »: the song was left unmatched.
    const onLrc = vi.fn(async () => song());
    const onStatus = vi.fn();
    const oasis = song({
      artist: "Oasis",
      title: "Don't look back in anger",
      lyrics: "Slip inside the eye of your mind",
    });
    const candidate = (id: number, artistName: string) => ({
      id,
      trackName: "Don't Look Back In Anger",
      artistName,
      albumName: "",
      duration: 290,
      syncedLyrics: "[00:11.95]Slip inside the eye of your mind",
      instrumental: false,
    });
    await syncLyrics(oasis, {
      onPhase: () => {},
      findLrc: async () => [candidate(1, "Oasis/oasis"), candidate(2, "Oasis")],
      onLrc,
      onStatus,
    });
    expect(onLrc).toHaveBeenCalledWith(
      "{{00:11.95}} Slip inside the eye of your mind",
    );
    expect(onStatus).toHaveBeenCalledWith({ lyricsMatch: "matched" });
  });
});
