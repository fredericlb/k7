// HomeSidebar.tsx — the left sidebar of the home page and of the pages that hang off it, /libraries,
// /tasks, /settings, /about, /media/… and /rehearsal/…: Projects, Tasks and Libraries as entries, then the
// media library's and the rehearsal pages' sections, the user menu at its foot. All are routes, so going between them reloads
// nothing. Below `sm` it folds to an icon rail. Inside a project it is a DRAWER (`HomeDrawer`): the
// router's basename is the project there, so its entries are full addresses (appNav.ts). See ../../docs/projects.md.

import { Button } from "@frediverse/ui/button";
import {
  AudioLines,
  Folders,
  Info,
  LibraryBig,
  ListChecks,
  type LucideIcon,
  RefreshCw,
} from "@frediverse/ui/icons";
import { cn } from "@frediverse/ui/lib/utils";
import { projectsUrl } from "@studio/project-shell/launch";
import { LIBRARY_SECTIONS, sectionAt, sectionPath } from "@studio/ui-library";
import { REHEARSAL_SECTIONS, rehearsalSectionAt } from "@studio/ui-rehearsal";
import { UserMenu } from "@studio/ui-user-menu";
import { type ReactNode, useEffect, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import k7Logo from "../../icon/k7.svg";
import { api } from "../api";
import { go } from "../appNav";
import { canCheckForUpdates, checkForUpdates } from "../appUpdates";
import {
  HomeEngine,
  SidebarEngine,
  type SidebarEngineProps,
} from "../components/SidebarEngine";
import { SidebarServer } from "../components/SidebarServer";
import { desktop } from "../desktop";
import { m } from "../paraglide/messages.js";
import { usePopin } from "../popins";
import { setServerChoice } from "../serverChoice";
import { useOnDesktopEngine } from "../settings/desktopEngine";
import { VERSION } from "../version";
import {
  ABOUT_ROUTE,
  ENGINE_SETTINGS_ROUTE,
  LIBRARIES_ROUTE,
  MEDIA_ROUTE,
  REHEARSAL_ROUTE,
  SETTINGS_ROUTE,
  TASKS_ROUTE,
} from "./api";
import { mediaSectionLabel } from "./mediaLabels";

/** The page frame: the sidebar on the left, the page's own column on the right. */
export function HomeShell({
  actions,
  mediaCounts,
  children,
}: {
  /** Drawn above the user menu — a page's own control, such as a refresh. */
  actions?: ReactNode;
  /** Each media section's count, known only on the media pages, which load them. */
  mediaCounts?: Partial<Record<string, number>>;
  children: ReactNode;
}) {
  return (
    <div className="flex h-full bg-background text-foreground">
      <HomeSidebar actions={actions} mediaCounts={mediaCounts} />
      <div className="flex min-w-0 flex-1 flex-col">{children}</div>
    </div>
  );
}

/** A home route as a full address, which appNav draws in place, for a sidebar drawn outside the home router. */
const homeHref = (route: string): string =>
  new URL(route.slice(1), projectsUrl(window.location.href)).href;

/** The sidebar over a project: slides in from the left, a click beside it or Escape closes it. */
export function HomeDrawer({
  open,
  onClose,
  engine,
}: {
  open: boolean;
  onClose: () => void;
  /** The project's live engine, which the sidebar's engine block shows and changes. */
  engine?: SidebarEngineProps;
}) {
  usePopin(open, onClose);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex">
      <HomeSidebar away engine={engine} />
      <button
        type="button"
        aria-label={m["common.close"]()}
        className="flex-1 cursor-default bg-black/40"
        onClick={onClose}
      />
    </div>
  );
}

interface Entry {
  label: string;
  icon: LucideIcon;
  route: string;
  active: boolean;
  /** Trailing, beside the label; absent draws nothing rather than a zero. */
  count?: number;
}

/** A LINK, not a button: an entry is an address, so it opens in a new tab and copies like one. */
function SidebarEntry({
  entry: { label, icon: Icon, route, active, count },
  away,
}: {
  entry: Entry;
  away?: boolean;
}) {
  const inner = (
    <>
      <Icon className={cn("h-4 w-4 shrink-0", active && "text-primary-text")} />
      <span
        className={cn(
          "min-w-0 flex-1 truncate text-left",
          away ? "inline" : "hidden sm:inline",
        )}
      >
        {label}
      </span>
      {count !== undefined ? (
        <span
          className={cn(
            "shrink-0 text-muted-foreground text-xs tabular-nums",
            away ? "inline" : "hidden sm:inline",
          )}
        >
          {count}
        </span>
      ) : null}
    </>
  );
  return (
    <Button
      variant="ghost"
      size="sm"
      title={label}
      aria-current={active ? "page" : undefined}
      asChild
      className={cn(
        away ? "justify-start" : "justify-center sm:justify-start",
        // The lit entry is the one place the sidebar wears the accent: violet means "you are here" (../../docs/projects.md).
        active &&
          "bg-primary/15 text-foreground hover:bg-primary/20 hover:text-foreground",
      )}
    >
      {away ? (
        <a href={homeHref(route)}>{inner}</a>
      ) : (
        <Link to={route}>{inner}</Link>
      )}
    </Button>
  );
}

/** A titled run of entries below the first: the title on a wide sidebar, a rule on the rail. */
function SidebarGroup({
  title,
  entries,
  away,
}: {
  title: string;
  entries: Entry[];
  away?: boolean;
}) {
  return (
    <nav className="mt-4 flex flex-col gap-1 px-2" aria-label={title}>
      <span
        className={cn(
          "px-3 pb-1 text-muted-foreground text-xs",
          away ? "inline" : "hidden sm:inline",
        )}
      >
        {title}
      </span>
      {!away && <span className="mx-2 mb-1 border-border border-t sm:hidden" />}
      {entries.map((e) => (
        <SidebarEntry key={e.route} entry={e} away={away} />
      ))}
    </nav>
  );
}

function HomeSidebar({
  actions,
  mediaCounts,
  away,
  engine,
}: {
  actions?: ReactNode;
  mediaCounts?: Partial<Record<string, number>>;
  /** Drawn over a project: full-address links, nothing lit, never folded to the rail. */
  away?: boolean;
  /** The project's engine, given by the drawer; absent on a home page, which shows the account's own. */
  engine?: SidebarEngineProps;
}) {
  const routerNavigate = useNavigate();
  const navigate = (route: string) =>
    away ? void go(homeHref(route)) : routerNavigate(route);
  // Over a project the address is the project's, so no entry is "here".
  const pathname = useLocation().pathname;
  const here = (route: string) => !away && pathname === route;

  // Null off the tray's backend; on it, the SERVER is whose apps the menu lists (../desktop.ts).
  const engineHere = useOnDesktopEngine();
  const [isDesktop, setIsDesktop] = useState(false);
  const [server, setServer] = useState<string | null>(null);
  useEffect(() => {
    void desktop.state().then((d) => {
      setIsDesktop(d !== null);
      setServer(d?.server ?? null);
      // A choice left from a pairing since undone would point every page at no server.
      if (!d?.server) setServerChoice("local");
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

  const items: Entry[] = [
    { label: m["home.projects"](), icon: Folders, route: "/" },
    { label: m["home.tasks"](), icon: ListChecks, route: TASKS_ROUTE },
    { label: m["home.libraries"](), icon: LibraryBig, route: LIBRARIES_ROUTE },
  ].map((e) => ({ ...e, active: here(e.route) }));

  // The media library's sections: active by the section the address shows, the bare prefix included.
  const onMedia =
    pathname === MEDIA_ROUTE || pathname.startsWith(`${MEDIA_ROUTE}/`);
  const shownSection = onMedia ? sectionAt(pathname, MEDIA_ROUTE) : null;
  const media: Entry[] = LIBRARY_SECTIONS.map((s) => ({
    label: mediaSectionLabel(s.id),
    icon: s.icon,
    route: sectionPath(s.id, MEDIA_ROUTE),
    active: !away && shownSection === s.id,
    count: s.counted ? mediaCounts?.[s.id] : undefined,
  }));

  // The rehearsal pages' sections, active by the entry the address belongs to, detail pages included.
  const shownRehearsal = rehearsalSectionAt(pathname, REHEARSAL_ROUTE);
  const rehearsal: Entry[] = REHEARSAL_SECTIONS.map((s) => ({
    label: s.label(),
    icon: s.icon,
    route: `${REHEARSAL_ROUTE}${s.path}`,
    active: !away && shownRehearsal === s.id,
  }));

  return (
    <aside
      className={cn(
        "z-20 flex shrink-0 flex-col bg-card",
        away ? "h-full w-52 shadow-2xl" : "w-14 sm:w-52",
      )}
    >
      <div
        className={cn(
          "flex flex-col gap-1 pt-4 pb-3",
          away ? "px-5" : "px-3 sm:px-5",
        )}
      >
        {/* The logo alone on the rail: it is too narrow for the logo and the name together. */}
        <span
          className="flex min-w-0 items-center gap-2 font-brand text-xl leading-none text-white"
          title={VERSION}
        >
          <img src={k7Logo} alt="k7" className="h-6 w-auto shrink-0" />
          <span
            className={cn("truncate", away ? "inline" : "hidden sm:inline")}
          >
            k7
          </span>
        </span>
      </div>

      {/* The entries scroll on a short screen; the brand and the user menu stay put. */}
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto pb-3">
        <nav className="flex flex-col gap-1 px-2">
          {items.map((e) => (
            <SidebarEntry key={e.route} entry={e} away={away} />
          ))}
        </nav>

        <SidebarGroup title={m["home.media"]()} entries={media} away={away} />
        <SidebarGroup
          title={m["home.rehearsal"]()}
          entries={rehearsal}
          away={away}
        />
      </div>

      {/* The server the pages read, on the tray once paired: a server's own page has no other to offer. */}
      {isDesktop && server && <SidebarServer server={server} folds={!away} />}

      {/* The one engine selector, above the user menu: the project's live engine in the drawer, the account's elsewhere. */}
      {engine ? <SidebarEngine {...engine} /> : <HomeEngine />}

      <div
        className={cn(
          "flex items-center gap-1 px-2 pb-3",
          away ? "flex-row justify-end" : "flex-col sm:flex-row sm:justify-end",
        )}
      >
        {actions}
        {/* Last: the account, the settings, the other apps, the logout (packages/ui-user-menu/docs/userMenu.md). */}
        <UserMenu
          self="k7"
          email={email}
          onLogout={() =>
            void api.logout().then(() => window.location.reload())
          }
          onSettings={() => navigate(SETTINGS_ROUTE)}
          settingsLabel={m["home.settings"]()}
          label={m["home.account"]()}
          logoutLabel={m["home.signOut"]()}
          // Beside Settings, in an app that updates itself; this machine's engine page, on the tray's backend; About (../../docs/about.md).
          items={[
            ...(canCheckForUpdates()
              ? [
                  {
                    id: "updates",
                    label: m["home.checkUpdates"](),
                    icon: RefreshCw,
                    onSelect: checkForUpdates,
                  },
                ]
              : []),
            ...(engineHere
              ? [
                  {
                    id: "engine",
                    label: m["home.engine"](),
                    icon: AudioLines,
                    onSelect: () => navigate(ENGINE_SETTINGS_ROUTE),
                  },
                ]
              : []),
            {
              id: "about",
              label: m["home.about"](),
              icon: Info,
              onSelect: () => navigate(ABOUT_ROUTE),
            },
          ]}
          origin={server}
          unavailable={
            isDesktop && !server ? m["home.appsUnavailable"]() : undefined
          }
        />
      </div>
    </aside>
  );
}
