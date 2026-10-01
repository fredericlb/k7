// ParamDropField.tsx — a param slot the inspector fills by DRAGGING a row from the Parameters pane,
// never by typing: the name must be the plugin's exactly. A widget's bind is one, a crossfade knob's
// dry param another. The one thing a reader would get wrong: its children take no pointer, on purpose.

import { Trash2 } from "@frediverse/ui/icons";
import { cn } from "@frediverse/ui/lib/utils";
import { useState } from "react";
import { isParamDrag, type ParamDrag, readParamDrag } from "./paramDrag";

export function ParamDropField({
  value,
  disabled,
  clearTitle,
  onDrop,
  onClear,
}: {
  value: string | undefined;
  disabled: boolean;
  clearTitle: string;
  onDrop: (p: ParamDrag) => void;
  onClear: () => void;
}) {
  // Whether a parameter is over the field — the ring that says the drop will land.
  const [over, setOver] = useState(false);
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: a drop zone, reached by dragging a row of the Parameters pane.
    <div
      onDragOver={(e) => {
        if (disabled || !isParamDrag(e.dataTransfer)) return;
        e.preventDefault(); // "yes, you may drop here"
        e.dataTransfer.dropEffect = "copy";
        if (!over) setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        setOver(false);
        if (disabled) return;
        const p = readParamDrag(e.dataTransfer);
        if (!p) return;
        e.preventDefault();
        onDrop(p);
      }}
      // The children take no pointer, so every drag event lands on this div, not the chip.
      className={cn(
        "[&_*]:pointer-events-none",
        over && "rounded ring-2 ring-primary",
      )}
    >
      {value ? (
        <div className="flex items-center gap-1">
          <span
            className="min-w-0 flex-1 truncate rounded border border-border bg-muted/40 px-2 py-1 font-mono text-xs"
            title={value}
          >
            {value}
          </span>
          <button
            type="button"
            disabled={disabled}
            onClick={onClear}
            // …except this one, which is a control and has to stay clickable.
            className="pointer-events-auto shrink-0 rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
            title={clearTitle}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      ) : (
        <div className="rounded border border-dashed border-border px-2 py-1 text-xs text-muted-foreground">
          drag a parameter here
        </div>
      )}
    </div>
  );
}
