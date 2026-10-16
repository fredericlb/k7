// Stepper.tsx — the grid editor's −/+ number field for the panel's columns and rows.

import { Minus, Plus } from "@frediverse/ui/icons";

export function Stepper({
  label,
  value,
  min,
  disabled,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  disabled?: boolean;
  onChange: (v: number) => void;
}) {
  return (
    <div className="flex items-center gap-1 text-xs text-muted-foreground">
      <span>{label}</span>
      <button
        className="grid h-6 w-6 place-items-center rounded border border-border hover:bg-accent disabled:opacity-40"
        disabled={disabled || value <= min}
        onClick={() => onChange(value - 1)}
      >
        <Minus className="h-3 w-3" />
      </button>
      <span className="w-4 text-center font-mono text-foreground">{value}</span>
      <button
        className="grid h-6 w-6 place-items-center rounded border border-border hover:bg-accent disabled:opacity-40"
        disabled={disabled}
        onClick={() => onChange(value + 1)}
      >
        <Plus className="h-3 w-3" />
      </button>
    </div>
  );
}
