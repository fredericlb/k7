// GridMenu.tsx — the builder grid's right-click menu: a short list at the pointer, nothing more.
// Dismissed by Escape, a press outside it, a scroll, or a pick. Rationale: docs/builder.md.

import type { LucideIcon } from "@frediverse/ui/icons";
import { cn } from "@frediverse/ui/lib/utils";
import { useEffect, useLayoutEffect, useRef, useState } from "react";

export interface GridMenuItem {
  label: string;
  icon: LucideIcon;
  disabled?: boolean;
  onPick: () => void;
}

export function GridMenu({
  x,
  y,
  items,
  onClose,
}: {
  /** Viewport coordinates of the right-click. */
  x: number;
  y: number;
  items: GridMenuItem[];
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x, y });

  // Kept inside the viewport once it can be measured: a click near the edge must not open half a menu.
  useLayoutEffect(() => {
    const r = ref.current?.getBoundingClientRect();
    if (!r) return;
    setPos({
      x: Math.min(x, window.innerWidth - r.width - 4),
      y: Math.min(y, window.innerHeight - r.height - 4),
    });
  }, [x, y]);

  useEffect(() => {
    const away = (e: Event) => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    const key = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("pointerdown", away, true);
    window.addEventListener("scroll", onClose, true);
    window.addEventListener("keydown", key);
    return () => {
      window.removeEventListener("pointerdown", away, true);
      window.removeEventListener("scroll", onClose, true);
      window.removeEventListener("keydown", key);
    };
  }, [onClose]);

  return (
    <div
      ref={ref}
      role="menu"
      className="fixed z-50 min-w-[8rem] rounded-md border border-border bg-popover p-1 text-sm shadow-md"
      style={{ left: pos.x, top: pos.y }}
      onContextMenu={(e) => e.preventDefault()}
    >
      {items.map((it) => (
        <button
          key={it.label}
          type="button"
          role="menuitem"
          disabled={it.disabled}
          onClick={() => {
            onClose();
            it.onPick();
          }}
          className={cn(
            "flex w-full items-center gap-2 rounded px-2 py-1 text-left",
            it.disabled ? "cursor-default text-faint" : "hover:bg-secondary",
          )}
        >
          <it.icon className="h-3.5 w-3.5" />
          {it.label}
        </button>
      ))}
    </div>
  );
}
