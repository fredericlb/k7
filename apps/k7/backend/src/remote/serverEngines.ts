// serverEngines.ts — a machine's own backend listing the engines its MAIN server lists for the link's account, through
// that server's device door, each marked `via` that server so the page drives it through the server's relay.
// The one thing a reader would get wrong: nothing here relays an engine; the page dials the server's relay itself,
// with the ticket the server minted for that account. ../../docs/serverEngines.md.

import type {
  EngineVia,
  PublicEngine,
  ServerEngines,
} from "@studio/web-protocol";
import type { Request, RequestHandler } from "express";
import { DEVICE_HEADER, DOOR_PATH } from "./door.ts";

/** The main link of the session's account: its http origin, its device token and the remote account; null when none. */
export type MainLinkOf = (
  req: Request,
) => { base: string; token: string; account?: string } | null;

/** How long one answer is reused: well inside the minute a relay ticket lives, and long enough to fold a page's bursts. */
export const SERVER_ENGINES_TTL_MS = 5_000;
/** How long the server has to answer: the page's own list waits beside this one. */
export const SERVER_ENGINES_TIMEOUT_MS = 4_000;

/** The roles a page may drive through the server; an unowned stranger's engine is not offered from afar. */
const DRIVABLE = new Set(["owner", "shared", "server"]);

/** The server's listing as this machine offers it: only what the account may drive, each `via` the server, no WebRTC. */
export function throughServer(
  listed: readonly PublicEngine[],
  via: EngineVia,
): PublicEngine[] {
  return listed.flatMap((e) =>
    e?.id && e.proxyTicket && DRIVABLE.has(e.access ?? "")
      ? [{ ...e, rtc: undefined, via }]
      : [],
  );
}

/** The route's handler; `fetchImpl` and `now` are injected for the tests. */
export function serverEnginesRoute(
  linkOf: MainLinkOf,
  fetchImpl: typeof fetch = fetch,
  now: () => number = Date.now,
): RequestHandler {
  // One entry per link, so two accounts on this machine never read each other's list.
  const cache = new Map<string, { at: number; p: Promise<ServerEngines> }>();

  const ask = async (
    link: NonNullable<ReturnType<MainLinkOf>>,
    via: EngineVia,
  ): Promise<ServerEngines> => {
    try {
      const res = await fetchImpl(`${link.base}${DOOR_PATH}/api/engines`, {
        headers: { [DEVICE_HEADER]: link.token },
        signal: AbortSignal.timeout(SERVER_ENGINES_TIMEOUT_MS),
      });
      if (!res.ok) return { server: via, reachable: false, engines: [] };
      const listed = (await res.json()) as unknown;
      const engines = Array.isArray(listed)
        ? throughServer(listed as PublicEngine[], via)
        : [];
      return { server: via, reachable: true, engines };
    } catch {
      return { server: via, reachable: false, engines: [] };
    }
  };

  return (req, res) => {
    const link = linkOf(req);
    if (!link)
      return void res.json({
        server: null,
        reachable: false,
        engines: [],
      } satisfies ServerEngines);
    const via: EngineVia = {
      origin: link.base,
      host: new URL(link.base).host,
      ...(link.account ? { account: link.account } : {}),
    };
    const key = `${link.base}|${link.token}`;
    const hit = cache.get(key);
    const t = now();
    const entry =
      hit && t - hit.at < SERVER_ENGINES_TTL_MS
        ? hit
        : { at: t, p: ask(link, via) };
    cache.set(key, entry);
    // Expired entries go as they are replaced; a link forgotten leaves one small entry until the process ends.
    for (const [k, v] of cache)
      if (k !== key && t - v.at >= SERVER_ENGINES_TTL_MS) cache.delete(k);
    void entry.p.then((body) => res.json(body));
  };
}
