import { useSyncExternalStore } from "react";
import {
  cameBackStillAnonymous,
  logout as logoutAs,
  SIGN_IN_DID_NOT_STICK,
} from "z0-shared/account";
import { f } from "./api";

// ONE module-level auth state off /api/auth/me, so every consumer sees the same answer.

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
      // Back from pl8 and still anonymous means the button would only bounce again: say so.
      const why = cameBackStillAnonymous() ? SIGN_IN_DID_NOT_STICK : null;
      setState({
        status: why ? "error" : "unauthenticated",
        error: why,
        user: null,
      });
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

// One rule for all six SPAs: the account belongs to pl8, the guest cookie to z0.
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
