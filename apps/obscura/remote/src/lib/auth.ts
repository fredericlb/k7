import { useSyncExternalStore } from "react";
import { f } from "./api";

// React port of the remote's useAuth: /api/auth/me once at boot, with the
// groups/isAdmin fields the admin gate needs. No polling, no guest login.

export interface AuthUser {
  name: string;
  email: string;
  subject: string;
  kind: string;
  groups: string[];
  isAdmin: boolean;
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
}

let state: AuthState = { status: "loading", error: null, user: null };
let started = false;
const listeners = new Set<() => void>();

function setState(next: AuthState): void {
  state = next;
  for (const l of listeners) l();
}

async function bootstrap(): Promise<void> {
  try {
    const res = await f("/api/auth/me");
    if (res.ok) {
      const data = await res.json();
      setState({
        status: "authenticated",
        error: null,
        user: {
          name: data.name || "",
          email: data.email || "",
          subject: data.subject || "",
          kind: data.kind || "",
          groups: Array.isArray(data.groups) ? data.groups : [],
          isAdmin: Boolean(data.isAdmin),
        },
      });
      return;
    }
    if (res.status === 401) {
      setState({ status: "unauthenticated", error: null, user: null });
      return;
    }
    setState({
      status: "error",
      error: `auth check failed (${res.status})`,
      user: null,
    });
  } catch (e) {
    setState({
      status: "error",
      error: `auth network error: ${(e as Error).message}`,
      user: null,
    });
  }
}

// Single origin: /auth/login is served by the backend on this very host, so the
// redirect target is relative. return_to comes back to wherever we are now.
export function login(): void {
  const back = encodeURIComponent(window.location.href);
  window.location.assign(`/obscura/auth/login?return_to=${back}`);
}

export async function logout(): Promise<void> {
  try {
    await f("/api/auth/logout", { method: "POST" });
  } catch {
    /* ignore */
  }
  window.location.reload();
}

export function useAuth(): AuthState {
  if (!started) {
    started = true;
    void bootstrap();
  }
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => state,
  );
}
