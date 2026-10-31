// ContextMenuHeader.tsx — the top of the right-click menu, sticky above the rows: the title row
// naming what the menu is on, with a close button where there is no pointer to click away with,
// and the tab strip, one icon per kind of thing the rows act on — the open one also says its name.
// See docs/contextMenu.md, "The title row" and "Tabs".

import {
  AppWindow,
  AudioWaveform,
  Box,
  Ellipsis,
  Film,
  FolderOpen,
  Group,
  ListMusic,
  ListTodo,
  type LucideIcon,
  Music,
  Network,
  Package,
  Play,
  RectangleHorizontal,
  Rows3,
  Settings,
  Spline,
  SquareDashed,
  X,
} from "@frediverse/ui/icons";
import type { MenuItem } from "../contextMenu";
import type { MenuTarget } from "../menuTitle";
import { m } from "../paraglide/messages.js";
import type { MenuEntity } from "../types";

/** One drawing and one name per kind of thing a row acts on — the command's first word; an unknown one gets the ellipsis and the word. */
const TABS: Record<string, { icon: LucideIcon; name: () => string }> = {
  ui: { icon: AppWindow, name: () => m["menuTab.ui"]() },
  event: { icon: RectangleHorizontal, name: () => m["menuTab.event"]() },
  track: { icon: Rows3, name: () => m["menuTab.track"]() },
  node: { icon: Box, name: () => m["menuTab.node"]() },
  module: { icon: Package, name: () => m["menuTab.module"]() },
  sequence: { icon: Music, name: () => m["menuTab.sequence"]() },
  clip: { icon: AudioWaveform, name: () => m["menuTab.clip"]() },
  curve: { icon: Spline, name: () => m["menuTab.curve"]() },
  project: { icon: FolderOpen, name: () => m["menuTab.project"]() },
  transport: { icon: Play, name: () => m["menuTab.transport"]() },
  picture: { icon: Film, name: () => m["menuTab.picture"]() },
  graph: { icon: Network, name: () => m["menuTab.graph"]() },
  playlist: { icon: ListMusic, name: () => m["menuTab.playlist"]() },
  task: { icon: ListTodo, name: () => m["menuTab.task"]() },
  assembly: { icon: Group, name: () => m["menuTab.assembly"]() },
  selection: { icon: SquareDashed, name: () => m["menuTab.selection"]() },
  system: { icon: Settings, name: () => m["menuTab.system"]() },
};

/** What the title row calls each entity — a noun, where the settings page's `menuEntity.*` is a phrase. */
const NOUNS: Record<MenuEntity, () => string> = {
  track: () => m["menuNoun.track"](),
  group: () => m["menuNoun.group"](),
  node: () => m["menuNoun.node"](),
  event: () => m["menuNoun.event"](),
  param: () => m["menuNoun.param"](),
  curve: () => m["menuNoun.curve"](),
  ruler: () => m["menuNoun.ruler"](),
  marker: () => m["menuNoun.marker"](),
  timeline: () => m["menuNoun.timeline"](),
  assembly: () => m["menuNoun.assembly"](),
  warp: () => m["menuNoun.warp"](),
  shot: () => m["menuNoun.shot"](),
  picture: () => m["menuNoun.picture"](),
  pad: () => m["menuNoun.pad"](),
  note: () => m["menuNoun.note"](),
  tap: () => m["menuNoun.tap"](),
  rack: () => m["menuNoun.rack"](),
};

export function ContextMenuHeader({
  target,
  tabs,
  on,
  onTab,
  onClose,
}: {
  target?: MenuTarget | null;
  tabs: { tab: string; items: MenuItem[] }[];
  /** The index of the tab on show. */
  on: number;
  onTab: (i: number) => void;
  onClose: () => void;
}) {
  return (
    // With no title and no tabs, only a touch screen has something to show here: its close button.
    <div
      className={`sticky top-0 z-10 -mt-1 mb-1 border-border border-b bg-popover ${
        !target && tabs.length < 2 ? "hidden [@media(hover:none)]:block" : ""
      }`}
    >
      {/* Without a target the row holds only the close button, so it shows on a touch screen alone. */}
      <div
        className={`items-center gap-1.5 py-1 pr-1 pl-3 ${target ? "flex" : "hidden [@media(hover:none)]:flex"}`}
      >
        {target && (
          <span className="min-w-0 flex-1 truncate text-xs">
            <span className="text-muted-foreground">
              {NOUNS[target.entity]()}
            </span>{" "}
            <span className="font-medium">{target.name}</span>
          </span>
        )}
        {/* Clicking away is the desktop's way out; a finger needs a door it can see. */}
        <button
          type="button"
          aria-label={m["menu.close"]()}
          title={m["menu.close"]()}
          onClick={onClose}
          className="ml-auto hidden h-7 w-7 shrink-0 items-center justify-center rounded-sm text-muted-foreground hover:bg-accent [@media(hover:none)]:flex"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
      {/* The tabs, only when the rows act on more than one kind of thing — a lone tab would say nothing. */}
      {tabs.length > 1 && (
        <div
          role="tablist"
          aria-label={m["menu.tabs"]()}
          className="flex gap-0.5 px-1"
        >
          {tabs.map((t, i) => {
            const known = TABS[t.tab];
            const Icon = known?.icon ?? Ellipsis;
            const name = known ? known.name() : t.tab;
            const active = i === on;
            return (
              <button
                key={t.tab}
                type="button"
                role="tab"
                aria-selected={active}
                aria-label={name}
                title={`${name} (${t.items.length})`}
                onClick={() => onTab(i)}
                className={`flex h-7 min-w-8 items-center justify-center gap-1 rounded-t-sm px-2 text-xs ${
                  active
                    ? "bg-accent text-accent-foreground"
                    : "text-muted-foreground hover:bg-accent/50 hover:text-foreground"
                }`}
              >
                <Icon className="h-4 w-4 shrink-0" />
                {/* The open tab says what it is in words; the others stay icons, the strip being as narrow as the menu. */}
                {active && <span>{name}</span>}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
