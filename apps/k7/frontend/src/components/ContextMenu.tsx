// ContextMenu.tsx — the right-click popup shared by the timeline and the chains graph: it names
// each command, reports what the one under the pointer DOES through `onHint`, and on a pick
// PRE-WRITES its line into the bar (see contextMenu.ts). One instance lives in App; both surfaces
// open it through openContextMenu. Dismisses on Escape, an outside click, a scroll, or losing
// focus. Its rows are split into icon TABS, one per kind of thing they act on (menuTabs.ts).

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
} from "@frediverse/ui/icons";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { type CommandPrefs, labelIn } from "../commandPrefs";
import type { MenuItem } from "../contextMenu";
import { useLocale } from "../i18n";
import { useIcons } from "../lucideIcons";
import { menuTabs } from "../menuTabs";

/** One drawing per kind of thing a row acts on — the command's first word; an unknown one gets the ellipsis. */
const TAB_ICONS: Record<string, LucideIcon> = {
  ui: AppWindow,
  event: RectangleHorizontal,
  track: Rows3,
  node: Box,
  module: Package,
  sequence: Music,
  clip: AudioWaveform,
  curve: Spline,
  project: FolderOpen,
  transport: Play,
  picture: Film,
  graph: Network,
  playlist: ListMusic,
  task: ListTodo,
  assembly: Group,
  selection: SquareDashed,
  system: Settings,
};

export function ContextMenu({
  items,
  prefs,
  x,
  y,
  onPick,
  onHint,
  onClose,
}: {
  items: MenuItem[];
  /** This person's layer over the catalogue, applied HERE rather than in `contextMenu.ts`, which stays a pure function. */
  prefs: CommandPrefs;
  x: number; // viewport coords of the click
  y: number;
  // The WHOLE item, not its line: whether every argument is filled decides whether the host runs it or hands it to the bar.
  onPick: (item: MenuItem) => void;
  /** What the entry under the pointer DOES, for the host's status bar — must be STABLE, being called from an unmount cleanup. */
  onHint?: (description: string) => void;
  onClose: () => void;
}) {
  // Null until the set lands: a menu opened first thing draws its labels and no icons, which is the honest degradation.
  const icons = useIcons();
  // A person's name for a command is per LANGUAGE, so picking one takes a locale — read here, exactly as `useIcons` is.
  const { locale } = useLocale();
  const ref = useRef<HTMLDivElement>(null);
  // Start at the click, then clamp into the viewport once we can measure the menu.
  const [pos, setPos] = useState({ x, y });
  // The rows by tab, and the tab on show: the first, which is the thing you clicked, on every new menu.
  const tabs = useMemo(() => menuTabs(items), [items]);
  const [tab, setTab] = useState(0);
  // biome-ignore lint/correctness/useExhaustiveDependencies: a new list of rows is a new menu, opened on its first tab.
  useEffect(() => setTab(0), [items]);
  const shown = tabs[Math.min(tab, tabs.length - 1)]?.items ?? [];

  // Clamped into the viewport on opening, and again on a tab switch: another tab is another height.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `tab` is a trigger — the new rows are measured from the DOM.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setPos({
      x: Math.max(8, Math.min(x, window.innerWidth - r.width - 8)),
      y: Math.max(8, Math.min(y, window.innerHeight - r.height - 8)),
    });
  }, [x, y, tab]);

  useEffect(() => {
    // Capture, so an outside click dismisses before it acts; a pointerdown inside is left to the button's onClick.
    const down = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
      // Left and right walk the tabs, as they do in any tab strip.
      if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
        e.stopPropagation();
        e.preventDefault();
        setTab((t) => {
          const n = tabCount.current;
          return n ? (t + (e.key === "ArrowLeft" ? n - 1 : 1)) % n : 0;
        });
      }
    };
    window.addEventListener("pointerdown", down, true);
    window.addEventListener("keydown", key, true);
    window.addEventListener("blur", onClose);
    window.addEventListener("scroll", onClose, true);
    return () => {
      window.removeEventListener("pointerdown", down, true);
      window.removeEventListener("keydown", key, true);
      window.removeEventListener("blur", onClose);
      window.removeEventListener("scroll", onClose, true);
    };
  }, [onClose]);
  // Read by the key handler, which is bound once.
  const tabCount = useRef(tabs.length);
  tabCount.current = tabs.length;

  // The menu going takes its line with it, or the last thing hovered would read as something the app just did.
  useEffect(() => () => onHint?.(""), [onHint]);

  if (!items.length) return null;

  return (
    <div
      ref={ref}
      style={{ left: pos.x, top: pos.y }}
      // Bounded and scrollable: a track offers sixteen rows, and a menu that runs off the bottom of the screen hides its own tail.
      className="fixed z-50 max-h-[70vh] min-w-[11rem] max-w-[18rem] overflow-y-auto rounded-md border border-border bg-popover py-1 text-sm shadow-md"
      role="menu"
      // One handler for the whole list: leaving the menu by the gap between two rows should clear the line, and only the container sees that.
      onPointerLeave={() => onHint?.("")}
    >
      {/* The tabs, as icons, only when the rows act on more than one kind of thing — a lone tab would say nothing. */}
      {tabs.length > 1 && (
        <div
          role="tablist"
          className="sticky top-0 z-10 -mt-1 mb-1 flex gap-0.5 border-border border-b bg-popover px-1 pt-1"
        >
          {tabs.map((t, i) => {
            const Icon = TAB_ICONS[t.tab] ?? Ellipsis;
            const on = i === Math.min(tab, tabs.length - 1);
            return (
              <button
                key={t.tab}
                type="button"
                role="tab"
                aria-selected={on}
                aria-label={t.tab}
                title={`${t.tab} (${t.items.length})`}
                onClick={() => setTab(i)}
                className={`flex h-7 w-8 items-center justify-center rounded-t-sm ${
                  on
                    ? "bg-accent text-accent-foreground"
                    : "text-muted-foreground hover:bg-accent/50 hover:text-foreground"
                }`}
              >
                <Icon className="h-4 w-4" />
              </button>
            );
          })}
        </div>
      )}
      {shown.map((it) => {
        const pref = prefs[it.verb];
        const Icon = pref?.icon ? icons?.[pref.icon] : undefined;
        return (
          <button
            key={it.command}
            type="button"
            role="menuitem"
            title={
              it.complete
                ? `runs: ${it.command}`
                : `fills the bar: ${it.command}`
            }
            onClick={() => {
              onPick(it);
              onClose();
            }}
            // The status line follows the pointer, and the KEYBOARD too — tabbing through the menu is a way of reading it.
            onPointerEnter={() => onHint?.(it.description)}
            onFocus={() => onHint?.(it.description)}
            className="flex w-full items-center gap-2 px-3 py-1 text-left hover:bg-accent hover:text-accent-foreground"
          >
            {/* The command's NAME minus the word naming what you right-clicked, with the icon gutter held whether or not there is one (docs/contextMenu.md). */}
            <span className="flex h-4 w-4 shrink-0 items-center justify-center">
              {Icon ? <Icon className="h-4 w-4" /> : null}
            </span>
            {/* The person's name for it in THIS language, else the entry's own; `labelIn` answers as AUTHORED, so the trim lives here (docs/shell.md). */}
            <span className="min-w-0 flex-1 truncate">
              {labelIn(pref?.label, locale).trim() || it.label}
            </span>
            {/* Whether picking this RUNS it or only fills the bar with it — an action against a question, worth a character per row. */}
            {!it.complete && (
              <span className="shrink-0 text-muted-foreground">…</span>
            )}
          </button>
        );
      })}
    </div>
  );
}
