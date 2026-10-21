// browserAccount.ts — signing in and pairing from the page itself, when it is served by the tray's backend in a browser.
// Sign-in is the backend's own /auth/login, the address bar being right there; pairing is the backend's
// /api/sync/remote/pair, its trip to the server opened in a tab of its own from a click, which a browser allows.
// See ../../docs/localApp.md and packages/file-hub/docs/syncRelay.md, "Pairing through the browser".

import type { AccountStatus } from "./bridge";

const SERVER_KEY = "k7.syncServer";
// Set by a sign-in, read once back on the page: the server to offer pairing with.
const PAIR_KEY = "k7.pairAfterSignIn";

interface Pairing {
  state: string;
  host: string;
  phase: "waiting" | "paired" | "otherAccount" | "expired" | "notStored";
  browserAs: string | null;
}

let status: AccountStatus = { state: "idle" };
const listeners = new Set<(s: AccountStatus) => void>();
const set = (s: AccountStatus): void => {
  status = s;
  for (const l of listeners) l(s);
};
let current: string | null = null;

const store = (k: Storage | undefined, key: string, v: string | null) => {
  try {
    if (v === null) k?.removeItem(key);
    else k?.setItem(key, v);
  } catch {
    // A private window keeps nothing; the next sign-in asks again.
  }
};
const read = (k: Storage | undefined, key: string): string | null => {
  try {
    return k?.getItem(key) ?? null;
  } catch {
    return null;
  }
};

/** How a pairing that left `waiting` reads in the account bar. */
function ending(p: Pairing): AccountStatus {
  if (p.phase === "paired")
    return { state: "done", code: "paired", detail: p.host };
  if (p.phase === "otherAccount")
    return { state: "error", code: "pairRefused", detail: p.browserAs ?? "" };
  if (p.phase === "expired") return { state: "error", code: "pairTimeout" };
  return { state: "error", code: "pairNotStored" };
}

/** Held on the backend's long poll until the browser tab comes back, then told and forgotten. */
async function follow(state: string): Promise<boolean> {
  for (;;) {
    const r = await fetch(`/api/sync/remote/pair/${state}?wait=25000`, {
      cache: "no-store",
    }).catch(() => null);
    if (!r?.ok) {
      set({ state: "idle" });
      return false;
    }
    const { pairing } = (await r.json()) as { pairing: Pairing };
    if (pairing.phase === "waiting") continue;
    void fetch(`/api/sync/remote/pair/${state}`, { method: "DELETE" });
    set(ending(pairing));
    return pairing.phase === "paired";
  }
}

/** Pair this machine with `server` from a click: the server's page opens in a new tab, which the page then waits on. */
async function pair(server: string, main: boolean): Promise<boolean> {
  // Opened first, inside the click: a window opened after an await is a pop-up a browser blocks.
  const tab = window.open("about:blank", "_blank");
  const r = await fetch("/api/sync/remote/pair", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ origin: server, main }),
  }).catch(() => null);
  if (r?.status === 409) {
    tab?.close();
    set({ state: "done", code: "paired", detail: new URL(server).host });
    return true;
  }
  if (!r?.ok) {
    tab?.close();
    set({ state: "error", code: "badServer", detail: server });
    return false;
  }
  const { url, pairing } = (await r.json()) as {
    url: string;
    pairing: Pairing;
  };
  if (tab) tab.location.href = url;
  else window.open(url, "_blank");
  current = pairing.state;
  set({ state: "waiting", what: "pair" });
  return follow(pairing.state);
}

/** The account controls' sign-in and pairing in a browser (./bridge.ts). */
export const browserAccount = {
  signIn(server?: string): void {
    if (server) {
      store(globalThis.localStorage, SERVER_KEY, server);
      store(globalThis.sessionStorage, PAIR_KEY, server);
    }
    const back = encodeURIComponent(location.pathname + location.search);
    location.assign(`/auth/login?return_to=${back}`);
  },
  server: async (): Promise<string | null> =>
    read(globalThis.localStorage, SERVER_KEY),
  authStatus: async (): Promise<AccountStatus | null> => {
    const server = read(globalThis.sessionStorage, PAIR_KEY);
    if (status.state !== "idle" || !server) return status;
    // Back from a sign-in: offered once, unless the account already syncs with it.
    store(globalThis.sessionStorage, PAIR_KEY, null);
    const r = await fetch(
      `/api/sync/remote/pair?origin=${encodeURIComponent(server)}`,
      { cache: "no-store" },
    ).catch(() => null);
    const asked = r?.ok
      ? ((await r.json()) as { local: boolean; paired: boolean })
      : null;
    if (asked && !asked.local && !asked.paired) set({ state: "offer", server });
    return status;
  },
  onAuthStatus(cb: (s: AccountStatus) => void): () => void {
    listeners.add(cb);
    return () => listeners.delete(cb);
  },
  cancelSignIn(): void {
    if (current)
      void fetch(`/api/sync/remote/pair/${current}`, { method: "DELETE" });
    current = null;
    set({ state: "idle" });
  },
  /** The offer's button: the main server, being the first. */
  pair: (server: string): Promise<boolean> => pair(server, true),
  addServer: (server: string): Promise<boolean> => pair(server, false),
};
