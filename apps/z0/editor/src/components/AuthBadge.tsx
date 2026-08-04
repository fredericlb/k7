import { AuthBadge as SharedAuthBadge } from "z0-shared/auth-badge";
import { logout, useAuth } from "../lib/auth";

// Editor flavour: sits inline in the topbar (margin-left:auto), plain
// blue/grey styling rather than the game surfaces' synthwave badge — that
// difference lives entirely in the editor's .auth-* rules. Sentence-case
// "Logout" here rather than the game surfaces' shouted label.
export function AuthBadge(props: {
  logoutLabel?: string;
  showLogout?: boolean;
}) {
  const { user } = useAuth();
  return (
    <SharedAuthBadge
      user={user}
      onLogout={() => void logout()}
      logoutLabel="Logout"
      {...props}
    />
  );
}
