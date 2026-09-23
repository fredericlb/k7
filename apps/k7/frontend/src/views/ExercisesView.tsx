import { m } from "../paraglide/messages.js";

interface Props {
  onOpen: (id: string) => void;
}

// The catalogue of exercises. New ones slot in here.
const EXERCISES = [
  {
    id: "random-chords",
    title: m["exercise.chords.title"],
    desc: m["exercise.chords.desc"],
  },
  {
    id: "tuner",
    title: m["exercise.tuner.title"],
    desc: m["exercise.tuner.desc"],
  },
  {
    id: "singing",
    title: m["exercise.singing.title"],
    desc: m["exercise.singing.desc"],
  },
];

export function ExercisesView({ onOpen }: Props) {
  return (
    <div className="moments-pane">
      <ul className="session-list home-list">
        {EXERCISES.map((ex) => (
          <li
            key={ex.id}
            className="session-item"
            onClick={() => onOpen(ex.id)}
          >
            <div className="session-name">{ex.title()}</div>
            <div className="session-meta">
              <span>{ex.desc()}</span>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
