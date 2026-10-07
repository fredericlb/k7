import { UserMenu } from "@frediverse/ui/user-menu";
import { logout, useAuth } from "../lib/auth";

// This app's auth store on commons' user menu; no app links, since z0 does not mount studio's table of apps.
export function AccountMenu() {
  const { user } = useAuth();
  if (!user) return null;
  return (
    <UserMenu
      email={user.email || user.name || null}
      onLogout={() => void logout()}
    />
  );
}
