// ListMarks.tsx — the mark a starred or practised row of the songs' table wears, which takes it
// off that list in one click. The lists themselves are favorites.ts.

import { GraduationCap, Star } from "@frediverse/ui/icons";
import { useLabels } from "./host";

/** A starred row's star — outside the row's own button, since a button cannot hold one. */
export function StarredMark({ onUnstar }: { onUnstar: () => void }) {
  const l = useLabels().tree;
  return (
    <button
      type="button"
      className="shrink-0 p-0.5 text-amber-400 hover:text-amber-300"
      title={l.unfavorite}
      aria-label={l.unfavorite}
      aria-pressed
      onClick={(e) => {
        // Inside a row that opens on a click: taking it off a list is not opening it.
        e.stopPropagation();
        onUnstar();
      }}
    >
      <Star className="size-3.5 fill-current" />
    </button>
  );
}

/** A practised row's mark, which takes it off the practice list. */
export function PracticeMark({ onRemove }: { onRemove: () => void }) {
  const l = useLabels().tree;
  return (
    <button
      type="button"
      className="shrink-0 p-0.5 text-sky-400 hover:text-sky-300"
      title={l.unpractice}
      aria-label={l.unpractice}
      aria-pressed
      onClick={(e) => {
        // Inside a row that opens on a click: taking it off a list is not opening it.
        e.stopPropagation();
        onRemove();
      }}
    >
      <GraduationCap className="size-3.5" />
    </button>
  );
}
