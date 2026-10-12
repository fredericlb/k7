// pairSync.ts — pair this machine's signed-in account with the ORIGIN's relay, once, through the system browser:
// the origin mints a device token and sends it to a loopback port, and the local backend keeps it for that account.
// The token never passes through a window: a page could be anything. See docs/sync.md.

import { randomBytes } from "node:crypto";
import { createServer, type Server } from "node:http";
import { hostname } from "node:os";
import { line } from "@frediverse/electron-shell/log";
import {
  SYNC_PAIR_RETURN_PATH,
  syncPairUrl,
} from "@studio/web-protocol/pairing";
import { STUDIO_ORIGIN } from "@studio/web-protocol/services";
import { session, shell } from "electron";

/** A pairing left unfinished in the browser stops listening after this. */
const WAIT_MS = 10 * 60_000;

const PAGE = (
  said: string,
) => `<!doctype html><meta charset="utf-8"><title>st0</title>
<body style="font:16px system-ui;background:#101114;color:#e4e4e7;display:grid;place-items:center;height:100vh;margin:0">
<p>${said}</p>`;

/** The origin this machine syncs with; overridable for a test origin. */
export const syncOrigin = (): string =>
  process.env.ST0_SYNC_ORIGIN?.trim() || STUDIO_ORIGIN;

let pending: Server | null = null;
/** Accounts asked this run: a pairing the person closed is not reopened at every cookie change. */
const asked = new Set<string>();

/** Through the app's own session, so the local backend knows which account is asking. */
async function local<T>(
  st0: string,
  path: string,
  init?: RequestInit,
): Promise<T | null> {
  const r = await session.defaultSession
    .fetch(`${st0}${path}`, init)
    .catch(() => null);
  return r?.ok ? ((await r.json()) as T) : null;
}

/** Pair the account signed in here, unless it is the local user, already paired, or already asked this run. */
export async function pairIfNeeded(st0: string): Promise<void> {
  const me = await local<{ user?: { email?: string; local?: boolean } }>(
    st0,
    "/auth/me",
  );
  const email = me?.user?.email;
  if (!email || me?.user?.local || asked.has(email)) return;
  const remote = await local<{ paired: boolean }>(st0, "/api/sync/remote");
  if (!remote || remote.paired) return;
  asked.add(email);
  pending?.close();
  const state = randomBytes(16).toString("base64url");
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    const p = url.searchParams;
    if (url.pathname !== SYNC_PAIR_RETURN_PATH || p.get("state") !== state) {
      res.writeHead(404).end();
      return;
    }
    server.close();
    pending = null;
    // The browser may be signed in to the origin as someone else: their token must not sync this account.
    if (p.get("identity") !== email) {
      line(
        "app",
        `sync pairing refused: the browser is signed in as ${p.get("identity")}, not ${email}`,
      );
      res
        .writeHead(409, { "Content-Type": "text/html; charset=utf-8" })
        .end(
          PAGE(
            `The browser is signed in to st0 as another account. Sign in there as ${email} and try again.`,
          ),
        );
      return;
    }
    res
      .writeHead(200, { "Content-Type": "text/html; charset=utf-8" })
      .end(
        PAGE("This machine now syncs your workspaces. You can close this tab."),
      );
    void local(st0, "/api/sync/remote", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url: p.get("url"), token: p.get("token") }),
    }).then((done) =>
      line(
        "app",
        done
          ? `sync paired with ${syncOrigin()}`
          : "sync pairing could not be stored",
      ),
    );
  });
  pending = server;
  server.listen(0, "127.0.0.1", () => {
    const address = server.address();
    if (!address || typeof address === "string") return;
    const back = `http://127.0.0.1:${address.port}${SYNC_PAIR_RETURN_PATH}`;
    void shell.openExternal(syncPairUrl(syncOrigin(), back, state, hostname()));
  });
  setTimeout(() => {
    if (pending === server) {
      server.close();
      pending = null;
    }
  }, WAIT_MS).unref();
}
