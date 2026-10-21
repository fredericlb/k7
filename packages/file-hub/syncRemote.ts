// syncRemote.ts — an account on THIS hub paired with remote servers: its file service syncs each workspace
// with the relay of the server it belongs to, with the device token that server minted. One server is the
// MAIN: the account's libraries, the remote surfaces and new workspaces are its. Per account, because a
// desktop's hub also serves its local user, whose workspaces are not the account's. See docs/syncRelay.md.

import { readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { currentStudioUrl } from "@studio/web-protocol/services";

/** One pairing: the remote relay's socket URL, the device token, the account's email, and whether it is the main one. */
export interface SyncRemote {
  url: string;
  token: string;
  user: string;
  main: boolean;
}

const FILE = ".sync-remote.json";

/** The relay's host, which is what makes two pairings the same server. */
const serverHost = (url: string): string => {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
};

/** Exactly one main among `list`: the one marked, else the first. */
function oneMain(list: SyncRemote[]): SyncRemote[] {
  const at = Math.max(
    0,
    list.findIndex((r) => r.main),
  );
  return list.map((r, i) => ({ ...r, main: i === at }));
}

/** Every pairing of the account folder `home`, the main one first; empty when it syncs with this hub's own relay. */
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
  const list = items.flatMap((v) =>
    v?.url && v.token && v.user
      ? [
          {
            // A pairing made under a former host relays through its successor: the token is the same backend's.
            url: currentStudioUrl(v.url),
            token: v.token,
            user: v.user,
            main: v.main === true,
          },
        ]
      : [],
  );
  return oneMain(list).sort((a, b) => Number(b.main) - Number(a.main));
}

/** The MAIN pairing of `home`, or null when it syncs with this hub's own relay. */
export function readRemote(home: string): SyncRemote | null {
  return readRemotes(home)[0] ?? null;
}

function save(home: string, list: SyncRemote[]): void {
  const at = join(home, FILE);
  if (!list.length) {
    rmSync(at, { force: true });
    return;
  }
  writeFileSync(
    at,
    `${JSON.stringify({ servers: oneMain(list) }, null, 2)}\n`,
    {
      mode: 0o600,
    },
  );
}

/** Add or replace the pairing with `remote`'s server; `main` makes it the main one, and the first pairing always is. */
export function writeRemote(home: string, remote: SyncRemote): void {
  const others = readRemotes(home).filter(
    (r) => serverHost(r.url) !== serverHost(remote.url),
  );
  const main = remote.main || !others.length;
  save(home, [
    ...others.map((r) => ({ ...r, main: main ? false : r.main })),
    { ...remote, main },
  ]);
}

/** Make the pairing with `url`'s server the main one; false when there is none. */
export function setMainRemote(home: string, url: string): boolean {
  const list = readRemotes(home);
  if (!list.some((r) => serverHost(r.url) === serverHost(url))) return false;
  save(
    home,
    list.map((r) => ({ ...r, main: serverHost(r.url) === serverHost(url) })),
  );
  return true;
}

/** Forget the pairing with `url`'s server, or every one without `url`; true when one went. */
export function forgetRemote(home: string, url?: string): boolean {
  const list = readRemotes(home);
  const kept = url
    ? list.filter((r) => serverHost(r.url) !== serverHost(url))
    : [];
  if (kept.length === list.length) return false;
  save(home, kept);
  return true;
}

/** Every paired account under `dataRoot`, by its main pairing: what the hub starts at once and never stops for idleness. */
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

/** Where an account's service syncs: its MAIN server by its device token, the others beside it, else this hub's own relay `own`. */
export function syncTarget(
  own: string,
  remotes: SyncRemote[],
  ownMain: boolean,
): Record<string, string> {
  const [main] = remotes;
  if (!main) return { STUDIO_SYNC_URL: own };
  // A server stays its accounts' main one, by its hub secret; what is paired rides beside it (file-service liveServers.ts).
  if (ownMain)
    return {
      STUDIO_SYNC_URL: own,
      STUDIO_SYNC_SERVERS: JSON.stringify([
        { url: own, own: true, main: true },
        ...remotes.map((r) => ({ url: r.url, token: r.token, main: false })),
      ]),
    };
  return {
    STUDIO_SYNC_URL: main.url,
    STUDIO_SYNC_TOKEN: main.token,
    // Every pairing, main included, for the workspaces each server holds (file-service docs/liveCapture.md).
    STUDIO_SYNC_SERVERS: JSON.stringify(
      remotes.map((r) => ({ url: r.url, token: r.token, main: r.main })),
    ),
  };
}
