// TrackAlternatives.tsx — the lane header's alternative picker: which variant of this track's
// clip list is playing, and how to start another. See apps/l8/frontend/docs/timeline.md.
//
// NOT the AlternativePicker beside the project title, which switches a git BRANCH. This one is
// inside one track and writes one line of its YAML — `track alternative` in commands.yaml.

import { cn } from "@frediverse/ui/lib/utils";
import { Check, ChevronDown, Copy, Plus } from "lucide-react";
import { useEffect, useRef, useState } from "react";

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
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Closes on a click anywhere else or on Escape — the same pair the header's picker uses. The
  // timeout is what stops the click that OPENED it from closing it again on the same gesture.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    const id = setTimeout(() => {
      window.addEventListener("pointerdown", onDown);
      window.addEventListener("keydown", onKey);
    });
    return () => {
      clearTimeout(id);
      window.removeEventListener("pointerdown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  // Not on the first one: the lane is showing a variant, and that has to be visible without
  // opening anything — otherwise a track whose clips are "missing" looks like a bug.
  const away = names.length > 1 && current !== names[0];

  return (
    <div className="relative shrink-0" ref={ref}>
      <button
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
          setOpen((o) => !o);
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

      {open && (
        <div
          role="menu"
          className="absolute left-0 top-full z-50 mt-1 flex min-w-[11rem] flex-col rounded-md border border-border bg-popover p-1 shadow-lg"
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
                setOpen(false);
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
                className={cn("h-3 w-3 shrink-0", n !== current && "opacity-0")}
              />
              <span className="min-w-0 flex-1 truncate font-mono">{n}</span>
            </button>
          ))}
          <div className="my-1 h-px bg-border" />
          {/* Adding is what makes this control useful on a track that has only one, which is
              why the menu is offered there at all. Empty first: a second take starts blank. */}
          {[
            ["new (empty)", false, Plus] as const,
            ["copy of this one", true, Copy] as const,
          ].map(([label, copy, Icon]) => (
            <button
              key={label}
              type="button"
              role="menuitem"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                setOpen(false);
                onAdd(copy);
              }}
              className="flex items-center gap-2 rounded px-2 py-1 text-left text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              <Icon className="h-3 w-3 shrink-0" />
              <span className="min-w-0 flex-1 truncate">{label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
