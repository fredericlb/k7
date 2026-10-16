// CurveConditions.tsx — the curve editor's WHEN: a list of conditions, the curve running while ANY
// holds, and none meaning always. Each row keeps every moment it was given, so switching its kind
// loses nothing. See docs/curveEditor.md.

import { Button } from "@frediverse/ui/button";
import { Plus, X } from "@frediverse/ui/icons";
import { Input } from "@frediverse/ui/input";
import { useId } from "react";
import {
  conditionProblem,
  DRAFT_WHENS,
  type DraftCondition,
  type DraftWhen,
  newCondition,
} from "../curveDraft";
import { m } from "../paraglide/messages.js";

/** What each condition reads as in its select. */
const WHEN_LABEL: Record<DraftWhen, () => string> = {
  start: () => m["curve.whenStart"](),
  end: () => m["curve.whenEnd"](),
  between: () => m["curve.whenBetween"](),
  event: () => m["curve.whenEvent"](),
};

const FIELD = "flex items-center gap-3";
const LABEL = "w-24 shrink-0 text-xs text-muted-foreground";
const SELECT =
  "min-w-0 flex-1 rounded border border-border bg-background px-2 py-1 text-sm";

export function CurveConditions({
  conditions,
  events,
  onChange,
}: {
  conditions: DraftCondition[];
  /** The events the automated node announces: each event's dropdown. Absent, the event is typed (`ui curve`). */
  events?: readonly string[];
  onChange: (conditions: DraftCondition[]) => void;
}) {
  const patch = (i: number, p: Partial<DraftCondition>) =>
    onChange(conditions.map((c, j) => (j === i ? { ...c, ...p } : c)));
  return (
    <div className="flex flex-col gap-2 rounded border border-border p-2">
      <div className={FIELD}>
        <span className={LABEL}>{m["curve.conditions"]()}</span>
        <span className="flex-1 text-xs text-muted-foreground">
          {conditions.length
            ? m["curve.conditionsAny"]()
            : m["curve.conditionsNone"]()}
        </span>
        <Button
          variant="ghost"
          size="sm"
          onClick={() =>
            onChange([...conditions, newCondition(events?.[0] ?? "Note On")])
          }
        >
          <Plus className="size-3.5" /> {m["curve.addCondition"]()}
        </Button>
      </div>
      {conditions.map((c, i) => (
        <ConditionRow
          // biome-ignore lint/suspicious/noArrayIndexKey: a row IS its place in the list, which has no other identity.
          key={i}
          condition={c}
          events={events}
          onPatch={(p) => patch(i, p)}
          onRemove={() => onChange(conditions.filter((_, j) => j !== i))}
        />
      ))}
    </div>
  );
}

function ConditionRow({
  condition: c,
  events,
  onPatch,
  onRemove,
}: {
  condition: DraftCondition;
  events?: readonly string[];
  onPatch: (p: Partial<DraftCondition>) => void;
  onRemove: () => void;
}) {
  // One id per row, so each label names its own field however many rows there are.
  const uid = useId();
  const opens = c.when === "start" || c.when === "between";
  const closes = c.when === "end" || c.when === "between";
  const problem =
    conditionProblem(c) ??
    (c.when === "event" && events && !events.length
      ? m["curve.noEvent"]()
      : null);
  return (
    <div className="flex flex-col gap-2 border-t border-border pt-2">
      <div className={FIELD}>
        <select
          value={c.when}
          onChange={(e) => onPatch({ when: e.target.value as DraftWhen })}
          className={SELECT}
        >
          {DRAFT_WHENS.map((w) => (
            <option key={w} value={w}>
              {WHEN_LABEL[w]()}
            </option>
          ))}
        </select>
        <Button
          variant="ghost"
          size="sm"
          onClick={onRemove}
          title={m["curve.removeCondition"]()}
        >
          <X className="size-3.5" />
        </Button>
      </div>
      {opens && (
        <label className={FIELD} htmlFor={`${uid}-start`}>
          <span className={LABEL}>
            {c.when === "between" ? m["curve.from"]() : m["curve.whenStart"]()}
          </span>
          <Input
            id={`${uid}-start`}
            value={c.startAt}
            onChange={(e) => onPatch({ startAt: e.target.value })}
            placeholder="5:1:1"
            spellCheck={false}
            className="w-32 font-mono text-xs"
          />
        </label>
      )}
      {closes && (
        <label className={FIELD} htmlFor={`${uid}-end`}>
          <span className={LABEL}>
            {c.when === "between" ? m["curve.to"]() : m["curve.whenEnd"]()}
          </span>
          <Input
            id={`${uid}-end`}
            value={c.endAt}
            onChange={(e) => onPatch({ endAt: e.target.value })}
            placeholder="9:1:1"
            spellCheck={false}
            className="w-32 font-mono text-xs"
          />
        </label>
      )}
      {c.when === "event" && (
        <label className={FIELD} htmlFor={`${uid}-event`}>
          <span className={LABEL}>{m["curve.event"]()}</span>
          {events ? (
            // From a node: what it announces, and nothing it does not.
            <select
              id={`${uid}-event`}
              value={c.event}
              onChange={(e) => onPatch({ event: e.target.value })}
              disabled={!events.length}
              className={SELECT}
            >
              {events.map((ev) => (
                <option key={ev} value={ev}>
                  {ev}
                </option>
              ))}
            </select>
          ) : (
            <Input
              id={`${uid}-event`}
              value={c.event}
              onChange={(e) => onPatch({ event: e.target.value })}
              placeholder="Note On"
              spellCheck={false}
              className="flex-1 text-xs"
              title={m["curve.eventHint"]()}
            />
          )}
        </label>
      )}
      <label className={FIELD}>
        <span className={LABEL}>{m["curve.retrigger"]()}</span>
        <input
          type="checkbox"
          checked={c.retrigger}
          onChange={(e) => onPatch({ retrigger: e.target.checked })}
        />
        <span className="text-xs text-muted-foreground">
          {m["curve.retriggerHint"]()}
        </span>
      </label>
      {problem && <p className="text-xs text-red-500">{problem}</p>}
    </div>
  );
}
