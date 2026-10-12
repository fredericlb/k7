// EventGainSlider.tsx — an audio event's own trim, ±6 dB, in the clip panel's header beside the loop switch.
// The thumb moves locally and the value COMMITS once, on release — one `event gain`, one write, one reload —
// and a double-click puts it back to unity. See packages/song-edit/docs/eventGain.md.

import { useState } from "react";
import { m } from "../paraglide/messages.js";

const MAX_DB = 6;

const label = (db: number) => `${db > 0 ? "+" : ""}${db.toFixed(1)} dB`;

export function EventGainSlider({
  db,
  onCommit,
}: {
  /** The event's trim as the file states it, 0 when it states none. */
  db: number;
  /** Absent ⇒ nothing is drawn: only a placed audio event has a gain of its own. */
  onCommit?: (db: number) => void;
}) {
  const [draft, setDraft] = useState<number | null>(null);
  if (!onCommit) return null;
  const shown = draft ?? db;
  const commit = (v: number) => {
    setDraft(null);
    if (Math.abs(v - db) > 1e-6) onCommit(v);
  };
  return (
    <label
      className="flex items-center gap-1.5 whitespace-nowrap"
      title={m["clip.gainHint"]()}
    >
      {m["clip.gain"]()}
      <input
        type="range"
        min={-MAX_DB}
        max={MAX_DB}
        step={0.1}
        value={shown}
        onChange={(e) => setDraft(Number(e.target.value))}
        // Released by pointer or by key: either way the gesture is over, and the value is written once.
        onPointerUp={(e) => commit(Number(e.currentTarget.value))}
        onKeyUp={(e) => commit(Number(e.currentTarget.value))}
        onDoubleClick={() => commit(0)}
        className="w-24"
        aria-label={m["clip.gain"]()}
      />
      <span className="w-14 text-right tabular-nums">{label(shown)}</span>
    </label>
  );
}
