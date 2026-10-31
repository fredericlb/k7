// browserAccount.ts — signing in and pairing from the page itself, served in a browser by the tray's backend or a server.
// Sign-in is the backend's own /auth/login, the address bar being right there; pairing is the backend's
// /api/sync/remote/pair, its trip to the server opened in a tab of its own from a click, which a browser allows, or no
// tab at all when the backend pairs with that server at once from the account's sign-in (`directHosts`).
// See ../../docs/localApp.md and packages/file-hub/docs/syncRelay.md, "Pairing without the browser".

import type { AccountStatus } from "./bridge";

const SERVER_KEY = "k7.syncServer";
// Set by a sign-in, read once back on the page: the server to offer pairing with.
const PAIR_KEY = "k7.pairAfterSignIn";

interface Pairing {
  state: string;
  host: string;
  /** The local account the link is stored for. */
  email: string;
  phase:
    | "waiting"
    | "paired"
    | "alreadyLinked"
    | "otherAccount"
    | "expired"
    | "notStored";
  /** The account on the server the browser came back as: the link's. */
  browserAs: string | null;
}

let status: AccountStatus = { state: "idle" };
const listeners = new Set<(s: AccountStatus) => void>();
const set = (s: AccountStatus): void => {
  status = s;
  for (const l of listeners) l(s);
};
let current: string | null = null;
// The servers the backend pairs with at once for this session, asked ahead: a tab is opened inside the click or never.
let directHosts = new Set<string>();

const hostOf = (server: string): string => {
  try {
    return new URL(server).host;
  } catch {
    return "";
  }
};

/** Ask the backend which servers it pairs with at once, before any click needs to know. */
async function prepare(): Promise<void> {
  const r = await fetch("/api/sync/remote/pair", { cache: "no-store" }).catch(
    () => null,
  );
  const a = r?.ok ? ((await r.json()) as { directHosts?: string[] }) : null;
  directHosts = new Set(a?.directHosts ?? []);
}

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

/** How a pairing that left `waiting` reads in the account bar: both accounts named, k7's here and the server's. */
function ending(p: Pairing): AccountStatus {
  const as = p.browserAs ?? p.email;
  if (p.phase === "paired")
    return { state: "done", code: "paired", detail: `${p.host} · ${as}` };
  if (p.phase === "alreadyLinked" || p.phase === "otherAccount")
    return {
      state: "error",
      code: "alreadyLinked",
      detail: p.host,
      as,
      local: p.email,
    };
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

/** Pair this machine with `server` from a click, which makes it the active one: the server's page opens in a new tab, waited on here. */
async function pair(server: string, another = false): Promise<boolean> {
  // A server paired with at once needs no tab; any other is opened first, inside the click, or the browser blocks it.
  const silent = !another && directHosts.has(hostOf(server));
  const tab = silent ? null : window.open("about:blank", "_blank");
  const r = await fetch("/api/sync/remote/pair", {
    method: "POST",
    headers: { "content-type": "application/json" },
    // `another`: a server already linked, whose page then asks which account (packages/file-hub/docs/syncRelay.md).
    body: JSON.stringify({ origin: server, ...(another ? { another } : {}) }),
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
    url: string | null;
    pairing: Pairing;
  };
  // Paired already, by the account's own sign-in: said at once, with no tab.
  if (!url) {
    tab?.close();
    void fetch(`/api/sync/remote/pair/${pairing.state}`, { method: "DELETE" });
    set(ending(pairing));
    return pairing.phase === "paired";
  }
  if (tab) tab.location.href = url;
  else if (!window.open(url, "_blank")) {
    // Opened after the await, the tab was blocked: the next click opens it first.
    directHosts.delete(hostOf(server));
    void fetch(`/api/sync/remote/pair/${pairing.state}`, { method: "DELETE" });
    set({ state: "error", code: "pairBlocked" });
    return false;
  }
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
  /** Ask ahead which servers pair with no tab, for a page that offers Add. */
  prepare: (): Promise<void> => prepare(),
  authStatus: async (): Promise<AccountStatus | null> => {
    void prepare();
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
  /** The offer's button after a sign-in. */
  pair: (server: string): Promise<boolean> => pair(server),
  addServer: (server: string): Promise<boolean> => pair(server),
  /** Another account on a server already saved: its page asks which one. */
  addAccount: (server: string): Promise<boolean> => pair(server, true),
};
