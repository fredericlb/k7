// HomeHeader.tsx — the header of the home page and of the two pages that hang off it, /libraries
// and /settings: Projects and Libraries as entries, the user menu as its last action. All three
// are routes, so going between them reloads nothing. See ../../docs/projects.md.

import { AppHeader, type AppHeaderItem } from "@frediverse/ui/app-header";
import { FolderGit2, LibraryBig } from "@frediverse/ui/icons";
import { UserMenu } from "@studio/ui-user-menu";
import { type ReactNode, useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { api } from "../api";
import { desktop } from "../desktop";
import { m } from "../paraglide/messages.js";
import { VERSION } from "../version";
import { LIBRARIES_ROUTE, SETTINGS_ROUTE } from "./api";

export function HomeHeader({
  subtitle,
  actions,
  className,
}: {
  subtitle: ReactNode;
  /** Drawn ahead of the user menu — a page's own control, such as a refresh. */
  actions?: ReactNode;
  className?: string;
}) {
  const navigate = useNavigate();
  const { pathname } = useLocation();

  // Asked once: a hosted origin will not grow the route mid-session; the SERVER is whose apps the menu lists (../desktop.ts).
  const [isDesktop, setIsDesktop] = useState(false);
  const [server, setServer] = useState<string | null>(null);
  useEffect(() => {
    void desktop.state().then((d) => {
      setIsDesktop(d !== null);
      setServer(d?.server ?? null);
    });
  }, []);

  // Who is signed in, for the user menu: AuthGate asked already, but hands nothing down.
  const [email, setEmail] = useState<string | null>(null);
  useEffect(() => {
    void api
      .getMe()
      .then((u) => setEmail(u?.email || u?.name || u?.sub || null))
      .catch(() => {});
  }, []);

  const items: AppHeaderItem[] = [
    {
      label: m["home.projects"](),
      icon: <FolderGit2 className="h-4 w-4" />,
      active: pathname === "/",
      onClick: () => navigate("/"),
    },
    {
      label: m["home.libraries"](),
      icon: <LibraryBig className="h-4 w-4" />,
      active: pathname === LIBRARIES_ROUTE,
      onClick: () => navigate(LIBRARIES_ROUTE),
    },
  ];

  return (
    <AppHeader
      title="st0"
      version={VERSION}
      subtitle={subtitle}
      items={items}
      className={className}
      actions={
        <>
          {actions}
          {/* Last: the account, the settings, the other apps, the logout (packages/ui-user-menu/docs/userMenu.md). */}
          <UserMenu
            self="st0"
            email={email}
            onLogout={() =>
              void api.logout().then(() => window.location.reload())
            }
            onSettings={() => navigate(SETTINGS_ROUTE)}
            settingsLabel={m["home.settings"]()}
            origin={server}
            unavailable={
              isDesktop && !server ? m["home.appsUnavailable"]() : undefined
            }
          />
        </>
      }
    />
  );
}
