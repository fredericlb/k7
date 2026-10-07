// The signed-in account, pinned top-right on every game SPA: the name as a commons Badge, and the
// logout behind commons' UserMenu. It positions itself, so a host's stylesheet owns none of it.
// Hosts compile z0-shared themselves: their Tailwind must @source this folder, or these classes vanish.

import { Badge } from "@frediverse/ui/badge";
import { CircleUser } from "@frediverse/ui/icons";
import { UserMenu } from "@frediverse/ui/user-menu";

export interface AuthBadgeUser {
  name?: string;
  email?: string;
}

export function AuthBadge({
  user,
  onLogout,
  logoutLabel = "LOGOUT",
  showLogout = true,
}: {
  user: AuthBadgeUser | null | undefined;
  onLogout: () => void;
  logoutLabel?: string;
  showLogout?: boolean;
}) {
  if (!user) return null;
  const label = user.name || user.email || "?";
  return (
    <div className="fixed top-2 right-2 z-50 flex items-center gap-1 rounded-md bg-background">
      <Badge>
        {!showLogout && <CircleUser className="size-3" aria-hidden />}
        {label}
      </Badge>
      {showLogout && (
        <UserMenu
          email={user.email || label}
          label={label}
          logoutLabel={logoutLabel}
          onLogout={onLogout}
        />
      )}
    </div>
  );
}
