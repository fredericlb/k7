// MobileChrome.tsx — the ONE piece of shell a phone gets: a hamburger holding the header's right
// side and every screen to go to. There is no global view on a phone (`full` is never null), so
// the menu is what drives it.
//
// No bottom tab bar: it spends a row of a ~400px-tall landscape screen on a control used a few
// times a session, and a bare pane name is what the local dispatcher refuses. One menu, one
// place to go somewhere.
//
// A plain popover, not a DropdownMenu, since what it holds is itself menus.

import { Button } from "@frediverse/ui/button";
import { cn } from "@frediverse/ui/lib/utils";
import { Menu, X } from "lucide-react";
import { useEffect, useRef } from "react";
import { usePopin } from "../popins";

export function MobileMenu({
  open,
  onOpenChange,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  // Registered while open so the shell's Esc stops here (see popins.ts).
  usePopin(open, () => onOpenChange(false));
  // Close on outside press or Escape. Pointerdown, so a press that starts outside and drags in still closes it.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) onOpenChange(false);
    };
    const onKey = (e: KeyboardEvent) =>
      e.key === "Escape" && onOpenChange(false);
    // Deferred: the very pointerdown that opened this is still propagating.
    const id = setTimeout(() => {
      window.addEventListener("pointerdown", onDown);
      window.addEventListener("keydown", onKey);
    });
    return () => {
      clearTimeout(id);
      window.removeEventListener("pointerdown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open, onOpenChange]);

  return (
    <div className="relative" ref={ref}>
      <Button
        size="icon"
        variant={open ? "default" : "ghost"}
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={() => onOpenChange(!open)}
        title="Menu"
        aria-label="Menu"
      >
        {open ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
      </Button>
      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full z-50 mt-1 flex min-w-[13rem] flex-col gap-2 rounded-md border border-border bg-popover p-2 shadow-lg"
        >
          {children}
        </div>
      )}
    </div>
  );
}

/** One row of that menu: `aria-current` and not `aria-pressed`, since on a phone these are NAVIGATION, with a full-width hit target. */
export function MobileMenuItem({
  icon: Icon,
  label,
  current,
  onSelect,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  current?: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      aria-current={current}
      onClick={onSelect}
      className={cn(
        "flex w-full items-center gap-2 rounded px-2 py-2 text-left text-sm",
        current
          ? "bg-accent text-accent-foreground"
          : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
      )}
    >
      <Icon className="h-4 w-4 shrink-0" />
      <span className="truncate">{label}</span>
    </button>
  );
}
