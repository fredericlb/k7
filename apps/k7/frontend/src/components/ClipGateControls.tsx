// ClipGateControls.tsx — the clip panel's two thresholds: the onset editor's sensitivity, and the
// trim gate, whose menu OPENS a gate rather than applying one so the wave can draw what it would keep.
// See ../../docs/clipEditors.md.

import { Button } from "@frediverse/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@frediverse/ui/dropdown-menu";
import { Loader2 } from "@frediverse/ui/icons";
import { m } from "../paraglide/messages.js";

// The bounds the file service clamps to anyway (see the /waveform route), repeated so the slider cannot ask for something silently adjusted.
const SENS_MIN = 0.25;
const SENS_MAX = 8;

// The gate's range, in dBFS: −80 is below anything a take carries and −10 above a signal, so neither end is useless.
const GATE_MIN = -80;
const GATE_MAX = -10;

/** The onset detector's sensitivity; unset reads as the service's default, 2. */
export function OnsetThreshold({
  value,
  onChange,
}: {
  value: number | undefined;
  onChange: (value: number) => void;
}) {
  return (
    <label className="flex items-center gap-2">
      {m["clip.threshold"]()}
      <input
        type="range"
        min={SENS_MIN}
        max={SENS_MAX}
        step={0.25}
        value={value ?? 2}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-32"
        aria-label={m["clip.sensitivityLabel"]()}
      />
      <span className="w-8 tabular-nums">{(value ?? 2).toFixed(2)}</span>
    </label>
  );
}

/** The Trim button and its gate: a threshold, what it would keep, and the trim itself. */
export function TrimGateMenu({
  open,
  onOpenChange,
  gate,
  onGate,
  keep,
  busy,
  disabled,
  canTrim,
  onTrim,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  gate: number;
  onGate: (db: number) => void;
  /** What a trim at this gate would keep, in file seconds, or null for nothing above it. */
  keep: { from: number; to: number } | null;
  /** A trim is running. */
  busy: boolean;
  disabled: boolean;
  /** Off with no EVENT to name: the verb addresses a placement, and a take being reviewed has none. */
  canTrim: boolean;
  onTrim: () => void;
}) {
  return (
    <DropdownMenu open={open} onOpenChange={onOpenChange}>
      <DropdownMenuTrigger asChild>
        <Button size="sm" variant="outline" disabled={disabled}>
          {busy ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            m["clip.trim"]()
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-72 p-3">
        <div className="flex items-center gap-2 text-xs">
          {m["clip.threshold"]()}
          <input
            type="range"
            min={GATE_MIN}
            max={GATE_MAX}
            step={1}
            value={gate}
            onChange={(e) => onGate(Number(e.target.value))}
            className="flex-1"
            aria-label={m["clip.gateLabel"]()}
          />
          <span className="w-12 tabular-nums">{gate} dB</span>
        </div>
        <p className="mt-2 text-[11px] text-muted-foreground">
          {keep
            ? m["clip.keeps"]({
                from: keep.from.toFixed(2),
                to: keep.to.toFixed(2),
              })
            : m["clip.nothingAbove"]()}
        </p>
        {/* No warning needed: a trim writes this EVENT's window, not the material (song/docs/materialCut.md). */}
        <Button
          size="sm"
          className="mt-2 w-full"
          disabled={!canTrim}
          onClick={onTrim}
          title={m["clip.trimHint"]()}
        >
          {m["clip.trim"]()}
        </Button>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
