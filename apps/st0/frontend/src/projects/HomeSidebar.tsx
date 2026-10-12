// HomeSidebar.tsx — the left sidebar of the home page and of the pages that hang off it, /libraries,
// /tasks and /settings: Projects, Tasks and Libraries as entries, the user menu at its foot.
// All are routes, so going between them reloads nothing. Below `sm` it folds to an icon rail.
// See ../../docs/projects.md.

import { Button } from "@frediverse/ui/button";
import { FolderGit2, LibraryBig, ListChecks } from "@frediverse/ui/icons";
import { cn } from "@frediverse/ui/lib/utils";
import { UserMenu } from "@studio/ui-user-menu";
import { type ReactNode, useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { api } from "../api";
import { desktop } from "../desktop";
import { m } from "../paraglide/messages.js";
import { VERSION } from "../version";
import { LIBRARIES_ROUTE, SETTINGS_ROUTE, TASKS_ROUTE } from "./api";

/** The page frame: the sidebar on the left, the page's own column on the right. */
export function HomeShell({
  subtitle,
  actions,
  children,
}: {
  subtitle: ReactNode;
  /** Drawn above the user menu — a page's own control, such as a refresh. */
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="flex h-full bg-background text-foreground">
      <HomeSidebar subtitle={subtitle} actions={actions} />
      <div className="flex min-w-0 flex-1 flex-col">{children}</div>
    </div>
  );
}

function HomeSidebar({
  subtitle,
  actions,
}: {
  subtitle: ReactNode;
  actions?: ReactNode;
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

  const items = [
    { label: m["home.projects"](), icon: FolderGit2, route: "/" },
    { label: m["home.tasks"](), icon: ListChecks, route: TASKS_ROUTE },
    { label: m["home.libraries"](), icon: LibraryBig, route: LIBRARIES_ROUTE },
  ];

  return (
    <aside className="z-20 flex w-14 shrink-0 flex-col border-r border-primary/20 bg-primary/20 sm:w-52">
      <div className="flex flex-col gap-1 px-3 pt-4 pb-3 sm:px-5">
        <span
          className="truncate font-brand text-xl leading-none text-white"
          title={VERSION}
        >
          st0
        </span>
        <span className="hidden truncate text-xs text-muted-foreground sm:inline">
          {subtitle}
        </span>
      </div>

      <nav className="flex flex-col gap-1 px-2">
        {items.map(({ label, icon: Icon, route }) => {
          const active = pathname === route;
          return (
            <Button
              key={route}
              variant="ghost"
              size="sm"
              title={label}
              aria-current={active ? "page" : undefined}
              onClick={() => navigate(route)}
              className={cn(
                "justify-center sm:justify-start",
                active &&
                  "bg-background text-foreground hover:bg-background hover:text-foreground",
              )}
            >
              <Icon className="h-4 w-4 shrink-0" />
              <span className="hidden truncate sm:inline">{label}</span>
            </Button>
          );
        })}
      </nav>

      <div className="mt-auto flex flex-col items-center gap-1 px-2 pb-3 sm:flex-row sm:justify-end">
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
      </div>
    </aside>
  );
}
