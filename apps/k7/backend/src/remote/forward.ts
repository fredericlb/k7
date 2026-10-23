// forward.ts — the paired machine's side: what its page asks under SERVER_PATH goes to the account's paired server,
// through that server's device door, with the device token beside the page's own headers. Bodies and answers stream,
// so a track plays and an upload lands as they would on the server. Whose server is the SESSION's: ../../docs/serverPicker.md.

import { Readable } from "node:stream";
import type { Request, RequestHandler } from "express";
import { DEVICE_HEADER, DOOR_PATH } from "./door.ts";

/** Where this machine's page reaches its paired server: `/api/server/api/mediatek/…` is the server's `/api/mediatek/…`. */
export const SERVER_PATH = "/api/server";

/** The account's paired server and its device token, or null when the account is paired with none. */
export type PairedServerOf = (
  req: Request,
) => { base: string; token: string } | null;

/** This hop's own headers, and this origin's identity: never sent on to the server. */
const NOT_SENT = new Set([
  "host",
  "cookie",
  "origin",
  "referer",
  "connection",
  "keep-alive",
  "transfer-encoding",
  "content-length",
  "accept-encoding",
  DEVICE_HEADER,
]);

/** Headers that describe the server's hop, or a body `fetch` already decoded: not passed back. */
const NOT_RETURNED = new Set([
  "connection",
  "keep-alive",
  "transfer-encoding",
  "content-encoding",
  "content-length",
  "set-cookie",
]);

/** The body this backend's JSON parser already read, as bytes again; null when nobody read it and it can stream. */
function parsedBody(req: Request): Buffer | null {
  if (!req.readableEnded) return null;
  const b = req.body as unknown;
  if (b === undefined || b === null) return Buffer.alloc(0);
  if (Buffer.isBuffer(b)) return b;
  return Buffer.from(typeof b === "string" ? b : JSON.stringify(b));
}

/** Mounted at SERVER_PATH behind the session: 503 with a reason when there is no server to reach. */
export function forwardToPairedServer(
  serverOf: PairedServerOf,
): RequestHandler {
  return (req, res) => {
    const s = serverOf(req);
    if (!s)
      return void res.status(503).json({
        error: "this account is paired with no server",
        reason: "unpaired",
      });
    const headers: Record<string, string> = { [DEVICE_HEADER]: s.token };
    for (const [k, v] of Object.entries(req.headers))
      if (!NOT_SENT.has(k) && typeof v === "string") headers[k] = v;
    const hasBody = req.method !== "GET" && req.method !== "HEAD";
    const parsed = hasBody ? parsedBody(req) : null;
    const init: RequestInit & { duplex?: "half" } = {
      method: req.method,
      headers,
      redirect: "manual",
      // Long: an upload of a take, or a track played to its end.
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
    // `req.url` is what follows SERVER_PATH, query included.
    const target = `${s.base}${DOOR_PATH}${req.url}`;
    fetch(target, init).then(
      (up) => {
        res.status(up.status);
        up.headers.forEach((v, k) => {
          if (!NOT_RETURNED.has(k)) res.setHeader(k, v);
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
