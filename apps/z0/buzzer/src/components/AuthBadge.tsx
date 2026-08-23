import { AuthBadge as SharedAuthBadge } from "z0-shared/auth-badge";
import { logout, useAuth } from "../lib/auth";

// This app's auth store on the shared badge; the .auth-* look is its own extracted-styles.css.
export function AuthBadge(props: {
  logoutLabel?: string;
  showLogout?: boolean;
}) {
  const { user } = useAuth();
  return (
    <SharedAuthBadge user={user} onLogout={() => void logout()} {...props} />
  );
}
