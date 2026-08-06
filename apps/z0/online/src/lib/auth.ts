import { useSyncExternalStore } from "react";
import { logout as logoutAs } from "z0-shared/account";
import { f } from "./api";

// React port of shared/composables/useAuth.ts: one module-level auth state,
// bootstrapped from /api/auth/me, exposed to components via
// useSyncExternalStore so every consumer re-renders on changes.

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

// Signing in and out is the same rule for all six SPAs, and a subtle one — the
// account belongs to st0, the guest cookie to z0. It lives in z0-shared/account
// rather than in six copies here.
export { login } from "z0-shared/account";

export async function logout(): Promise<void> {
  await logoutAs(state.user?.kind);
}

/** Re-run /auth/me (e.g. after a guest claim set a new cookie). */
export async function refreshAuth(): Promise<AuthStatus> {
  setState({ ...state, status: "loading" });
  await bootstrap();
  return state.status;
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
