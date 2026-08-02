import { Avatar, AvatarFallback } from "@frediverse/ui/avatar";
import { Button } from "@frediverse/ui/button";
import { LogOut } from "lucide-react";
import { logout, useAuth } from "../lib/auth";

// Topbar identity badge — own @frediverse/ui implementation rather than
// obscura-shared's terminal-styled AuthBadge (that one still backs the
// other five obscura frontends).
export function AuthBadge({
  logoutLabel = "LOGOUT",
  showLogout = true,
}: {
  logoutLabel?: string;
  showLogout?: boolean;
}) {
  const { user } = useAuth();
  if (!user) return null;
  const label = user.name || user.email || "?";

  return (
    <div className="flex items-center gap-2">
      <Avatar size="sm">
        <AvatarFallback className="bg-secondary text-xs font-semibold">
          {label.slice(0, 1).toUpperCase()}
        </AvatarFallback>
      </Avatar>
      <span className="max-w-32 truncate text-sm text-foreground">{label}</span>
      {showLogout && (
        <Button
          variant="ghost"
          size="icon-sm"
          title={logoutLabel}
          aria-label={logoutLabel}
          onClick={() => void logout()}
        >
          <LogOut className="size-4" />
        </Button>
      )}
    </div>
  );
}
