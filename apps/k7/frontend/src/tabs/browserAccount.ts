// browserAccount.ts — pairing from the page itself, served in a browser by the tray's backend: the backend's
// /api/sync/remote/pair, its trip to the server opened in a tab of its own from a click, which a browser allows, or no
// tab at all when the backend pairs with that server at once from the account's sign-in (`directHosts`).
// See ../../docs/localApp.md and packages/file-hub/docs/syncRelay.md, "Pairing without the browser".

import type { AccountStatus } from "./bridge";

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

/** How a pairing that left `waiting` reads under its button: both accounts named, k7's here and the server's. */
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

/** The page's pairing in a browser (./bridge.ts). */
export const browserAccount = {
  /** Ask ahead which servers pair with no tab, for a page that offers Connect or Add. */
  prepare: (): Promise<void> => prepare(),
  authStatus: async (): Promise<AccountStatus | null> => {
    void prepare();
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
  addServer: (server: string): Promise<boolean> => pair(server),
  /** Another account on a server already saved: its page asks which one. */
  addAccount: (server: string): Promise<boolean> => pair(server, true),
};
