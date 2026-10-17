// ShapePicker.tsx — the archetype buttons and the line saying what the chosen one opens, shared by
// a workspace's first project and a project added to one. See ../../docs/projects.md.

import { Button } from "@frediverse/ui/button";
import type { ProjectShape } from "@studio/song-schema/yaml/projectSchema";
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
  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        {SHAPES.map((sh) => (
          <Button
            key={sh.id}
            type="button"
            size="sm"
            variant={shape === sh.id ? "default" : "secondary"}
            disabled={busy}
            aria-pressed={shape === sh.id}
            onClick={() => onShape(sh.id)}
          >
            <sh.icon className="h-3.5 w-3.5" />
            {sh.label()}
          </Button>
        ))}
      </div>
      <span className="text-muted-foreground text-xs">
        {SHAPES.find((sh) => sh.id === shape)?.what()}
      </span>
    </>
  );
}
