import { Button } from "@frediverse/ui/button";
import { useState } from "react";
import { ChordDiagram } from "../components/ChordDiagram";
import { type ChordPrompt, randomChord } from "../utils/exercises";

interface Props {
  onBack: () => void;
}

/**
 * Calls out a random chord for the player to fret. There's nothing to check —
 * the "reveal" simply shows the fingering so the player can verify themselves
 * before moving on to the next chord.
 */
export function RandomChordsExercise({ onBack }: Props) {
  const [prompt, setPrompt] = useState<ChordPrompt>(() => randomChord());
  const [revealed, setRevealed] = useState(false);
  const [count, setCount] = useState(1);

  const next = () => {
    setPrompt((p) => randomChord(p.symbol));
    setRevealed(false);
    setCount((c) => c + 1);
  };

  return (
    <div className="exercise">
      <Button variant="outline" size="sm" onClick={onBack}>
        ← Exercices
      </Button>
      <h2>Random chords</h2>
      <p className="muted small">
        Play the chord shown on your instrument, then reveal the fingering to
        check yourself and move on.
      </p>

      <div className="exercise-chord-stage">
        <div className="exercise-chord-name">{prompt.symbol}</div>
        <div className="exercise-chord-quality muted">{prompt.quality}</div>

        {revealed ? (
          <div className="exercise-chord-diagram">
            <ChordDiagram key={prompt.symbol} symbol={prompt.symbol} />
          </div>
        ) : (
          <Button variant="outline" onClick={() => setRevealed(true)}>
            👁 Reveal fingering
          </Button>
        )}
      </div>

      <div className="row exercise-actions">
        <Button onClick={next}>Next chord →</Button>
      </div>

      <p className="muted small exercise-count">Chord #{count}</p>
    </div>
  );
}
