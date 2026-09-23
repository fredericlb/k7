// run.ts — the two fetches, as resumable steps: the TRACK (pl8's library, hunted on Soulseek when it
// is not there yet) and the INSTRUMENTAL (the same song without its voice, cut on any engine).
// Two verbs because separating borrows a musician's machine — ../../../docs/audio.md.

import { importLrc } from "@k7/lyrics";
import type { MediatekEntry } from "@studio/mediatek/types";
import type { HuntRecord } from "@studio/web-protocol/hunt";
import { m } from "../paraglide/messages.js";
import type { FetchStatus, LrcCandidate, LyricTiming, Song } from "../types";
import { findLibrarySong, masterPath, matches, songAtPath } from "./match";
import type { Pl8Client } from "./pl8";

const POLL_MS = 2000;

/** What `onStatus` persists — `fetchStatus`'s own fields, plus the sibling `lyricsMatch`
 * field the backend's PATCH body carries beside it (see store.ts's updateSong). */
export interface StatusPatch extends Partial<FetchStatus> {
  lyricsMatch?: "" | "matched" | "unmatched";
}

interface Common {
  pl8: Pl8Client;
  /** What the link says it is doing. */
  onPhase(phase: string): void;
  /** Persists a piece of status, so a reload finds the pipeline where it left off. */
  onStatus?(patch: StatusPatch): void;
  sleep?(ms: number): Promise<void>;
}

export interface FetchSteps extends Common {
  /** Copy a library master in as the song's track; returns the song as k7 now has it. */
  copyTrack(path: string): Promise<Song>;
}

export interface InstrumentalSteps extends Common {
  /** Mix the instrumental from a library song folder's stems; returns the song as k7 now has it. */
  mixInstrumental(folder: string): Promise<Song>;
}

/** How far the instrumental got: made, or why it stopped short. */
export interface InstrumentalOutcome {
  instrumental: boolean;
  note?: string;
  /** The song as k7 now has it, present when a mix actually happened. */
  song?: Song;
}

const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** The song in pl8's library, or nothing — this never hunts. */
async function inLibrary(
  steps: Common,
  song: Song,
): Promise<MediatekEntry | undefined> {
  steps.onPhase(m["fetch.library"]());
  return findLibrarySong(await steps.pl8.listSongs(), song.artist, song.title);
}

/** Poll the hunt list until this hunt ends; pl8 has no route for one hunt. */
async function huntEnd(steps: Common, id: string): Promise<HuntRecord> {
  const sleep = steps.sleep ?? wait;
  for (;;) {
    const hunt = (await steps.pl8.hunts()).find((h) => h.id === id);
    if (!hunt) throw new Error(m["fetch.huntRemoved"]());
    if (hunt.status === "done" || hunt.status === "failed") return hunt;
    const phase = hunt.status === "downloading" ? "downloading" : "searching";
    steps.onPhase(
      phase === "downloading"
        ? m["fetch.downloading"]()
        : m["fetch.searching"](),
    );
    steps.onStatus?.({ phase, huntId: id });
    await sleep(POLL_MS);
  }
}

/** Hunt the song on Soulseek, then find what pl8 filed. `resumeHuntId` skips straight to
 * polling an already-running hunt — a reload picking the pipeline back up. */
async function huntIntoLibrary(
  steps: Common,
  song: Song,
  resumeHuntId?: string,
): Promise<MediatekEntry> {
  let hunt: HuntRecord;
  if (resumeHuntId) {
    hunt = await huntEnd(steps, resumeHuntId);
  } else {
    steps.onPhase(m["fetch.searching"]());
    steps.onStatus?.({ phase: "searching" });
    const started = await steps.pl8.startHunt(`${song.artist} ${song.title}`);
    steps.onStatus?.({ huntId: started.id });
    hunt =
      started.status === "done" || started.status === "failed"
        ? started
        : await huntEnd(steps, started.id);
  }
  if (hunt.status === "failed")
    throw new Error(hunt.error || m["fetch.notFound"]());

  steps.onPhase(m["fetch.library"]());
  const entries = await steps.pl8.listSongs();
  const landed =
    findLibrarySong(entries, song.artist, song.title) ??
    (hunt.artist && hunt.title
      ? findLibrarySong(entries, hunt.artist, hunt.title)
      : undefined) ??
    songAtPath(entries, hunt.path);
  if (!landed) throw new Error(m["fetch.notFiledYet"]());
  return landed;
}

/** The song's reference track, out of pl8's library and hunted first if need be. */
export async function fetchSong(
  song: Song,
  steps: FetchSteps,
  resumeHuntId?: string,
): Promise<Song> {
  const entry =
    (await inLibrary(steps, song)) ??
    (await huntIntoLibrary(steps, song, resumeHuntId));
  if (song.audio) return song; // already fetched: the library lookup is the whole of it
  steps.onPhase(m["fetch.copyTrack"]());
  return steps.copyTrack(masterPath(entry));
}

/** Wait for pl8 to hold the instrumental of `master`, cutting it on the first engine online.
 * `resumeJobId` skips straight to polling an already-running separation. */
async function instrumentalReady(
  steps: Common,
  master: string,
  resumeJobId?: string,
): Promise<boolean> {
  const sleep = steps.sleep ?? wait;
  steps.onPhase(m["fetch.stemming"]());
  steps.onStatus?.({ phase: "stemming" });
  let id = resumeJobId;
  if (!id) {
    const engines = await steps.pl8.engines();
    if (engines.length === 0) return false;
    const reply = await steps.pl8.prepareStems(
      master,
      engines[0].id,
      "instrumental",
    );
    if (reply.ready) return true;
    id = reply.job?.id;
    if (!id) throw new Error(m["fetch.noSeparation"]());
    steps.onStatus?.({ jobId: id });
  }
  for (;;) {
    await sleep(POLL_MS);
    const job = await steps.pl8.separation(id);
    // Swept after it finished: the disk says whether it worked.
    if (!job) {
      if (await steps.pl8.stemsHeld(master, "instrumental")) return true;
      throw new Error(m["fetch.noInstrumental"]());
    }
    if (job.failed) throw new Error(job.error || m["fetch.separationFailed"]());
    if (job.done) return true;
    if (job.percent !== null) {
      steps.onPhase(
        m["fetch.stemmingPercent"]({ percent: Math.round(job.percent) }),
      );
      steps.onStatus?.({ phase: "stemming", progress: job.percent });
    }
  }
}

/** The same song without the voice: an engine's chain writes it beside the master, k7 keeps a copy. */
export async function makeInstrumental(
  song: Song,
  steps: InstrumentalSteps,
  resumeJobId?: string,
): Promise<InstrumentalOutcome> {
  const entry = await inLibrary(steps, song);
  if (!entry) throw new Error(m["fetch.notInLibrary"]());
  if (song.instrumental) return { instrumental: true };

  if (!(await instrumentalReady(steps, masterPath(entry), resumeJobId)))
    return {
      instrumental: false,
      note: m["fetch.noEngine"](),
    };

  steps.onPhase(m["fetch.copyInstrumental"]());
  const updated = await steps.mixInstrumental(entry.path);
  return { instrumental: true, song: updated };
}

export interface PipelineSteps extends Common {
  copyTrack(path: string): Promise<Song>;
  mixInstrumental(folder: string): Promise<Song>;
  findLrc(duration?: number): Promise<LrcCandidate[]>;
  onLrc(lyrics: string, timings: LyricTiming[]): Promise<Song>;
}

/** A fresh start on `"download"` (the insert's button, or the ⋮ menu's re-run), or picking back
 * up wherever `song` says the pipeline got to on `"continue"` — a reload, or an upload. */
export type PipelineMode = "download" | "continue";

/** The whole chain a track goes through once it exists: search → download → stem → find
 * lyrics. Every step reads the song its own predecessor returned, so a reload can resume
 * from `song.fetchStatus`/`song.lyricsMatch` alone rather than losing the thread — see
 * ../../docs/audio.md. */
export async function runPipeline(
  song: Song,
  mode: PipelineMode,
  steps: PipelineSteps,
): Promise<Song> {
  let current = song;
  // A fresh start never resumes a stored hunt or job: it may be the very one that failed.
  const resume = mode === "continue";
  // What went wrong without stopping the chain, left on the song as the run's outcome.
  let problem = "";

  if (!current.audio) {
    if (resume && !current.fetchStatus.huntId) return current;
    current = await fetchSong(
      current,
      steps,
      (resume && current.fetchStatus.huntId) || undefined,
    );
  }

  if (current.audio && !current.instrumental) {
    const outcome = await makeInstrumental(
      current,
      steps,
      (resume && current.fetchStatus.jobId) || undefined,
    );
    // No engine online does not stop the chain on its way to lyrics, but it is reported.
    if (outcome.song) current = outcome.song;
    if (outcome.note) problem = outcome.note;
  }

  // Lyrics already there are a person's own — the pipeline never overwrites them; pairing an
  // LRC against existing text needs the manual TimedLyricsDialog, not an automatic guess.
  if (
    current.audio &&
    current.lyricsMatch === "" &&
    current.lyrics.trim() === ""
  ) {
    steps.onPhase(m["fetch.lyrics"]());
    steps.onStatus?.({ phase: "matching-lyrics" });
    const best = (await steps.findLrc())[0];
    const found =
      best &&
      matches(current.artist, current.title, best.artistName, best.trackName)
        ? importLrc("", best.syncedLyrics)
        : null;
    if (found?.ok && found.lyrics !== null) {
      current = await steps.onLrc(found.lyrics, found.timings);
      steps.onStatus?.({ lyricsMatch: "matched" });
    } else {
      steps.onStatus?.({ lyricsMatch: "unmatched" });
    }
  }

  steps.onStatus?.({
    phase: problem ? "failed" : "",
    error: problem,
    progress: null,
    huntId: "",
    jobId: "",
  });
  return current;
}
