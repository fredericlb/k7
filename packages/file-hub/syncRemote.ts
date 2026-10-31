// syncRemote.ts — an account on THIS hub linked to remote servers: each LINK is one account on one server (`as`), with
// the device token that server minted, and the account's file service syncs each workspace with the link it belongs to.
// Several links may share a server under different accounts; one link is the MAIN: libraries, remote surfaces and new
// workspaces are its. Per local account, since a desktop's hub also serves its local user. See docs/syncRelay.md.

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
  main: boolean;
}

/** What a caller writes: the id and origin are derived from the url and `as`. */
export type SyncRemoteInput = Omit<SyncRemote, "id" | "origin" | "as"> & {
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

/** Exactly one main among `list`: the one marked, else the first. */
function oneMain<T extends { main: boolean }>(list: T[]): T[] {
  const at = Math.max(
    0,
    list.findIndex((r) => r.main),
  );
  return list.map((r, i) => ({ ...r, main: i === at }));
}

/** Every link of the account folder `home`, the main one first; empty when it syncs with this hub's own relay. */
export function readRemotes(home: string): SyncRemote[] {
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(join(home, FILE), "utf8"));
  } catch {
    return [];
  }
  // A file from before secondaries is one pairing, and it is the main one.
  const items = Array.isArray((raw as { servers?: unknown })?.servers)
    ? ((raw as { servers: unknown[] }).servers as Partial<SyncRemote>[])
    : [{ ...(raw as Partial<SyncRemote>), main: true }];
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
        main: v.main === true,
      },
    ];
  });
  return oneMain(list).sort((a, b) => Number(b.main) - Number(a.main));
}

/** The MAIN link of `home`, or null when it syncs with this hub's own relay. */
export function readRemote(home: string): SyncRemote | null {
  return readRemotes(home)[0] ?? null;
}

/** The link `ref` names: its id, else the first link on that server's host (the main one when it is there). */
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
  const servers = oneMain(list).map(({ url, token, user, as, main }) => ({
    url,
    token,
    user,
    as,
    main,
  }));
  writeFileSync(at, `${JSON.stringify({ servers }, null, 2)}\n`, {
    mode: 0o600,
  });
}

/** Add or replace the link to `remote`'s server as its account; `main` makes it the main one, and the first always is. */
export function writeRemote(home: string, remote: SyncRemoteInput): SyncRemote {
  const as = remote.as || remote.user;
  const id = linkId(remote.url, as);
  const others = readRemotes(home).filter((r) => r.id !== id);
  const main = remote.main || !others.length;
  const link: SyncRemote = {
    ...remote,
    id,
    origin: originOfRelay(remote.url),
    as,
    main,
  };
  save(home, [
    ...others.map((r) => ({ ...r, main: main ? false : r.main })),
    link,
  ]);
  return link;
}

/** Make the link `ref` names (an id, or a server's URL) the main one; false when there is none. */
export function setMainRemote(home: string, ref: string): boolean {
  const list = readRemotes(home);
  const chosen = findRemote(list, ref);
  if (!chosen) return false;
  save(
    home,
    list.map((r) => ({ ...r, main: r.id === chosen.id })),
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

/** Every paired account under `dataRoot`, by its main link: what the hub starts at once and never stops for idleness. */
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

/** The link of `list` that hands its token to the engine at `origin`: the main one when it is there, else the first. */
export function engineLinkOf(
  list: SyncRemote[],
  origin: string,
): SyncRemote | undefined {
  const there = list.filter((r) => r.origin === origin);
  return there.find((r) => r.main) ?? there[0];
}

/** One link per server per account, with its token: what a machine's engine is listed at (one token per origin). */
export function pairedServers(
  dataRoot: string,
): { origin: string; token: string }[] {
  let names: string[] = [];
  try {
    names = readdirSync(dataRoot);
  } catch {
    return [];
  }
  return names.flatMap((n) => {
    const list = readRemotes(join(dataRoot, n));
    const origins = [...new Set(list.map((r) => r.origin).filter(Boolean))];
    return origins.flatMap((origin) => {
      const r = engineLinkOf(list, origin);
      return r ? [{ origin, token: r.token }] : [];
    });
  });
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

/** The id this hub's own relay goes by on a server: one per hub, whatever port it listens on. */
export const OWN_LINK = "own";

/** Where an account's service syncs: its MAIN link by its device token, the others beside it, else this hub's own relay `own`. */
export function syncTarget(
  own: string,
  remotes: SyncRemote[],
  ownMain: boolean,
): Record<string, string> {
  const [main] = remotes;
  if (!main) return { STUDIO_SYNC_URL: own };
  const homes = homeLinks(remotes);
  const entry = (r: SyncRemote, isMain: boolean) => ({
    url: r.url,
    token: r.token,
    main: isMain,
    id: r.id,
    as: r.as,
    ...(homes.has(r.id) ? { home: true } : {}),
  });
  // A server stays its accounts' main one, by its hub secret; what is linked rides beside it (file-service liveServers.ts).
  if (ownMain)
    return {
      STUDIO_SYNC_URL: own,
      STUDIO_SYNC_SERVERS: JSON.stringify([
        { url: own, own: true, main: true, id: OWN_LINK, home: true },
        ...remotes.map((r) => entry(r, false)),
      ]),
    };
  return {
    STUDIO_SYNC_URL: main.url,
    STUDIO_SYNC_TOKEN: main.token,
    // Every link, main included, for the workspaces each holds (file-service docs/liveCapture.md).
    STUDIO_SYNC_SERVERS: JSON.stringify(remotes.map((r) => entry(r, r.main))),
  };
}
