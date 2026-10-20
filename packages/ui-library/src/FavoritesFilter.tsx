// FavoritesFilter.tsx — the songs' tree's two favorite controls: the All / Favorites selector above it,
// and the star a starred row wears, which unstars it. The state behind them is favorites.ts.

import { Star } from "@frediverse/ui/icons";
import { Tabs, TabsList, TabsTrigger } from "@frediverse/ui/tabs";
import { useLabels } from "./host";

/** Every song, or only the starred ones. */
export function FavoritesFilter({
  only,
  onChange,
}: {
  only: boolean;
  onChange: (only: boolean) => void;
}) {
  const l = useLabels().tree;
  return (
    <Tabs
      value={only ? "favorites" : "all"}
      onValueChange={(v) => onChange(v === "favorites")}
      className="mb-2 shrink-0"
    >
      <TabsList>
        <TabsTrigger value="all">{l.showAll}</TabsTrigger>
        <TabsTrigger value="favorites">
          <Star className="mr-1 inline size-3.5" />
          {l.showFavorites}
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
