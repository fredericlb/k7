// auth-store.ts — the account store four of z0's SPAs share: `/api/auth/me` once at boot, held in
// a module-level store, read through `useSyncExternalStore`. No polling and no guest login — that
// half is the backend's cookie, and signing in/out is `account.ts`. See apps/z0/docs/auth.md.
//
// It was four BYTE-IDENTICAL copies (editor, monitor-web, presenter, remote), each ~100 lines,
// with the file's own comment saying the rule "lives in z0-shared/account rather than in six
// copies here" — printed directly under its own ninety lines of copy. Only the fetch differed,
// and it differed by import rather than by behaviour, which is what a parameter is for.
//
// `buzzer` and `online` keep their own: theirs really do differ (a guest login, and a comment at
// `online/src/components/AuthBadge.tsx` explaining its own case).

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

/**
 * One store for one SPA. Call it ONCE, at module scope, and export what it returns.
 *
 * Module-level rather than a hook's state, deliberately: every consumer of a page has to see the
 * same answer, and the boot fetch must happen once however many components ask.
 */
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
        // Not always an invitation to log in. If we JUST came back from st0 and are still
        // anonymous, the button would only bounce off it again — say so instead of looping.
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
