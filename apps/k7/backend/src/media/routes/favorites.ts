// favorites.ts — the médiathèque songs and albums an account starred, kept where the account lives.
// A paired machine keeps none of its own: it asks its server, through a device door, so every
// device shows the same stars. An unpaired backend, the server among them, keeps them itself.
// The one thing a reader would get wrong: these are NOT in the preferences file, which the page
// rewrites wholesale from a copy read at load — see packages/ui-library/docs/library.md.

import { wrap } from "@frediverse/http/route";
import type { PrefsStore } from "@studio/user-prefs";
import { type Request, type RequestHandler, Router } from "express";
import { z } from "zod";
import { subOf } from "../../who.ts";

/** Where the origin answers a paired device's favorites, behind its device token. */
export const DEVICE_FAVORITES_ROUTE = "/api/sync/favorites";

export interface FavoriteStores {
  /** Each account's starred library paths, in a store of their own. */
  own: PrefsStore<{ favorites: string[] }>;
  /** The account's preferences, whose `favorites` field seeds an account with no list yet. */
  prefs: PrefsStore<{ favorites?: string[] }>;
}

/** What a paired machine needs to call its server. */
interface PairedServer {
  base: string;
  token: string;
}

const starSchema = z.object({
  paths: z.array(z.string().min(1)).min(1),
  favorite: z.boolean(),
});

type Star = z.infer<typeof starSchema>;

/** How long the server may take: the stars wait on it, and it may be away. */
const SERVER_TIMEOUT_MS = 10_000;

/** The account's list, seeded from its preferences while it has none of its own. */
export function listOf(s: FavoriteStores, sub: string): string[] {
  return s.own.read(sub)?.favorites ?? s.prefs.read(sub)?.favorites ?? [];
}

/** Star or unstar `paths`, an explicit state rather than a toggle so two devices never undo each other; null when the write failed. */
export function star(
  s: FavoriteStores,
  sub: string,
  { paths, favorite }: Star,
): string[] | null {
  const now = new Set(
    s.own.readForUpdate(sub)?.favorites ?? s.prefs.read(sub)?.favorites ?? [],
  );
  for (const p of paths) favorite ? now.add(p) : now.delete(p);
  const list = [...now].sort();
  return s.own.write(sub, { favorites: list }) ? list : null;
}

/** One request answered from this backend's own store, for `sub`. */
function answerHere(
  s: FavoriteStores,
  sub: string,
  req: Request,
  res: Parameters<RequestHandler>[1],
): void {
  if (req.method === "GET") return void res.json({ favorites: listOf(s, sub) });
  const body = starSchema.safeParse(req.body);
  if (!body.success)
    return void res
      .status(400)
      .json({ error: "expected { paths: string[], favorite: boolean }" });
  const list = star(s, sub, body.data);
  if (!list)
    return void res.status(500).json({ error: "favorites not stored" });
  res.json({ favorites: list });
}

/** The server's side: the account's favorites for the person who paired the device. */
export function favoritesDeviceRouter(
  gate: RequestHandler,
  s: FavoriteStores,
): Router {
  const r = Router();
  r.use(gate);
  r.all("/", (req, res) => {
    const person = (
      res.locals.syncCaller as { person?: string | null } | undefined
    )?.person;
    // Favorites are a person's: a token that names nobody reaches none.
    if (!person)
      return void res.status(403).json({
        error:
          "this machine was paired before tokens named a person: pair it again",
        reason: "repair",
      });
    answerHere(s, person, req, res);
  });
  return r;
}

/** Call the paired server's door: the list, or a change to it. */
const callServer = (server: PairedServer, body?: Star): Promise<Response> =>
  fetch(`${server.base}${DEVICE_FAVORITES_ROUTE}`, {
    method: body ? "POST" : "GET",
    headers: {
      authorization: `Bearer ${server.token}`,
      ...(body ? { "content-type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(SERVER_TIMEOUT_MS),
  });

/** The session's side: its server's list when the account is paired, else this backend's own. */
export function favoritesRouter(
  s: FavoriteStores,
  serverOf: (req: Request) => PairedServer | null,
): Router {
  const r = Router();
  r.all(
    "/",
    wrap(async (req, res) => {
      const sub = subOf(req);
      if (!sub)
        return res.status(401).json({ error: "no user on the session" });
      if (req.method !== "GET" && req.method !== "POST")
        return res.status(405).json({ error: "GET or POST" });
      const server = serverOf(req);
      if (!server) return answerHere(s, sub, req, res);
      const body =
        req.method === "POST" ? starSchema.safeParse(req.body) : undefined;
      if (body && !body.success)
        return res
          .status(400)
          .json({ error: "expected { paths: string[], favorite: boolean }" });
      try {
        // Stars made here before the pairing go up once; from then on this machine keeps none.
        const mine = listOf(s, sub);
        if (mine.length) {
          const up = await callServer(server, { paths: mine, favorite: true });
          if (up.ok) s.own.write(sub, { favorites: [] });
        }
        const got = await callServer(server, body?.data);
        res.status(got.status).json(await got.json());
      } catch (e) {
        res.status(502).json({
          error: `could not reach ${server.base} for the favorites: ${(e as Error).message}`,
        });
      }
    }),
  );
  return r;
}
