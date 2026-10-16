// ShapeBar.tsx — the switch between a panel's two shapes, horizontal and its `vertical` twin, and
// what the pair still breaks: the same check the library is held to. See docs/layouts.md.

import { LAYOUT_MAX, twinIssues } from "@studio/panel-rules/layout-twins";
import type { ModuleUI } from "./moduleUi";

/** The switch between the panel's two shapes, and what the pair still breaks — the same check the library is held to. */
export function ShapeBar({
  ui,
  shape,
  onShape,
  onSeed,
  disabled,
}: {
  ui: ModuleUI;
  shape: "horizontal" | "vertical";
  onShape: (s: "horizontal" | "vertical") => void;
  onSeed: () => void;
  disabled: boolean;
}) {
  const issues = twinIssues(ui);
  const fitsBoth = ui.cols <= LAYOUT_MAX && !ui.vertical;
  const btn = (s: "horizontal" | "vertical", label: string) => (
    <button
      type="button"
      onClick={() => onShape(s)}
      className={`rounded px-2 py-0.5 text-xs ${
        shape === s
          ? "bg-accent text-accent-foreground"
          : "text-muted-foreground hover:bg-accent/50"
      }`}
    >
      {label}
    </button>
  );
  return (
    <div className="flex shrink-0 flex-col gap-1 border-b border-border px-2 py-1">
      <div className="flex items-center gap-1">
        {btn("horizontal", `Horizontal · ≤${LAYOUT_MAX} rows`)}
        {btn("vertical", `Vertical · ≤${LAYOUT_MAX} cols`)}
        {/* No twin yet: one is proposed from the panel, every control kept, the frames left to draw again. */}
        {shape === "vertical" && !ui.vertical && !fitsBoth && (
          <button
            type="button"
            disabled={disabled}
            onClick={onSeed}
            className="ml-2 rounded border border-border px-2 py-0.5 text-xs hover:bg-accent disabled:opacity-50"
          >
            Create the vertical layout
          </button>
        )}
        {shape === "vertical" && fitsBoth && (
          <span className="ml-2 text-muted-foreground text-xs">
            This panel is {LAYOUT_MAX} columns or fewer: it serves both shapes.
          </span>
        )}
      </div>
      {issues.length > 0 && (
        <ul className="text-amber-500 text-xs">
          {issues.map((i) => (
            <li key={i}>{i}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
