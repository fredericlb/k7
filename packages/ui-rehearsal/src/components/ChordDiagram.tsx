/// <reference path="../types/react-chords.d.ts" />
import { Button } from "@frediverse/ui/button";
import { ChevronLeft, ChevronRight } from "@frediverse/ui/icons";
import ChordImport from "@tombatossals/react-chords/lib/Chord";
import { useMemo, useState } from "react";
import { m } from "../paraglide/messages.js";
import { GUITAR, getChordPositions } from "../utils/chordDiagram";

// react-chords is CommonJS, so its default import is the component or a wrapper around it.
const Chord = ((ChordImport as unknown as { default?: typeof ChordImport })
  .default ?? ChordImport) as typeof ChordImport;

interface Props {
  symbol: string;
}

/** One chord: its name, a fingering diagram, and a pager over the alternatives. */
export function ChordDiagram({ symbol }: Props) {
  const positions = useMemo(() => getChordPositions(symbol), [symbol]);
  const [i, setI] = useState(0);

  if (!positions || positions.length === 0) {
    return (
      <div className="chord-card">
        <div className="chord-card-name">{symbol}</div>
        <div className="chord-card-empty">{m["chord.noDiagram"]()}</div>
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
            aria-label={m["chord.prevFingering"]()}
          >
            <ChevronLeft className="size-4" />
          </Button>
          <span className="chord-pager-count">
            {idx + 1}/{positions.length}
          </span>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setI((n) => (n + 1) % positions.length)}
            aria-label={m["chord.nextFingering"]()}
          >
            <ChevronRight className="size-4" />
          </Button>
        </div>
      )}
    </div>
  );
}
