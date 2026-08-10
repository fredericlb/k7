// ContextMenu.tsx — the right-click popup shared by the timeline and the chains graph: it
// lists WHAT each command does and on a pick PRE-WRITES one into the bar, never running it
// (see contextMenu.ts). One instance lives in App; both surfaces open it through
// openContextMenu. Dismisses on Escape, an outside click, a scroll, or losing focus.

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { MenuItem } from "../contextMenu";

export function ContextMenu({
  items,
  x,
  y,
  onPick,
  onClose,
}: {
  items: MenuItem[];
  x: number; // viewport coords of the click
  y: number;
  onPick: (command: string) => void;
  onClose: () => void;
}) {
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
      {items.map((it) => (
        <button
          key={it.command}
          type="button"
          role="menuitem"
          title={it.command}
          onClick={() => {
            onPick(it.command);
            onClose();
          }}
          className="flex w-full items-baseline justify-between gap-6 px-3 py-1 text-left hover:bg-accent hover:text-accent-foreground"
        >
          {/* What it DOES leads. The line it pre-writes stays beside it, muted: the menu's whole
              contract is that it writes into the bar, and hiding what lands there is opaque. */}
          <span className="min-w-0 flex-1">{it.label}</span>
          <span className="shrink-0 truncate font-mono text-xs text-muted-foreground">
            {it.command}
          </span>
        </button>
      ))}
    </div>
  );
}
