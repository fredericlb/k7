// This SPA's account store. The whole of it is `z0-shared/auth-store`; what is local is the
// FETCH, which carries this app's base path — and that was the only difference between the four
// byte-identical copies this replaced.

import { createAuthStore } from "z0-shared/auth-store";
import { f } from "./api";

// One rule for all six SPAs: the account belongs to st0, the guest cookie to z0.
export { login } from "z0-shared/account";
export type { AuthState, AuthStatus, AuthUser } from "z0-shared/auth-store";

export const { useAuth, logout } = createAuthStore(f);
