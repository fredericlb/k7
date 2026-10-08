// CompStrip.tsx — a comped event as the waveform panel shows it: one strip across the event, each
// piece in its take's colour with its waveform, and each a button — the piece clicked is the one the
// wave below shows and edits. The colours are the takes view's (`takeColor`), so the two agree on
// which take is which. See docs/clipEditors.md and packages/song/docs/takes.md.

import { cn } from "@frediverse/ui/lib/utils";
import type { EnvelopeProject } from "../clipEnvelope";
import { type TakesEvent, takeColor, takeOfPiece } from "../takes";
import type { WebClip } from "../types";
import { ClipContent } from "./ClipContent";

export function CompStrip({
  ev,
  selected,
  onSelect,
  project,
}: {
  ev: TakesEvent;
  /** The piece the wave below shows. */
  selected: string | null;
  onSelect: (piece: WebClip) => void;
  project: EnvelopeProject;
}) {
  const from = ev.pieces.reduce((m, p) => Math.min(m, p.start), ev.start);
  const to = ev.pieces.reduce((m, p) => Math.max(m, p.start + p.length), from);
  const span = Math.max(1e-6, to - from);
  const pct = (b: number) => `${((b - from) / span) * 100}%`;
  return (
    <div className="relative h-12 shrink-0 overflow-hidden rounded-sm bg-muted/30">
      {ev.pieces.map((p) => {
        const take = takeOfPiece(p);
        const color = takeColor(ev, take);
        const label = take === ev.ref ? "the event's own" : take;
        return (
          <button
            key={p.id}
            type="button"
            onClick={() => onSelect(p)}
            aria-pressed={p.id === selected}
            title={`${label} — click to show and edit this part`}
            aria-label={`edit the part played by ${label}`}
            className={cn(
              "absolute inset-y-0 overflow-hidden border-t-4 text-left",
              p.id === selected
                ? "ring-2 ring-foreground ring-inset"
                : "opacity-80 hover:opacity-100",
            )}
            style={{
              left: pct(p.start),
              width: `calc(${pct(p.start + p.length)} - ${pct(p.start)})`,
              borderTopColor: color,
              background: `${color}33`,
            }}
          >
            <ClipContent clip={p} spanBeats={p.length} project={project} />
          </button>
        );
      })}
    </div>
  );
}
