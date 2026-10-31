// liveServers.ts — the LINKS this account syncs with (one account on one server each, several possibly on one server),
// and which one each workspace belongs to. The MAIN one is `STUDIO_SYNC_URL` (on a server, its own relay); all ride in
// `STUDIO_SYNC_SERVERS` (file-hub syncRemote.ts). Everything here is keyed by the link's id, never by its host.
// A workspace's link and room are kept in its log folder; with none recorded it is the main one's under its own name.
// See docs/liveCapture.md, "Several servers".

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { currentStudioUrl } from "@studio/web-protocol/services";
import { EXAMPLES_WORKSPACE } from "./demos.ts";
import { authHeaders, type RelayAuth, RelayLink } from "./liveRelay.ts";

/** One link this account syncs with — or, on a server, its own relay. */
export interface SyncServer {
  /** Stable: what a workspace's record and the pages name it by (file-hub syncRemote.ts `linkId`). */
  id: string;
  url: string;
  auth: RelayAuth;
  main: boolean;
  /** This hub's own relay, reached by its secret: a server's, which holds every room it has. */
  own: boolean;
  /** The account on that server the token was minted for, when the hub said. */
  as?: string;
  /** The link a workspace recorded with only its server's origin belongs to, on that server. */
  home: boolean;
}

/** Where a workspace syncs: its server's origin, the link's id when recorded, and the room it is called by there. */
export interface WorkspaceLink {
  server: string;
  link?: string;
  room: string;
}

/** The room the account's own library syncs in; `_` starts no workspace name, so none can take it. */
export const ACCOUNT_LIBRARY_ROOM = "_account";

/** The id of this hub's own relay on a server (file-hub syncRemote.ts `OWN_LINK`). */
const OWN_LINK = "own";

/** The relay's host: a workspace linked under a former host is its successor's. */
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

interface RawServer {
  url?: string;
  token?: string;
  main?: boolean;
  own?: boolean;
  id?: string;
  as?: string;
  home?: boolean;
}

/** Every link, the main one first; empty when this service syncs with no relay at all. */
export function syncServers(): SyncServer[] {
  const raw = process.env.STUDIO_SYNC_SERVERS;
  const secret = process.env.STUDIO_HUB_SECRET;
  if (raw)
    try {
      const parsed = JSON.parse(raw) as RawServer[];
      // A list from a hub before accounts marks no home link: one link per host then, each its host's.
      const marked = parsed.some((s) => s.home === true);
      const list = parsed.flatMap((s): SyncServer[] => {
        const main = s.main === true;
        // …and names no id: the host stands in, as unique as it was then.
        const id = s.id || (s.own ? OWN_LINK : hostOf(s.url ?? ""));
        const home = marked ? s.home === true : true;
        const as = s.as ? { as: s.as } : {};
        if (s.url && s.own && secret)
          return [
            { id, url: s.url, auth: { secret }, main, own: true, home, ...as },
          ];
        return s.url && s.token
          ? [
              {
                id,
                url: s.url,
                auth: { token: s.token },
                main,
                own: false,
                home,
                ...as,
              },
            ]
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
      id: token ? hostOf(url) : OWN_LINK,
      url,
      auth: token ? { token } : { secret: secret ?? "" },
      main: true,
      own: !token,
      home: true,
    },
  ];
}

export const mainServer = (): SyncServer | undefined => syncServers()[0];

/** The link `ref` names: its id, else the server an origin or relay URL names — its home link there, else the first. */
export function serverOf(ref: string): SyncServer | undefined {
  const all = syncServers();
  const byId = all.find((s) => s.id === ref);
  if (byId) return byId;
  const there = all.filter((s) => hostOf(s.url) === hostOf(ref));
  return there.find((s) => s.home) ?? there[0];
}

/** The link a workspace's record names: by its id, else by its server as recorded before accounts. */
export function serverForRecord(rec: WorkspaceLink): SyncServer | undefined {
  // A link let go leaves its workspaces synced nowhere: another account on that server must never take them.
  if (rec.link && rec.link !== hostOf(rec.server))
    return syncServers().find((s) => s.id === rec.link);
  return serverOf(rec.server);
}

/** Whether another link shares `server`'s host: then the pages name each by its account too. */
export const sharesHost = (server: SyncServer): boolean =>
  syncServers().some(
    (s) => s.id !== server.id && hostOf(s.url) === hostOf(server.url),
  );

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

/** The relay link of `server`, made once; `onOpen` hears each (re)connection, when a workspace may have appeared there. */
export function linkFor(
  server: SyncServer,
  onOpen: (server: SyncServer) => void,
): RelayLink {
  let link = links.get(server.id);
  if (!link) {
    link = new RelayLink(server.url, server.auth, undefined, () =>
      onOpen(server),
    );
    links.set(server.id, link);
  }
  return link;
}

/** The relay's HTTP twin of its socket URL: `ws(s)://host/api/sync` → `http(s)://host/api/sync/rooms`. */
const roomsUrl = (syncUrl: string): string =>
  `${syncUrl.replace(/^ws/, "http").replace(/\/+$/, "")}/rooms`;

const rooms = new Map<string, { names: string[]; at: number }>();

/** The workspaces of `server`'s account there, asked again when older than `maxAgeMs`; the last list known if it is away. */
export async function listRooms(
  server: SyncServer,
  maxAgeMs = 30_000,
  // A request answering a page: a stale list is answered at once and asked again behind it (docs/workspaces.md).
  staleOk = false,
): Promise<string[]> {
  const known = rooms.get(server.id);
  if (known && Date.now() - known.at <= maxAgeMs) return known.names;
  if (staleOk && known) {
    refreshRooms(server);
    return known.names;
  }
  return fetchRooms(server);
}

/** The background question a stale answer leaves behind, one per link at a time. */
const refreshing = new Set<string>();
function refreshRooms(server: SyncServer): void {
  if (refreshing.has(server.id)) return;
  refreshing.add(server.id);
  void fetchRooms(server).finally(() => refreshing.delete(server.id));
}

/** Bumped by forgetRooms, so an answer asked for before a move never lands after it. */
const generation = new Map<string, number>();

async function fetchRooms(server: SyncServer): Promise<string[]> {
  const key = server.id;
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
  rooms.delete(server.id);
  generation.set(server.id, (generation.get(server.id) ?? 0) + 1);
};

const LINK_FILE = "server.json";

/** Which link and room the workspace logged in `logDir` syncs with; null when none is recorded. */
export function readLinkRecord(logDir: string): WorkspaceLink | null {
  try {
    const v = JSON.parse(
      readFileSync(join(logDir, LINK_FILE), "utf8"),
    ) as Partial<WorkspaceLink>;
    if (typeof v.server !== "string" || typeof v.room !== "string") return null;
    return typeof v.link === "string" && v.link
      ? { server: v.server, link: v.link, room: v.room }
      : { server: v.server, room: v.room };
  } catch {
    return null;
  }
}

export function writeLinkRecord(logDir: string, link: WorkspaceLink): void {
  mkdirSync(logDir, { recursive: true });
  writeFileSync(join(logDir, LINK_FILE), `${JSON.stringify(link, null, 2)}\n`);
}

/** The record that links a workspace to `server` under `room`. */
export const recordFor = (server: SyncServer, room: string): WorkspaceLink => ({
  server: originOf(server.url),
  link: server.id,
  room,
});

/** A name the workspace rules allow, from a host or an email. */
const safe = (s: string): string => s.replace(/[^A-Za-z0-9._-]/g, "-");

/** The local folder a room is brought down to: its own name, else `room.host` — `room.host.account` when two accounts share the host. */
export function localNameFor(
  room: string,
  server: SyncServer,
  taken: (name: string) => boolean,
  shared = sharesHost(server),
): string {
  if (!taken(room)) return room;
  const host = `${room}.${safe(hostOf(server.url))}`;
  const base = shared && server.as ? `${host}.${safe(server.as)}` : host;
  let name = base;
  for (let i = 2; taken(name); i++) name = `${base}-${i}`;
  return name;
}
