// HeaderView.tsx — k7's app bar, hosted in the shared @frediverse/ui AppHeader: the mark and the
// build stamp on the left, the sections as entries, and the controls that must stay reachable
// on the right. The bar, the sm breakpoint and the hamburger are the shared component's; what is
// in them is this app's.

import { AppHeader, type AppHeaderItem } from "@frediverse/ui/app-header";
import { Button } from "@frediverse/ui/button";
import {
  BookOpen,
  Disc3,
  type LucideIcon,
  Mic,
  MicOff,
  Settings,
  Target,
} from "@frediverse/ui/icons";
import { UserMenu } from "@studio/ui-user-menu";
import { useState } from "react";
import { m } from "../paraglide/messages.js";
import type { NavKey } from "../types";

interface Props {
  /** An entry, or "settings" — the one page reached from a control rather than an entry. */
  activeNav: NavKey | "settings";
  onHome: () => void;
  onNav: (tab: NavKey) => void;
  onStartSession: () => Promise<void>;
  onOpenSettings: () => void;
  /** Who is signed in, for the user menu's heading. */
  email: string;
  onLogout: () => void;
}

// Build stamp baked in by the Dockerfile; "dev" anywhere it wasn't set.
const VERSION = import.meta.env.VITE_APP_VERSION ?? "dev";

/** The sections, and they are ENTRIES rather than controls — ../../../docs/header.md. */
const NAV_ITEMS: { key: NavKey; label: () => string; icon: LucideIcon }[] = [
  { key: "recordings", label: m["nav.recordings"], icon: Mic },
  { key: "publications", label: m["nav.publications"], icon: Disc3 },
  { key: "songbook", label: m["nav.songbook"], icon: BookOpen },
  { key: "exercices", label: m["nav.exercices"], icon: Target },
];

export function HeaderView({
  activeNav,
  onHome,
  onNav,
  onStartSession,
  onOpenSettings,
  email,
  onLogout,
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
      label: label(),
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
        <button
          type="button"
          className="brand"
          onClick={onHome}
          // A label and not a title: a title here would shadow AppHeader's version tooltip.
          aria-label={m["nav.home"]()}
        >
          {/* BASE_URL, not "/": vite rewrites index.html, never a JSX string. */}
          <img
            className="brand-icon"
            src={`${import.meta.env.BASE_URL}icon-192.png`}
            alt=""
          />
          <span className="brand-text">k7</span>
        </button>
      }
      version={VERSION}
      items={items}
      actions={
        <>
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
            title={m["settings.title"]()}
            aria-label={m["settings.title"]()}
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
              title={creating ? m["rec.starting"]() : m["rec.newSession"]()}
              aria-label={m["rec.newSession"]()}
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
          {/* Last, at the far right: the account, the other apps, the logout (@studio/ui-user-menu). */}
          <UserMenu self="k7" email={email} onLogout={onLogout} />
        </>
      }
    />
  );
}
