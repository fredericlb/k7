// browserAccount.ts — signing the tray in to its server from the page: the backend's /api/sync/remote/pair gives the
// server's sign-in page, opened in a tab of its own inside the click (a browser blocks one opened later), then waited
// on here until that tab comes back to the backend. See ../../docs/localApp.md and
// packages/file-hub/docs/syncRelay.md, "Signing in is pairing".

import type { AccountStatus } from "./bridge";

interface Pairing {
  state: string;
  host: string;
  phase: "waiting" | "paired" | "expired" | "notStored";
  /** The account the person signed in as at the server: the link's. */
  browserAs: string | null;
}

let status: AccountStatus = { state: "idle" };
const listeners = new Set<(s: AccountStatus) => void>();
const set = (s: AccountStatus): void => {
  status = s;
  for (const l of listeners) l(s);
};
let current: string | null = null;

/** How a sign-in that left `waiting` reads under its button. */
function ending(p: Pairing): AccountStatus {
  if (p.phase === "paired")
    return {
      state: "done",
      code: "paired",
      detail: `${p.host} · ${p.browserAs ?? ""}`,
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

/** Sign in to `server` from a click: its page opens in a new tab, and the link it brings back replaces any other. */
async function signIn(server: string): Promise<boolean> {
  const tab = window.open("about:blank", "_blank");
  const r = await fetch("/api/sync/remote/pair", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ origin: server, name: navigator.platform || "" }),
  }).catch(() => null);
  if (!r?.ok) {
    tab?.close();
    set({ state: "error", code: "badServer", detail: server });
    return false;
  }
  const { url, pairing } = (await r.json()) as {
    url: string;
    pairing: Pairing;
  };
  if (!tab) {
    void fetch(`/api/sync/remote/pair/${pairing.state}`, { method: "DELETE" });
    set({ state: "error", code: "pairBlocked" });
    return false;
  }
  tab.location.href = url;
  current = pairing.state;
  set({ state: "waiting", what: "pair" });
  return follow(pairing.state);
}

/** The page's sign-in in a browser (./bridge.ts). */
export const browserAccount = {
  authStatus: async (): Promise<AccountStatus | null> => status,
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
  signIn,
};
