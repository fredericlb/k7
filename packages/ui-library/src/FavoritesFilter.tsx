// FavoritesFilter.tsx — the songs' tree's list controls: the All / Favorites / Practice selector
// above it, and the mark a starred or practised row wears, which takes it off that list. The state
// behind them is favorites.ts.

import { GraduationCap, Star } from "@frediverse/ui/icons";
import { Tabs, TabsList, TabsTrigger } from "@frediverse/ui/tabs";
import type { TreeFilter } from "./favorites";
import { useLabels } from "./host";

/** Every song, or only the starred ones, or only the ones being practised. */
export function FavoritesFilter({
  value,
  onChange,
}: {
  value: TreeFilter;
  onChange: (filter: TreeFilter) => void;
}) {
  const l = useLabels().tree;
  return (
    <Tabs
      value={value}
      onValueChange={(v) => onChange(v as TreeFilter)}
      className="mb-2 shrink-0"
    >
      <TabsList>
        <TabsTrigger value="all">{l.showAll}</TabsTrigger>
        <TabsTrigger value="favorites">
          <Star className="mr-1 inline size-3.5" />
          {l.showFavorites}
        </TabsTrigger>
        <TabsTrigger value="practice">
          <GraduationCap className="mr-1 inline size-3.5" />
          {l.showPractice}
        </TabsTrigger>
      </TabsList>
    </Tabs>
  );
}

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
      onClick={onUnstar}
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
      onClick={onRemove}
    >
      <GraduationCap className="size-3.5" />
    </button>
  );
}
