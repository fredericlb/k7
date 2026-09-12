// The reference track at the top of a song: the browser's own player, and the two
// buttons that put a file there or take it away.
//
// `<audio controls>` rather than a hand-rolled transport — it already draws the progress
// bar, seeks, and knows about buffering; the backend answers Range so the bar works.
// Why the bytes are in the médiathèque and not in Grist: ../../docs/audio.md.

import { Button } from "@frediverse/ui/button";
import { useRef, useState } from "react";
import type { Song } from "../types";

interface Props {
  song: Song;
  audioUrl: string;
  onUpload: (file: File) => Promise<void>;
  onDelete: () => Promise<void>;
}

export function SongPlayer({ song, audioUrl, onUpload, onDelete }: Props) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async (act: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await act();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const pick = (file: File | undefined) => {
    if (file) void run(() => onUpload(file));
    if (input.current) input.current.value = "";
  };

  const remove = () => {
    if (!confirm("Remove the track from this song?")) return;
    void run(onDelete);
  };

  return (
    <div className="song-player">
      {song.audio && (
        <audio
          controls
          crossOrigin="use-credentials"
          // The name is in the URL's query so a replaced track is not the cached one.
          src={`${audioUrl}?v=${encodeURIComponent(song.audio.name)}`}
          className="song-player-audio"
        >
          <track kind="captions" />
        </audio>
      )}

      <div className="song-player-row">
        {song.audio ? (
          <span className="muted small song-player-name">
            {song.audio.name}
          </span>
        ) : (
          <span className="muted small">No track yet.</span>
        )}
        <Button
          variant="outline"
          size="sm"
          disabled={busy}
          onClick={() => input.current?.click()}
        >
          {busy ? "Working…" : song.audio ? "Replace" : "＋ Add a track"}
        </Button>
        {song.audio && (
          <Button variant="outline" size="sm" disabled={busy} onClick={remove}>
            Remove
          </Button>
        )}
        <input
          ref={input}
          type="file"
          accept="audio/*"
          className="hidden"
          onChange={(e) => pick(e.target.files?.[0])}
        />
      </div>

      {error && <p className="error small">{error}</p>}
    </div>
  );
}
