// owners.ts — which ACCOUNT each engine id belongs to, and whom its owner shared it with. The
// first account to open an unowned engine with its token becomes its owner: the relay no longer
// hands that token to anyone who may not use the engine, so holding it means this browser met the
// engine directly. Kept on disk beside the bindings, since a listing lasts 15 s. See docs/ownership.md.

import { loadJson, saveJson } from "./stateFile.ts";

/** The file's name under a host's state dir. */
export const OWNERS_FILE = "engine-owners.json";
/** Past this many owned ids the oldest record goes, so the file cannot grow for ever. */
const MAX_OWNED = 10_000;
/** How many accounts one engine may be shared with. */
export const MAX_SHARED = 50;

export interface Ownership {
  /** The account that enrolled it, spelled as `claimHolder` spells the session. */
  owner: string;
  /** The accounts it is shared with, lowercase emails. */
  shared: string[];
  /** Epoch ms it was enrolled. */
  since: number;
}

/** What an account is to one engine: only the first three may claim it, `unowned` once it proves it reached it. */
export type EngineRole = "owner" | "shared" | "server" | "unowned" | "none";

export interface EngineOwners {
  get(id: string): Ownership | undefined;
  /** Make `owner` the owner of an unowned id; false when the id already has one. */
  enrol(id: string, owner: string): boolean;
  /** Replace the share list of an owned id; false when the id has no owner. */
  share(id: string, emails: string[]): boolean;
  /** Forget the id's owner and its shares; it is unowned again. */
  release(id: string): boolean;
  all(): [string, Ownership][];
}

const EMAIL = /^[^\s@]+@[^\s@]+$/;

/** The account a claim is held under, from the session — the one name every claim and owner check compares against. */
export function claimHolder(req: {
  user?: { email?: string | null; sub?: string | null };
}): string {
  return req.user?.email || req.user?.sub || "";
}

/** The share list as typed, cleaned — trimmed, lowercased, deduplicated — or the first entry that is not an email. */
export function cleanShares(
  raw: readonly string[],
): { ok: true; emails: string[] } | { ok: false; bad: string } {
  const out: string[] = [];
  for (const r of raw) {
    const e = r.trim().toLowerCase();
    if (!e) continue;
    if (e.length > 254 || !EMAIL.test(e)) return { ok: false, bad: r };
    if (!out.includes(e)) out.push(e);
  }
  return { ok: true, emails: out };
}

/** What `holder` is to an engine with record `o`; the server's own engine is everybody's. */
export function roleOf(
  o: Ownership | undefined,
  holder: string,
  server: boolean,
): EngineRole {
  if (server) return "server";
  if (!o) return "unowned";
  if (!holder) return "none";
  if (o.owner === holder) return "owner";
  return o.shared.includes(holder.toLowerCase()) ? "shared" : "none";
}

/** Whether a role may claim the engine and read its token through the relay. */
export const mayUse = (r: EngineRole): boolean =>
  r === "owner" || r === "shared" || r === "server";

/** The owners at `file`, or in memory alone when no file is given (the tests, a host with no state dir). */
export function createOwners(
  file?: string,
  log: (line: string) => void = (l) => console.warn(`[registry] ${l}`),
  now: () => number = Date.now,
): EngineOwners {
  const map = new Map<string, Ownership>(file ? load(file, log) : []);
  const save = (): void => {
    if (file)
      saveJson(
        file,
        { version: 1, engines: Object.fromEntries(map) },
        "engine owners",
        log,
      );
  };

  return {
    get: (id) => map.get(id),
    enrol(id, owner) {
      if (!owner || map.has(id)) return false;
      map.set(id, { owner, shared: [], since: now() });
      if (map.size > MAX_OWNED) {
        const oldest = [...map].sort((x, y) => x[1].since - y[1].since)[0];
        if (oldest) map.delete(oldest[0]);
      }
      log(`engine ${id} enrolled by ${owner}`);
      save();
      return true;
    },
    share(id, emails) {
      const o = map.get(id);
      if (!o) return false;
      o.shared = emails.slice(0, MAX_SHARED);
      save();
      return true;
    },
    release(id) {
      if (!map.delete(id)) return false;
      log(`engine ${id} has no owner any more`);
      save();
      return true;
    },
    all: () => [...map],
  };
}

function load(
  file: string,
  log: (line: string) => void,
): [string, Ownership][] {
  const raw = loadJson(file, "engine owners", log) as
    | { engines?: Record<string, unknown> }
    | undefined;
  const out: [string, Ownership][] = [];
  for (const [id, v] of Object.entries(raw?.engines ?? {})) {
    const o = v as Partial<Ownership>;
    if (typeof o?.owner !== "string" || !o.owner) continue;
    const shared = Array.isArray(o.shared)
      ? o.shared.filter((s): s is string => typeof s === "string")
      : [];
    out.push([
      id,
      {
        owner: o.owner,
        shared,
        since: typeof o.since === "number" ? o.since : 0,
      },
    ]);
  }
  return out;
}
