// owners.ts — which ACCOUNT each engine id belongs to, and whom its owner shared it with. The owner
// is the account the engine's heartbeat PROVES with a device token, never whoever opened it first:
// an open proves only that a browser reached the machine. Kept on disk beside the bindings, since a
// listing lasts 15 s. See docs/ownership.md.

import { isLoopbackAddress } from "@studio/web-protocol/services";
import type { EngineRegistry } from "./registry.ts";
import { loadJson, saveJson } from "./stateFile.ts";

/** The file's name under a host's state dir. */
export const OWNERS_FILE = "engine-owners.json";
/** Past this many owned ids the oldest record goes, so the file cannot grow for ever. */
const MAX_OWNED = 10_000;
/** How many accounts one engine may be shared with. */
export const MAX_SHARED = 50;

export interface Ownership {
  /** The account its heartbeat proves, spelled as `claimHolder` spells the session. */
  owner: string;
  /** The accounts it is shared with, lowercase emails. */
  shared: string[];
  /** Shared with every signed-in account of this server, present and future. */
  everyone: boolean;
  /** Epoch ms this owner was assigned. */
  since: number;
}

/** What an account is to one engine: only the first three may claim it. */
export type EngineRole = "owner" | "shared" | "server" | "unowned" | "none";

export interface EngineOwners {
  get(id: string): Ownership | undefined;
  /** Make `owner` the owner of `id`; `moved` when it took it from another account, whose shares go with it. */
  assign(id: string, owner: string): "same" | "new" | "moved";
  /** Replace the share list of an owned id, and its everyone flag when given; false when the id has no owner. */
  share(id: string, emails: string[], everyone?: boolean): boolean;
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
  return o.everyone || o.shared.includes(holder.toLowerCase())
    ? "shared"
    : "none";
}

/** What `holder` is to engine `id`: the ONE rule the listing, a select and the relay apply — an engine on this backend's own machine is every signed-in account's (docs/ownership.md). */
export function engineRole(
  reg: EngineRegistry,
  id: string,
  holder: string,
  server: boolean,
): EngineRole {
  if (holder && isLoopbackAddress(reg.get(id)?.publicIpHint)) return "owner";
  return roleOf(reg.owners.get(id), holder, server);
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
    assign(id, owner) {
      const was = map.get(id)?.owner;
      if (was === owner) return "same";
      map.set(id, { owner, shared: [], everyone: false, since: now() });
      if (map.size > MAX_OWNED) {
        const oldest = [...map].sort((x, y) => x[1].since - y[1].since)[0];
        if (oldest) map.delete(oldest[0]);
      }
      log(
        was
          ? `engine ${id} moved from ${was} to ${owner}, its heartbeat proving it`
          : `engine ${id} is ${owner}'s, its heartbeat proving it`,
      );
      save();
      return was ? "moved" : "new";
    },
    share(id, emails, everyone) {
      const o = map.get(id);
      if (!o) return false;
      o.shared = emails.slice(0, MAX_SHARED);
      if (everyone !== undefined) o.everyone = everyone;
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
        everyone: o.everyone === true,
        since: typeof o.since === "number" ? o.since : 0,
      },
    ]);
  }
  return out;
}
