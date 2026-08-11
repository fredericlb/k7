// TrackAlternatives.tsx — the lane header's alternative picker: which variant of this track's
// clip list is playing, and how to start another. See apps/l8/frontend/docs/timeline.md.
//
// NOT the AlternativePicker beside the project title, which switches a git BRANCH. This one is
// inside one track and writes one line of its YAML — `track alternative` in commands.yaml.
//
// The menu is PORTALLED to the body, and that is not a detail: the lane's gutter is
// `overflow-hidden` (a zoom parks out-of-view clips at negative offsets, which would otherwise
// spill across it), so a menu positioned inside it is clipped to the height of a lane and
// appears not to open at all.

import { cn } from "@frediverse/ui/lib/utils";
import { Check, ChevronDown, Copy, Plus } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { usePopin } from "../popins";

export function TrackAlternatives({
  track,
  names,
  current,
  onPick,
  onAdd,
}: {
  /** The track's id — every label here names it, since the gutter is too narrow to. */
  track: string;
  /** Every variant's name, in order. A track that has never had one is a list of one. */
  names: string[];
  current: string;
  onPick: (name: string) => void;
  onAdd: (copy: boolean) => void;
}) {
  // Where the menu goes, in viewport coordinates — it lives on the body, so the button's own
  // position is the only thing that can place it. Null means closed.
  const [at, setAt] = useState<{ left: number; top: number } | null>(null);
  const open = at !== null;
  const btn = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);

  const place = useCallback(() => {
    const r = btn.current?.getBoundingClientRect();
    if (!r) return;
    // Estimated from the row count, because the menu is not in the document yet and a lane near
    // the bottom of a long song is exactly where this control gets used. One row is ~26px; the
    // two `create` rows and the separator are the constant.
    const height = names.length * 26 + 66;
    const below = r.bottom + 4;
    setAt({
      left: r.left,
      top:
        below + height > window.innerHeight
          ? Math.max(4, r.top - 4 - height)
          : below,
    });
  }, [names.length]);

  // Registered while open so the shell's Esc stops at this menu rather than closing it AND the
  // graph slot behind it on one keypress. See popins.ts.
  usePopin(open, () => setAt(null));

  // Closes on a click anywhere else or on Escape — the same pair the header's picker uses. The
  // timeout is what stops the click that OPENED it from closing it again on the same gesture.
  useEffect(() => {
    if (!open) return;
    const close = () => setAt(null);
    // BOTH nodes: the menu is no longer inside the button's subtree, so containment has to be
    // asked of each — a click on the menu would otherwise close it before it fired.
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!btn.current?.contains(t) && !menu.current?.contains(t)) close();
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    // A fixed menu does not follow the lane it belongs to, so scrolling or resizing closes it
    // rather than leaving it hanging over an unrelated row.
    const id = setTimeout(() => {
      window.addEventListener("pointerdown", onDown);
      window.addEventListener("keydown", onKey);
      window.addEventListener("scroll", close, true);
      window.addEventListener("resize", close);
    });
    return () => {
      clearTimeout(id);
      window.removeEventListener("pointerdown", onDown);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
  }, [open]);

  // Not on the first one: the lane is showing a variant, and that has to be visible without
  // opening anything — otherwise a track whose clips are "missing" looks like a bug.
  const away = names.length > 1 && current !== names[0];

  return (
    <div className="relative shrink-0">
      <button
        ref={btn}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`alternatives for ${track}`}
        title={
          names.length > 1
            ? `alternative '${current}' of ${names.length} — ${names.join(", ")}`
            : `${track} has one arrangement — this adds another`
        }
        // stopPropagation on the pointer, as the m/s/a buttons do: the gutter is the row's
        // handle, and opening this menu must not also move the caret or select the row.
        onPointerDown={(e) => e.stopPropagation()}
        onDoubleClick={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation();
          if (open) setAt(null);
          else place();
        }}
        className={cn(
          "flex h-4 items-center rounded-sm px-0.5 text-[9px] leading-none",
          away
            ? "gap-0.5 text-amber-400 hover:bg-accent"
            : "text-muted-foreground/60 hover:bg-accent hover:text-foreground",
        )}
      >
        <ChevronDown className="h-3 w-3 shrink-0" />
        {/* The name only when it is NOT the first: that is the state you must be able to read
            off the lane, and every other track keeps the width it always had. */}
        {away && <span className="max-w-[3.5rem] truncate">{current}</span>}
      </button>

      {at &&
        createPortal(
          <div
            ref={menu}
            role="menu"
            style={{ left: at.left, top: at.top }}
            className="fixed z-50 flex min-w-[11rem] flex-col rounded-md border border-border bg-popover p-1 shadow-lg"
          >
            {names.map((n) => (
              <button
                key={n}
                type="button"
                role="menuitem"
                disabled={n === current}
                onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) => {
                  e.stopPropagation();
                  setAt(null);
                  onPick(n);
                }}
                className={cn(
                  "flex items-center gap-2 rounded px-2 py-1 text-left text-xs",
                  n === current
                    ? "text-foreground"
                    : "text-muted-foreground hover:bg-accent hover:text-foreground",
                )}
              >
                <Check
                  className={cn(
                    "h-3 w-3 shrink-0",
                    n !== current && "opacity-0",
                  )}
                />
                <span className="min-w-0 flex-1 truncate font-mono">{n}</span>
              </button>
            ))}
            <div className="my-1 h-px bg-border" />
            {/* Adding is what makes this control useful on a track that has only one, which is
              why the menu is offered there at all. Empty first: a second take starts blank. */}
            {/* Worded as the commands are, so the menu teaches the line you would type. */}
            {[
              ["create (empty)", false, Plus] as const,
              ["create a copy", true, Copy] as const,
            ].map(([label, copy, Icon]) => (
              <button
                key={label}
                type="button"
                role="menuitem"
                onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) => {
                  e.stopPropagation();
                  setAt(null);
                  onAdd(copy);
                }}
                className="flex items-center gap-2 rounded px-2 py-1 text-left text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
              >
                <Icon className="h-3 w-3 shrink-0" />
                <span className="min-w-0 flex-1 truncate">{label}</span>
              </button>
            ))}
          </div>,
          document.body,
        )}
    </div>
  );
}
