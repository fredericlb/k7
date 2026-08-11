// MobileChrome.tsx — the two pieces of shell a phone gets: a hamburger holding what the
// header's right side used to show, and a bottom tab bar in place of the studio layout
// (there is no global view on a phone — `full` is simply never null and the tabs drive
// it). A plain popover, not a DropdownMenu, since what it holds is itself menus.

import { Button } from "@frediverse/ui/button";
import { cn } from "@frediverse/ui/lib/utils";
import { type LucideIcon, Menu, Terminal, X } from "lucide-react";
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

// The bottom tab bar: where a thumb reaches, and under the panes so it never covers the current tab.
export function MobileTabBar<P extends string>({
  tabs,
  current,
  onSelect,
  onOpenCommandBar,
}: {
  tabs: { id: P; icon: LucideIcon; label: string }[];
  current: P | null;
  onSelect: (id: P) => void;
  onOpenCommandBar: () => void;
}) {
  return (
    <nav
      className="flex shrink-0 items-stretch border-t border-border bg-card/60"
      // Clear of a phone's home indicator / gesture bar.
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      {tabs.map(({ id, icon: Icon, label }) => (
        <button
          key={id}
          type="button"
          aria-current={current === id}
          onClick={() => onSelect(id)}
          className={cn(
            "flex flex-1 flex-col items-center gap-0.5 py-2 text-[10px]",
            current === id
              ? "text-foreground"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          <Icon className="h-5 w-5" />
          {label}
        </button>
      ))}
      {/* The command bar has no keyboard opener on a phone (there is no double-Shift), so
          it needs a control of its own. */}
      <button
        type="button"
        onClick={onOpenCommandBar}
        className="flex flex-1 flex-col items-center gap-0.5 py-2 text-[10px] text-muted-foreground hover:text-foreground"
        aria-label="Command bar"
      >
        <Terminal className="h-5 w-5" />
        Command
      </button>
    </nav>
  );
}
