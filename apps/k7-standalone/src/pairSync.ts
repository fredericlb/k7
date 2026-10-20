// pairSync.ts — pair this machine's signed-in account with a server's relay, through the system browser. The
// pairing itself is the local backend's (packages/file-hub/pairRoutes.ts, shared with the phones): this file asks
// it whether to offer one, opens the URL it answers, and tells the account bar how it ended. The browser brings
// the token back to the backend's own port, never through a window: a page could be anything. See docs/sync.md.

import { hostname } from "node:os";
import { openExternalSafely } from "@frediverse/electron-shell/external";
import { line } from "@frediverse/electron-shell/log";
import { normalizeServer } from "@studio/web-protocol/pairing";
import { dialog, session } from "electron";
import { onCancel, setAccountStatus } from "./accountStatus.ts";
import { chosenServer } from "./server.ts";

/** The local backend's pairing routes. */
const PAIR_API = "/api/sync/remote/pair";
/** One long poll of the backend while the browser is in front. */
const POLL_MS = 25_000;

interface Pairing {
  state: string;
  email: string;
  host: string;
  phase: "waiting" | "paired" | "otherAccount" | "notStored" | "expired";
}

interface Offer {
  email: string;
  local: boolean;
  paired: boolean;
  servers: number;
}

/** The server this machine syncs with: the one chosen at sign-in (server.ts). */
const syncOrigin = (): string => chosenServer();

/** The state of the pairing this process waits on; null when none. */
let current: string | null = null;
let forget: () => void = () => undefined;

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

/** Stop waiting, and have the backend drop the pairing: the browser's return then finds nothing. */
function abandon(k7: string): void {
  if (current) void local(k7, `${PAIR_API}/${current}`, { method: "DELETE" });
  current = null;
  forget();
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

/** What the backend says of the signed-in account and `origin`; null for the local user, nobody, or no answer. */
async function offer(k7: string, origin: string): Promise<Offer | null> {
  const o = await local<Offer>(
    k7,
    `${PAIR_API}?origin=${encodeURIComponent(origin)}`,
  );
  return o?.email && !o.local ? o : null;
}

/** Pair the account with the server chosen at sign-in, as its MAIN one, unless it already syncs with that server. */
export async function pairIfNeeded(k7: string): Promise<void> {
  const origin = syncOrigin();
  const o = await offer(k7, origin);
  // Already a server of this account, main or not: which one is main is the person's choice, kept by the hub.
  if (!o || o.paired || asked.has(`${o.email} ${origin}`)) return;
  asked.add(`${o.email} ${origin}`);
  if (await confirmPairing(origin)) void pair(k7, origin, true);
}

/** Pair the account with ANOTHER server beside its main one — the home page's Add server; false when it cannot. */
export async function addServer(k7: string, input: string): Promise<boolean> {
  const origin = normalizeServer(input);
  const o = origin ? await offer(k7, origin) : null;
  if (!origin || !o || o.paired) return false;
  // The first one paired is the main one whatever it was asked as.
  void pair(k7, origin, o.servers === 0);
  return true;
}

/** The pairing once it is no longer waiting; null when it went or the backend stopped answering. */
async function settled(k7: string, state: string): Promise<Pairing | null> {
  while (current === state) {
    const r = await local<{ pairing: Pairing }>(
      k7,
      `${PAIR_API}/${state}?wait=${POLL_MS}`,
    );
    if (!r) return null;
    if (r.pairing.phase !== "waiting") return r.pairing;
  }
  return null;
}

/** The pairing itself: started by the backend, the browser on the server's pairing page, its ending told. */
async function pair(k7: string, origin: string, main: boolean): Promise<void> {
  abandon(k7);
  const started = await local<{ url: string; pairing: Pairing }>(k7, PAIR_API, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ origin, name: hostname(), main }),
  });
  if (!started) {
    line("app", "sync pairing could not start");
    return setAccountStatus({ state: "error", code: "pairFailed" });
  }
  const { state } = started.pairing;
  current = state;
  forget = onCancel(() => abandon(k7));
  if (!openExternalSafely(started.url)) {
    abandon(k7);
    return setAccountStatus({ state: "error", code: "pairFailed" });
  }
  setAccountStatus({ state: "waiting", what: "pair" });
  const ended = await settled(k7, state);
  // Cancelled, or replaced by another pairing: whoever took over says how it ends.
  if (current !== state) return;
  current = null;
  forget();
  if (!ended) return setAccountStatus({ state: "error", code: "pairFailed" });
  void local(k7, `${PAIR_API}/${state}`, { method: "DELETE" });
  line("app", `sync pairing with ${ended.host}: ${ended.phase}`);
  if (ended.phase === "paired")
    setAccountStatus({ state: "done", code: "paired", detail: ended.host });
  else if (ended.phase === "otherAccount")
    setAccountStatus({
      state: "error",
      code: "pairRefused",
      detail: ended.email,
    });
  else if (ended.phase === "expired")
    setAccountStatus({ state: "error", code: "pairTimeout" });
  else
    setAccountStatus({
      state: "error",
      code: "pairNotStored",
      detail: ended.host,
    });
}
