// HeaderView.tsx — k7's app bar, hosted in the shared @frediverse/ui AppHeader: the mark and the
// build stamp on the left, the six sections as entries, and the controls that must stay reachable
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
import { useState } from "react";
import type { NavKey, Song } from "../types";

interface Props {
  activeNav: NavKey;
  favorites: Song[];
  onHome: () => void;
  onNav: (tab: NavKey) => void;
  onStartSession: () => Promise<void>;
  onOpenSong: (s: Song) => void;
  onOpenSettings: () => void;
}

// Build stamp baked in by the Dockerfile; "dev" anywhere it wasn't set.
const VERSION = import.meta.env.VITE_APP_VERSION ?? "dev";

/**
 * The sections, and they are ENTRIES rather than controls — which is the line AppHeader draws and
 * the reason they are the ones behind the hamburger on a phone.
 *
 * The icons used to be what made the bar fit: below a breakpoint `styles.css` hid every label and
 * left a row of glyphs, deliberately instead of a hamburger. That is the decision this adoption
 * gives up — six anonymous glyphs are a row nobody can read either, and the shared bar collapses
 * them into a menu that names them. The icons stay because a named entry with a glyph is still
 * faster to find than a named entry without one.
 */
const NAV_ITEMS: { key: NavKey; label: string; icon: string }[] = [
  { key: "sessions", label: "Sessions", icon: "🎙" },
  { key: "moments", label: "Moments", icon: "◆" },
  { key: "releases", label: "Releases", icon: "💿" },
  { key: "pages", label: "Pages", icon: "📄" },
  { key: "songbook", label: "Songbook", icon: "📖" },
  { key: "exercices", label: "Exercices", icon: "🎯" },
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

  const items: AppHeaderItem[] = NAV_ITEMS.map(({ key, label, icon }) => ({
    label,
    icon: <span className="nav-icon">{icon}</span>,
    active: activeNav === key,
    onClick: () => onNav(key),
  }));

  return (
    <AppHeader
      // `plain`: k7's page carries the colour and this bar is a surface with a rule under it —
      // which is what `.topbar` said in CSS before the shared bar said it in a prop.
      variant="plain"
      title={
        // A button, not a div: it navigates, and the mark has always been the way home.
        <button type="button" className="brand" onClick={onHome} title="Home">
          {/* BASE_URL, not "/": vite rewrites index.html, never a JSX string. */}
          <img
            className="brand-icon"
            src={`${import.meta.env.BASE_URL}icon-192.png`}
            alt=""
          />
          <span className="brand-text">
            f<span style={{ color: "var(--red)" }}>·</span>rec
          </span>
        </button>
      }
      subtitle={VERSION}
      items={items}
      actions={
        <>
          {/* Favourites is a MENU over songs, not a page — so it stays inline rather than
              collapsing with the sections. Empty, it draws nothing: a menu of nothing is a
              button that disappoints. */}
          {favorites.length > 0 && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  title="Favorites"
                  aria-label="Favorites"
                >
                  <span className="nav-icon">★</span>
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

          <Button
            variant="ghost"
            size="sm"
            onClick={onOpenSettings}
            title="Settings"
            aria-label="Settings"
          >
            <span className="nav-icon">⚙</span>
          </Button>

          {/* The one thing this bar DOES rather than opens, so it keeps its weight and its
              label. Its error hangs off it — anchored to the button that failed, which is
              where anyone would look for it. */}
          <div className="topbar-new-wrap">
            <Button
              className="topbar-new"
              disabled={creating}
              onClick={create}
              title="New session"
              aria-label="New session"
            >
              <span className="nav-icon">＋</span>
              <span className="nav-label">
                {creating ? "Starting…" : "New session"}
              </span>
            </Button>
            {sessionError && (
              <p className="error topbar-error">🎤 {sessionError}</p>
            )}
          </div>
        </>
      }
    />
  );
}
