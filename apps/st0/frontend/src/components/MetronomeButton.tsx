// MetronomeButton.tsx — the footer's click toggle, with its LEVEL under a right-click. Two
// questions on one control: whether the metronome sounds (the click) and how loud (the menu).
// Both are project settings written to settings.yaml; see @studio/song docs/metronome.md.

import { Button } from "@frediverse/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@frediverse/ui/dropdown-menu";
import { METRONOME_MIN } from "@studio/engine-protocol/build";
import { type MouseEvent as ReactMouseEvent, useEffect, useState } from "react";
import { m } from "../paraglide/messages.js";
import { MetronomeIcon } from "../shellMeta";

export function MetronomeButton({
  on,
  level,
  onToggle,
  onLevel,
}: {
  on: boolean;
  /** 0.2 … 1, from the compiled doc. */
  level: number;
  onToggle: () => void;
  /** Commit a new level — one command, so one line in the journal and one Ctrl+Z. */
  onLevel: (level: number) => void;
}) {
  const [open, setOpen] = useState(false);
  /** What the slider shows while it is being dragged — the command rewrites settings.yaml, so it goes on RELEASE. */
  const [dragging, setDragging] = useState<number | null>(null);
  const shown = dragging ?? level;
  // A reload that changes the level while the menu sits open should be seen, not overwritten by a ghost nobody is holding.
  useEffect(() => {
    if (!open) setDragging(null);
  }, [open]);

  const commit = () => {
    if (dragging === null) return;
    const v = dragging;
    setDragging(null);
    // Only when it actually moved: reopening the menu and letting go must not write the file.
    if (Math.abs(v - level) > 1e-6) onLevel(v);
  };

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      {/* The trigger is the button but does not OPEN the menu: `asChild` anchors it while `onContextMenu` opens it, leaving left click alone. */}
      <DropdownMenuTrigger asChild>
        <Button
          size="icon-xs"
          variant={on ? "default" : "ghost"}
          aria-pressed={on}
          onClick={onToggle}
          onContextMenu={(e: ReactMouseEvent) => {
            e.preventDefault();
            setOpen(true);
          }}
          title={`${m["transport.metronome"]()} — clic droit : volume (${Math.round(level * 100)}%)`}
          aria-label={m["transport.metronome"]()}
        >
          <MetronomeIcon className="h-3.5 w-3.5" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56 p-3">
        <label className="flex items-center gap-2 text-xs">
          volume
          <input
            type="range"
            min={METRONOME_MIN}
            max={1}
            step={0.05}
            value={shown}
            onChange={(e) => setDragging(Number(e.target.value))}
            onPointerUp={commit}
            // The keyboard moves it too, and a key press is its own release: without this the arrows would paint and write nothing.
            onKeyUp={commit}
            onBlur={commit}
            className="flex-1"
            aria-label="volume du métronome"
          />
          <span className="w-8 text-right tabular-nums">
            {Math.round(shown * 100)}%
          </span>
        </label>
        {/* Said out loud, because a slider stopping short of zero otherwise looks like a bug. */}
        <p className="mt-2 text-[10px] text-muted-foreground leading-snug">
          le plus bas est {Math.round(METRONOME_MIN * 100)}% — pour le silence,
          cliquez le métronome
        </p>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
