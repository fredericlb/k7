// EngineSelect.tsx — which ENGINE a node runs as, above the card's left corner, opposite the
// alternatives' badges. A dropdown and not a row of badges: a compressor has eight engines, and
// eight badges would be wider than the card. The switch is the HOST's command; this only asks.
// See packages/song/docs/engines.md.

import { useEffect, useState } from "react";

export function EngineSelect({
  module,
  names,
  current,
  onEngine,
}: {
  module: string;
  names: string[];
  current: string;
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
