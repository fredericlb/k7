// WidgetInspector.tsx — the field editor under the grid for the ONE selected widget: its type, its
// bind (dragged, never typed), its label, and the fields its kind carries. It owns nothing — every
// edit is a patch the grid writes back. The kinds' rules are widgetKinds.ts; docs/builder.md.

import { Button } from "@frediverse/ui/button";
import { Trash2 } from "@frediverse/ui/icons";
import { Input } from "@frediverse/ui/input";
import { cn } from "@frediverse/ui/lib/utils";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@frediverse/ui/select";
import { useState } from "react";
import type { Widget, WidgetType } from "./moduleUi";
import { ParamDropField } from "./ParamDropField";
import type { ParamDrag } from "./paramDrag";
import { GROUP_COLOR, ranged, retype, TYPES } from "./widgetKinds";

// The field editor for the selected widget, mirroring #Widget's conditional shape (label vs bound vs numeric).
export function WidgetInspector({
  id,
  w,
  assetParams,
  disabled,
  onPatch,
  onBind,
  onDelete,
}: {
  id: string;
  w: Widget;
  assetParams?: string[];
  disabled?: boolean;
  onPatch: (w: Partial<Widget>) => void;
  /** Bind a dropped parameter, the SAME path a drop on the grid takes — range and settings and all. */
  onBind: (p: ParamDrag) => void;
  onDelete: () => void;
}) {
  const isLabel = w.type === "label";
  const isWaveform = w.type === "waveform";
  const isLcd = w.type === "lcdscreen";
  const isGroup = w.type === "group";
  // A file picker's `bind` is chosen from the File select below, so the bind chip steps aside.
  const isLibrary =
    w.type === "filepicker" || (w.type === "dropdown" && !!w.library);
  const numeric = ranged(w); // same predicate the drop path uses to adopt a range
  const num = (v: string): number | undefined => {
    const t = v.trim();
    if (t === "") return undefined;
    const n = Number(t);
    return Number.isFinite(n) ? n : undefined;
  };

  return (
    <div className="max-h-[38%] shrink-0 space-y-2 overflow-auto border-t border-border bg-card/40 p-3 text-sm">
      <div className="flex items-center justify-between">
        <span className="font-mono text-xs text-muted-foreground">
          {id} · {w.type}
        </span>
        <Button
          size="sm"
          variant="ghost"
          disabled={disabled}
          onClick={onDelete}
          title="Delete widget"
        >
          <Trash2 className="mr-1 h-3.5 w-3.5" />
          Delete
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <Field label="Type">
          <PickField
            value={w.type}
            disabled={!!disabled}
            options={TYPES.map((t) => ({ value: t.type, label: t.label }))}
            onChange={(v) => onPatch(retype(w, v as WidgetType))}
          />
        </Field>

        {isLabel ? (
          <Field label="Text">
            <Input
              className={FIELD_CLS}
              value={w.text ?? ""}
              disabled={!!disabled}
              onChange={(e) => onPatch({ text: e.target.value })}
            />
          </Field>
        ) : isLcd ? (
          // Nothing to bind: the screen is whatever widgets.js draws under this id.
          <Field label="Drawn by">
            <span className="block truncate rounded border border-border bg-muted/40 px-2 py-1 font-mono text-xs">
              widgets.js → {id}
            </span>
          </Field>
        ) : isGroup ? (
          <>
            <Field label="Color">
              <ColorField
                value={w.color ?? GROUP_COLOR}
                disabled={!!disabled}
                onChange={(color) => onPatch({ color })}
              />
            </Field>
            {/* An on/off param switches the whole section: the card draws its switch and greys the group out. */}
            <Field label="On/off param">
              <ParamDropField
                value={w.bind}
                disabled={!!disabled}
                clearTitle="Unbind"
                onDrop={onBind}
                onClear={() => onPatch({ bind: undefined, invert: undefined })}
              />
            </Field>
            {/* A Mute or Bypass param is on when the section is OFF: the switch reads it backwards. */}
            {w.bind && (
              <Field label="Param is a mute / bypass">
                <label className="flex items-center gap-2 py-1">
                  <input
                    type="checkbox"
                    checked={!!w.invert}
                    disabled={!!disabled}
                    onChange={(e) =>
                      onPatch({ invert: e.target.checked || undefined })
                    }
                  />
                  <span className="text-xs text-muted-foreground">
                    on while the param is off
                  </span>
                </label>
              </Field>
            )}
          </>
        ) : isWaveform || isLibrary ? null : (
          // Not a text field: a binding is DRAGGED, and both halves are the same drop target.
          <Field label="Bound param">
            <ParamDropField
              value={w.bind}
              disabled={!!disabled}
              clearTitle="Unbind"
              onDrop={onBind}
              onClear={() => onPatch({ bind: undefined })}
            />
          </Field>
        )}

        {w.type === "knob" && (
          // The DRY param of a crossfade knob, its bind being the wet one — ui-chains-react's docs/widgets.md.
          <Field label="Crossfade dry">
            <ParamDropField
              value={w.pair}
              disabled={!!disabled || !w.bind}
              clearTitle="Stop crossfading"
              onDrop={(p) => p.name !== w.bind && onPatch({ pair: p.name })}
              onClear={() => onPatch({ pair: undefined })}
            />
          </Field>
        )}

        <Field label="Label">
          <Input
            className={FIELD_CLS}
            value={w.label ?? ""}
            disabled={!!disabled}
            placeholder="(optional)"
            onChange={(e) => onPatch({ label: e.target.value || undefined })}
          />
        </Field>

        {w.type === "filepicker" && (
          // WHICH file-valued param this picker sets — the whole configuration, so nothing can disagree.
          <Field label="File">
            <PickField
              value={w.bind ?? ""}
              disabled={!!disabled || !assetParams?.length}
              options={[
                { value: "", label: "(pick a parameter)" },
                ...(assetParams ?? []).map((p) => ({ value: p, label: p })),
              ]}
              onChange={(v) =>
                onPatch({ bind: v || undefined, library: undefined })
              }
            />
          </Field>
        )}

        {w.type === "dropdown" && !!w.library && (
          // The older spelling of a file picker, kept editable — packages/song/docs/filePicker.md.
          <Field label="Files (legacy)">
            <PickField
              value={w.library ?? ""}
              disabled={!!disabled || !assetParams?.length}
              options={[
                { value: "", label: "(the parameter's settings)" },
                ...(assetParams ?? []).map((p) => ({ value: p, label: p })),
              ]}
              onChange={(param) =>
                onPatch(
                  param
                    ? { library: param, bind: param, options: undefined }
                    : { library: undefined, bind: undefined },
                )
              }
            />
          </Field>
        )}

        {isWaveform && (
          <Field label="Source">
            <PickField
              value={w.source ?? "output"}
              disabled={!!disabled}
              options={[
                { value: "output", label: "Output" },
                { value: "input", label: "Input" },
              ]}
              onChange={(v) => onPatch({ source: v as "input" | "output" })}
            />
          </Field>
        )}

        {numeric && (
          <>
            <Field label="Min">
              <Input
                className={FIELD_CLS}
                inputMode="decimal"
                value={w.min ?? ""}
                disabled={!!disabled}
                onChange={(e) => onPatch({ min: num(e.target.value) })}
              />
            </Field>
            <Field label="Max">
              <Input
                className={FIELD_CLS}
                inputMode="decimal"
                value={w.max ?? ""}
                disabled={!!disabled}
                onChange={(e) => onPatch({ max: num(e.target.value) })}
              />
            </Field>
            <Field label="Step">
              <Input
                className={FIELD_CLS}
                inputMode="decimal"
                value={w.step ?? ""}
                disabled={!!disabled}
                placeholder="(optional)"
                onChange={(e) => onPatch({ step: num(e.target.value) })}
              />
            </Field>
            <Field label="Curve">
              <PickField
                value={w.curve ?? "lin"}
                disabled={!!disabled}
                options={[
                  { value: "lin", label: "lin" },
                  { value: "log", label: "log" },
                ]}
                onChange={(v) =>
                  onPatch({ curve: v === "log" ? "log" : undefined })
                }
              />
            </Field>
          </>
        )}
      </div>
    </div>
  );
}

// The design system's fields at the inspector's density: a row of the grid, not a form.
const FIELD_CLS = "h-7 rounded px-2 py-1";

// Radix reserves "" for "no value", so an empty option travels under this name instead.
const NONE = "(none)";

// A design-system Select over plain options, "" allowed as one of them.
function PickField({
  value,
  options,
  disabled,
  onChange,
}: {
  value: string;
  options: { value: string; label: string }[];
  disabled: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <Select
      value={value || NONE}
      disabled={disabled}
      onValueChange={(v) => onChange(v === NONE ? "" : v)}
    >
      <SelectTrigger size="sm" className="h-7 w-full px-2">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map((o) => (
          <SelectItem key={o.value || NONE} value={o.value || NONE}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-0.5">
      <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      {children}
    </label>
  );
}

const HEX = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;

// A swatch and the text beside it: the swatch picks #rrggbb and keeps the alpha, which only the text can set.
function ColorField({
  value,
  disabled,
  onChange,
}: {
  value: string;
  disabled: boolean;
  onChange: (color: string) => void;
}) {
  // The typed text, held apart from the document until it is a colour the schema accepts.
  const [draft, setDraft] = useState(value);
  const rgb = value.length >= 7 ? value.slice(0, 7) : "#000000";
  const alpha = value.length === 9 ? value.slice(7) : "";
  return (
    <div className="flex items-center gap-1">
      <input
        type="color"
        className="h-7 w-8 shrink-0 cursor-pointer rounded border border-border bg-background p-0.5"
        value={rgb}
        disabled={disabled}
        onChange={(e) => {
          setDraft(e.target.value + alpha);
          onChange(e.target.value + alpha);
        }}
      />
      <Input
        className={cn(
          FIELD_CLS,
          "font-mono",
          !HEX.test(draft) && "border-amber-500",
        )}
        value={draft}
        disabled={disabled}
        placeholder="#rrggbbaa"
        onChange={(e) => {
          setDraft(e.target.value);
          if (HEX.test(e.target.value)) onChange(e.target.value);
        }}
      />
    </div>
  );
}
