// SettingsMenu.tsx — the cog dropdown: the account (who you are + sign out), the app-wide
// settings screens, and the language choice. The screens themselves are rendered by App as
// an overlay — this menu only says which one to open, so the panes underneath stay mounted.
//
// Each entry is a COMMAND LINE the shell dispatches (`ui settings editor`, `ui engine`,
// `ui workspace quit`, `ui logout`), not a callback of its own: every one of them is reachable
// from the palette, and one implementation is what stops the two drifting.

import { Button } from "@frediverse/ui/button";
import {
  AudioLines,
  Command,
  DoorOpen,
  ListMusic,
  LogOut,
  Server,
  Settings,
  SlidersHorizontal,
  UserCircle2,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { type AuthUser, api } from "../api";
import { m } from "../paraglide/messages.js";
import { LocaleSwitcher } from "./LocaleSwitcher";

// "io" is the odd one: App renders it as a DIALOG, not a full screen (see IoPanel). It is
// listed here anyway — it is a settings surface, and a second menu for one entry is worse.
export type SettingsScreen = "editor" | "io" | "commands" | "playlists";

export function SettingsMenu({
  onRun,
}: {
  /** Run one of the menu's lines. The shell dispatches it, exactly as the palette would. */
  onRun: (command: string) => void;
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
  const run = (command: string) => {
    setOpen(false);
    onRun(command);
  };

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
              onClick={() => run("ui logout")}
            >
              <LogOut className="h-4 w-4" />
            </Button>
          </div>
          <div className="my-1 border-t border-border" />
          {/* The SSH key is NOT here any more. It belongs to pl8, which owns the repositories
              and generates the one deploy key — see packages/git-repos/docs/keys.md. */}
          <button className={item} onClick={() => run("ui settings editor")}>
            <SlidersHorizontal className="h-4 w-4 text-muted-foreground" />
            {m["settings.editor"]()}
          </button>
          <button className={item} onClick={() => run("ui settings io")}>
            <AudioLines className="h-4 w-4 text-muted-foreground" />
            {m["settings.io"]()}
          </button>
          {/* Not translated through paraglide like its neighbours: this entry is new and the
              message catalogue is generated, so it would fail the build until regenerated. */}
          <button className={item} onClick={() => run("ui settings commands")}>
            <Command className="h-4 w-4 text-muted-foreground" />
            Commandes
          </button>
          {/* Under the cog and not among the panes, because what it opens is not part of the
              open song: a playlist lives in `_playlists/` at the root of the REPOSITORY and is
              the same one whichever project you have open. See ../docs/playlists.md.
              Not translated through paraglide, for the reason its neighbour above says. */}
          <button
            type="button"
            className={item}
            onClick={() => run("ui settings playlists")}
          >
            <ListMusic className="h-4 w-4 text-muted-foreground" />
            Playlists
          </button>
          <div className="my-1 border-t border-border" />
          {/* The engine is remembered on the ACCOUNT now, so this is the one way back to
              the picker — without it a choice made once could never be undone. */}
          <button className={item} onClick={() => run("ui engine")}>
            <Server className="h-4 w-4 text-muted-foreground" />
            {m["settings.engine"]()}
          </button>
          <button className={item} onClick={() => run("ui workspace quit")}>
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
