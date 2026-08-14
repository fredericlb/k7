// ContextMenu.tsx — the right-click popup shared by the timeline and the chains graph: it
// lists WHAT each command does and on a pick PRE-WRITES one into the bar, never running it
// (see contextMenu.ts). One instance lives in App; both surfaces open it through
// openContextMenu. Dismisses on Escape, an outside click, a scroll, or losing focus.

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { CommandPrefs } from "../commandPrefs";
import type { MenuItem } from "../contextMenu";
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
      // rows, and a menu that runs off the bottom of the screen hides its own tail.
      className="fixed z-50 max-h-[70vh] min-w-[13rem] max-w-[34rem] overflow-y-auto rounded-md border border-border bg-popover py-1 text-sm shadow-md"
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
            className="flex w-full items-center justify-between gap-6 px-3 py-1 text-left hover:bg-accent hover:text-accent-foreground"
          >
            {/* What it DOES leads, behind the icon this person gave it. The line stays beside it,
              muted, because hiding what a pick is about to run — or write into the bar — is
              opaque. The trailing … is the difference between the two: an item still owing an
              argument asks for it, the rest just go.

              The gutter is held whether or not there IS an icon, so the labels of a half-decorated
              menu still line up — a ragged left edge reads as a rendering fault. */}
            <span className="flex min-w-0 flex-1 items-center gap-2">
              <span className="flex h-4 w-4 shrink-0 items-center justify-center">
                {Icon ? <Icon className="h-4 w-4" /> : null}
              </span>
              <span className="min-w-0 flex-1 truncate">
                {pref?.label?.trim() || it.label}
              </span>
            </span>
            <span className="shrink-0 truncate font-mono text-xs text-muted-foreground">
              {it.command.trimEnd()}
              {it.complete ? "" : " …"}
            </span>
          </button>
        );
      })}
    </div>
  );
}
