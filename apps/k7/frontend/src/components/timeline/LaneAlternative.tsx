// LaneAlternative.tsx — the gutter badge naming the attribute set a lane plays. See
// packages/song/docs/alternatives.md.

import { cn } from "@frediverse/ui/lib/utils";
import { blurOnClick } from "../../keys";

/** Which attribute set a lane is playing, drawn only when it HAS a choice — amber away from the first, and the click opens the lane's ⋮ menu (packages/song/docs/alternatives.md). */
export function LaneAlternative({
  track,
  names,
  current,
  onOpen,
}: {
  track: string;
  names: string[];
  current: string;
  onOpen: (at: { x: number; y: number }) => void;
}) {
  const away = current !== names[0];
  const title = `${track}: alternative '${current}' of ${names.length} — ${names.join(", ")}. Click to switch or add one.`;
  return (
    <button
      type="button"
      aria-haspopup="menu"
      // The gutter is too narrow to repeat the lane's name, so the tooltip carries it.
      title={title}
      aria-label={title}
      // As the m/s/a buttons do: the gutter is the row's handle, and opening this must not also move the caret.
      onPointerDown={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      onClick={(e) => {
        e.stopPropagation();
        const r = e.currentTarget.getBoundingClientRect();
        onOpen({ x: r.left, y: r.bottom + 2 });
        // Or the next Space re-opens this menu instead of rolling the transport — see blurOnClick.
        blurOnClick(e);
      }}
      className={cn(
        "shrink-0 rounded-sm px-1 font-mono text-[9px] leading-none",
        away
          ? "bg-amber-400/20 text-amber-400 hover:bg-amber-400/30"
          : "bg-muted/50 text-muted-foreground hover:bg-accent hover:text-foreground",
      )}
    >
      {current}
    </button>
  );
}
