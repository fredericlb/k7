// EngineSelect.tsx — which ENGINE a node runs as, at the right end of the header's second line.
// A dropdown and not a row of badges: a compressor has eight engines, and eight badges would be
// wider than the card. Its width is SET, so the line's layout is known without a reflow.
// The switch is the HOST's command; this only asks. See packages/song/docs/engines.md.

import { useEffect, useState } from "react";

/** The select's width for these engines: the longest name in 9 px monospace, plus the arrow, capped. */
export function engineSelectW(names: readonly string[]): number {
  const longest = Math.max(0, ...names.map((n) => n.length));
  return Math.min(
    ENGINE_MAX_W,
    Math.ceil(longest * ENGINE_CHAR_W) + ENGINE_CHROME_W,
  );
}

export function EngineSelect({
  module,
  names,
  current,
  width,
  onEngine,
}: {
  module: string;
  names: string[];
  current: string;
  /** As `engineSelectW` gave it — the header's arithmetic counts the same figure. */
  width: number;
  onEngine: (module: string, name: string) => void;
}) {
  // The one asked for, shown at once; the graph's answer replaces it, a refusal by the timeout.
  const [asked, setAsked] = useState<string | null>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: the dep is the trigger, not an input.
  useEffect(() => setAsked(null), [current]);
  useEffect(() => {
    if (asked === null) return;
    const t = setTimeout(() => setAsked(null), ENGINE_GUESS_MS);
    return () => clearTimeout(t);
  }, [asked]);
  return (
    // Kept off the pane like a widget's press, or it arms a pan and the pick never lands.
    <select
      className="dgx-engine"
      style={{ width }}
      title={`Engine — what this ${module} runs as`}
      value={asked ?? current}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
      onChange={(e) => {
        const name = e.target.value;
        if (name === (asked ?? current)) return;
        setAsked(name);
        onEngine(module, name);
      }}
    >
      {names.map((name) => (
        <option key={name} value={name}>
          {name}
        </option>
      ))}
    </select>
  );
}

// How long a pick waits for the graph before giving up — a refused switch never answers.
const ENGINE_GUESS_MS = 4000;
// One character of the 9 px monospace, the padding and arrow around them, and the most a header gives up.
const ENGINE_CHAR_W = 5.5;
const ENGINE_CHROME_W = 22;
const ENGINE_MAX_W = 84;
