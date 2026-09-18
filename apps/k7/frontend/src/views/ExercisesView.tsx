interface Props {
  onOpen: (id: string) => void;
}

// The catalogue of exercises. New ones slot in here.
const EXERCISES = [
  {
    id: "random-chords",
    title: "Random chords",
    desc: "The app calls out a random chord — major, minor, 7th and more — for you to play on your instrument.",
  },
  {
    id: "tuner",
    title: "Guitar tuner",
    desc: "Tune your guitar by ear-free feedback: play a string and the app shows the note, how many cents off you are, and the nearest string.",
  },
  {
    id: "singing",
    title: "Singing exercices",
    desc: "Your own warm-ups and drills: add what to sing and how it goes, and keep them to hand.",
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
            <div className="session-name">{ex.title}</div>
            <div className="session-meta">
              <span>{ex.desc}</span>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
