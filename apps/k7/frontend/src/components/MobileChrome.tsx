// MobileChrome.tsx — the ONE piece of shell a phone gets: a menu at the project bar's right end
// holding every screen to go to. There is no global view on a phone (`full` is never null), so the
// menu is what drives it. `MobileInfo` is its twin on the LEFT, holding the project's name and the
// engine, whose labels and figures leave the bar no room otherwise. Both open UPWARD: the bar is
// at the foot of the window. A plain popover, not a DropdownMenu, since what each holds is menus.

import { Button } from "@frediverse/ui/button";
import { Info, Menu, X } from "@frediverse/ui/icons";
import { cn } from "@frediverse/ui/lib/utils";
import { type RefObject, useEffect, useRef } from "react";
import { m } from "../paraglide/messages.js";
import { usePopin } from "../popins";

/** Closes a popover on the shell's Esc and on a press outside `ref`. */
function useDismiss(
  open: boolean,
  onOpenChange: (open: boolean) => void,
  ref: RefObject<HTMLDivElement | null>,
) {
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
  }, [open, onOpenChange, ref]);
}

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
  useDismiss(open, onOpenChange, ref);

  return (
    <div className="relative" ref={ref}>
      <Button
        size="icon"
        variant={open ? "default" : "ghost"}
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={() => onOpenChange(!open)}
        title={m["common.menu"]()}
        aria-label={m["common.menu"]()}
      >
        {open ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
      </Button>
      {open && (
        <div
          role="menu"
          className="absolute right-0 bottom-full z-50 mb-1 flex min-w-[13rem] flex-col gap-2 rounded-md border border-border bg-popover p-2 shadow-lg"
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

/** The phone's name-and-engine popover: one icon in the bar, its dot the link's light so a glance still says it. */
export function MobileInfo({
  open,
  onOpenChange,
  status,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The dot on the icon: the link up, down, or no engine at all; null draws none (a frozen share). */
  status: "up" | "down" | "none" | null;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useDismiss(open, onOpenChange, ref);

  return (
    <div className="relative shrink-0" ref={ref}>
      <Button
        size="icon"
        variant={open ? "default" : "ghost"}
        // A finger-sized slot of its own, beside the hamburger's (docs/shell.md).
        className="relative size-11"
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => onOpenChange(!open)}
        title={m["engineSwitch.info"]()}
        aria-label={m["engineSwitch.info"]()}
      >
        <Info className="h-4 w-4" />
        {/* Named like the desktop's light (EngineLink.tsx), so the link's state reads with the popover closed. */}
        {status && (
          <span
            role="img"
            aria-label={
              status === "up"
                ? m["engine.linkUp"]()
                : status === "down"
                  ? m["engine.linkDown"]()
                  : m["engine.linkNone"]()
            }
            className={cn(
              "absolute right-1 top-1 h-2 w-2 rounded-full ring-2 ring-background",
              status === "up"
                ? "bg-emerald-500"
                : status === "down"
                  ? "bg-red-500"
                  : "bg-amber-500",
            )}
          />
        )}
      </Button>
      {open && (
        <div
          role="dialog"
          aria-label={m["engineSwitch.info"]()}
          className="absolute left-0 bottom-full z-50 mb-1 flex min-w-[16rem] max-w-[calc(100vw-1.5rem)] flex-col gap-2 rounded-md border border-border bg-popover p-2 shadow-lg"
        >
          {children}
        </div>
      )}
    </div>
  );
}
