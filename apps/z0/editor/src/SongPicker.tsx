// SongPicker.tsx — pick a médiathèque song by typing. Over the catalogue already in memory, so
// it answers per keystroke without a request. See docs/editing.md.

import { Badge } from "@frediverse/ui/badge";
import { Button } from "@frediverse/ui/button";
import { Input } from "@frediverse/ui/input";
import { useMemo, useState } from "react";
import { type Catalogue, type SongInfo, search } from "./mediatek";

export function SongPicker({
  catalogue,
  onPick,
  onCancel,
}: {
  catalogue: Catalogue;
  onPick: (song: SongInfo) => void;
  onCancel: () => void;
}) {
  const [q, setQ] = useState("");
  const hits = useMemo(() => search(q, catalogue), [q, catalogue]);

  return (
    <div className="border-b bg-muted/30 p-2">
      {/* biome-ignore lint/a11y/noAutofocus: the picker only exists because it was just asked
          for, and typing is the entire interaction. */}
      <Input
        autoFocus
        value={q}
        placeholder="Chercher un morceau…"
        onChange={(e) => setQ(e.target.value)}
        onKeyDown={(e) => e.key === "Escape" && onCancel()}
      />
      {catalogue.size === 0 && (
        <p className="px-1 py-2 text-xs text-muted-foreground">
          La médiathèque n'a pas répondu : aucun morceau à proposer.
        </p>
      )}
      <div className="mt-1 max-h-64 overflow-y-auto">
        {hits.map((s) => (
          <Button
            key={s.id}
            variant="ghost"
            size="sm"
            className="w-full justify-start font-normal"
            onClick={() => onPick(s)}
          >
            <span className="truncate">
              <span className="font-medium">{s.title}</span>
              {s.artist && (
                <span className="text-muted-foreground"> — {s.artist}</span>
              )}
            </span>
            {!s.master && <Badge className="ml-auto">sans audio</Badge>}
          </Button>
        ))}
        {q.trim() && hits.length === 0 && (
          <p className="px-2 py-2 text-xs text-muted-foreground">
            Aucun morceau pour « {q} ».
          </p>
        )}
      </div>
    </div>
  );
}
