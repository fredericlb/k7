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

// Each nav entry carries an icon so the header can collapse to icons-only on
// small screens (see the responsive rules in styles.css) instead of hiding
// behind a hamburger.
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

  return (
    <header className="topbar">
      <div className="topbar-inner">
        <div className="topbar-left">
          <div className="brand" onClick={onHome} title="Home">
            <img className="brand-icon" src="/icon-192.png" alt="" />
            <span className="brand-text">
              f<span style={{ color: "var(--red)" }}>·</span>rec
            </span>
          </div>
        </div>

        <nav className="topnav">
          {NAV_ITEMS.map(({ key, label, icon }) => (
            <button
              key={key}
              className={activeNav === key ? "active" : ""}
              onClick={() => onNav(key)}
              title={label}
              aria-label={label}
            >
              <span className="nav-icon">{icon}</span>
              <span className="nav-label">{label}</span>
            </button>
          ))}

          {favorites.length > 0 && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  className="topnav-fav-btn"
                  title="Favorites"
                  aria-label="Favorites"
                >
                  <span className="nav-icon">★</span>
                  <span className="nav-label">Favorites</span>
                  <span className="caret">▾</span>
                </button>
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
        </nav>

        <div className="topbar-right">
          <button
            className="topbar-settings"
            onClick={onOpenSettings}
            title="Settings"
            aria-label="Settings"
          >
            <span className="nav-icon">⚙</span>
          </button>

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
        </div>
      </div>
    </header>
  );
}
