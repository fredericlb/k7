// QueueButton.tsx — the queue, right of the bottom bar: what plays next, in order, movable and
// removable. See ../../docs/miniPlayer.md.

import { Button } from "@frediverse/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@frediverse/ui/dropdown-menu";
import { ChevronDown, ChevronUp, ListVideo, X } from "@frediverse/ui/icons";
import { useLabels } from "../host";
import { usePlayback } from "./PlaybackProvider";

/** The artist and album, which the path carries; empty for a song nobody filed. */
function under(path: string): string {
  const parts = path.split("/");
  return parts.length >= 4 ? `${parts[1]} · ${parts[2]}` : "";
}

export function QueueButton() {
  const { queue, removeFromQueue, moveInQueue } = usePlayback();
  const labels = useLabels();
  const l = labels.playback;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          size="icon"
          variant="ghost"
          className="relative shrink-0"
          aria-label={l.queueButton(queue.length)}
          title={l.queueRegion}
        >
          <ListVideo className="h-4 w-4" />
          {/* The count on the badge, and none on an empty queue: a « 0 » would be permanent noise. */}
          {queue.length > 0 && (
            <span className="absolute -right-0.5 -top-0.5 rounded-full bg-primary px-1 text-[10px] font-semibold leading-4 text-primary-foreground">
              {queue.length}
            </span>
          )}
        </Button>
      </DropdownMenuTrigger>

      {/* Aligned to the end and upwards, and capped by the WINDOW (../docs/responsive.md). */}
      <DropdownMenuContent
        align="end"
        side="top"
        className="w-[min(24rem,calc(100vw-1.5rem))]"
      >
        <DropdownMenuLabel>
          {l.upNext}
          {queue.length ? ` — ${queue.length}` : ""}
        </DropdownMenuLabel>

        {queue.length === 0 ? (
          <p className="px-2 py-3 text-xs text-muted-foreground">
            {l.queueEmpty}
          </p>
        ) : (
          // A list and not DropdownMenuItems: an item closes on click, and moving a row takes several.
          <ul className="max-h-80 overflow-auto">
            {queue.map((item, i) => (
              <li
                key={item.id}
                className="flex items-center gap-1 rounded px-2 py-1 hover:bg-accent/50"
              >
                <span className="w-5 shrink-0 text-right text-[11px] tabular-nums text-muted-foreground">
                  {i + 1}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm">
                    {item.entry.name}
                  </span>
                  {under(item.entry.path) && (
                    <span className="block truncate text-[11px] text-muted-foreground">
                      {under(item.entry.path)}
                    </span>
                  )}
                </span>
                <Button
                  size="icon-xs"
                  variant="ghost"
                  aria-label={labels.common.moveUp}
                  disabled={i === 0}
                  onClick={() => moveInQueue(i, i - 1)}
                >
                  <ChevronUp className="h-3.5 w-3.5" />
                </Button>
                <Button
                  size="icon-xs"
                  variant="ghost"
                  aria-label={labels.common.moveDown}
                  disabled={i === queue.length - 1}
                  onClick={() => moveInQueue(i, i + 1)}
                >
                  <ChevronDown className="h-3.5 w-3.5" />
                </Button>
                <Button
                  size="icon-xs"
                  variant="ghost"
                  aria-label={labels.common.remove}
                  className="text-muted-foreground hover:text-destructive"
                  onClick={() => removeFromQueue(i)}
                >
                  <X className="h-3.5 w-3.5" />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
