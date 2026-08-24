import { useSyncExternalStore } from "react";
import { logout as logoutAs } from "z0-shared/account";
import { f } from "./api";

// Re-polled every 5 s while the gate is up, so JOIN unlocks the moment registration opens.

export interface AuthUser {
  name: string;
  email: string;
  subject: string;
  kind: string;
}

export type AuthStatus =
  | "loading"
  | "authenticated"
  | "unauthenticated"
  | "error";

interface AuthState {
  status: AuthStatus;
  error: string | null;
  user: AuthUser | null;
  guestEnabled: boolean;
  registrationOpen: boolean;
}

let state: AuthState = {
  status: "loading",
  error: null,
  user: null,
  guestEnabled: false,
  registrationOpen: false,
};
let started = false;
let pollTimer: number | null = null;
const listeners = new Set<() => void>();

function setState(patch: Partial<AuthState>): void {
  state = { ...state, ...patch };
  for (const l of listeners) l();
}

async function refresh(): Promise<void> {
  try {
    const res = await f("/api/auth/me");
    const data = (await res.json().catch(() => ({}))) as Record<
      string,
      unknown
    >;
    const flags = {
      guestEnabled: Boolean(data.guestEnabled),
      registrationOpen: Boolean(data.registrationOpen),
    };
    if (res.ok) {
      setState({
        ...flags,
        status: "authenticated",
        error: null,
        user: {
          name: String(data.name || ""),
          email: String(data.email || ""),
          subject: String(data.subject || ""),
          kind: String(data.kind || ""),
        },
      });
      return;
    }
    if (res.status === 401) {
      setState({ ...flags, status: "unauthenticated", user: null });
      return;
    }
    setState({
      ...flags,
      status: "error",
      error: `auth check failed (${res.status})`,
    });
  } catch (e) {
    setState({
      status: "error",
      error: `auth network error: ${(e as Error).message}`,
    });
  }
}

function startPolling(): void {
  if (pollTimer != null) return;
  pollTimer = window.setInterval(() => {
    if (state.status !== "authenticated") void refresh();
  }, 5000);
}

// One rule for all six SPAs: the account belongs to st0, the guest cookie to z0.
export { login } from "z0-shared/account";

export async function logout(): Promise<void> {
  await logoutAs(state.user?.kind);
}

/** Session-scoped guest login. Returns null on success (page reloads). */
export async function loginAsGuest(
  password: string,
  name: string,
): Promise<string | null> {
  try {
    const res = await f("/api/auth/guest", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password, name }),
    });
    if (res.ok) {
      window.location.reload();
      return null;
    }
    const text = (await res.text()).trim();
    return text || `error ${res.status}`;
  } catch (e) {
    return `network error: ${(e as Error).message}`;
  }
}

export function useAuth(): AuthState {
  if (!started) {
    started = true;
    void refresh();
    startPolling();
  }
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => state,
  );
}
