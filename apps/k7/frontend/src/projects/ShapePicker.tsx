// ShapePicker.tsx — the archetypes as CARDS, each with a drawing of the screen it opens on and
// what it writes, all visible at once: the choice decides what the whole project becomes, so it
// is shown rather than named. Native radios under the cards, so the arrows, the one tab stop and
// the screen reader's "3 of 5" come from the browser. Shared by a workspace's first project and a
// project added to one. See ../../docs/projects.md.

import { cn } from "@frediverse/ui/lib/utils";
import type { ProjectShape } from "@studio/song-schema/yaml/projectSchema";
import { useId } from "react";
import { m } from "../paraglide/messages.js";
import { ShapeSchematic } from "./shapeSchematics";
import { SHAPES } from "./shapes";

export function ShapePicker({
  shape,
  onShape,
  busy,
}: {
  shape: ProjectShape;
  onShape: (shape: ProjectShape) => void;
  busy: boolean;
}) {
  // Two pickers may be mounted at once (two workspaces' dialogs), and a radio group is keyed by its name.
  const name = useId();
  return (
    <fieldset disabled={busy} className="min-w-0 disabled:opacity-50">
      <legend className="sr-only">{m["shape.pick"]()}</legend>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {SHAPES.map((sh) => {
          const on = shape === sh.id;
          return (
            <label
              key={sh.id}
              className={cn(
                "flex min-w-0 cursor-pointer flex-col items-start gap-2 rounded-lg border p-3 transition-colors",
                // The input is hidden, so its keyboard focus is drawn on the card it stands for.
                "has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-ring has-[:focus-visible]:outline-offset-2",
                on
                  ? "border-primary bg-primary/10"
                  : "border-border hover:border-muted-foreground/40 hover:bg-accent/40",
              )}
            >
              <input
                type="radio"
                name={name}
                value={sh.id}
                checked={on}
                onChange={() => onShape(sh.id)}
                className="sr-only"
              />
              <span className={on ? "text-primary" : "text-muted-foreground"}>
                <ShapeSchematic shape={sh.id} />
              </span>
              <span className="flex items-center gap-1.5 font-semibold text-sm">
                <sh.icon
                  className={cn(
                    "h-3.5 w-3.5 shrink-0",
                    on ? "text-primary" : "text-muted-foreground",
                  )}
                />
                {/* `::first-letter` needs a block container, which a flex row is not. */}
                <span className="inline-block first-letter:uppercase">
                  {sh.label()}
                </span>
              </span>
              <span className="block text-muted-foreground text-xs leading-snug first-letter:uppercase">
                {sh.what()}
              </span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}
