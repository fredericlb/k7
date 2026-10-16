// ParamsPane.tsx — the module's parameters as a list, read-only and filtered on purpose: a row is
// DRAGGED onto a widget to bind it, never edited here. The buttons beside the filter ask the
// machine about the plugin (usePluginProbe.ts). See docs/builder.md.

import { Button } from "@frediverse/ui/button";
import {
  AppWindow,
  Camera,
  Loader2,
  RefreshCw,
  SlidersHorizontal,
} from "@frediverse/ui/icons";
import { Input } from "@frediverse/ui/input";
import type { ParamMeta } from "@studio/engine-protocol";
import { useState } from "react";
import { setParamDrag } from "./paramDrag";

/** One parameter as the pane lists it: its authored value, whether a widget binds it, its range. */
export interface ParamRow {
  name: string;
  value?: string;
  bound: boolean;
  meta?: ParamMeta;
}

// A long float is noise in a ~90px row; the untruncated value stays in the row's tooltip.
function shortValue(raw: string): string {
  const n = Number(raw);
  return Number.isFinite(n) && /^-?[\d.]+$/.test(raw.trim())
    ? String(Math.round(n * 1e4) / 1e4)
    : raw;
}

// The parameters, read-only and filtered on purpose — see docs/builder.md.
export function ParamsPane({
  rows,
  onScan,
  scanning,
  scanNote,
  onNativeUi,
  openingUi,
  onSnapshotBase,
  snapping,
}: {
  rows: ParamRow[];
  /** Absent ⇒ no button: a host with no engine cannot ask, and a dead control is worse than none. */
  onScan?: () => void;
  scanning?: boolean;
  /** What the last scan OR window-open answered: the empty and refused cases have no rows to show. */
  scanNote?: string | null;
  /** Absent ⇒ no button: no engine to ask, or a built-in, which draws no window. */
  onNativeUi?: () => void;
  openingUi?: boolean;
  /** Absent ⇒ no button; a base is a WRITE into the module's folder, so it follows the text's lock. */
  onSnapshotBase?: () => void;
  snapping?: boolean;
}) {
  const [q, setQ] = useState("");
  const needle = q.trim().toLowerCase();
  const shown = needle
    ? rows.filter((r) => r.name.toLowerCase().includes(needle))
    : rows;

  return (
    // A pane filling the column, with no border-t: nothing is above it to be separated from.
    <div className="flex h-full min-h-0 flex-col bg-card/30">
      <div className="flex shrink-0 items-center gap-2 border-b border-border px-2 py-1">
        <SlidersHorizontal className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        <span className="hidden text-[10px] text-muted-foreground sm:inline">
          drag onto a widget, or onto empty grid
        </span>
        <span className="text-xs text-muted-foreground">
          {needle ? `${shown.length}/${rows.length}` : rows.length}
        </span>
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="filter…"
          className="ml-auto h-6 w-32 px-2 text-xs"
        />
        {/* With the LIST and not in the header, since what it changes is this pane and not the module. */}
        {onScan && (
          <Button
            size="sm"
            variant="ghost"
            className="h-6 shrink-0 px-2 text-xs"
            disabled={scanning}
            onClick={onScan}
            title="Load this module's plugin and read its parameters — takes a few seconds"
          >
            {scanning ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <RefreshCw className="h-3.5 w-3.5" />
            )}
            <span className="ml-1 hidden sm:inline">
              {scanning ? "lecture…" : "greffon"}
            </span>
          </Button>
        )}
        {/* Beside the scan and not instead of it: the two ask the same binary for different things. */}
        {onNativeUi && (
          <Button
            size="sm"
            variant="ghost"
            className="h-6 shrink-0 px-2 text-xs"
            disabled={openingUi}
            onClick={onNativeUi}
            title="Open the plugin's own window — a separate instance, on the engine's machine. Nothing touched in it is saved."
          >
            {openingUi ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <AppWindow className="h-3.5 w-3.5" />
            )}
            <span className="ml-1 hidden sm:inline">
              {openingUi ? "ouverture…" : "Native UI"}
            </span>
          </Button>
        )}
        {/* Next to the window it reads from, and gone on a read-only module since it writes a file. */}
        {onSnapshotBase && (
          <Button
            size="sm"
            variant="ghost"
            className="h-6 shrink-0 px-2 text-xs"
            disabled={snapping}
            onClick={onSnapshotBase}
            title="Keep the plugin's current state as a named base in the module's base/ folder — for plugins whose sound is not in their parameters"
          >
            {snapping ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Camera className="h-3.5 w-3.5" />
            )}
            <span className="ml-1 hidden sm:inline">
              {snapping ? "capture…" : "Snapshot a base"}
            </span>
          </Button>
        )}
      </div>
      {scanNote && (
        <div className="shrink-0 border-b border-border px-2 py-1 text-[11px] text-muted-foreground">
          {scanNote}
        </div>
      )}
      <div className="min-h-0 flex-1 overflow-auto">
        {shown.length === 0 ? (
          <div className="p-3 text-xs text-muted-foreground">
            {rows.length === 0
              ? onScan
                ? "no parameters known — the project instantiates no plugin for this module. Ask the plugin itself with the button above."
                : "no parameters known — the module sets none, and the engine has no live plugin to ask"
              : `nothing matches "${q.trim()}"`}
          </div>
        ) : (
          shown.map((r) => (
            <div
              key={r.name}
              // Dragging a row onto a widget is what binds it (paramDrag.ts); the range rides along with the name.
              draggable
              onDragStart={(e) =>
                setParamDrag(e.dataTransfer, { name: r.name, meta: r.meta })
              }
              title={[
                r.value === undefined ? r.name : `${r.name} = ${r.value}`,
                r.meta?.states?.length
                  ? `settings: ${r.meta.states.map((s) => s.label).join(", ")}`
                  : r.meta && `range ${r.meta.min}…${r.meta.max}`,
                r.meta?.def !== undefined && `default ${r.meta.def}`,
              ]
                .filter(Boolean)
                .join("\n")}
              className="flex cursor-grab items-baseline gap-2 px-2 py-0.5 font-mono text-xs odd:bg-muted/20 hover:bg-accent/40 active:cursor-grabbing"
            >
              {/* Dimmed when the file leaves the param at the plugin's own value. */}
              <span
                className={`min-w-0 flex-1 truncate ${r.value === undefined ? "text-muted-foreground" : "text-foreground"}`}
              >
                {r.name}
              </span>
              {/* What the parameter spans, which is the number a knob has to be given. */}
              {/* A discrete one shows its setting count instead: that is the cue it makes a dropdown. */}
              {r.meta?.states?.length ? (
                <span className="shrink-0 text-[10px] tabular-nums text-muted-foreground/70">
                  {r.meta.states.length} settings
                </span>
              ) : r.meta ? (
                <span className="shrink-0 text-[10px] tabular-nums text-muted-foreground/70">
                  {r.meta.min}…{r.meta.max}
                </span>
              ) : null}
              {r.bound && (
                <span
                  title="bound to a widget in the UI grid"
                  className="shrink-0 text-[10px] uppercase tracking-wide text-muted-foreground"
                >
                  ui
                </span>
              )}
              <span className="shrink-0 tabular-nums text-muted-foreground">
                {r.value === undefined ? "—" : shortValue(r.value)}
              </span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
