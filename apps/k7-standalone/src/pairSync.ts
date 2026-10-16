// pairSync.ts — pair this machine's signed-in account with a server's relay, through the system browser: the
// server mints a device token and sends it to a loopback port, and the local backend keeps it for that account.
// The server chosen at sign-in is the MAIN one; others are added beside it. The token never passes through a
// window: a page could be anything. See docs/sync.md.

import { randomBytes } from "node:crypto";
import { createServer, type Server } from "node:http";
import { hostname } from "node:os";
import { openExternalSafely } from "@frediverse/electron-shell/external";
import { line } from "@frediverse/electron-shell/log";
import {
  normalizeServer,
  SYNC_PAIR_RETURN_PATH,
  SYNC_RELAY_PATH,
  syncPairUrl,
} from "@studio/web-protocol/pairing";
import { dialog, session } from "electron";
import { onCancel, setAccountStatus } from "./accountStatus.ts";
import { chosenServer } from "./server.ts";

/** A pairing left unfinished in the browser stops listening after this. */
const WAIT_MS = 10 * 60_000;

const PAGE = (
  said: string,
) => `<!doctype html><meta charset="utf-8"><title>k7</title>
<body style="font:16px system-ui;background:#101114;color:#e4e4e7;display:grid;place-items:center;height:100vh;margin:0">
<p>${said}</p>`;

/** The server this machine syncs with: the one chosen at sign-in (server.ts). */
export const syncOrigin = (): string => chosenServer();

/** The relay's socket at a server's origin: `https://app.k7.rocks` → `wss://app.k7.rocks/api/sync`. */
const relayOf = (origin: string): string =>
  `${origin.replace(/^http/, "ws")}${SYNC_RELAY_PATH}`;

/** The host a relay or server URL names, for comparing a pairing with the server chosen. */
const hostOf = (url: string): string => {
  try {
    return new URL(url).host;
  } catch {
    return "";
  }
};

let pending: Server | null = null;
let forget: () => void = () => undefined;

/** Stop listening for `server`'s token; true when it was still the one waited for. */
function abandon(server: Server): boolean {
  if (pending !== server) return false;
  server.close();
  pending = null;
  forget();
  return true;
}

/** The second browser trip, right after the sign-in's, said before it happens; false when the person declines it. */
async function confirmPairing(origin: string): Promise<boolean> {
  const { response } = await dialog.showMessageBox({
    type: "info",
    title: "k7",
    message:
      "Now k7 opens your browser once more to link this computer's workspaces",
    detail: `${new URL(origin).host} asks you to confirm, in the browser, that this computer may sync your account's workspaces. Not now leaves them on this computer only; Add a server on the home page asks again.`,
    buttons: ["Open the browser", "Not now"],
    defaultId: 0,
    cancelId: 1,
  });
  return response === 0;
}

/** Account and server pairs asked this run: a pairing the person closed is not reopened at every cookie change. */
const asked = new Set<string>();

/** Through the app's own session, so the local backend knows which account is asking. */
async function local<T>(
  k7: string,
  path: string,
  init?: RequestInit,
): Promise<T | null> {
  const r = await session.defaultSession
    .fetch(`${k7}${path}`, init)
    .catch(() => null);
  return r?.ok ? ((await r.json()) as T) : null;
}

/** The account signed in here, or null for the local user and for nobody. */
async function account(k7: string): Promise<string | null> {
  const me = await local<{ user?: { email?: string; local?: boolean } }>(
    k7,
    "/auth/me",
  );
  return me?.user?.email && !me.user.local ? me.user.email : null;
}

/** The servers the account is paired with, by host; null when the local backend cannot say. */
async function pairedHosts(k7: string): Promise<Set<string> | null> {
  const remote = await local<{ servers?: { url: string }[] }>(
    k7,
    "/api/sync/remote",
  );
  return remote
    ? new Set((remote.servers ?? []).map((r) => hostOf(r.url)))
    : null;
}

/** Pair the account with the server chosen at sign-in, as its MAIN one, unless it already syncs with that server. */
export async function pairIfNeeded(k7: string): Promise<void> {
  const email = await account(k7);
  if (!email || asked.has(`${email} ${syncOrigin()}`)) return;
  const hosts = await pairedHosts(k7);
  // Already a server of this account, main or not: which one is main is the person's choice, kept by the hub.
  if (!hosts || hosts.has(hostOf(syncOrigin()))) return;
  asked.add(`${email} ${syncOrigin()}`);
  if (await confirmPairing(syncOrigin())) pair(k7, email, syncOrigin(), true);
}

/** Pair the account with ANOTHER server beside its main one — the home page's Add server; false when it cannot. */
export async function addServer(k7: string, input: string): Promise<boolean> {
  const origin = normalizeServer(input);
  const email = await account(k7);
  if (!origin || !email) return false;
  const hosts = await pairedHosts(k7);
  if (!hosts || hosts.has(hostOf(origin))) return false;
  // The first one paired is the main one whatever it was asked as.
  pair(k7, email, origin, hosts.size === 0);
  return true;
}

/** The pairing itself: the browser on `origin`'s pairing page, the token back on loopback, kept by the local backend. */
function pair(k7: string, email: string, origin: string, main: boolean): void {
  if (pending) abandon(pending);
  const state = randomBytes(16).toString("base64url");
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    const p = url.searchParams;
    if (url.pathname !== SYNC_PAIR_RETURN_PATH || p.get("state") !== state) {
      res.writeHead(404).end();
      return;
    }
    abandon(server);
    // The browser may be signed in to the server as someone else: their token must not sync this account.
    if (p.get("identity") !== email) {
      line(
        "app",
        `sync pairing refused: the browser is signed in as ${p.get("identity")}, not ${email}`,
      );
      setAccountStatus({ state: "error", code: "pairRefused", detail: email });
      res
        .writeHead(409, { "Content-Type": "text/html; charset=utf-8" })
        .end(
          PAGE(
            `The browser is signed in to k7 as another account. Sign in there as ${email} and try again.`,
          ),
        );
      return;
    }
    res
      .writeHead(200, { "Content-Type": "text/html; charset=utf-8" })
      .end(
        PAGE("This machine now syncs your workspaces. You can close this tab."),
      );
    void local(k7, "/api/sync/remote", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      // The relay is reached where the person named the server, whatever host a proxy showed it.
      body: JSON.stringify({
        url: relayOf(origin),
        token: p.get("token"),
        main,
      }),
    }).then((done) => {
      line(
        "app",
        done
          ? `sync paired with ${origin}${main ? " (main)" : ""}`
          : "sync pairing could not be stored",
      );
      const host = new URL(origin).host;
      setAccountStatus(
        done
          ? { state: "done", code: "paired", detail: host }
          : { state: "error", code: "pairNotStored", detail: host },
      );
    });
  });
  pending = server;
  forget = onCancel(() => abandon(server));
  setAccountStatus({ state: "waiting", what: "pair" });
  server.on("error", (e) => {
    line("app", `sync pairing could not listen: ${e.message}`);
    if (abandon(server))
      setAccountStatus({ state: "error", code: "pairFailed" });
  });
  server.listen(0, "127.0.0.1", () => {
    const address = server.address();
    if (!address || typeof address === "string") return;
    const back = `http://127.0.0.1:${address.port}${SYNC_PAIR_RETURN_PATH}`;
    openExternalSafely(syncPairUrl(origin, back, state, hostname()));
  });
  setTimeout(() => {
    if (abandon(server))
      setAccountStatus({ state: "error", code: "pairTimeout" });
  }, WAIT_MS).unref();
}
