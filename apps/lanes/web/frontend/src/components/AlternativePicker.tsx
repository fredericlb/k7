// AlternativePicker.tsx — the header's alternative selector, beside the project title.
//
// An alternative is a git branch you try a version of the song on (see `project
// alternative` in commands.yaml). This lists them and switches, which is the pair of
// things you want at a glance; starting, applying and dropping one are deliberately NOT
// here — they change history, and a menu you open to read is the wrong place to put a
// destructive action one slip away from the item above it.
//
// Every action goes through the command bar's own commands, so the menu and a typed
// `project alternative switch` are the same code path.

import { Button } from "@frediverse/ui/button";
import { cn } from "@frediverse/ui/lib/utils";
import { Check, GitBranch } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { api } from "../api";
import type { Alternatives } from "../types";

export function AlternativePicker({
  reloadKey,
  onSwitch,
}: {
  /** Bumped by every command, so the list re-reads after a switch/new/apply. */
  reloadKey: number;
  onSwitch: (name: string) => void;
}) {
  const [alts, setAlts] = useState<Alternatives | null>(null);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let alive = true;
    api
      .alternatives()
      .then((a) => alive && setAlts(a))
      .catch(() => alive && setAlts(null)); // no repo — the picker simply doesn't appear
    return () => {
      alive = false;
    };
  }, [reloadKey]);

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

  // Nothing to choose between is nothing to show: a workspace with one branch gets no
  // control at all rather than a menu of one.
  if (!alts?.current || alts.branches.length < 2) return null;

  return (
    <div className="relative shrink-0" ref={ref}>
      <Button
        size="xs"
        variant="ghost"
        className="h-6 gap-1 px-1.5 text-xs text-muted-foreground hover:text-foreground"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="menu"
        title={
          alts.parent
            ? `alternative '${alts.current}', started from '${alts.parent}'`
            : `on '${alts.current}'`
        }
      >
        <GitBranch className="h-3 w-3 shrink-0" />
        <span className="max-w-[8rem] truncate">{alts.current}</span>
      </Button>
      {open && (
        <div
          role="menu"
          className="absolute left-0 top-full z-50 mt-1 flex min-w-[14rem] flex-col rounded-md border border-border bg-popover p-1 shadow-lg"
        >
          {alts.branches.map((b) => (
            <button
              key={b.name}
              type="button"
              role="menuitem"
              disabled={b.current}
              onClick={() => {
                setOpen(false);
                onSwitch(b.name);
              }}
              className={cn(
                "flex items-center gap-2 rounded px-2 py-1 text-left text-xs",
                b.current
                  ? "text-foreground"
                  : "text-muted-foreground hover:bg-accent hover:text-foreground",
              )}
            >
              <Check
                className={cn("h-3 w-3 shrink-0", !b.current && "opacity-0")}
              />
              <span className="min-w-0 flex-1 truncate font-mono">
                {b.name}
              </span>
              {/* Where it came from — what `apply` would merge into, and what tells a
                  root branch from an alternative at a glance. */}
              {b.parent && (
                <span className="shrink-0 text-[10px] text-muted-foreground">
                  ← {b.parent}
                </span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
