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
  /**
   * What the slider shows while it is being dragged.
   *
   * Local because the command behind it rewrites settings.yaml and re-sends the whole document:
   * firing that per pointer frame would be forty writes for one gesture, and forty entries in the
   * journal to undo it. The handle follows the finger from here and the command goes on RELEASE —
   * the rule the clip panel's velocity drag and the sequencer's nudge already follow.
   */
  const [dragging, setDragging] = useState<number | null>(null);
  const shown = dragging ?? level;
  // A reload that changes the level while the menu sits open should be seen, not overwritten by a
  // ghost nobody is holding any more.
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
      {/* The trigger is the button itself, but it is NOT what opens the menu: a left click
          toggles the click, as it always has. `asChild` keeps the menu anchored to it while
          `onContextMenu` is what opens it — two gestures, one control, and the primary one
          unchanged. */}
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
            // The keyboard moves it too, and a key press is its own release: without this the
            // arrows would paint the handle and never write anything.
            onKeyUp={commit}
            onBlur={commit}
            className="flex-1"
            aria-label="volume du métronome"
          />
          <span className="w-8 text-right tabular-nums">
            {Math.round(shown * 100)}%
          </span>
        </label>
        {/* Said out loud, because the slider stopping short of zero looks like a bug otherwise —
            and because the way to silence it is the control your hand is already on. */}
        <p className="mt-2 text-[10px] text-muted-foreground leading-snug">
          le plus bas est {Math.round(METRONOME_MIN * 100)}% — pour le silence,
          cliquez le métronome
        </p>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
