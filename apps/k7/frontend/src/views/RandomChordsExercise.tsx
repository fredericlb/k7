import { Button } from "@frediverse/ui/button";
import { ArrowRight, Eye } from "@frediverse/ui/icons";
import { useState } from "react";
import { BackButton } from "../components/BackButton";
import { ChordDiagram } from "../components/ChordDiagram";
import { type ChordPrompt, randomChord } from "../utils/exercises";

interface Props {
  onBack: () => void;
}

/** Calls out a random chord; nothing is checked, the reveal only shows the fingering. */
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
      <div className="detail-head">
        <BackButton to="Exercices" onClick={onBack} />
        <h2>Random chords</h2>
      </div>
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
            <Eye className="size-4" /> Reveal fingering
          </Button>
        )}
      </div>

      <div className="row exercise-actions">
        <Button onClick={next}>
          Next chord <ArrowRight className="size-4" />
        </Button>
      </div>

      <p className="muted small exercise-count">Chord #{count}</p>
    </div>
  );
}
