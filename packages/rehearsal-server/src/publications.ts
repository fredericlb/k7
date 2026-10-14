// publications.ts — releases and pages live on the SERVER alone. A local instance (a desktop, a phone)
// forwards their routes to its paired server as the person who paired it, and answers 503 when it cannot.
// What reads wrong: the server serves them twice, to sessions at /api and to devices at DEVICE_ROUTE — ../docs/publications.md.

import { Readable } from "node:stream";
import type { PublicationsStatus } from "@studio/rehearsal-shared";
import { type Request, type RequestHandler, Router } from "express";
import { env } from "./env.ts";
import { jsonErrors } from "./errors.ts";
import type * as Declared from "./index.d.ts";
import { pagesRouter } from "./routes/pages.ts";
import { publicPagesRouter } from "./routes/publicPages.ts";
import { releasesRouter } from "./routes/releases.ts";

/** Where the server answers a paired device's releases and pages, behind its device token. */
export const DEVICE_ROUTE: typeof Declared.DEVICE_PUBLICATIONS_ROUTE =
  "/api/sync/k7";

/** The rehearsal routes that live on the server alone, under `/api`. */
export const PUBLICATION_ROUTES = ["/releases", "/pages", "/public/pages"];

type ServerOf = (req: Request) => { base: string; token: string } | null;

/** Headers a request carries through; the session's cookie and the host are this origin's, never sent. */
const REQUEST_HEADERS = [
  "content-type",
  "accept",
  "range",
  "if-none-match",
  "if-modified-since",
];

/** Headers that describe this hop, or a body `fetch` already decoded: not passed back. */
const DROPPED = new Set([
  "connection",
  "keep-alive",
  "transfer-encoding",
  "content-encoding",
  "content-length",
  "set-cookie",
]);

/** The body the host's parser already read, as bytes again; null when nobody read it and it can stream. */
function parsedBody(req: Request): Buffer | null {
  if (!req.readableEnded) return null;
  const b = req.body as unknown;
  if (b === undefined || b === null) return Buffer.alloc(0);
  if (Buffer.isBuffer(b)) return b;
  return Buffer.from(typeof b === "string" ? b : JSON.stringify(b));
}

/** The server's side: the three routers again, with the device's person standing in for the session. */
export const publicationsDeviceRouter: typeof Declared.publicationsDeviceRouter =
  (gate: RequestHandler) => {
    const r = Router();
    r.use(gate);
    r.use((req, res, next) => {
      const person = (
        res.locals.syncCaller as { person?: string | null } | undefined
      )?.person;
      // Releases and pages are somebody's: a token that names nobody reaches none of them.
      if (!person)
        return void res.status(403).json({
          error:
            "this machine was paired before tokens named a person: pair it again",
          reason: "repair",
        });
      (req as { user?: { sub: string } }).user = { sub: person };
      next();
    });
    r.get("/ping", (_req, res) => void res.json({ ok: true }));
    r.use("/releases", releasesRouter);
    r.use("/pages", pagesRouter);
    r.use("/public/pages", publicPagesRouter);
    r.use(jsonErrors);
    return r;
  };

/** On a local instance: every request to a publication route goes to the paired server, or is refused. */
export function forwardToServer(server: ServerOf): RequestHandler {
  return (req, res) => {
    const s = server(req);
    if (!s)
      return void res.status(503).json({
        error:
          "releases and pages live on the server: pair this machine with one",
        reason: "unpaired",
      });
    const headers: Record<string, string> = {
      authorization: `Bearer ${s.token}`,
    };
    for (const h of REQUEST_HEADERS) {
      const v = req.get(h);
      if (v) headers[h] = v;
    }
    const hasBody = req.method !== "GET" && req.method !== "HEAD";
    // A JSON body was already parsed by the host; an upload was not, and streams through.
    const parsed = hasBody ? parsedBody(req) : null;
    if (parsed && req.is("json")) headers["content-type"] = "application/json";
    const init: RequestInit & { duplex?: "half" } = {
      method: req.method,
      headers,
      redirect: "manual",
      // Long: an upload of a mixdown, or a track played to its end.
      signal: AbortSignal.timeout(30 * 60_000),
    };
    if (hasBody) {
      if (parsed) init.body = parsed;
      else {
        init.body = Readable.toWeb(req) as unknown as NonNullable<
          RequestInit["body"]
        >;
        init.duplex = "half";
      }
    }
    // `req.originalUrl` is `/api/releases/…`: the same path under the device's door.
    const target = `${s.base}${DEVICE_ROUTE}${req.originalUrl.replace(/^\/api/, "")}`;
    fetch(target, init).then(
      (up) => {
        res.status(up.status);
        up.headers.forEach((v, k) => {
          if (!DROPPED.has(k)) res.setHeader(k, v);
        });
        if (!up.body) return void res.end();
        const body = Readable.fromWeb(
          up.body as import("node:stream/web").ReadableStream,
        );
        body.on("error", () => res.destroy());
        // A listener who leaves mid-track stops the download from the server too.
        res.on("close", () => body.destroy());
        body.pipe(res);
      },
      (e: Error) => {
        if (res.headersSent) return void res.destroy();
        res.status(503).json({
          error: `the server ${new URL(s.base).host} cannot be reached: ${e.message}`,
          reason: "unreachable",
        });
      },
    );
  };
}

/** Whether releases and pages are reachable from here; on the server, always. */
export function publicationsStatus(server: ServerOf): RequestHandler {
  return (req, res) => {
    const answer = (st: PublicationsStatus) => void res.json(st);
    if (env.instance !== "local") return answer({ available: true });
    const s = server(req);
    if (!s)
      return answer({ available: false, reason: "unpaired", server: null });
    fetch(`${s.base}${DEVICE_ROUTE}/ping`, {
      headers: { authorization: `Bearer ${s.token}` },
      // Short: a page waits on this before it draws anything.
      signal: AbortSignal.timeout(4000),
    }).then(
      (up) =>
        answer(
          up.ok
            ? { available: true, server: s.base }
            : {
                available: false,
                reason: up.status === 403 ? "repair" : "unreachable",
                server: s.base,
              },
        ),
      () => answer({ available: false, reason: "unreachable", server: s.base }),
    );
  };
}
