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

/** Copy one entry (a sample's file, a song's folder) from `server` here; the count, 0 when it has none. */
async function downloadEntry(
  server: PairedServer,
  family: Family,
  path: string,
): Promise<number> {
  const source = remoteLibrary({ ...server, route: DEVICE_LIBRARY_ROUTE });
  const files = (await source.manifest(family)).filter(
    (f) => f.path === path || f.path.startsWith(`${path}/`),
  );
  for (const f of files) await source.download(f.path, safePath(f.path));
  if (files.length) bumped(family);
  return files.length;
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

/** `GET /?family=` places each entry; `POST /download {family, path}` brings one server-only entry down. */
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
      try {
        // Bounded: the library page must not wait on a server that is away.
        const got = await fetch(
          `${server.base}${DEVICE_LIBRARY_ROUTE}/list?family=${family}`,
          {
            headers: { authorization: `Bearer ${server.token}` },
            signal: AbortSignal.timeout(5000),
          },
        );
        if (!got.ok) throw new Error(`${got.status} ${got.statusText}`);
        theirs = (await got.json()) as FamilyListing;
      } catch (e) {
        return res.status(502).json({
          error: `could not list ${server.base}'s library: ${(e as Error).message}`,
        });
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
      const path = typeof req.body?.path === "string" ? req.body.path : "";
      if (!family) return res.status(400).json({ error: FAMILY_ERROR });
      if (!path) return res.status(400).json({ error: "path is required" });
      const server = serverOf(hub, req);
      if (!server)
        return res.status(409).json({ error: "this account is not paired" });
      try {
        const files = await downloadEntry(server, family, path);
        if (!files)
          return res.status(404).json({ error: `the server has no '${path}'` });
        res.json({ files });
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
        if (!(await downloadEntry(server, "songs", folder)))
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
