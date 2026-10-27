// instrumental.ts — a library song's instrumental, as the mini player's button sees it: there, being
// cut, or absent. One store for the page, keyed by the song's master, so a cut keeps being followed
// while the bar shows another song or none. The cut is the server's (`/api/stems`), and lands where
// the songbook's does: `stems/instrumental.wav` beside the master (../../docs/miniPlayer.md).

import type { MediatekEntry } from "@studio/mediatek/types";
import type { SeparateJob, StemsReply } from "@studio/web-protocol";
import { library, NoCutter, stems } from "../api";
import { type PollOptions, poll } from "../poll";

/** The version name an instrumental plays under — what the bar shows beside the title. */
export const INSTRUMENTAL_VERSION = "instrumental";

/** Where a cut instrumental is written, beside the master (packages/song-schema's stems.ts). */
const CUT_FILE = "stems/instrumental.wav";

/** How often a running cut is asked about; a cut lasts minutes, a percent a few seconds. */
const POLL_MS = 1500;

export type InstrumentalState =
  /** Not asked yet. */
  | { kind: "unknown" }
  /** None, and none being made: the button offers to make one. */
  | { kind: "absent" }
  | { kind: "ready"; path: string }
  /** Being cut; `percent` 0..100, null while the cut cannot say. */
  | { kind: "making"; percent: number | null }
  /** The cut failed, or could not start: `noEngine` when no machine was there to cut it. */
  | { kind: "failed"; error: string; noEngine: boolean };

/** The one "not asked yet": a subscriber is handed the SAME object until something changes. */
export const UNKNOWN: InstrumentalState = Object.freeze({ kind: "unknown" });

/** The master's library path, for a library SONG with one — the only thing a cut can start from. */
export function masterOf(entry: MediatekEntry): string | null {
  const master = entry.meta?.master;
  return entry.family === "songs" && typeof master === "string" && master
    ? `${entry.path}/${master}`
    : null;
}

/** An instrumental the song DECLARES, a variant of that name whose file is there — preferred over a cut. */
export function declaredInstrumental(entry: MediatekEntry): string | null {
  const v = entry.variants?.find(
    (x) => x.name.toLowerCase() === INSTRUMENTAL_VERSION && x.kind === "file",
  );
  return v ? `${entry.path}/${v.ref}` : null;
}

/** What the store asks of the server; injected, so a test never needs one. */
export interface InstrumentalClient {
  held: (master: string) => Promise<StemsReply>;
  make: (master: string) => Promise<StemsReply>;
  job: (id: string) => Promise<SeparateJob | null>;
  /** Tell the songbook too, when the song is one of its own. */
  recorded: (entry: MediatekEntry, path: string) => Promise<unknown>;
  /** A refusal that means "no engine to cut on". */
  isNoEngine: (e: unknown) => boolean;
}

export class InstrumentalStore {
  private states = new Map<string, InstrumentalState>();
  private listeners = new Set<() => void>();
  private following = new Set<string>();
  // The cuts asked for HERE: the one that lands on the song still playing switches to it, once.
  private asked = new Set<string>();

  constructor(
    private client: InstrumentalClient,
    private every: (
      tick: () => unknown,
      ms: number,
      opts?: PollOptions,
    ) => () => void = poll,
  ) {}

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  };

  get = (master: string): InstrumentalState =>
    this.states.get(master) ?? UNKNOWN;

  private set(master: string, state: InstrumentalState): void {
    this.states.set(master, state);
    for (const fn of this.listeners) fn();
  }

  /** Learn where a song's instrumental stands, once: declared, cut, being cut, or absent. */
  async check(entry: MediatekEntry): Promise<void> {
    const master = masterOf(entry);
    if (!master || this.get(master).kind !== "unknown") return;
    const declared = declaredInstrumental(entry);
    if (declared) return this.set(master, { kind: "ready", path: declared });
    this.set(master, { kind: "absent" });
    try {
      const reply = await this.client.held(master);
      if (reply.ready)
        this.set(master, { kind: "ready", path: `${entry.path}/${CUT_FILE}` });
      else if (reply.job) this.follow(entry, master, reply.job);
    } catch {
      // Unreadable now: the song simply offers to make one, and making one asks again.
    }
  }

  /** Make the instrumental: start the cut, or join the one running, and follow it to the end. */
  async make(entry: MediatekEntry): Promise<void> {
    const master = masterOf(entry);
    if (!master) return;
    this.asked.add(master);
    this.set(master, { kind: "making", percent: null });
    try {
      const reply = await this.client.make(master);
      if (reply.ready) this.done(entry, master);
      else if (reply.job) this.follow(entry, master, reply.job);
    } catch (e) {
      this.set(master, {
        kind: "failed",
        error: (e as Error).message,
        noEngine: this.client.isNoEngine(e),
      });
    }
  }

  /** Was this song's cut asked for here, and has it just landed? True once — the switch it calls for. */
  takeLanded(master: string): boolean {
    if (this.get(master).kind !== "ready" || !this.asked.has(master))
      return false;
    this.asked.delete(master);
    return true;
  }

  private follow(entry: MediatekEntry, master: string, first: SeparateJob) {
    this.set(master, { kind: "making", percent: first.percent });
    if (this.following.has(master)) return;
    this.following.add(master);
    const stop = this.every(
      async () => {
        const job = await this.client.job(first.id);
        let over = true;
        if (!job) {
          // Forgotten once finished: the disk says how it ended.
          const held = await this.client.held(master).catch(() => null);
          if (held?.ready) this.done(entry, master);
          else this.failed(master, "");
        } else if (job.failed) this.failed(master, job.error ?? "");
        else if (job.done) this.done(entry, master);
        else {
          over = false;
          this.set(master, { kind: "making", percent: job.percent });
        }
        if (over) {
          this.following.delete(master);
          stop();
        }
      },
      POLL_MS,
      // A cut finishing while the tab is hidden still switches the song it was made for.
      { whileHidden: true },
    );
  }

  private failed(master: string, error: string) {
    this.asked.delete(master);
    this.set(master, { kind: "failed", error, noEngine: false });
  }

  private done(entry: MediatekEntry, master: string) {
    const path = `${entry.path}/${CUT_FILE}`;
    this.set(master, { kind: "ready", path });
    void this.client.recorded(entry, path).catch(() => {});
  }
}

/** The page's one store: it outlives the bar, which comes and goes with what plays. */
export const instrumentals = new InstrumentalStore({
  held: stems.held,
  make: stems.instrumental,
  job: stems.job,
  // A songbook song plays the same instrumental in rehearsal: its fact names it.
  recorded: (entry, path) => {
    const id = entry.meta?.uuid;
    return typeof id === "string" && id
      ? library.patchSongbook(id, { instrumental: path })
      : Promise.resolve();
  },
  isNoEngine: (e) => e instanceof NoCutter,
});
