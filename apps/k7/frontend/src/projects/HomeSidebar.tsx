// HomeSidebar.tsx — the left sidebar of the home page and of the pages that hang off it, /libraries,
// /tasks, /settings, /about, /media/… and /rehearsal/…: Projects, Tasks and Libraries as entries, then the
// media library's and the rehearsal pages' sections, the user menu at its foot. All are routes, so going between them reloads
// nothing. Below `sm` it folds to an icon rail. See ../../docs/projects.md.

import { Button } from "@frediverse/ui/button";
import {
  AudioLines,
  Folders,
  Info,
  LibraryBig,
  ListChecks,
  type LucideIcon,
} from "@frediverse/ui/icons";
import { cn } from "@frediverse/ui/lib/utils";
import { LIBRARY_SECTIONS, sectionAt, sectionPath } from "@studio/ui-library";
import { REHEARSAL_SECTIONS, rehearsalSectionAt } from "@studio/ui-rehearsal";
import { UserMenu } from "@studio/ui-user-menu";
import { type ReactNode, useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { api } from "../api";
import { desktop } from "../desktop";
import { m } from "../paraglide/messages.js";
import { onDesktopEngine } from "../settings/desktopEngine";
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
  subtitle,
  actions,
  mediaCounts,
  children,
}: {
  subtitle: ReactNode;
  /** Drawn above the user menu — a page's own control, such as a refresh. */
  actions?: ReactNode;
  /** Each media section's count, known only on the media pages, which load them. */
  mediaCounts?: Partial<Record<string, number>>;
  children: ReactNode;
}) {
  return (
    <div className="flex h-full bg-background text-foreground">
      <HomeSidebar
        subtitle={subtitle}
        actions={actions}
        mediaCounts={mediaCounts}
      />
      <div className="flex min-w-0 flex-1 flex-col">{children}</div>
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

function SidebarEntry({
  entry: { label, icon: Icon, route, active, count },
  onPick,
}: {
  entry: Entry;
  onPick: (route: string) => void;
}) {
  return (
    <Button
      variant="ghost"
      size="sm"
      title={label}
      aria-current={active ? "page" : undefined}
      onClick={() => onPick(route)}
      className={cn(
        "justify-center sm:justify-start",
        active &&
          "bg-background text-foreground hover:bg-background hover:text-foreground",
      )}
    >
      <Icon className="h-4 w-4 shrink-0" />
      <span className="hidden min-w-0 flex-1 truncate text-left sm:inline">
        {label}
      </span>
      {count !== undefined ? (
        <span className="hidden shrink-0 text-muted-foreground text-xs tabular-nums sm:inline">
          {count}
        </span>
      ) : null}
    </Button>
  );
}

/** A titled run of entries below the first: the title on a wide sidebar, a rule on the rail. */
function SidebarGroup({
  title,
  entries,
  onPick,
}: {
  title: string;
  entries: Entry[];
  onPick: (route: string) => void;
}) {
  return (
    <nav className="mt-4 flex flex-col gap-1 px-2" aria-label={title}>
      <span className="hidden px-3 pb-1 text-muted-foreground text-xs sm:inline">
        {title}
      </span>
      <span className="mx-2 mb-1 border-primary/20 border-t sm:hidden" />
      {entries.map((e) => (
        <SidebarEntry key={e.route} entry={e} onPick={onPick} />
      ))}
    </nav>
  );
}

function HomeSidebar({
  subtitle,
  actions,
  mediaCounts,
}: {
  subtitle: ReactNode;
  actions?: ReactNode;
  mediaCounts?: Partial<Record<string, number>>;
}) {
  const navigate = useNavigate();
  const { pathname } = useLocation();

  // Null off the desktop app; on it, the SERVER is whose apps the menu lists (../desktop.ts).
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

  const items: Entry[] = [
    { label: m["home.projects"](), icon: Folders, route: "/" },
    { label: m["home.tasks"](), icon: ListChecks, route: TASKS_ROUTE },
    { label: m["home.libraries"](), icon: LibraryBig, route: LIBRARIES_ROUTE },
  ].map((e) => ({ ...e, active: pathname === e.route }));

  // The media library's sections: active by the section the address shows, the bare prefix included.
  const onMedia =
    pathname === MEDIA_ROUTE || pathname.startsWith(`${MEDIA_ROUTE}/`);
  const shownSection = onMedia ? sectionAt(pathname, MEDIA_ROUTE) : null;
  const media: Entry[] = LIBRARY_SECTIONS.map((s) => ({
    label: mediaSectionLabel(s.id),
    icon: s.icon,
    route: sectionPath(s.id, MEDIA_ROUTE),
    active: shownSection === s.id,
    count: s.counted ? mediaCounts?.[s.id] : undefined,
  }));

  // The rehearsal pages' sections, active by the entry the address belongs to, detail pages included.
  const shownRehearsal = rehearsalSectionAt(pathname, REHEARSAL_ROUTE);
  const rehearsal: Entry[] = REHEARSAL_SECTIONS.map((s) => ({
    label: s.label(),
    icon: s.icon,
    route: `${REHEARSAL_ROUTE}${s.path}`,
    active: shownRehearsal === s.id,
  }));

  return (
    <aside className="z-20 flex w-14 shrink-0 flex-col border-r border-primary/20 bg-primary/20 sm:w-52">
      <div className="flex flex-col gap-1 px-3 pt-4 pb-3 sm:px-5">
        <span
          className="truncate font-brand text-xl leading-none text-white"
          title={VERSION}
        >
          k7
        </span>
        <span className="hidden truncate text-xs text-muted-foreground sm:inline">
          {subtitle}
        </span>
      </div>

      {/* The entries scroll on a short screen; the brand and the user menu stay put. */}
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto pb-3">
        <nav className="flex flex-col gap-1 px-2">
          {items.map((e) => (
            <SidebarEntry key={e.route} entry={e} onPick={navigate} />
          ))}
        </nav>

        <SidebarGroup
          title={m["home.media"]()}
          entries={media}
          onPick={navigate}
        />
        <SidebarGroup
          title={m["home.rehearsal"]()}
          entries={rehearsal}
          onPick={navigate}
        />
      </div>

      <div className="flex flex-col items-center gap-1 px-2 pb-3 sm:flex-row sm:justify-end">
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
          // The desktop app's own engine page, then About — version, licence, source, notices (../../docs/about.md).
          items={[
            ...(onDesktopEngine()
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
