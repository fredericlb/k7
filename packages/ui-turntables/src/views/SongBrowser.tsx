// SongBrowser.tsx — click the middle of a record and pick what goes on it: the set's songs,
// searchable, sorted by artist then title. See ../../docs/songBrowser.md.

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@frediverse/ui/dialog";
import { Input } from "@frediverse/ui/input";
import { CloudDownload, Disc3 } from "lucide-react";
import { useMemo, useState } from "react";
import { browseSongs, type SetEntry } from "../setList";

export function SongBrowser({
  side,
  songs,
  open,
  onOpenChange,
  onPick,
}: {
  /** Which deck this will land on — the one thing the dialog has to say out loud. */
  side: "A" | "B";
  songs: SetEntry[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onPick: (song: SetEntry) => void;
}) {
  const [query, setQuery] = useState("");
  const shown = useMemo(() => browseSongs(songs, query), [songs, query]);
  /** In the cache, with audio: the two things that have to be true to play it. */
  const playable = (s: SetEntry) => !!s.entry?.meta?.master;

  const pick = (s: SetEntry) => {
    if (!playable(s)) return;
    onPick(s);
    onOpenChange(false);
    // Cleared on the way OUT, so reopening for the other deck starts on the whole set.
    setQuery("");
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[80vh] max-w-lg flex-col">
        <DialogHeader>
          <DialogTitle>Platine {side}</DialogTitle>
          <DialogDescription>
            {songs.length} morceau{songs.length > 1 ? "x" : ""} dans le set
          </DialogDescription>
        </DialogHeader>

        <Input
          autoFocus
          value={query}
          placeholder="Search for an artist, a title…"
          onChange={(e) => setQuery(e.target.value)}
          // Type, Enter, done — and the first PLAYABLE row, so a syncing song cannot be loaded by mistake.
          onKeyDown={(e) => {
            if (e.key !== "Enter") return;
            const first = shown.find(playable);
            if (first) pick(first);
          }}
        />

        <div className="min-h-0 flex-1 overflow-auto">
          {!shown.length ? (
            <p className="px-3 py-6 text-center text-sm text-muted-foreground">
              {songs.length
                ? "No song matches."
                : "The set is empty — add songs to songs.yaml."}
            </p>
          ) : (
            <ul className="flex flex-col">
              {shown.map((s) => (
                <li key={s.ref}>
                  <button
                    type="button"
                    disabled={!playable(s)}
                    onClick={() => pick(s)}
                    title={
                      playable(s)
                        ? `load onto deck ${side}`
                        : s.entry
                          ? "this folder carries no audio"
                          : "not in this machine's cache yet"
                    }
                    className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-left hover:bg-accent/40 disabled:opacity-50 disabled:hover:bg-transparent"
                  >
                    {s.entry ? (
                      <Disc3 className="h-4 w-4 shrink-0 text-muted-foreground" />
                    ) : (
                      <CloudDownload className="h-4 w-4 shrink-0 text-muted-foreground opacity-60" />
                    )}
                    <span className="flex min-w-0 flex-col">
                      {/* The ARTIST first and smaller, since the list is sorted by artist. */}
                      {s.artist ? (
                        <span className="truncate text-xs text-muted-foreground">
                          {s.artist}
                        </span>
                      ) : null}
                      <span className="truncate text-sm">{s.name}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
