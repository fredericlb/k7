// SettingsMenu.tsx — the cog dropdown: the account (who you are + sign out), the app-wide
// settings screens, and the language choice. The screens themselves are rendered by App as
// an overlay — this menu only says which one to open, so the panes underneath stay mounted.

import { Button } from "@frediverse/ui/button";
import {
  AudioLines,
  Boxes,
  DoorOpen,
  ExternalLink,
  LogOut,
  Server,
  Settings,
  SlidersHorizontal,
  UserCircle2,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { type AuthUser, api, MEDIATEK_URL } from "../api";
import { m } from "../paraglide/messages.js";
import { LocaleSwitcher } from "./LocaleSwitcher";

// "io" is the odd one: App renders it as a DIALOG, not a full screen (see IoPanel). It is
// listed here anyway — it is a settings surface, and a second menu for one entry is worse.
export type SettingsScreen = "editor" | "io";

export function SettingsMenu({
  onOpenScreen,
  onQuitWorkspace,
  onChangeEngine,
}: {
  onOpenScreen: (s: SettingsScreen) => void;
  onQuitWorkspace: () => void;
  /** Back to the engine picker. An ACTION and not a screen, like quitting a workspace:
   *  the choice unwinds a gate above this component, so there is nothing to render here. */
  onChangeEngine: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [user, setUser] = useState<AuthUser | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    void api
      .getMe()
      .then(setUser)
      .catch(() => {}); // header still works; the menu just shows no name
  }, []);

  // Close on pointerdown, like the breadcrumb's menu, so it is gone before a click behind it lands.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("pointerdown", onDown);
    return () => window.removeEventListener("pointerdown", onDown);
  }, [open]);

  const item =
    "flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-accent";

  return (
    <div ref={ref} className="relative">
      <Button
        size="icon"
        variant="ghost"
        aria-expanded={open}
        title={m["settings.menu"]()}
        aria-label={m["settings.menu"]()}
        onClick={() => setOpen((o) => !o)}
      >
        <Settings className="h-4 w-4" />
      </Button>
      {open && (
        <div className="absolute right-0 top-full z-30 mt-1 w-64 rounded-md border border-border bg-popover p-2 shadow-lg">
          <div className="flex items-center gap-2 px-2 pb-2">
            <UserCircle2 className="h-6 w-6 shrink-0 text-muted-foreground" />
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium">
                {user?.name || user?.email || "…"}
              </div>
              {user?.name && user.email && (
                <div className="truncate text-xs text-muted-foreground">
                  {user.email}
                </div>
              )}
            </div>
            <Button
              size="sm"
              variant="secondary"
              title={m["settings.logout"]()}
              aria-label={m["settings.logout"]()}
              // Reload after logout: AuthGate is outermost, so a fresh load lands on sign-in (and pagehide frees the engine).
              onClick={() =>
                void api.logout().then(() => window.location.reload())
              }
            >
              <LogOut className="h-4 w-4" />
            </Button>
          </div>
          <div className="my-1 border-t border-border" />
          {/* The SSH key is NOT here any more. It belongs to st0, which owns the repositories
              and generates the one deploy key — see packages/git-repos/docs/keys.md. */}
          <button
            className={item}
            onClick={() => {
              onOpenScreen("editor");
              setOpen(false);
            }}
          >
            <SlidersHorizontal className="h-4 w-4 text-muted-foreground" />
            {m["settings.editor"]()}
          </button>
          <button
            className={item}
            onClick={() => {
              onOpenScreen("io");
              setOpen(false);
            }}
          >
            <AudioLines className="h-4 w-4 text-muted-foreground" />
            {m["settings.io"]()}
          </button>
          {/* A LINK, not a screen: modules are catalogued and edited in the médiathèque
              now, because it is the only editable library. A workspace's `_modules` is a
              read-only copy, so there is nothing here to open a builder on. */}
          <a
            className={item}
            href={MEDIATEK_URL}
            target="_blank"
            rel="noreferrer"
            onClick={() => setOpen(false)}
          >
            <Boxes className="h-4 w-4 text-muted-foreground" />
            {m["settings.modules"]()}
            <ExternalLink className="ml-auto h-3.5 w-3.5 text-muted-foreground" />
          </a>
          <div className="my-1 border-t border-border" />
          {/* The engine is remembered on the ACCOUNT now, so this is the one way back to
              the picker — without it a choice made once could never be undone. */}
          <button
            className={item}
            onClick={() => {
              onChangeEngine();
              setOpen(false);
            }}
          >
            <Server className="h-4 w-4 text-muted-foreground" />
            {m["settings.engine"]()}
          </button>
          <button
            className={item}
            onClick={() => {
              onQuitWorkspace();
              setOpen(false);
            }}
          >
            <DoorOpen className="h-4 w-4 text-muted-foreground" />
            {m["settings.quitWorkspace"]()}
          </button>
          <div className="my-1 border-t border-border" />
          <div className="flex items-center justify-between gap-2 px-2 py-1.5">
            <span className="text-sm text-muted-foreground">
              {m["settings.language"]()}
            </span>
            <LocaleSwitcher />
          </div>
        </div>
      )}
    </div>
  );
}
