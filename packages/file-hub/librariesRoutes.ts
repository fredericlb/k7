// librariesRoutes.ts — `/account/libraries`, answered by the HUB and never forwarded: the list and
// the folders are the origin's, not an account's, so no account's file service holds them. Reading
// is everyone's; changing the list is the admins'. See docs/fileHub.md.

import type { PublishLibraryBody } from "@studio/web-protocol";
import type { Request, Response } from "express";
import type { LibraryStore } from "./libraries.ts";

/** The most a body read here may weigh: the file service's own limit, ENGINE_BODY_LIMIT. */
export const JSON_BODY_MAX = 8 * 1024 * 1024;

/** Thrown by `jsonBody` past JSON_BODY_MAX, rather than reading on or handing back an empty body. */
export class BodyTooLargeError extends Error {
  readonly status = 413;
}

/** The JSON body, whether a parser in front already read it or not — the hub's paths are not parsed. */
export async function jsonBody(req: Request): Promise<unknown> {
  if (req.readableEnded) return req.body ?? {};
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req as AsyncIterable<Buffer>) {
    size += chunk.length;
    if (size > JSON_BODY_MAX)
      throw new BodyTooLargeError(`body over ${JSON_BODY_MAX} bytes`);
    chunks.push(chunk);
  }
  // Joined as bytes, so a character split across two chunks is decoded whole.
  const text = Buffer.concat(chunks).toString("utf8");
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    return {};
  }
}

/** Whether this request is one of these routes, by its path under the hub. */
export const isLibrariesPath = (path: string): boolean =>
  path === "/account/libraries" || path.startsWith("/account/libraries/");

export async function librariesRoute(
  store: LibraryStore,
  req: Request,
  res: Response,
  admin: boolean,
  onChange: () => void,
): Promise<void> {
  const sub = req.path.slice("/account/libraries".length) || "/";
  if (req.method === "GET" && sub === "/") {
    res.json(store.view(await store.ensure()));
    return;
  }
  if (req.method === "PUT" && sub === "/") {
    if (!admin) {
      res
        .status(403)
        .json({ error: "only the origin's admins may change the libraries" });
      return;
    }
    const body = (await jsonBody(req)) as { libraries?: { name?: unknown }[] };
    if (!Array.isArray(body.libraries)) {
      res.status(400).json({ error: "expected { libraries: [{ name }] }" });
      return;
    }
    const r = await store.set(
      body.libraries.map((l) => ({ name: String(l?.name ?? "").trim() })),
    );
    if ("error" in r) res.status(400).json({ error: r.error });
    else {
      onChange();
      res.json(r.reply);
    }
    return;
  }
  const publish = /^\/([^/]+)\/publish$/.exec(sub);
  if (req.method === "POST" && publish) {
    if (!admin) {
      res
        .status(403)
        .json({ error: "only the origin's admins may publish a library" });
      return;
    }
    const body = (await jsonBody(req)) as PublishLibraryBody;
    const r = await store.publish(decodeURIComponent(publish[1]), {
      requires: typeof body.requires === "number" ? body.requires : undefined,
      notes: typeof body.notes === "string" ? body.notes : undefined,
    });
    if ("error" in r) res.status(400).json({ error: r.error });
    else {
      onChange();
      res.json(store.view());
    }
    return;
  }
  res.status(404).json({ error: `no ${req.method} ${req.path}` });
}
