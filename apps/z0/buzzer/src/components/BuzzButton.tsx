// The buzzer's face: a commons Button grown to most of the screen, its variant telling the state.
// It has no handler of its own — the whole PAGE buzzes on a tap, so a thumb need not aim (BuzzerView).

import { Button } from "@frediverse/ui/button";
import { cn } from "@frediverse/ui/lib/utils";

export function BuzzButton({
  text,
  isAnswering,
  locked,
  politeness,
  hasPlayer,
  pressed,
  lockRemaining,
}: {
  text: string;
  isAnswering: boolean;
  locked: boolean;
  politeness: boolean;
  hasPlayer: boolean;
  pressed: boolean;
  lockRemaining: number;
}) {
  const disabled = (locked || !hasPlayer) && !isAnswering;
  const polite = locked && politeness && !isAnswering;
  return (
    <Button
      type="button"
      tabIndex={-1}
      disabled={disabled}
      variant={
        isAnswering
          ? "default"
          : polite
            ? "outline"
            : disabled
              ? "secondary"
              : "default"
      }
      className={cn(
        "size-[70vmin] max-h-[400px] max-w-[400px] flex-col gap-2 rounded-full text-4xl tracking-widest whitespace-normal shadow-2xl ring-8 ring-primary/30 transition-transform",
        pressed && !locked && "scale-95 ring-primary/70",
        disabled && "scale-[0.97] ring-destructive/30",
        polite &&
          "border-4 border-primary text-base leading-snug text-primary ring-primary/20 disabled:opacity-100",
        isAnswering &&
          "animate-pulse bg-green text-background ring-green/50 hover:bg-green",
      )}
    >
      <span className={cn("pointer-events-none", polite && "max-w-[70%]")}>
        {text}
      </span>
      {locked && lockRemaining > 0 && !isAnswering && (
        <span className="pointer-events-none text-xl text-destructive">
          {lockRemaining}s
        </span>
      )}
    </Button>
  );
}
