// serverCopy.ts — a paired machine's library against its server's: which entries are here, there or
// both, whether the server answers now, the download of entries from there, and the jobs that keep the
// followed songs in step. Matched by PATH: the two volumes share an id space. See packages/mediatek/docs/serverCopy.md.

import { wrap } from "@frediverse/http/route";
import type { FileHub } from "@studio/file-hub";
import { listFamilyFresh } from "@studio/mediatek/catalogue";
import {
  asFamily,
  FAMILY_ERROR,
  type FamilyListing,
  type LibraryPlacement,
  type ServerReach,
} from "@studio/mediatek/types";
import {
  DEVICE_PUBLICATIONS_ROUTE,
  type LinkedServer,
  momentDeviceRouter,
  momentShareRouter,
  publicationsDeviceRouter,
} from "@studio/rehearsal-server";
import {
  type Express,
  type Request,
  type RequestHandler,
  Router,
} from "express";
import { downloadEntries } from "../serverSongs/download.ts";
import { keepListing, lastListing } from "../serverSongs/listings.ts";
import { noteReach, reachOf } from "../serverSongs/reach.ts";
import {
  DEVICE_LIBRARY_ROUTE,
  deviceGet,
  type PairedServer,
} from "../serverSongs/server.ts";
import { checkSongUpdates, songSyncJobs } from "../serverSongs/updates.ts";
import { libraryRouter } from "./library.ts";

export { DEVICE_LIBRARY_ROUTE };

/** The origin's library, READ-ONLY, for a device that proves its account by token rather than session. */
export function deviceLibraryRouter(gate: RequestHandler): Router {
  const r = Router();
  r.use(gate);
  // The same reads a session gets; no write is a device's to make through this door.
  r.use((req, res, next) =>
    req.method === "GET" || req.method === "HEAD"
      ? next()
      : res.status(405).json({ error: "read-only for a device" }),
  );
  r.use(libraryRouter);
  return r;
}

/** One path or several — an album, a playlist's songs — deduplicated, empty ones dropped. */
function pathsOf(body: unknown): string[] {
  const b = (body ?? {}) as { path?: unknown; paths?: unknown };
  const all: unknown[] = Array.isArray(b.paths) ? b.paths : [b.path];
  return [
    ...new Set(all.filter((p): p is string => typeof p === "string" && !!p)),
  ];
}

/** The session's account's active server, as an http origin and the token to call it with. */
export function serverOf(hub: FileHub, req: Request): PairedServer | null {
  const remote = hub.sync.remoteOf(req);
  if (!remote) return null;
  return {
    base: new URL(remote.url.replace(/^ws/, "http")).origin,
    token: remote.token,
    ...(remote.as ? { account: remote.as } : {}),
  };
}

/** The session's account's active server with its link id and account: where a moment goes. */
export function activeServerOf(
  hub: FileHub,
  req: Request,
): LinkedServer | null {
  const r = hub.sync.remoteOf(req);
  if (!r) return null;
  return {
    id: r.id,
    origin: r.origin,
    as: r.as,
    base: new URL(r.url.replace(/^ws/, "http")).origin,
    token: r.token,
  };
}

/** How long the server's listing may take: a few hundred songs from a busy origin take seconds. */
const LISTING_TIMEOUT_MS = 20_000;

/** `GET /?family=` places each entry; `GET /status` says whether the server answers; `POST /download` brings entries down. */
export function serverCopyRouter(
  hub: FileHub,
  servers: () => PairedServer[] = () => [],
): Router {
  const r = Router();

  r.get(
    "/",
    wrap(async (req, res) => {
      const family = asFamily(req.query.family);
      if (!family) return res.status(400).json({ error: FAMILY_ERROR });
      const server = serverOf(hub, req);
      if (!server) {
        const none: LibraryPlacement = {
          paired: false,
          server: null,
          synced: [],
          serverOnly: [],
        };
        return res.json(none);
      }
      let theirs: FamilyListing;
      let stale = false;
      const key = `${server.base} ${family}`;
      try {
        // Bounded: the library page must not wait for ever on a server that is away.
        theirs = await deviceGet<FamilyListing>(
          server,
          `/list?family=${family}`,
          LISTING_TIMEOUT_MS,
        );
        noteReach(server.base, true);
        keepListing(key, theirs);
      } catch (e) {
        noteReach(server.base, false);
        // What it said last time, kept on disk, beats an empty page: its songs do not vanish because it is away.
        const known = lastListing(key);
        if (!known)
          return res.status(502).json({
            error: `could not list ${server.base}'s library: ${(e as Error).message}`,
          });
        theirs = known;
        stale = true;
      }
      const here = new Set(
        (await listFamilyFresh(family)).entries.map((e) => e.path),
      );
      const placement: LibraryPlacement = {
        paired: true,
        server: server.base,
        synced: theirs.entries
          .filter((e) => here.has(e.path))
          .map((e) => e.path),
        serverOnly: theirs.entries.filter((e) => !here.has(e.path)),
        ...(stale ? { stale } : {}),
      };
      res.json(placement);
    }),
  );

  r.get(
    "/status",
    wrap(async (req, res) => {
      const server = serverOf(hub, req);
      if (!server) {
        const none: ServerReach = {
          paired: false,
          server: null,
          reachable: null,
          checkedAt: null,
        };
        return res.json(none);
      }
      const k = await reachOf(server);
      const reach: ServerReach = {
        paired: true,
        server: server.base,
        reachable: k.reachable,
        checkedAt: k.at,
      };
      res.json(reach);
    }),
  );

  r.post(
    "/download",
    wrap(async (req, res) => {
      const family = asFamily(req.body?.family);
      const paths = pathsOf(req.body);
      if (!family) return res.status(400).json({ error: FAMILY_ERROR });
      if (!paths.length)
        return res.status(400).json({ error: "path or paths is required" });
      const server = serverOf(hub, req);
      if (!server)
        return res.status(409).json({ error: "this account is not paired" });
      try {
        const got = await downloadEntries(server, family, paths, {
          follow: req.body?.follow === true,
        });
        // A list partly there is a success that names what was not; nothing there at all is a 404.
        if (got.missing.length === paths.length)
          return res
            .status(404)
            .json({ error: `the server has no '${paths.join("', '")}'` });
        res.json(got);
      } catch (e) {
        res.status(502).json({ error: (e as Error).message });
      }
    }),
  );

  // The backend's own jobs over the followed songs, which the page's download manager mirrors.
  r.get("/jobs", (_req, res) => {
    res.json({ jobs: songSyncJobs() });
  });

  // A check now, answered at once: its progress is the job list's.
  r.post("/check", (_req, res) => {
    // A server, or a machine paired with none, follows nothing: no scan for anyone to start.
    if (!servers().length)
      return void res
        .status(409)
        .json({ error: "this machine is paired with no server" });
    void checkSongUpdates(servers).catch(() => {});
    res.status(202).json({ ok: true });
  });

  return r;
}

/** Where the origin takes a paired device's shared moments, behind the same token. */
const DEVICE_MOMENTS_ROUTE = "/api/sync/moments";

/** Mount both sides of each: the origin's device doors, and this machine's placements against its server. */
export function mountServerCopy(
  app: Express,
  hub: FileHub,
  requireAuth: RequestHandler,
  servers?: () => PairedServer[],
): void {
  app.use(DEVICE_LIBRARY_ROUTE, deviceLibraryRouter(hub.sync.deviceGate()));
  app.use("/api/sync/library", requireAuth, serverCopyRouter(hub, servers));
  // Releases and pages live here alone; a paired machine reads and writes them through this door.
  app.use(
    DEVICE_PUBLICATIONS_ROUTE,
    publicationsDeviceRouter(hub.sync.deviceGate()),
  );
  // A moment goes UP, never a session: the session stays on the machine it was recorded on.
  app.use(DEVICE_MOMENTS_ROUTE, momentDeviceRouter(hub.sync.deviceGate()));
  app.use(
    "/api/sync/moments-share",
    requireAuth,
    momentShareRouter({
      deviceRoute: DEVICE_MOMENTS_ROUTE,
      server: (req) => serverOf(hub, req),
      active: (req) => activeServerOf(hub, req),
      reach: async (server) => (await reachOf(server)).reachable,
    }),
  );
}
