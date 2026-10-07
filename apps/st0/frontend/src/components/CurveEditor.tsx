// CurveEditor.tsx — `ui curve [name]`: a curve created or edited in one popin. Its name (a uuid for
// a new one), its shape — the four oscillators, an envelope, a drawn curve — its amplitude, and what
// the shape takes: phase and frequency for an oscillator, four knobs for an envelope, the points
// themselves for a drawn curve. Nothing is written until Save, which is one `curve set`.
// See docs/curveEditor.md.

import { Button } from "@frediverse/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@frediverse/ui/dialog";
import { Input } from "@frediverse/ui/input";
import type { CurveCut, CurveSpec } from "@studio/graph-model";
import { CURVE_CUTS } from "@studio/song-schema/curveMath";
import { useState } from "react";
import {
  type CurveDraft,
  conditionsProblem,
  type DraftShape,
  draftOf,
  durationProblem,
  fieldsOf,
  isDrawnShape,
  type ParamKind,
  shapesFor,
} from "../curveDraft";
import { usePopin } from "../popins";
import { CurveConditions } from "./CurveConditions";
import { CurveKnob } from "./CurveKnob";
import { CurvePlot } from "./CurvePlot";

/** What each shape reads as in the select. */
const SHAPE_LABEL: Record<DraftShape, string> = {
  sine: "sine",
  triangle: "triangle",
  saw: "saw",
  square: "square",
  adsr: "ADSR envelope",
  custom: "custom (drawn)",
  onoff: "on / off",
};

/** What each cut reads as in its select. */
const CUT_LABEL: Record<CurveCut, string> = {
  none: "none",
  positive: "positive — keep 0..1",
  negative: "negative — keep -1..0",
};

/** The envelope's four knobs, in ms: what each stage spans at most. */
const ADSR_KNOBS = [
  { key: "attack", label: "A", max: 2000 },
  { key: "decay", label: "D", max: 2000 },
  { key: "sustain", label: "S", max: 4000 },
  { key: "release", label: "R", max: 4000 },
] as const;

const NAME = /^[A-Za-z0-9_-]+$/;

const FIELD = "flex items-center gap-3";
const LABEL = "w-24 shrink-0 text-xs text-muted-foreground";

export function CurveEditor({
  name: initialName,
  isNew,
  spec,
  num,
  den,
  events,
  kind,
  onSave,
  onClose,
}: {
  /** The curve's name — a fresh uuid for a new one, which the person may change before saving. */
  name: string;
  isNew: boolean;
  /** The curve as it is, absent for a new one. */
  spec?: CurveSpec;
  /** The song's time signature, which turns a drawn point into a timecode. */
  num: number;
  den: number;
  /** The events the automated node announces: the condition's dropdown. Absent, the event is typed (`ui curve`). */
  events?: readonly string[];
  /** The kind of param it drives — a boolean follows an on/off curve, a number any other; absent, every shape is offered. */
  kind?: ParamKind;
  onSave: (
    name: string,
    fields: Record<string, unknown>,
  ) => void | Promise<void>;
  onClose: () => void;
}) {
  const [name, setName] = useState(initialName);
  // From a node, the event starts as one it announces rather than a name it may not.
  // …and the shape starts as one the param can follow: on/off for a boolean, never on/off for a number.
  const shapes = shapesFor(kind);
  const [draft, setDraft] = useState<CurveDraft>(() => {
    const d = draftOf(spec);
    const shape = shapes.includes(d.shape) ? d.shape : shapes[0];
    // An event condition opened from a node names one it announces.
    const conditions = d.conditions.map((c) =>
      c.when === "event" && events?.length && !events.includes(c.event)
        ? { ...c, event: events[0] }
        : c,
    );
    return { ...d, shape, conditions };
  });
  const set = (patch: Partial<CurveDraft>) =>
    setDraft((d) => ({ ...d, ...patch }));
  // Registered so the shell's Esc closes this before anything under it (popins.ts).
  usePopin(true, onClose);

  const oscillator = draft.shape !== "adsr" && !isDrawnShape(draft.shape);
  const nameOk = NAME.test(name);
  const problem =
    durationProblem(draft) ??
    conditionsProblem(draft) ??
    (draft.conditions.some((c) => c.when === "event") &&
    events &&
    !events.length
      ? "this node announces no event"
      : null);

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      {/* One shrinkable column, and a scroll past the screen's height: the grid would otherwise grow to its widest row. */}
      <DialogContent className="max-h-[90vh] max-w-xl grid-cols-[minmax(0,1fr)] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>
            {isNew ? "New curve" : `Curve ${initialName}`}
          </DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <label className={FIELD}>
            <span className={LABEL}>name</span>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value.trim())}
              // An existing curve IS its file; renaming it is another verb's business.
              disabled={!isNew}
              spellCheck={false}
              className="font-mono text-xs"
              aria-invalid={!nameOk}
              title={nameOk ? undefined : "letters, digits, '_' and '-' only"}
            />
          </label>
          <label className={FIELD}>
            <span className={LABEL}>shape</span>
            <select
              value={draft.shape}
              onChange={(e) => set({ shape: e.target.value as DraftShape })}
              // A boolean has one shape to follow: shown, so it is clear what the curve is, and not a choice.
              disabled={shapes.length < 2}
              className="min-w-0 flex-1 rounded border border-border bg-background px-2 py-1 text-sm"
            >
              {shapes.map((s) => (
                <option key={s} value={s}>
                  {SHAPE_LABEL[s]}
                </option>
              ))}
            </select>
          </label>
          {/* Depth and, for an oscillator, where it starts — one row, the two sliders side by side. */}
          {draft.shape !== "onoff" && (
            <div className={FIELD}>
              <Slider
                label="amplitude"
                value={draft.amplitude}
                onChange={(amplitude) => set({ amplitude })}
              />
              {oscillator && (
                <Slider
                  label="phase"
                  value={draft.phase}
                  onChange={(phase) => set({ phase })}
                />
              )}
            </div>
          )}
          {/* Its sign, then which half of the output it keeps — a switch's 0 and 1 have neither (docs/curveEditor.md). */}
          {draft.shape !== "onoff" && (
            <div className={FIELD}>
              <span className={LABEL}>polarity</span>
              {(["bipolar", "unipolar"] as const).map((p) => (
                <label key={p} className="flex items-center gap-1 text-xs">
                  <input
                    type="radio"
                    name="curve-polarity"
                    checked={draft.polarity === p}
                    onChange={() => set({ polarity: p })}
                  />
                  {p}
                </label>
              ))}
              <label className="ml-auto flex min-w-0 flex-1 items-center gap-2">
                <span className="text-xs text-muted-foreground">cut</span>
                <select
                  value={draft.cut}
                  onChange={(e) => set({ cut: e.target.value as CurveCut })}
                  className="min-w-0 flex-1 rounded border border-border bg-background px-2 py-1 text-sm"
                >
                  {CURVE_CUTS.map((c) => (
                    <option key={c} value={c}>
                      {CUT_LABEL[c]}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          )}
          {oscillator && (
            <label className={FIELD}>
              <span className={LABEL}>cycles / bar</span>
              <Input
                type="number"
                min={0.01}
                step={0.25}
                value={draft.frequency}
                onChange={(e) => {
                  const f = Number(e.target.value);
                  if (f > 0) set({ frequency: f });
                }}
                className="w-24 font-mono text-xs"
              />
              {/* How long it runs, a length: 0 is for ever (docs/curveEditor.md). */}
              <span className="ml-2 text-xs text-muted-foreground">
                duration
              </span>
              <Input
                value={draft.duration}
                onChange={(e) => set({ duration: e.target.value })}
                placeholder="0"
                spellCheck={false}
                title="how long the curve runs, a length like 2:0 — 0 runs for ever"
                className="w-24 font-mono text-xs"
              />
            </label>
          )}
          {draft.shape === "adsr" && (
            <div className="flex justify-around py-1">
              {ADSR_KNOBS.map((k) => (
                <CurveKnob
                  key={k.key}
                  label={k.label}
                  value={draft[k.key]}
                  min={0}
                  max={k.max}
                  unit=" ms"
                  onChange={(v) => set({ [k.key]: v })}
                />
              ))}
            </div>
          )}
          {/* WHEN it runs — any of its conditions, each restarting it or not (docs/curveEditor.md). */}
          <CurveConditions
            conditions={draft.conditions}
            events={events}
            onChange={(conditions) => set({ conditions })}
          />
          <CurvePlot
            draft={draft}
            num={num}
            den={den}
            onPoints={(points) => set({ points })}
          />
          {isDrawnShape(draft.shape) && (
            <p className="text-xs text-muted-foreground">
              Click to add a point, drag to move it, double-click to remove it.
              {draft.shape === "onoff" &&
                " Each point is off or on, held until the next."}
            </p>
          )}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={!nameOk || !!problem}
            onClick={() => {
              void onSave(name, fieldsOf(draft));
              onClose();
            }}
          >
            {isNew ? "Create" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** A 0..1 slider with its name before it and its value after — half a row when it shares one. */
function Slider({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <label className="flex min-w-0 flex-1 items-center gap-2">
      <span className="text-xs text-muted-foreground">{label}</span>
      <input
        type="range"
        min={0}
        max={1}
        step={0.01}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="min-w-0 flex-1"
      />
      <span className="w-8 text-right font-mono text-xs tabular-nums">
        {value.toFixed(2)}
      </span>
    </label>
  );
}
