// The band's common book of singing exercises. Anyone adds to it and anyone improves an entry;
// only its author removes one, which is the songbook's rule and holds here for the same reason
// — ../../docs/ownership.md.
//
// One popin serves both verbs: adding and editing differ by what it opens on, not by their form.

import { Button } from "@frediverse/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@frediverse/ui/dialog";
import { Dices, Play, Plus } from "@frediverse/ui/icons";
import { Input } from "@frediverse/ui/input";
import { Textarea } from "@frediverse/ui/textarea";
import { isYouTubeUrl } from "@k7/shared/youtube";
import { useEffect, useState } from "react";
import { api } from "../api";
import { BackButton } from "../components/BackButton";
import type { SingingExercise } from "../types";
import { pickWorkout } from "../utils/exercises";

interface Props {
  onBack: () => void;
}

/** What the popin is working on: a new entry, or the one it was opened from. */
type Editing = {
  of: SingingExercise | null;
  title: string;
  description: string;
  videoUrl: string;
};

const BLANK: Editing = { of: null, title: "", description: "", videoUrl: "" };

export function SingingExercisesView({ onBack }: Props) {
  // `null` is "not read yet", which is not the same screen as an empty book.
  const [items, setItems] = useState<SingingExercise[] | null>(null);
  const [editing, setEditing] = useState<Editing | null>(null);
  // A drawn workout, shown until it is dismissed; `null` is simply "no dice rolled".
  const [workout, setWorkout] = useState<SingingExercise[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    void api
      .listSingingExercises()
      .then((list) => alive && setItems(list))
      .catch((e: Error) => alive && setError(e.message));
    return () => {
      alive = false;
    };
  }, []);

  /** Save the popin: the entry it opened on decides whether this writes or creates. */
  const save = async () => {
    if (!editing) return;
    const title = editing.title.trim();
    const description = editing.description.trim();
    const videoUrl = editing.videoUrl.trim();
    setBusy(true);
    setError(null);
    try {
      if (editing.of) {
        const saved = await api.updateSingingExercise(editing.of.id, {
          title,
          description,
          videoUrl,
        });
        setItems((list) =>
          (list ?? []).map((x) => (x.id === saved.id ? saved : x)),
        );
      } else {
        const made = await api.createSingingExercise({
          title,
          description,
          videoUrl,
        });
        setItems((list) => [made, ...(list ?? [])]);
      }
      setEditing(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  // A link that is there and is not YouTube's: the one thing the popin refuses to save.
  const link = editing?.videoUrl.trim() ?? "";
  const badLink = link !== "" && !isYouTubeUrl(link);

  const remove = async (ex: SingingExercise) => {
    if (!confirm(`Delete “${ex.title}”?`)) return;
    setError(null);
    try {
      await api.deleteSingingExercise(ex.id);
      setItems((list) => (list ?? []).filter((x) => x.id !== ex.id));
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <div className="exercise">
      <div className="singing-head">
        <BackButton to="Exercices" onClick={onBack} />
        <h2>Singing exercices</h2>
        <Button
          size="sm"
          title="Add an exercise"
          aria-label="Add an exercise"
          onClick={() => setEditing(BLANK)}
        >
          <Plus className="size-4" />
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={!items?.length}
          title="Three of them, drawn at random"
          onClick={() => setWorkout(pickWorkout(items ?? [], 3))}
        >
          <Dices className="size-4" /> Create a workout
        </Button>
      </div>
      <p className="muted small">
        Warm-ups and drills the band writes for itself. Everyone sees them all
        and can improve them; you remove only the ones you wrote.
      </p>

      {error && <p className="error small">{error}</p>}

      {items === null ? (
        <p className="muted small">Loading…</p>
      ) : items.length === 0 ? (
        <p className="muted small">
          No exercise yet — <Plus className="size-3.5" /> writes the first one.
        </p>
      ) : (
        <ul className="session-list home-list">
          {items.map((ex) => (
            <li key={ex.id} className="session-item singing-item">
              <div>
                <div className="session-name">{ex.title}</div>
                {ex.description ? (
                  <div className="session-meta">
                    <span>{ex.description}</span>
                  </div>
                ) : null}
                {ex.videoUrl ? (
                  <a
                    className="small"
                    href={ex.videoUrl}
                    target="_blank"
                    rel="noreferrer"
                  >
                    <Play className="size-3.5" /> Demo
                  </a>
                ) : null}
              </div>
              <div className="row">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    setEditing({
                      of: ex,
                      title: ex.title,
                      description: ex.description,
                      videoUrl: ex.videoUrl,
                    })
                  }
                >
                  Edit
                </Button>
                {/* Only its author: removing an entry would take somebody's work with it. */}
                {ex.mine ? (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => void remove(ex)}
                  >
                    Delete
                  </Button>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}

      <Dialog
        open={workout !== null}
        onOpenChange={(o) => !o && setWorkout(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Your workout</DialogTitle>
            <DialogDescription>
              {workout && workout.length < 3
                ? "The whole book — it holds fewer than three exercises so far."
                : "Three exercises, drawn at random. Work them in this order."}
            </DialogDescription>
          </DialogHeader>

          <ol className="workout-list">
            {(workout ?? []).map((ex) => (
              <li key={ex.id}>
                <div className="session-name">{ex.title}</div>
                {ex.description ? (
                  <div className="muted small">{ex.description}</div>
                ) : null}
                {ex.videoUrl ? (
                  <a
                    className="small"
                    href={ex.videoUrl}
                    target="_blank"
                    rel="noreferrer"
                  >
                    <Play className="size-3.5" /> Demo
                  </a>
                ) : null}
              </li>
            ))}
          </ol>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setWorkout(pickWorkout(items ?? [], 3))}
            >
              <Dices className="size-4" /> Roll again
            </Button>
            <Button variant="secondary" onClick={() => setWorkout(null)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={editing !== null}
        onOpenChange={(o) => !o && setEditing(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {editing?.of ? "Edit exercise" : "New exercise"}
            </DialogTitle>
            <DialogDescription>
              A title everyone will recognise, and what the exercise asks of
              you.
            </DialogDescription>
          </DialogHeader>

          <div className="singing-form">
            <Input
              autoFocus
              placeholder="Title — e.g. Lip trills, five notes up"
              value={editing?.title ?? ""}
              onChange={(e) =>
                setEditing((d) => (d ? { ...d, title: e.target.value } : d))
              }
            />
            <Textarea
              rows={4}
              placeholder="How it goes: range, tempo, what to watch for…"
              value={editing?.description ?? ""}
              onChange={(e) =>
                setEditing((d) =>
                  d ? { ...d, description: e.target.value } : d,
                )
              }
            />
            <Input
              placeholder="Demo — a YouTube link (optional)"
              value={editing?.videoUrl ?? ""}
              onChange={(e) =>
                setEditing((d) => (d ? { ...d, videoUrl: e.target.value } : d))
              }
            />
            {/* Said here as well as refused by the route: a typo is worth catching before the trip. */}
            {badLink ? (
              <p className="error small">That is not a YouTube link.</p>
            ) : null}
          </div>

          <DialogFooter>
            <Button
              variant="secondary"
              disabled={busy}
              onClick={() => setEditing(null)}
            >
              Cancel
            </Button>
            <Button
              disabled={busy || badLink || (editing?.title ?? "").trim() === ""}
              onClick={() => void save()}
            >
              {busy ? "Saving…" : editing?.of ? "Save" : "Add"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
