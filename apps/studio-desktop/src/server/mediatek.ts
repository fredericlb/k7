// mediatek.ts — with no server to ask, the médiathèque panel browses what THIS machine has
// cached instead of showing an empty list. The file service already serves exactly that set,
// out of the same `@studio/mediatek` catalogue, so this maps pl8's four read routes onto it
// rather than reimplementing them. Reads only: an upload has nowhere to go without a server.
// See ../../docs/mediatek.md.

import { Readable } from "node:stream";
import { ENGINE_TOKEN_HEADER, USER_HEADER } from "@studio/web-protocol";
import type { Express, Request, Response } from "express";
import { line } from "../logbus.ts";

/** The routes pl8 and the file service both answer, under different prefixes. */
const READS = new Set(["list", "search", "revision", "file"]);

export interface CacheConfig {
  /** The file service's port, from settings — 8770 unless someone moved it. */
  filePort: number;
  /** The engine's token, which is what gates every header-carrying call to the file service. */
  engineToken: string | null;
  /** Who is asking; taken on faith by `resolveUser`, and the médiathèque needs no workspace. */
  user: string;
}

export type ReadCache = () => CacheConfig;

/** Headers worth carrying back, and no others: the rest belong to the hop. */
const PASS_BACK = [
  "content-type",
  "content-length",
  "content-range",
  "accept-ranges",
  "last-modified",
  "etag",
];

export function mountMediatekCache(app: Express, read: ReadCache): void {
  app.get(
    /^\/pl8\/api\/mediatek\/([a-z-]+)$/,
    async (req: Request, res: Response, next) => {
      const what = req.params[0] ?? "";
      if (!READS.has(what)) return next();

      const { filePort, engineToken, user } = read();
      const target = new URL(`http://127.0.0.1:${filePort}/mediatek/${what}`);
      for (const [k, v] of Object.entries(req.query)) {
        if (typeof v === "string") target.searchParams.set(k, v);
      }

      const headers = new Headers({ [USER_HEADER]: user });
      if (engineToken) headers.set(ENGINE_TOKEN_HEADER, engineToken);
      // Range is the whole reason `file` is streamed rather than buffered: an <audio> element
      // seeks by asking for one, and a proxy that swallowed it would make a song unseekable.
      const range = req.headers.range;
      if (range) headers.set("range", range);

      try {
        const up = await fetch(target, {
          headers,
          signal: AbortSignal.timeout(30_000),
        });
        res.status(up.status);
        for (const h of PASS_BACK) {
          const v = up.headers.get(h);
          if (v) res.setHeader(h, v);
        }
        if (!up.body) return res.end();
        // Streamed, not buffered: a song is not a JSON body, and the panel plays it in place.
        Readable.fromWeb(
          up.body as Parameters<typeof Readable.fromWeb>[0],
        ).pipe(res);
      } catch (e) {
        // The file service being down is what the red icon already says; the panel gets the
        // shim's sentence rather than a hang or a stack.
        line("host", `médiathèque cache unreachable (${String(e)})`);
        next();
      }
    },
  );
}
