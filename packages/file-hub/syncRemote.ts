// syncRemote.ts — the servers an account of a machine's hub has SAVED: each LINK is one account on one server (`as`),
// with the device token that server minted. Exactly one link is ACTIVE, and it is the only one anything talks to:
// sync, the libraries, the remote surfaces, the engine. The others wait, their workspaces hidden on disk.
// Per local account, since a desktop's hub also serves its local user. See docs/syncRelay.md.

import { createHash } from "node:crypto";
import { readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { currentStudioUrl } from "@studio/web-protocol/services";

/** One link: the remote relay's socket URL, the device token, the remote account (`as`), the local owner (`user`). */
export interface SyncRemote {
  /** Stable, derived from the relay's host and `as`: what a workspace's record and the pages name a link by. */
  id: string;
  /** The server as a page names it: `https://app.k7.rocks`. */
  origin: string;
  url: string;
  token: string;
  /** The local account whose folder holds this link. */
  user: string;
  /** The account on the remote server the token was minted for. */
  as: string;
  /** The one link in use: `active` in the file, where `main` reads the same. */
  active: boolean;
}

/** What a caller writes: the id and origin are derived from the url and `as`, and what is written is active. */
export type SyncRemoteInput = Omit<
  SyncRemote,
  "id" | "origin" | "as" | "active"
> & {
  as?: string;
};

const FILE = ".sync-remote.json";

/** The relay's host, which with `as` is what makes two links the same. */
export const serverHost = (url: string): string => {
  try {
    return new URL(currentStudioUrl(url)).host;
  } catch {
    return url;
  }
};

/** A link's id: the first 10 hex of sha256(host, as) — stable across restarts and re-pairings. */
export const linkId = (url: string, as: string): string =>
  createHash("sha256")
    .update(`${serverHost(url)}\n${as}`)
    .digest("hex")
    .slice(0, 10);

/** The server a relay URL belongs to, as an https origin: `wss://app.k7.rocks/api/sync` → `https://app.k7.rocks`. */
export function originOfRelay(url: string): string {
  try {
    const u = new URL(url);
    return `${u.protocol === "ws:" ? "http:" : "https:"}//${u.host}`;
  } catch {
    return "";
  }
}

/** Exactly one active among `list`: the one marked, else the first. */
function oneActive<T extends { active: boolean }>(list: T[]): T[] {
  const at = Math.max(
    0,
    list.findIndex((r) => r.active),
  );
  return list.map((r, i) => ({ ...r, active: i === at }));
}

/** Every saved link of the account folder `home`, the active one first; empty when none is saved. */
export function readRemotes(home: string): SyncRemote[] {
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(join(home, FILE), "utf8"));
  } catch {
    return [];
  }
  // A file holding one pairing, not a list, is that pairing, active.
  type Stored = Partial<SyncRemote> & { main?: boolean };
  const items = Array.isArray((raw as { servers?: unknown })?.servers)
    ? ((raw as { servers: unknown[] }).servers as Stored[])
    : [{ ...(raw as Stored), active: true }];
  const list = items.flatMap((v): SyncRemote[] => {
    if (!v?.url || !v.token || !v.user) return [];
    // A pairing made under a former host relays through its successor: the token is the same backend's.
    const url = currentStudioUrl(v.url);
    // A link from before accounts is the local account's own on that server.
    const as = typeof v.as === "string" && v.as ? v.as : v.user;
    return [
      {
        id: linkId(url, as),
        origin: originOfRelay(url),
        url,
        token: v.token,
        user: v.user,
        as,
        active: (v.active ?? v.main) === true,
      },
    ];
  });
  return oneActive(list).sort((a, b) => Number(b.active) - Number(a.active));
}

/** The ACTIVE link of `home`, or null when no server is saved. */
export function readRemote(home: string): SyncRemote | null {
  return readRemotes(home)[0] ?? null;
}

/** The link `ref` names: its id, else the first link on that server's host (the active one when it is there). */
export function findRemote(
  list: SyncRemote[],
  ref: string,
): SyncRemote | undefined {
  return (
    list.find((r) => r.id === ref) ??
    list.find((r) => serverHost(r.url) === serverHost(ref))
  );
}

/** The link to the server at `url` as the remote account `as`, if there is one. */
export const linkOf = (
  list: SyncRemote[],
  url: string,
  as: string,
): SyncRemote | undefined => list.find((r) => r.id === linkId(url, as));

function save(home: string, list: SyncRemote[]): void {
  const at = join(home, FILE);
  if (!list.length) {
    rmSync(at, { force: true });
    return;
  }
  // The id and origin are derived on read, so a stale copy of them can never disagree.
  const servers = oneActive(list).map(({ url, token, user, as, active }) => ({
    url,
    token,
    user,
    as,
    active,
  }));
  writeFileSync(at, `${JSON.stringify({ servers }, null, 2)}\n`, {
    mode: 0o600,
  });
}

/** Add or replace the link to `remote`'s server as its account, and make it the active one: adding a server is switching to it. */
export function writeRemote(home: string, remote: SyncRemoteInput): SyncRemote {
  const as = remote.as || remote.user;
  const id = linkId(remote.url, as);
  const others = readRemotes(home).filter((r) => r.id !== id);
  const link: SyncRemote = {
    ...remote,
    id,
    origin: originOfRelay(remote.url),
    as,
    active: true,
  };
  save(home, [...others.map((r) => ({ ...r, active: false })), link]);
  return link;
}

/** Make the link `ref` names (an id, or a server's URL) the active one; false when there is none. */
export function setActiveRemote(home: string, ref: string): boolean {
  const list = readRemotes(home);
  const chosen = findRemote(list, ref);
  if (!chosen) return false;
  save(
    home,
    list.map((r) => ({ ...r, active: r.id === chosen.id })),
  );
  return true;
}

/** Forget the link `ref` names by id, every link on a server named by URL, or every one without `ref`; true when one went. */
export function forgetRemote(home: string, ref?: string): boolean {
  const list = readRemotes(home);
  const byId = ref ? list.some((r) => r.id === ref) : false;
  const kept = !ref
    ? []
    : byId
      ? list.filter((r) => r.id !== ref)
      : list.filter((r) => serverHost(r.url) !== serverHost(ref));
  if (kept.length === list.length) return false;
  save(home, kept);
  return true;
}

/** Every account under `dataRoot` with a server saved, by its active link: what the hub starts at once and the engine follows. */
export function pairedAccounts(dataRoot: string): SyncRemote[] {
  let names: string[] = [];
  try {
    names = readdirSync(dataRoot);
  } catch {
    return [];
  }
  return names.flatMap((n) => {
    const r = readRemote(join(dataRoot, n));
    return r ? [r] : [];
  });
}

/** Each account's active server with its token: where a machine's engine is listed, and nowhere else. */
export function pairedServers(
  dataRoot: string,
): { origin: string; token: string }[] {
  return pairedAccounts(dataRoot).flatMap((r) =>
    r.origin ? [{ origin: r.origin, token: r.token }] : [],
  );
}

/** What the engine is told when the active link changes: the server it leaves, and the one it is listed at with which token. */
export function engineMoves(
  before: SyncRemote[],
  after: SyncRemote[],
): { forget?: string; pair?: { origin: string; token: string } } {
  const [was] = before;
  const [now] = after;
  const forget =
    was?.origin && was.origin !== now?.origin ? was.origin : undefined;
  const pair =
    now?.origin && now.token !== was?.token
      ? { origin: now.origin, token: now.token }
      : undefined;
  return { ...(forget ? { forget } : {}), ...(pair ? { pair } : {}) };
}

/** Per server host, the link a workspace recorded before accounts belongs to: the local account's own, else the first. */
function homeLinks(remotes: SyncRemote[]): Set<string> {
  const byHost = new Map<string, SyncRemote>();
  for (const r of remotes) {
    const host = serverHost(r.url);
    const held = byHost.get(host);
    if (!held || (held.as !== held.user && r.as === r.user))
      byHost.set(host, r);
  }
  return new Set([...byHost.values()].map((r) => r.id));
}

/** The id this hub's own relay goes by: one per hub, whatever port it listens on. */
export const OWN_LINK = "own";

/** Where an account's service syncs: on a machine its ACTIVE link alone, the other saved ones named to hide their workspaces; else this hub's own relay. */
export function syncTarget(
  own: string,
  remotes: SyncRemote[],
  machine: boolean,
): Record<string, string> {
  // A server syncs with its own relay only: pairings stored there are not used (docs/syncRelay.md, "A server").
  const [active] = machine ? remotes : [];
  if (!active) return { STUDIO_SYNC_URL: own };
  const homes = homeLinks(remotes);
  const home = (r: SyncRemote) => (homes.has(r.id) ? { home: true } : {});
  const hidden = remotes
    .slice(1)
    .map((r) => ({ id: r.id, url: r.url, ...home(r) }));
  return {
    STUDIO_SYNC_URL: active.url,
    STUDIO_SYNC_TOKEN: active.token,
    // The link's id and account, which a workspace's record names it by (file-service docs/liveCapture.md).
    STUDIO_SYNC_SERVERS: JSON.stringify([
      {
        url: active.url,
        token: active.token,
        main: true,
        id: active.id,
        as: active.as,
        ...home(active),
      },
    ]),
    ...(hidden.length ? { STUDIO_SYNC_HIDDEN: JSON.stringify(hidden) } : {}),
  };
}
