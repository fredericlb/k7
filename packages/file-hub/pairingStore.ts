// pairingStore.ts — the pairings of this machine's accounts with a remote origin that are under way or just ended,
// kept in one file under the data root: a process killed behind the system browser finds its pairing again, and an
// ending nobody was there to see is still told once the app comes back. The token itself is never kept here.
// See docs/syncRelay.md, "Pairing through the browser".

import { randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/** Where a pairing stands: waiting on the browser, or how it ended. */
export type PairPhase =
  | "waiting"
  | "paired"
  | "alreadyLinked"
  | "otherAccount"
  | "notStored"
  | "expired";

export interface PairRecord {
  /** The nonce the browser's return must carry: the only proof that return is this pairing's. */
  state: string;
  /** The local account whose folder the link is stored in. */
  email: string;
  /** The remote origin, as `normalizeServer` spells it. */
  origin: string;
  main: boolean;
  /** Started to add another account on a server already linked: the server's page lets the person pick one. */
  another?: boolean;
  /** Epoch ms after which a waiting pairing is expired. */
  until: number;
  phase: PairPhase;
  /** The remote account the browser came back signed in as: the link's `as`. */
  browserAs?: string;
  settledAt?: number;
}

/** A pairing left unfinished in the browser stops waiting after this. */
export const PAIR_WAIT_MS = 10 * 60_000;
/** An ending is kept this long for an app that was not running when it came. */
export const PAIR_KEEP_MS = 24 * 3600_000;

const FILE = ".sync-pairing.json";

// `otherAccount` is no ending any more, but a record kept a day may still say it.
const PHASES = new Set<PairPhase>([
  "waiting",
  "paired",
  "alreadyLinked",
  "otherAccount",
  "notStored",
  "expired",
]);

const valid = (r: Partial<PairRecord>): r is PairRecord =>
  typeof r?.state === "string" &&
  typeof r.email === "string" &&
  typeof r.origin === "string" &&
  typeof r.until === "number" &&
  PHASES.has(r.phase as PairPhase);

export class PairingStore {
  private records: PairRecord[];
  private readonly waiters = new Map<string, Set<() => void>>();

  constructor(
    private readonly dir: string,
    private readonly now: () => number = Date.now,
  ) {
    this.records = this.load();
  }

  private get file(): string {
    return join(this.dir, FILE);
  }

  private load(): PairRecord[] {
    try {
      const raw = JSON.parse(readFileSync(this.file, "utf8")) as {
        pairings?: Partial<PairRecord>[];
      };
      return (raw.pairings ?? []).filter(valid).map((r) => ({
        ...r,
        main: r.main !== false,
      }));
    } catch {
      return [];
    }
  }

  // Beside, then renamed over: a kill mid-write must leave the last whole file.
  private save(): void {
    const t = this.now();
    this.records = this.records.filter(
      (r) => (r.settledAt ?? r.until) + PAIR_KEEP_MS > t,
    );
    mkdirSync(this.dir, { recursive: true });
    const tmp = `${this.file}.tmp`;
    writeFileSync(
      tmp,
      `${JSON.stringify({ pairings: this.records }, null, 2)}\n`,
      { mode: 0o600 },
    );
    renameSync(tmp, this.file);
  }

  private notify(state: string): void {
    for (const wake of this.waiters.get(state) ?? []) wake();
    this.waiters.delete(state);
  }

  /** The record as it stands now: a waiting one past its deadline reads as expired. */
  private view(r: PairRecord | undefined): PairRecord | null {
    if (!r) return null;
    return r.phase === "waiting" && this.now() >= r.until
      ? { ...r, phase: "expired" }
      : { ...r };
  }

  /** Start a pairing for `email`, replacing any other of that account: one browser trip at a time. */
  begin(
    email: string,
    origin: string,
    main: boolean,
    another = false,
  ): PairRecord {
    for (const old of this.records.filter((r) => r.email === email))
      this.forget(old.state);
    const record: PairRecord = {
      state: randomBytes(16).toString("base64url"),
      email,
      origin,
      main,
      ...(another ? { another } : {}),
      until: this.now() + PAIR_WAIT_MS,
      phase: "waiting",
    };
    this.records.push(record);
    this.save();
    return { ...record };
  }

  get(state: string): PairRecord | null {
    return this.view(this.records.find((r) => r.state === state));
  }

  /** The account's latest pairing, waiting or ended and not yet forgotten. */
  ofAccount(email: string): PairRecord | null {
    return this.view(this.records.filter((r) => r.email === email).at(-1));
  }

  /** End a waiting pairing; null when it is not waiting any more. */
  settle(
    state: string,
    phase: Exclude<PairPhase, "waiting">,
    browserAs?: string,
  ): PairRecord | null {
    const r = this.records.find((x) => x.state === state);
    if (!r || this.view(r)?.phase !== "waiting") return null;
    r.phase = phase;
    r.settledAt = this.now();
    if (browserAs !== undefined) r.browserAs = browserAs;
    this.save();
    this.notify(state);
    return { ...r };
  }

  /** Drop a pairing: cancelled while waiting, or its ending told; true when there was one. */
  forget(state: string): boolean {
    const before = this.records.length;
    this.records = this.records.filter((r) => r.state !== state);
    if (this.records.length === before) return false;
    this.save();
    this.notify(state);
    return true;
  }

  /** The record once it is no longer waiting, or as it is after `ms`; null when it is gone. */
  async wait(state: string, ms: number): Promise<PairRecord | null> {
    const r = this.get(state);
    if (r?.phase !== "waiting") return r;
    const left = Math.max(0, Math.min(ms, r.until - this.now()));
    await new Promise<void>((resolve) => {
      const set = this.waiters.get(state) ?? new Set();
      const wake = () => {
        clearTimeout(timer);
        set.delete(wake);
        resolve();
      };
      const timer = setTimeout(wake, left);
      set.add(wake);
      this.waiters.set(state, set);
    });
    return this.get(state);
  }
}
