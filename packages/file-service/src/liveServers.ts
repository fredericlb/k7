// liveServers.ts — the servers this account syncs with, and which one each workspace belongs to. One link per
// server; the MAIN one is `STUDIO_SYNC_URL` (on a server, its own relay), all ride in `STUDIO_SYNC_SERVERS` (file-hub syncRemote.ts).
// A workspace's server and room are kept in its log folder: with none recorded it is the main one's, under its
// own name — which is what every workspace synced before secondaries is. See docs/liveCapture.md, "Several servers".

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { currentStudioUrl } from "@studio/web-protocol/services";
import { EXAMPLES_WORKSPACE } from "./demos.ts";
import { authHeaders, type RelayAuth, RelayLink } from "./liveRelay.ts";

/** One server this account is paired with — or, on a server, its own relay. */
export interface SyncServer {
  url: string;
  auth: RelayAuth;
  main: boolean;
  /** This hub's own relay, reached by its secret: a server's, which holds every room it has. */
  own: boolean;
}

/** Where a workspace syncs: its server's origin and the room it is called by there. */
export interface WorkspaceLink {
  server: string;
  room: string;
}

/** The room the account's own library syncs in; `_` starts no workspace name, so none can take it. */
export const ACCOUNT_LIBRARY_ROOM = "_account";

/** The relay's host, which is what makes two addresses the same server: a workspace linked under a former host is its successor's. */
export const hostOf = (url: string): string => {
  try {
    return new URL(currentStudioUrl(url)).host;
  } catch {
    return url;
  }
};

/** A relay socket's server as a page shows it: `wss://app.k7.rocks/api/sync` → `https://app.k7.rocks`. */
export const originOf = (url: string): string => {
  try {
    return new URL(currentStudioUrl(url).replace(/^ws/, "http")).origin;
  } catch {
    return url;
  }
};

/** Whether this service is a paired machine's — a device token — rather than a server's own. */
export const isPaired = (): boolean => !!process.env.STUDIO_SYNC_TOKEN;

/** Every server, the main one first; empty when this service syncs with no relay at all. */
export function syncServers(): SyncServer[] {
  const raw = process.env.STUDIO_SYNC_SERVERS;
  const secret = process.env.STUDIO_HUB_SECRET;
  if (raw)
    try {
      const list = (
        JSON.parse(raw) as {
          url?: string;
          token?: string;
          main?: boolean;
          own?: boolean;
        }[]
      ).flatMap((s): SyncServer[] => {
        const main = s.main === true;
        if (s.url && s.own && secret)
          return [{ url: s.url, auth: { secret }, main, own: true }];
        return s.url && s.token
          ? [{ url: s.url, auth: { token: s.token }, main, own: false }]
          : [];
      });
      if (list.length)
        return list.sort((a, b) => Number(b.main) - Number(a.main));
    } catch {
      // A list that does not read falls back to the main one alone.
    }
  const url = process.env.STUDIO_SYNC_URL;
  const token = process.env.STUDIO_SYNC_TOKEN;
  if (!url || !(token || secret)) return [];
  return [
    {
      url,
      auth: token ? { token } : { secret: secret ?? "" },
      main: true,
      own: !token,
    },
  ];
}

export const mainServer = (): SyncServer | undefined => syncServers()[0];

/** The server an origin or relay URL names, among those this account is paired with. */
export const serverOf = (url: string): SyncServer | undefined =>
  syncServers().find((s) => hostOf(s.url) === hostOf(url));

/** A page names this server by the origin it reached it at (`self`), which is this hub's own relay. */
export function fromPage(url: string, self: string | undefined): string {
  if (!self || hostOf(url) !== hostOf(self)) return url;
  return syncServers().find((s) => s.own)?.url ?? url;
}

/** …and is shown it by that origin: the own relay's loopback address means nothing to a browser. */
export function toPage(url: string, self: string | undefined): string {
  return self && serverOf(url)?.own ? self : originOf(url);
}

const links = new Map<string, RelayLink>();

/** The link to `server`, made once; `onOpen` hears each (re)connection, when a workspace may have appeared there. */
export function linkFor(
  server: SyncServer,
  onOpen: (server: SyncServer) => void,
): RelayLink {
  const key = hostOf(server.url);
  let link = links.get(key);
  if (!link) {
    link = new RelayLink(server.url, server.auth, undefined, () =>
      onOpen(server),
    );
    links.set(key, link);
  }
  return link;
}

/** The relay's HTTP twin of its socket URL: `ws(s)://host/api/sync` → `http(s)://host/api/sync/rooms`. */
const roomsUrl = (syncUrl: string): string =>
  `${syncUrl.replace(/^ws/, "http").replace(/\/+$/, "")}/rooms`;

const rooms = new Map<string, { names: string[]; at: number }>();

/** The account's workspaces on `server`, asked again when older than `maxAgeMs`; the last list known if it is away. */
export async function listRooms(
  server: SyncServer,
  maxAgeMs = 30_000,
  // A request answering a page: a stale list is answered at once and asked again behind it (docs/workspaces.md).
  staleOk = false,
): Promise<string[]> {
  const known = rooms.get(hostOf(server.url));
  if (known && Date.now() - known.at <= maxAgeMs) return known.names;
  if (staleOk && known) {
    refreshRooms(server);
    return known.names;
  }
  return fetchRooms(server);
}

/** The background question a stale answer leaves behind, one per server at a time. */
const refreshing = new Set<string>();
function refreshRooms(server: SyncServer): void {
  const key = hostOf(server.url);
  if (refreshing.has(key)) return;
  refreshing.add(key);
  void fetchRooms(server).finally(() => refreshing.delete(key));
}

/** Bumped by forgetRooms, so an answer asked for before a move never lands after it. */
const generation = new Map<string, number>();

async function fetchRooms(server: SyncServer): Promise<string[]> {
  const key = hostOf(server.url);
  const gen = generation.get(key) ?? 0;
  try {
    const r = await fetch(roomsUrl(server.url), {
      headers: authHeaders(server.auth),
      signal: AbortSignal.timeout(15_000),
    });
    if (!r.ok) throw new Error(`rooms ${r.status}`);
    const { workspaces } = (await r.json()) as { workspaces: string[] };
    // The account library's room is no workspace: workspaces.ts attaches it on its own.
    const names = workspaces.filter(
      (w) => w !== EXAMPLES_WORKSPACE && w !== ACCOUNT_LIBRARY_ROOM,
    );
    if ((generation.get(key) ?? 0) === gen)
      rooms.set(key, { names, at: Date.now() });
    return names;
  } catch (e) {
    console.warn(
      `sync | could not list the workspaces on ${originOf(server.url)}: ${(e as Error).message}`,
    );
    return rooms.get(key)?.names ?? [];
  }
}

/** Forget what `server`'s list said, so the next question asks it: a move just changed it. */
export const forgetRooms = (server: SyncServer): void => {
  const key = hostOf(server.url);
  rooms.delete(key);
  generation.set(key, (generation.get(key) ?? 0) + 1);
};

const LINK_FILE = "server.json";

/** Which server and room the workspace logged in `logDir` syncs with; null when none is recorded. */
export function readLinkRecord(logDir: string): WorkspaceLink | null {
  try {
    const v = JSON.parse(
      readFileSync(join(logDir, LINK_FILE), "utf8"),
    ) as Partial<WorkspaceLink>;
    return typeof v.server === "string" && typeof v.room === "string"
      ? { server: v.server, room: v.room }
      : null;
  } catch {
    return null;
  }
}

export function writeLinkRecord(logDir: string, link: WorkspaceLink): void {
  mkdirSync(logDir, { recursive: true });
  writeFileSync(join(logDir, LINK_FILE), `${JSON.stringify(link, null, 2)}\n`);
}

/** The local folder a room is brought down to: its own name, or `room.host` when that name is taken here. */
export function localNameFor(
  room: string,
  server: SyncServer,
  taken: (name: string) => boolean,
): string {
  if (!taken(room)) return room;
  const base = `${room}.${hostOf(server.url).replace(/[^A-Za-z0-9._-]/g, "-")}`;
  let name = base;
  for (let i = 2; taken(name); i++) name = `${base}-${i}`;
  return name;
}
