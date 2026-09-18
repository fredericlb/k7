// run.ts — the two fetches, as resumable steps: the TRACK (pl8's library, hunted on Soulseek when it
// is not there yet) and the INSTRUMENTAL (the same song without its voice, cut on any engine).
// Two verbs because separating borrows a musician's machine — ../../../docs/audio.md.

import type { MediatekEntry } from "@studio/mediatek/types";
import type { HuntRecord } from "@studio/web-protocol/hunt";
import type { Song } from "../types";
import { findLibrarySong, masterPath, songAtPath } from "./match";
import type { Pl8Client } from "./pl8";

const POLL_MS = 2000;

interface Common {
  pl8: Pl8Client;
  /** What the link says it is doing. */
  onPhase(phase: string): void;
  sleep?(ms: number): Promise<void>;
}

export interface FetchSteps extends Common {
  /** Copy a library master in as the song's track. */
  copyTrack(path: string): Promise<void>;
}

export interface InstrumentalSteps extends Common {
  /** Mix the instrumental from a library song folder's stems. */
  mixInstrumental(folder: string): Promise<void>;
}

/** How far the instrumental got: made, or why it stopped short. */
export interface InstrumentalOutcome {
  instrumental: boolean;
  note?: string;
}

const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** The song in pl8's library, or nothing — this never hunts. */
async function inLibrary(
  steps: Common,
  song: Song,
): Promise<MediatekEntry | undefined> {
  steps.onPhase("Looking in the library…");
  return findLibrarySong(await steps.pl8.listSongs(), song.artist, song.title);
}

/** Poll the hunt list until this hunt ends; pl8 has no route for one hunt. */
async function huntEnd(steps: Common, id: string): Promise<HuntRecord> {
  const sleep = steps.sleep ?? wait;
  for (;;) {
    const hunt = (await steps.pl8.hunts()).find((h) => h.id === id);
    if (!hunt)
      throw new Error("The Soulseek search was removed before it finished.");
    if (hunt.status === "done" || hunt.status === "failed") return hunt;
    steps.onPhase(
      hunt.status === "downloading"
        ? "Downloading from Soulseek…"
        : "Searching Soulseek…",
    );
    await sleep(POLL_MS);
  }
}

/** Hunt the song on Soulseek, then find what pl8 filed. */
async function huntIntoLibrary(
  steps: Common,
  song: Song,
): Promise<MediatekEntry> {
  steps.onPhase("Searching Soulseek…");
  const started = await steps.pl8.startHunt(`${song.artist} ${song.title}`);
  const hunt =
    started.status === "done" || started.status === "failed"
      ? started
      : await huntEnd(steps, started.id);
  if (hunt.status === "failed")
    throw new Error(hunt.error || "Soulseek did not find this song.");

  steps.onPhase("Looking in the library…");
  const entries = await steps.pl8.listSongs();
  const landed =
    findLibrarySong(entries, song.artist, song.title) ??
    (hunt.artist && hunt.title
      ? findLibrarySong(entries, hunt.artist, hunt.title)
      : undefined) ??
    songAtPath(entries, hunt.path);
  if (!landed)
    throw new Error(
      "The song was fetched but is not in the library yet — try again in a moment.",
    );
  return landed;
}

/** The song's reference track, out of pl8's library and hunted first if need be. */
export async function fetchSong(song: Song, steps: FetchSteps): Promise<void> {
  const entry =
    (await inLibrary(steps, song)) ?? (await huntIntoLibrary(steps, song));
  if (song.audio) return; // already fetched: the library lookup is the whole of it
  steps.onPhase("Copying the track…");
  await steps.copyTrack(masterPath(entry));
}

/** Wait for pl8 to hold the instrumental of `master`, cutting it on the first engine online. */
async function instrumentalReady(
  steps: Common,
  master: string,
): Promise<boolean> {
  const sleep = steps.sleep ?? wait;
  steps.onPhase("Making the instrumental…");
  const engines = await steps.pl8.engines();
  if (engines.length === 0) return false;
  const reply = await steps.pl8.prepareStems(
    master,
    engines[0].id,
    "instrumental",
  );
  if (reply.ready) return true;
  const id = reply.job?.id;
  if (!id) throw new Error("pl8 did not start the separation.");
  for (;;) {
    await sleep(POLL_MS);
    const job = await steps.pl8.separation(id);
    // Swept after it finished: the disk says whether it worked.
    if (!job) {
      if (await steps.pl8.stemsHeld(master, "instrumental")) return true;
      throw new Error(
        "The separation stopped without leaving an instrumental.",
      );
    }
    if (job.failed) throw new Error(job.error || "The separation failed.");
    if (job.done) return true;
    if (job.percent !== null)
      steps.onPhase(`Making the instrumental… ${Math.round(job.percent)}%`);
  }
}

/** The same song without the voice: an engine's chain writes it beside the master, k7 keeps a copy. */
export async function makeInstrumental(
  song: Song,
  steps: InstrumentalSteps,
): Promise<InstrumentalOutcome> {
  const entry = await inLibrary(steps, song);
  if (!entry)
    throw new Error(
      "This song is not in pl8's library — fetch the song first.",
    );
  if (song.instrumental) return { instrumental: true };

  if (!(await instrumentalReady(steps, masterPath(entry))))
    return {
      instrumental: false,
      note: "No engine is online to make an instrumental — press again once one is.",
    };

  steps.onPhase("Copying the instrumental…");
  await steps.mixInstrumental(entry.path);
  return { instrumental: true };
}
