// librariesRoutes.ts — `/account/libraries*`, answered by the HUB and never forwarded: the list and
// the clones are the origin's, not an account's, so no account's file service holds them. Reading
// and retrying a clone are everyone's; changing the list, forcing a pull and the server's key are the admins'.
// See docs/fileHub.md.

import type { Request, Response } from "express";
import type { LibraryStore } from "./libraries.ts";

/** The JSON body, whether a parser in front already read it or not. */
export async function jsonBody(req: Request): Promise<unknown> {
  if (req.readableEnded) return req.body ?? {};
  let text = "";
  for await (const chunk of req) text += chunk;
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    return {};
  }
}

const refuse = (res: Response) =>
  res
    .status(403)
    .json({ error: "only the origin's admins may change the libraries" });

/** Whether this request is one of these routes, by its path under the hub. */
export const isLibrariesPath = (path: string): boolean =>
  path === "/account/libraries" || path.startsWith("/account/libraries/");

export async function librariesRoute(
  store: LibraryStore,
  req: Request,
  res: Response,
  admin: boolean,
): Promise<void> {
  const sub = req.path.slice("/account/libraries".length) || "/";
  if (req.method === "GET" && sub === "/") {
    // A library added a minute ago is cloned behind the answer, at most once a minute.
    void store.sync().catch(() => undefined);
    res.json(store.view());
    return;
  }
  // Clone again what failed — a deploy key just added at the host, say. Anyone may: it changes nothing anybody wrote.
  if (req.method === "POST" && sub === "/retry") {
    const body = (await jsonBody(req)) as { name?: unknown };
    const name = typeof body.name === "string" ? body.name : undefined;
    res.json(store.view(await store.sync({ name, force: true })));
    return;
  }
  if (!admin) {
    refuse(res);
    return;
  }
  if (req.method === "GET" && sub === "/key") {
    res.json({ publicKey: await store.key() });
    return;
  }
  if (req.method === "POST" && sub === "/update") {
    res.json(store.view(await store.sync({ force: true })));
    return;
  }
  if (req.method === "PUT" && sub === "/") {
    const body = (await jsonBody(req)) as {
      libraries?: { name?: unknown; uri?: unknown }[];
      uri?: unknown;
      name?: unknown;
    };
    const entries = Array.isArray(body.libraries)
      ? body.libraries
      : typeof body.uri === "string"
        ? [...store.settings(), { name: body.name, uri: body.uri }]
        : null;
    if (!entries) {
      res
        .status(400)
        .json({ error: "expected { libraries: [...] } or { uri }" });
      return;
    }
    const asked = entries.map((l) => ({
      name: typeof l.name === "string" ? l.name.trim() : undefined,
      uri: String(l.uri ?? "").trim(),
    }));
    const r = await store.set(asked);
    if ("error" in r) res.status(400).json({ error: r.error });
    else res.json(r.reply);
    return;
  }
  res.status(404).json({ error: `no ${req.method} ${req.path}` });
}
