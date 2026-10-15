// serverCopy.ts — a paired machine's library against its server's: which entries are here, there or
// both, and the download of one entry from there. Matched by PATH: the two volumes share an id space,
// so a song that differs in content but not in path reads as synced. See packages/mediatek/docs/serverCopy.md.

import { existsSync as fileExists } from "node:fs";
import { wrap } from "@frediverse/http/route";
import type { FileHub } from "@studio/file-hub";
import { listFamily } from "@studio/mediatek/catalogue";
import { safePath } from "@studio/mediatek/layout";
import { remoteLibrary } from "@studio/mediatek/remote";
import { bumped } from "@studio/mediatek/revision";
import {
  asFamily,
  FAMILY_ERROR,
  type Family,
  type FamilyListing,
  type LibraryPlacement,
} from "@studio/mediatek/types";
import {
  DEVICE_PUBLICATIONS_ROUTE,
  momentDeviceRouter,
  momentShareRouter,
  publicationsDeviceRouter,
  songbookCopyRouter,
  songbookDeviceRouter,
} from "@studio/rehearsal-server";
import {
  type Express,
  type Request,
  type RequestHandler,
  Router,
} from "express";
import { libraryRouter } from "./library.ts";

/** Where the origin answers a paired device's reads, behind its device token. */
export const DEVICE_LIBRARY_ROUTE = "/api/sync/mediatek";

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

interface PairedServer {
  base: string;
  token: string;
}

/** Copy each entry (a sample's file, a song's folder) from `server` here, on one manifest; what was copied and what it lacks. */
async function downloadEntries(
  server: PairedServer,
  family: Family,
  paths: string[],
): Promise<{ files: number; missing: string[] }> {
  const source = remoteLibrary({ ...server, route: DEVICE_LIBRARY_ROUTE });
  const manifest = await source.manifest(family);
  let files = 0;
  const missing: string[] = [];
  for (const path of paths) {
    const under = manifest.filter(
      (f) => f.path === path || f.path.startsWith(`${path}/`),
    );
    if (!under.length) missing.push(path);
    for (const f of under) await source.download(f.path, safePath(f.path));
    files += under.length;
  }
  if (files) bumped(family);
  return { files, missing };
}

/** One path or several — an album, a playlist's songs — deduplicated, empty ones dropped. */
function pathsOf(body: unknown): string[] {
  const b = (body ?? {}) as { path?: unknown; paths?: unknown };
  const all: unknown[] = Array.isArray(b.paths) ? b.paths : [b.path];
  return [
    ...new Set(all.filter((p): p is string => typeof p === "string" && !!p)),
  ];
}

/** The paired origin of the session's account, as an http origin and the token to call it with. */
export function serverOf(hub: FileHub, req: Request): PairedServer | null {
  const remote = hub.sync.remoteOf(req);
  if (!remote) return null;
  return {
    base: new URL(remote.url.replace(/^ws/, "http")).origin,
    token: remote.token,
  };
}

/** How long the server's listing may take: a few hundred songs from a busy origin take seconds. */
const LISTING_TIMEOUT_MS = 20_000;

/** The last listing each server gave of each family, answered when it is slow or away rather than nothing. */
const lastListing = new Map<string, FamilyListing>();

/** `GET /?family=` places each entry; `POST /download {family, path | paths}` brings server-only entries down. */
export function serverCopyRouter(hub: FileHub): Router {
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
      const key = `${server.base} ${family}`;
      try {
        // Bounded: the library page must not wait for ever on a server that is away.
        const got = await fetch(
          `${server.base}${DEVICE_LIBRARY_ROUTE}/list?family=${family}`,
          {
            headers: { authorization: `Bearer ${server.token}` },
            signal: AbortSignal.timeout(LISTING_TIMEOUT_MS),
          },
        );
        if (!got.ok) throw new Error(`${got.status} ${got.statusText}`);
        theirs = (await got.json()) as FamilyListing;
        lastListing.set(key, theirs);
      } catch (e) {
        // What it said last time beats an empty page: its songs do not vanish because it was slow once.
        const known = lastListing.get(key);
        if (!known)
          return res.status(502).json({
            error: `could not list ${server.base}'s library: ${(e as Error).message}`,
          });
        theirs = known;
      }
      const here = new Set(listFamily(family).entries.map((e) => e.path));
      const placement: LibraryPlacement = {
        paired: true,
        server: server.base,
        synced: theirs.entries
          .filter((e) => here.has(e.path))
          .map((e) => e.path),
        serverOnly: theirs.entries.filter((e) => !here.has(e.path)),
      };
      res.json(placement);
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
        const got = await downloadEntries(server, family, paths);
        // A list partly there is a success that names what was not; nothing there at all is a 404.
        if (!got.files)
          return res
            .status(404)
            .json({ error: `the server has no '${paths.join("', '")}'` });
        res.json(got);
      } catch (e) {
        res.status(502).json({ error: (e as Error).message });
      }
    }),
  );

  return r;
}

/** Where the origin answers a paired device's songbook reads, behind the same token. */
const DEVICE_SONGBOOK_ROUTE = "/api/sync/songbook";

/** Where the origin takes a paired device's shared moments, behind the same token. */
const DEVICE_MOMENTS_ROUTE = "/api/sync/moments";

/** Mount both sides of each: the origin's device doors, and this machine's placements against its server. */
export function mountServerCopy(
  app: Express,
  hub: FileHub,
  requireAuth: RequestHandler,
): void {
  app.use(DEVICE_LIBRARY_ROUTE, deviceLibraryRouter(hub.sync.deviceGate()));
  app.use("/api/sync/library", requireAuth, serverCopyRouter(hub));
  app.use(DEVICE_SONGBOOK_ROUTE, songbookDeviceRouter(hub.sync.deviceGate()));
  app.use(
    "/api/sync/songbook-copy",
    requireAuth,
    songbookCopyRouter({
      deviceRoute: DEVICE_SONGBOOK_ROUTE,
      server: (req) => serverOf(hub, req),
      // A song's track is a file of a library song: its whole folder comes down, once.
      fetchTrack: async (req, path) => {
        const server = serverOf(hub, req);
        if (!server || fileExists(safePath(path))) return;
        const folder = path.split("/").slice(0, -1).join("/");
        if (!(await downloadEntries(server, "songs", [folder])).files)
          throw new Error(`the server's library has no '${path}'`);
      },
    }),
  );
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
    }),
  );
}
