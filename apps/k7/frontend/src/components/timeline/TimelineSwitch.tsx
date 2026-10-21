// TimelineSwitch.tsx — the bar above the lanes naming what the pane draws: Main, the project's own
// timeline, or one of its others, and the fixed length of the one open. Which is open is session
// state and writes nothing; a tab's right-click is the timeline's commands, and dragged onto a lane it
// places the timeline there (docs/timeline.md).

import { Layers, Plus } from "@frediverse/ui/icons";
import { cn } from "@frediverse/ui/lib/utils";
import type { WebTimeline } from "@studio/web-protocol";
import { TIMELINE_MIME } from "../../fileDrop";
import { m } from "../../paraglide/messages.js";

const TAB =
  "flex items-center gap-1 rounded px-2 py-0.5 text-xs hover:bg-muted";

export function TimelineSwitch({
  timelines,
  open,
  onOpen,
  onNew,
  lengthOf,
  onContext,
  draggable = false,
}: {
  timelines: WebTimeline[];
  open: string | null;
  onOpen: (id: string | null) => void;
  // Absent on a document that takes no edit: the bar still switches what is drawn.
  onNew?: () => void;
  // The open timeline's length as the ruler reads it, e.g. "8 bars".
  lengthOf: (t: WebTimeline) => string;
  // A tab's right-click: the timeline's own menu, rename first among it.
  onContext?: (id: string, x: number, y: number) => void;
  // A tab dragged onto a lane places its timeline there; off on a document that takes no edit.
  draggable?: boolean;
}) {
  const current = timelines.find((t) => t.id === open);
  return (
    <div className="flex shrink-0 items-center gap-1 overflow-x-auto border-b border-border px-1 py-0.5">
      <button
        type="button"
        aria-pressed={!current}
        onClick={() => onOpen(null)}
        className={cn(TAB, !current && "bg-muted font-medium")}
      >
        {m["tl.main"]()}
      </button>
      {timelines.map((t) => (
        <button
          key={t.id}
          type="button"
          aria-pressed={t.id === open}
          title={m["tl.timelineTitle"]({ name: t.id, length: lengthOf(t) })}
          onClick={() => onOpen(t.id)}
          draggable={draggable}
          onDragStart={(e) => {
            e.dataTransfer.setData(TIMELINE_MIME, t.id);
            e.dataTransfer.effectAllowed = "copy";
          }}
          onContextMenu={(e) => {
            if (!onContext) return;
            e.preventDefault();
            onContext(t.id, e.clientX, e.clientY);
          }}
          className={cn(TAB, t.id === open && "bg-muted font-medium")}
        >
          <Layers className="h-3 w-3 opacity-70" />
          {t.id}
        </button>
      ))}
      {onNew && (
        <button
          type="button"
          onClick={onNew}
          title={m["tl.newTimeline"]()}
          className={cn(TAB, "text-muted-foreground")}
        >
          <Plus className="h-3 w-3" />
          {m["tl.timeline"]()}
        </button>
      )}
      {current && (
        <span className="ml-auto shrink-0 px-2 text-muted-foreground text-xs">
          {m["tl.timelineFixed"]({ length: lengthOf(current) })}
        </span>
      )}
    </div>
  );
}
