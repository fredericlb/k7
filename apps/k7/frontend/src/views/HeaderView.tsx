// HeaderView.tsx — k7's app bar, hosted in the shared @frediverse/ui AppHeader: the mark and the
// build stamp on the left, the sections as entries, and the controls that must stay reachable
// on the right. The bar, the sm breakpoint and the hamburger are the shared component's; what is
// in them is this app's.

import { AppHeader, type AppHeaderItem } from "@frediverse/ui/app-header";
import { Button } from "@frediverse/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@frediverse/ui/dropdown-menu";
import {
  BookOpen,
  Disc3,
  type LucideIcon,
  Mic,
  MicOff,
  Settings,
  Star,
  Target,
} from "@frediverse/ui/icons";
import { useState } from "react";
import type { NavKey, Song } from "../types";

interface Props {
  /** An entry, or "settings" — the one page reached from a control rather than an entry. */
  activeNav: NavKey | "settings";
  favorites: Song[];
  onHome: () => void;
  onNav: (tab: NavKey) => void;
  onStartSession: () => Promise<void>;
  onOpenSong: (s: Song) => void;
  onOpenSettings: () => void;
}

// Build stamp baked in by the Dockerfile; "dev" anywhere it wasn't set.
const VERSION = import.meta.env.VITE_APP_VERSION ?? "dev";

/** The sections, and they are ENTRIES rather than controls — ../../../docs/header.md. */
const NAV_ITEMS: { key: NavKey; label: string; icon: LucideIcon }[] = [
  { key: "recordings", label: "Recordings", icon: Mic },
  { key: "publications", label: "Publications", icon: Disc3 },
  { key: "songbook", label: "Songbook", icon: BookOpen },
  { key: "exercices", label: "Exercices", icon: Target },
];

export function HeaderView({
  activeNav,
  favorites,
  onHome,
  onNav,
  onStartSession,
  onOpenSong,
  onOpenSettings,
}: Props) {
  const [creating, setCreating] = useState(false);
  const [sessionError, setSessionError] = useState<string | null>(null);

  const create = async () => {
    setCreating(true);
    setSessionError(null);
    try {
      await onStartSession();
    } catch (err) {
      setSessionError((err as Error).message);
    } finally {
      setCreating(false);
    }
  };

  const items: AppHeaderItem[] = NAV_ITEMS.map(
    ({ key, label, icon: Icon }) => ({
      label,
      icon: <Icon className="size-4" />,
      active: activeNav === key,
      onClick: () => onNav(key),
    }),
  );

  return (
    <AppHeader
      // No `variant`, and the z-index stays — for two different reasons, ../../../docs/header.md.
      className="z-20"
      title={
        // A button, not a div: it navigates, and the mark has always been the way home.
        <button type="button" className="brand" onClick={onHome} title="Home">
          {/* BASE_URL, not "/": vite rewrites index.html, never a JSX string. */}
          <img
            className="brand-icon"
            src={`${import.meta.env.BASE_URL}icon-192.png`}
            alt=""
          />
          <span className="brand-text">k7</span>
        </button>
      }
      subtitle={VERSION}
      items={items}
      actions={
        <>
          {/* Favourites is a MENU over songs and not a page, so it stays inline and draws nothing when empty. */}
          {favorites.length > 0 && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  title="Favorites"
                  aria-label="Favorites"
                >
                  <Star className="size-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="max-w-64">
                {favorites.map((s) => (
                  <DropdownMenuItem
                    key={s.id}
                    className="flex-col items-start gap-0"
                    title={`${s.title} — ${s.artist}`}
                    onSelect={() => onOpenSong(s)}
                  >
                    <span className="w-full truncate font-semibold">
                      {s.title}
                    </span>
                    <span className="w-full truncate text-xs text-muted-foreground">
                      {s.artist}
                    </span>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          )}

          {/* Drawn as one of AppHeader's tabs (its classes, tint variant) so /settings lights up like an entry. */}
          <Button
            variant="ghost"
            size="sm"
            className={`-mt-3 -mb-[calc(0.75rem+1px)] h-auto self-stretch rounded-none border border-b-0 px-3${
              activeNav === "settings"
                ? " border-primary/20 bg-background bg-clip-padding text-foreground hover:bg-background hover:text-foreground"
                : " border-transparent"
            }`}
            onClick={onOpenSettings}
            title="Settings"
            aria-label="Settings"
            aria-current={activeNav === "settings" ? "page" : undefined}
          >
            <Settings className="size-4" />
          </Button>

          {/* The one thing this bar DOES rather than opens, so its error hangs off the button that failed. */}
          <div className="topbar-new-wrap">
            <Button
              size="icon-sm"
              disabled={creating}
              onClick={create}
              title={creating ? "Starting…" : "New session"}
              aria-label="New session"
            >
              {/* A recorder's red dot, pulsing while the session starts. */}
              <span
                aria-hidden="true"
                className={`size-3.5 rounded-full bg-destructive${creating ? " animate-pulse" : ""}`}
              />
            </Button>
            {sessionError && (
              <p className="error topbar-error">
                <MicOff className="inline size-3.5" /> {sessionError}
              </p>
            )}
          </div>
        </>
      }
    />
  );
}
