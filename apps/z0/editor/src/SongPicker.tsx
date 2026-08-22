// SongPicker.tsx — pick a médiathèque song by typing. Over the catalogue already in memory, so
// it answers per keystroke without a request; the old Grist editor's library modal, minus the
// round trip it needed. See docs/editing.md.

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
          <button
            key={s.id}
            type="button"
            className="block w-full px-2 py-1 text-left text-xs hover:bg-accent"
            onClick={() => onPick(s)}
          >
            <span className="font-medium">{s.title}</span>
            {s.artist && (
              <span className="text-muted-foreground"> — {s.artist}</span>
            )}
            {!s.master && (
              <span className="ml-1 text-muted-foreground">(sans audio)</span>
            )}
          </button>
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
