// ContextMenu.tsx — the right-click popup shared by the timeline and the chains graph: a title
// naming what it is on, then each command as its sentence, its verb and its key, the destructive
// ones last and red; on a pick it PRE-WRITES the line into the bar (see contextMenu.ts). One
// instance lives in App; both surfaces open it through openContextMenu. Dismisses on Escape, an
// outside click, a scroll, losing focus or its close button. Rows are split into TABS (menuTabs.ts).

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { type CommandPrefs, labelIn } from "../commandPrefs";
import type { MenuItem } from "../contextMenu";
import { useLocale } from "../i18n";
import { shortcutsByCommand } from "../keys";
import { useIcons } from "../lucideIcons";
import { dangerLast, menuTabs, moveFocus } from "../menuTabs";
import type { MenuTarget } from "../menuTitle";
import { ContextMenuHeader } from "./ContextMenuHeader";

export function ContextMenu({
  items,
  prefs,
  target,
  x,
  y,
  onPick,
  onHint,
  onClose,
}: {
  items: MenuItem[];
  /** This person's layer over the catalogue, applied HERE rather than in `contextMenu.ts`, which stays a pure function. */
  prefs: CommandPrefs;
  /** What the menu is on, for its title row; absent, the row holds only the touch close button. */
  target?: MenuTarget | null;
  x: number; // viewport coords of the click
  y: number;
  // The WHOLE item, not its line: whether every argument is filled decides whether the host runs it or hands it to the bar.
  onPick: (item: MenuItem) => void;
  /** What the entry under the pointer DOES, for the host's status bar — must be STABLE, being called from an unmount cleanup. */
  onHint?: (description: string) => void;
  onClose: () => void;
}) {
  // Fetched only when some row carries a person's icon; null until it lands, so the first menu draws labels alone.
  const icons = useIcons(items.some((it) => !!prefs[it.verb]?.icon));
  // A person's name for a command is per LANGUAGE, so picking one takes a locale — read here, exactly as `useIcons` is.
  const { locale } = useLocale();
  // The key each command answers to, read off the person's own table so a row never advertises a key nothing binds.
  const keys = useMemo(() => shortcutsByCommand(prefs), [prefs]);
  const ref = useRef<HTMLDivElement>(null);
  // Start at the click, then clamp into the viewport once we can measure the menu.
  const [pos, setPos] = useState({ x, y });
  // The rows by tab, and the tab on show: the first, which is the thing you clicked, on every new menu.
  const tabs = useMemo(() => menuTabs(items), [items]);
  const [tab, setTab] = useState(0);
  // biome-ignore lint/correctness/useExhaustiveDependencies: a new list of rows is a new menu, opened on its first tab.
  useEffect(() => setTab(0), [items]);
  const on = Math.min(tab, tabs.length - 1);
  const { safe, danger } = dangerLast(tabs[on]?.items ?? []);

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

  // The keyboard lands on the first row on opening and on every tab switch, so the arrows have somewhere to start.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `tab` and `items` are triggers — the rows are read from the DOM.
  useEffect(() => {
    ref.current
      ?.querySelector<HTMLElement>('[role="menuitem"]')
      ?.focus({ preventScroll: true });
  }, [tab, items]);

  useEffect(() => {
    // Capture, so an outside click dismisses before it acts; a pointerdown inside is left to the button's onClick.
    const down = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
        return;
      }
      // Left and right walk the tabs, as they do in any tab strip.
      if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
        e.stopPropagation();
        e.preventDefault();
        setTab((t) => {
          const n = tabCount.current;
          return n ? (t + (e.key === "ArrowLeft" ? n - 1 : 1)) % n : 0;
        });
        return;
      }
      const rows = [
        ...(ref.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ??
          []),
      ];
      const at = rows.indexOf(document.activeElement as HTMLElement);
      // Enter picks the focused row here, before any shell key handler can read it as its own.
      if (e.key === "Enter" && at >= 0) {
        e.stopPropagation();
        e.preventDefault();
        rows[at].click();
        return;
      }
      const next = moveFocus(e.key, at, rows.length);
      if (next === null) return;
      e.stopPropagation();
      e.preventDefault();
      rows[next]?.focus();
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

  const row = (it: MenuItem, destructive: boolean) => {
    const pref = prefs[it.verb];
    const Icon = pref?.icon ? icons?.[pref.icon] : undefined;
    // The person's name in THIS language, else the catalogue's sentence, else the entry's name (docs/contextMenu.md).
    const text = labelIn(pref?.label, locale).trim() || it.sentence || it.label;
    const key = keys[it.verb];
    return (
      <button
        key={it.command}
        type="button"
        role="menuitem"
        title={
          it.complete ? `runs: ${it.command}` : `fills the bar: ${it.command}`
        }
        onClick={() => {
          onPick(it);
          onClose();
        }}
        // The status line follows the pointer, and the KEYBOARD too — walking the menu is a way of reading it.
        onPointerEnter={() => onHint?.(it.description)}
        onFocus={() => onHint?.(it.description)}
        className={`flex w-full items-center gap-2 px-3 py-1 text-left outline-none hover:bg-accent focus-visible:bg-accent ${
          destructive
            ? "text-destructive"
            : "hover:text-accent-foreground focus-visible:text-accent-foreground"
        }`}
      >
        {/* The icon gutter is held whether or not this row has one, so the texts line up. */}
        <span className="flex h-4 w-4 shrink-0 items-center justify-center">
          {Icon ? <Icon className="h-4 w-4" /> : null}
        </span>
        <span className="min-w-0 flex-1 truncate">{text}</span>
        {/* The verb, muted, whenever the row reads as something else: it is what you would type. */}
        {text !== it.label && (
          <span className="max-w-[8rem] shrink-0 truncate font-mono text-[11px] text-muted-foreground">
            {it.label}
          </span>
        )}
        {/* Whether picking this RUNS it or only fills the bar with it — an action against a question, worth a character per row. */}
        {!it.complete && (
          <span className="shrink-0 text-muted-foreground">…</span>
        )}
        {key && (
          <kbd className="shrink-0 rounded border border-border px-1 font-mono text-[10px] text-muted-foreground">
            {key}
          </kbd>
        )}
      </button>
    );
  };

  return (
    <div
      ref={ref}
      style={{ left: pos.x, top: pos.y }}
      // Bounded and scrollable: a track offers sixteen rows, and a menu that runs off the bottom of the screen hides its own tail.
      className="fixed z-50 max-h-[70vh] min-w-[12rem] max-w-[min(26rem,calc(100vw-16px))] overflow-y-auto rounded-md border border-border bg-popover py-1 text-sm shadow-md"
      role="menu"
      aria-label={target?.name}
      // One handler for the whole list: leaving the menu by the gap between two rows should clear the line, and only the container sees that.
      onPointerLeave={() => onHint?.("")}
    >
      <ContextMenuHeader
        target={target}
        tabs={tabs}
        on={on}
        onTab={setTab}
        onClose={onClose}
      />
      {safe.map((it) => row(it, false))}
      {safe.length > 0 && danger.length > 0 && (
        <hr className="my-1 border-border" />
      )}
      {danger.map((it) => row(it, true))}
    </div>
  );
}
