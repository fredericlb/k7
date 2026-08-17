// ContextMenu.tsx — the right-click popup shared by the timeline and the chains graph: it
// lists WHAT each command does — the sentence only, never the line, which is a hover away — and
// on a pick PRE-WRITES one into the bar (see contextMenu.ts). One instance lives in App; both
// surfaces open it through openContextMenu. Dismisses on Escape, an outside click, a scroll, or
// losing focus.

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { type CommandPrefs, labelIn } from "../commandPrefs";
import type { MenuItem } from "../contextMenu";
import { useLocale } from "../i18n";
import { useIcons } from "../lucideIcons";

export function ContextMenu({
  items,
  prefs,
  x,
  y,
  onPick,
  onClose,
}: {
  items: MenuItem[];
  /**
   * This person's layer over the catalogue: the icon each command wears, and the name they gave
   * it. Applied HERE rather than in `contextMenu.ts`, which stays a pure function of the
   * catalogue and the thing clicked — the arrangement is a matter of who is looking, not of what
   * the entry means.
   */
  prefs: CommandPrefs;
  x: number; // viewport coords of the click
  y: number;
  // The WHOLE item, not its line: whether every argument is already filled decides whether the
  // host runs it or hands it to the bar, and only the item knows (see contextMenu.ts).
  onPick: (item: MenuItem) => void;
  onClose: () => void;
}) {
  // Null until the set lands. A menu opened first thing draws its labels and no icons, which is
  // the honest degradation: the label is what an entry MEANS, the icon is how you recognise it
  // faster the second time. Cached after that, so every menu since is synchronous.
  const icons = useIcons();
  // A person's name for a command is per LANGUAGE now, so picking one takes a locale. Read here
  // rather than threaded down from App: this menu already reaches for its own `useIcons`, and the
  // settings page that WRITES these names reads the locale the same way (CommandsSettings).
  const { locale } = useLocale();
  const ref = useRef<HTMLDivElement>(null);
  // Start at the click, then clamp into the viewport once we can measure the menu.
  const [pos, setPos] = useState({ x, y });

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setPos({
      x: Math.max(8, Math.min(x, window.innerWidth - r.width - 8)),
      y: Math.max(8, Math.min(y, window.innerHeight - r.height - 8)),
    });
  }, [x, y]);

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

  if (!items.length) return null;

  return (
    <div
      ref={ref}
      style={{ left: pos.x, top: pos.y }}
      // Bounded and scrollable: a track offers every command that takes one, which is sixteen
      // rows, and a menu that runs off the bottom of the screen hides its own tail. Narrower
      // since the command column went — 34rem was width for two columns, and a menu of sentences
      // that wide leaves the eye travelling for nothing.
      className="fixed z-50 max-h-[70vh] min-w-[13rem] max-w-[22rem] overflow-y-auto rounded-md border border-border bg-popover py-1 text-sm shadow-md"
      role="menu"
    >
      {items.map((it) => {
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
            className="flex w-full items-center gap-2 px-3 py-1 text-left hover:bg-accent hover:text-accent-foreground"
          >
            {/* What it DOES, and only that. The command LINE used to sit beside it in mono, on the
              argument that hiding what a pick is about to run is opaque — but a menu is read for
              what it offers, not for how the offer is spelled, and a column of `track solo …`
              beside a column of sentences saying the same thing twice is what actually made this
              hard to scan. The line is still one hover away, in the title.

              The gutter is held whether or not there IS an icon, so the labels of a half-decorated
              menu still line up — a ragged left edge reads as a rendering fault. */}
            <span className="flex h-4 w-4 shrink-0 items-center justify-center">
              {Icon ? <Icon className="h-4 w-4" /> : null}
            </span>
            {/* The person's name for it in THIS language, else the entry's own. `labelIn` is
                what reads both shapes — a per-language map, and the bare string the field used
                to be, which still stands for every locale until that command is next renamed.
                Trimmed here, because it answers as AUTHORED: the settings field is a controlled
                input and cannot be handed back a value with the space just typed removed. */}
            <span className="min-w-0 flex-1 truncate">
              {labelIn(pref?.label, locale).trim() || it.label}
            </span>
            {/* The one thing the line carried that the sentence does not: whether picking this
                RUNS it or only fills the bar with it. It survives the line's removal because it
                is the difference between an action and a question. */}
            {!it.complete && (
              <span className="shrink-0 text-muted-foreground">…</span>
            )}
          </button>
        );
      })}
    </div>
  );
}
