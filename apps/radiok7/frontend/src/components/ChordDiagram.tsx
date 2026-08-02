import { Button } from "@frediverse/ui/button";
import ChordImport from "@tombatossals/react-chords/lib/Chord";
import { useMemo, useState } from "react";
import { GUITAR, getChordPositions } from "../utils/chordDiagram";

// react-chords is a Babel-compiled CommonJS module. Depending on the bundler's
// interop, the default import is either the component (node/Vite SSR) or a
// `{ default: component }` wrapper (Vite browser build) — unwrap defensively.
const Chord = ((ChordImport as unknown as { default?: typeof ChordImport })
  .default ?? ChordImport) as typeof ChordImport;

interface Props {
  symbol: string;
}

/**
 * One chord: its name, a guitar fingering diagram, and a pager to step through
 * the alternative fingerings when the database has more than one.
 */
export function ChordDiagram({ symbol }: Props) {
  const positions = useMemo(() => getChordPositions(symbol), [symbol]);
  const [i, setI] = useState(0);

  if (!positions || positions.length === 0) {
    return (
      <div className="chord-card">
        <div className="chord-card-name">{symbol}</div>
        <div className="chord-card-empty">no diagram</div>
      </div>
    );
  }

  const idx = Math.min(i, positions.length - 1);
  const many = positions.length > 1;

  return (
    <div className="chord-card">
      <div className="chord-card-name">{symbol}</div>
      <div className="chord-card-svg">
        <Chord chord={positions[idx]} instrument={GUITAR} />
      </div>
      {many && (
        <div className="chord-pager">
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              setI((n) => (n - 1 + positions.length) % positions.length)
            }
            aria-label="Previous fingering"
          >
            ‹
          </Button>
          <span className="chord-pager-count">
            {idx + 1}/{positions.length}
          </span>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setI((n) => (n + 1) % positions.length)}
            aria-label="Next fingering"
          >
            ›
          </Button>
        </div>
      )}
    </div>
  );
}
