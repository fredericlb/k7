// auth-store.ts — the account store four of z0's SPAs share: `/api/auth/me` once at boot, held in
// a module-level store, read through `useSyncExternalStore`. No polling, no guest login — signing
// in and out is `account.ts`. See apps/z0/docs/auth.md.
//
// One store for the four, parameterised by the fetch, which is all that separates them.
// `buzzer` and `online` keep their own: theirs genuinely differ.

import { useSyncExternalStore } from "react";
import {
  cameBackStillAnonymous,
  logout as logoutAs,
  SIGN_IN_DID_NOT_STICK,
} from "./account";

/** Who is signed in. `groups`/`isAdmin` are what an admin gate reads. */
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

export interface AuthState {
  status: AuthStatus;
  error: string | null;
  user: AuthUser | null;
}

/** The one thing that differed between the copies: each SPA's own fetch, which carries its base path. */
export type AuthFetch = (path: string) => Promise<Response>;

/** One store per SPA: call it ONCE at module scope, so the boot fetch happens once. */
export function createAuthStore(f: AuthFetch): {
  useAuth: () => AuthState;
  logout: () => Promise<void>;
} {
  let state: AuthState = { status: "loading", error: null, user: null };
  let started = false;
  const listeners = new Set<() => void>();

  const setState = (next: AuthState): void => {
    state = next;
    for (const l of listeners) l();
  };

  const bootstrap = async (): Promise<void> => {
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
        // Back from the login and still anonymous means the button would only bounce again: say so.
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
  };

  return {
    useAuth: () => {
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
    },
    logout: async () => {
      await logoutAs(state.user?.kind);
    },
  };
}
