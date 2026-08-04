import { AuthBadge as SharedAuthBadge } from "z0-shared/auth-badge";
import { logout, useAuth } from "../lib/auth";

// Wires this app's auth store to the shared badge. The markup is common to all
// six frontends; the .auth-* look is this app's own extracted-styles.css.
export function AuthBadge(props: {
  logoutLabel?: string;
  showLogout?: boolean;
}) {
  const { user } = useAuth();
  return (
    <SharedAuthBadge user={user} onLogout={() => void logout()} {...props} />
  );
}
