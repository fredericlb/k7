// SettingsPanel.tsx — the cog, as a PANEL anchored at the right rather than a dropdown: one tab
// per screen it used to open, docked beside the panes so it does not cover what it is about.
//
// It was a menu whose entries opened a full-screen page or a dialog — several surfaces, several
// ways out, and every one of them hid the thing you were configuring. The tabs are those
// surfaces, unchanged underneath; what went is the chrome each carried to be a page.
//
// It is one of THREE panels sharing the right column (the others are the playlists and the
// share), and they are three rather than one set of tabs on purpose: what is here is what you
// SET and leave. A set list is something you work from and a share is something you do, and
// filing either under a cog would be filing it by where it used to live.
//
// COMMANDS is the exception and stays a page, reached by a button here: it is a table of the
// whole catalogue, sixty rows wide with a field per language, and 24rem is not a width you can
// order a catalogue in. See ../docs/shell.md.
//
// Each tab is still a COMMAND LINE the shell dispatches (`ui settings io`, …), not a callback:
// every one is reachable from the palette, and one implementation is what stops the two
// drifting.

import { Button } from "@frediverse/ui/button";
import type { EngineClient } from "@studio/engine-browser";
import {
  AudioLines,
  Command,
  DoorOpen,
  LogOut,
  Server,
  Settings,
  SlidersHorizontal,
  UserCircle2,
  X,
} from "lucide-react";
import { useEffect, useState } from "react";
import { type AuthUser, api } from "../api";
import { m } from "../paraglide/messages.js";
import { EditorSettingsPage } from "./EditorSettingsPage";
import { IoPanel } from "./IoPanel";
import { LocaleSwitcher } from "./LocaleSwitcher";

/**
 * The tabs, in the order they are drawn.
 *
 * `commands` is not among them — it is the one settings screen still drawn as a PAGE, reached
 * by the button in the header. Nor is `playlists`, which had a tab here briefly and has its own
 * panel: settings are things you set and leave, a set list is a thing you work FROM.
 */
export const SETTINGS_TABS = ["editor", "io", "account"] as const;

export type SettingsTab = (typeof SETTINGS_TABS)[number];

/** Is this word one of them? For the places a typed string arrives — a command line. */
export const isSettingsTab = (s: string): s is SettingsTab =>
  (SETTINGS_TABS as readonly string[]).includes(s);

const TAB_META: Record<
  SettingsTab,
  { icon: typeof Settings; label: string; command: string }
> = {
  editor: {
    icon: SlidersHorizontal,
    label: m["settings.editor"](),
    command: "ui settings editor",
  },
  io: {
    icon: AudioLines,
    label: m["settings.io"](),
    command: "ui settings io",
  },
  // Not translated through paraglide like its neighbours: the message catalogue is generated,
  // and a key that is not in it yet fails the build.
  account: {
    icon: UserCircle2,
    label: "Compte",
    command: "ui settings account",
  },
};

export function SettingsPanel({
  tab,
  engine,
  vimMode,
  onRun,
  onClose,
}: {
  /** Which tab is showing. Owned by `App`, because a command line can change it. */
  tab: SettingsTab;
  /** For the I/O tab's meters. Null when the engine is not connected: the list still shows. */
  engine: EngineClient | null;
  vimMode: boolean;
  onRun: (line: string) => Promise<void>;
  onClose: () => void;
}) {
  // Escape closes it, which is the contract the I/O dialog had and the one thing a docked panel
  // must not lose: it is opened mid-gesture — plugging something in, checking a level — and a
  // surface you have to aim at to dismiss is one you leave open.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <aside className="flex w-[24rem] min-w-0 shrink-0 flex-col border-l border-border bg-background">
      <header className="flex shrink-0 items-center gap-2 border-b border-border px-2 py-1.5">
        <Settings className="h-4 w-4 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1 truncate text-sm font-medium">
          {m["settings.menu"]()}
        </span>
        {/* The one screen that is still a page, and the button that opens it. */}
        <Button
          size="icon"
          variant="ghost"
          title="Commandes — renommer, réordonner, relier une touche"
          aria-label="Commandes"
          onClick={() => void onRun("ui settings commands")}
        >
          <Command className="h-4 w-4" />
        </Button>
        <Button size="icon" variant="ghost" title="Fermer" onClick={onClose}>
          <X className="h-4 w-4" />
        </Button>
      </header>

      {/* The tabs. Each dispatches its own `ui settings <tab>` rather than setting state here,
          so the panel and the palette are one road — see the file header. */}
      <nav className="flex shrink-0 border-b border-border">
        {SETTINGS_TABS.map((t) => {
          const { icon: Icon, label, command } = TAB_META[t];
          const on = t === tab;
          return (
            <button
              key={t}
              type="button"
              aria-current={on ? "page" : undefined}
              title={label}
              onClick={() => void onRun(command)}
              className={`flex min-w-0 flex-1 items-center justify-center gap-1.5 border-b-2 px-1 py-1.5 text-xs ${
                on
                  ? "border-primary text-foreground"
                  : "border-transparent text-muted-foreground hover:bg-accent/40"
              }`}
            >
              <Icon className="h-4 w-4 shrink-0" />
              <span className="truncate">{label}</span>
            </button>
          );
        })}
      </nav>

      <div className="min-h-0 flex-1">
        {tab === "editor" && (
          <EditorSettingsPage
            vimMode={vimMode}
            onToggleVim={() => void onRun("ui vim")}
          />
        )}
        {tab === "io" && <IoPanel engine={engine} onRun={onRun} />}
        {tab === "account" && <AccountTab onRun={onRun} />}
      </div>
    </aside>
  );
}

/**
 * Who you are, and the three ways out of here.
 *
 * These were the menu's top and bottom — the account block, the engine picker, leaving the
 * workspace, the language. They are ACTIONS rather than a screen, which is why they were never
 * a `ui settings <x>`; a tab is where they go now that the menu they lived in is gone.
 */
function AccountTab({ onRun }: { onRun: (line: string) => Promise<void> }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  useEffect(() => {
    void api
      .getMe()
      .then(setUser)
      .catch(() => {}); // the tab still works; it just shows no name
  }, []);

  const row =
    "flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-accent";

  return (
    <div className="h-full overflow-y-auto p-2">
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
          onClick={() => void onRun("ui logout")}
        >
          <LogOut className="h-4 w-4" />
        </Button>
      </div>
      <div className="my-1 border-t border-border" />
      {/* The SSH key is NOT here. It belongs to pl8, which owns the repositories and generates
          the one deploy key — see packages/git-repos/docs/keys.md. */}
      {/* The engine is remembered on the ACCOUNT, so this is the one way back to the picker —
          without it a choice made once could never be undone. */}
      <button
        type="button"
        className={row}
        onClick={() => void onRun("ui engine")}
      >
        <Server className="h-4 w-4 text-muted-foreground" />
        {m["settings.engine"]()}
      </button>
      <button
        type="button"
        className={row}
        onClick={() => void onRun("ui workspace quit")}
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
  );
}
