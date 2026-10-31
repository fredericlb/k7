// LaneToggle.tsx — one of a lane gutter's M/S/A buttons, the same on an audio and a picture lane.
// On touch it fills its share of a second line and grows an invisible 44 px-tall hit box; its
// visual size is not its target size. See docs/timeline.md, "M/S/A in the gutter".

import { cn } from "@frediverse/ui/lib/utils";
import { blurOnClick } from "../../keys";

/** A lane's toggle: `on` wears `onCls` (the mute, solo or arm colour), off it is a quiet chip. */
export function LaneToggle({
  label,
  on,
  onCls,
  title,
  ariaLabel,
  touch,
  className,
  onToggle,
}: {
  label: string;
  on: boolean;
  onCls: string;
  title: string;
  ariaLabel: string;
  /** A phone's gutter: the button takes a third of the line and a finger-sized hit box. */
  touch?: boolean;
  className?: string;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={ariaLabel}
      aria-pressed={on}
      // Stopped so a press does not also start a row drag or move the caret.
      onPointerDown={(e) => e.stopPropagation()}
      // dblclick is its own event and bubbles past the click handler's stop.
      onDoubleClick={(e) => e.stopPropagation()}
      onClick={(e) => {
        e.stopPropagation();
        onToggle();
        // Or the next Space re-toggles this button instead of rolling the transport — see blurOnClick.
        blurOnClick(e);
      }}
      className={cn(
        "relative flex items-center justify-center rounded-sm font-bold text-[11px] leading-none",
        touch
          ? "h-7 min-w-0 flex-1 after:absolute after:inset-x-0 after:-inset-y-2 after:content-['']"
          : "h-5 w-5 shrink-0",
        on
          ? onCls
          : "bg-muted text-foreground/70 hover:bg-accent hover:text-foreground",
        className,
      )}
    >
      {label}
    </button>
  );
}
