// bufferEdit.ts (k7x) — an edit of a buffer's k7x text by key path, and the splices it made, so the editor dispatches
// those instead of replacing the whole text: the undo history keeps the gesture, the cursor stays where it was.
// A reader would get wrong where the splices travel: beside the text, kept for the next sync of that exact pair (docs/k7xTree.md).

import { ChangeSet } from "@codemirror/state";
import { type K7Change, K7Document, type K7Scope } from "@studio/k7x/document";

interface Made {
  before: string;
  after: string;
  changes: K7Change[];
}

/** The last few edits: a few, since a render may PROBE an edit (would it apply?) between a gesture and its sync. */
const recent: Made[] = [];
const KEEP = 8;

/** `edit` run on `text` as a k7x document: the new text, or null when the text does not read, `edit` returns false or throws. */
export function editK7xText(
  text: string,
  edit: (doc: K7Scope) => unknown,
): string | null {
  const doc = new K7Document(text);
  if (!doc.contents) return null;
  try {
    if (edit(doc.at([])) === false) return null;
  } catch {
    return null;
  }
  const after = doc.toString();
  if (after !== text) {
    recent.push({ before: text, after, changes: [...doc.changes] });
    if (recent.length > KEEP) recent.shift();
  }
  return after;
}

/** The splices an edit made from `before` to `after`, as one change set; null when no edit here made that pair. */
export function editChanges(before: string, after: string): ChangeSet | null {
  const made = [...recent]
    .reverse()
    .find((m) => m.before === before && m.after === after);
  if (!made) return null;
  let set = ChangeSet.empty(before.length);
  for (const c of made.changes)
    set = set.compose(
      ChangeSet.of(
        { from: c.start, to: c.end, insert: c.insert },
        set.newLength,
      ),
    );
  return set;
}
