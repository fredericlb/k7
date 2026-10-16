// AltBadges.tsx — a module's attribute sets as badges above its corner, and the `+` that adds one —
// docs/nodeCard.md.

import { Plus } from "@frediverse/ui/icons";
import { useEffect, useState } from "react";

/** One badge's width for its name: set, not measured, so the header can size the name beside the row. */
const altBadgeW = (name: string): number =>
  Math.min(ALT_MAX_W, Math.max(ALT_MIN_W, Math.ceil(name.length * 5.5) + 12));

/** The whole row's width — every badge, the `+`, and the gaps between. */
export function altBadgesW(names: readonly string[]): number {
  return names.reduce((w, name) => w + altBadgeW(name) + ALT_GAP, ALT_MIN_W);
}

/** A module's attribute sets as badges above its corner, the last a `+` that copies the one on — docs/nodeCard.md. */
export function AltBadges({
  module,
  names,
  current,
  onAlternative,
}: {
  module: string;
  names: string[];
  current: string;
  onAlternative: (module: string, name: string | null) => void;
}) {
  // The badge clicked, lit before the reply comes back — the graph's own answer replaces it.
  const [asked, setAsked] = useState<string | null>(null);
  // …and the `+`, marked busy until the new set arrives.
  const [adding, setAdding] = useState(false);
  // Any change to what the graph says is the answer, so the guesses give way to it.
  // biome-ignore lint/correctness/useExhaustiveDependencies: the deps are the trigger, not inputs.
  useEffect(() => {
    setAsked(null);
    setAdding(false);
  }, [current, names.length]);
  // A refusal changes nothing the graph says, so a guess also gives up on its own.
  useEffect(() => {
    if (asked === null && !adding) return;
    const t = setTimeout(() => {
      setAsked(null);
      setAdding(false);
    }, ALT_GUESS_MS);
    return () => clearTimeout(t);
  }, [asked, adding]);
  const on = asked ?? current;
  return (
    // Kept off the pane like a widget's press, or it arms a pan and the click never lands.
    <div
      className={`dgx-alts${names.length ? "" : " lone"}`}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
    >
      {names.map((name) => (
        <button
          key={name}
          type="button"
          className={`dgx-alt${name === on ? " on" : ""}`}
          style={{ width: altBadgeW(name) }}
          title={
            name === on
              ? `Alternative "${name}" — the settings this node is playing now`
              : `Play this node with the "${name}" settings instead`
          }
          onClick={() => {
            if (name === on) return;
            setAsked(name);
            onAlternative(module, name);
          }}
        >
          {name}
        </button>
      ))}
      <button
        type="button"
        className={`dgx-alt add${adding ? " busy" : ""}`}
        title={`New alternative — a copy of "${on}"`}
        disabled={adding}
        onClick={() => {
          setAdding(true);
          onAlternative(module, null);
        }}
      >
        <Plus />
      </button>
    </div>
  );
}

// How long a badge's guess waits for the graph before giving up — a refused switch never answers.
const ALT_GUESS_MS = 4000;
// A badge's narrowest (the `+` is that), its widest, and the gap between two — chainsCss.ts's `.dgx-alt`.
const ALT_MIN_W = 15;
const ALT_MAX_W = 80;
const ALT_GAP = 3;
