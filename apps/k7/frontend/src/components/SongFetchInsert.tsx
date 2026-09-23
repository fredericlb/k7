// Under the title: what a song with no track yet can become, and what the auto-fetch pipeline
// is doing about it. song.fetchStatus is server-side, so a reload finds it where it left off
// rather than an empty choice — ../../../docs/audio.md.

import { Button } from "@frediverse/ui/button";
import { Download, Pencil, RotateCw, Upload, X } from "@frediverse/ui/icons";
import { useRef } from "react";
import { m } from "../paraglide/messages.js";
import type { Song } from "../types";
import { FetchStepper } from "./FetchStepper";

interface Props {
  song: Song;
  onDownload: () => void;
  onUpload: (file: File) => void;
  onFixLyrics: () => void;
  /** "Ignore": never offer this insert for this song again — a persisted choice. */
  onIgnore: () => void;
  /** Runs the pipeline again after a step failed once the track was there. */
  onRetry: () => void;
  /** Clears the stored failure without retrying. */
  onDismiss: () => void;
}

export function SongFetchInsert({
  song,
  onDownload,
  onUpload,
  onFixLyrics,
  onIgnore,
  onRetry,
  onDismiss,
}: Props) {
  const file = useRef<HTMLInputElement>(null);
  const { phase, error } = song.fetchStatus;
  const running = phase !== "" && phase !== "failed";

  const pick = () => file.current?.click();
  const picked = () => {
    const f = file.current?.files?.[0];
    if (file.current) file.current.value = "";
    if (f) onUpload(f);
  };

  const input = (
    <input ref={file} type="file" accept="audio/*" hidden onChange={picked} />
  );

  if (song.audio) {
    // A track exists: this insert only has something to say while stemming/lyrics are still
    // running, once a later step failed, or once lyrics need a human's eye.
    if (running) return <FetchStepper {...song.fetchStatus} />;
    const failed = phase === "failed" && error !== "";
    const unmatched = song.lyricsMatch === "unmatched";
    if (!failed && !unmatched) return null;
    return (
      <div className="song-fetch-insert">
        {failed && (
          <p className="song-fetch-insert-text song-fetch-error">{error}</p>
        )}
        {failed && (
          <Button
            variant="ghost"
            size="sm"
            className="song-fetch-btn"
            onClick={onRetry}
          >
            <RotateCw className="size-4" /> {m["fetch.retry"]()}
          </Button>
        )}
        {unmatched && (
          <Button
            variant="ghost"
            size="sm"
            className="song-fetch-btn"
            onClick={onFixLyrics}
          >
            <Pencil className="size-4" /> {m["fetch.fixLyrics"]()}
          </Button>
        )}
        {failed && (
          <Button
            variant="ghost"
            size="sm"
            className="song-fetch-btn"
            onClick={onDismiss}
          >
            <X className="size-4" /> {m["fetch.dismiss"]()}
          </Button>
        )}
      </div>
    );
  }

  if (running) return <FetchStepper {...song.fetchStatus} />;

  // Dismissed on purpose, and nothing is running: stay out of the way for good.
  if (song.fetchIgnored) return null;

  return (
    <div className="song-fetch-insert">
      {phase === "failed" && error && (
        <p className="song-fetch-insert-text song-fetch-error">{error}</p>
      )}
      <p className="song-fetch-insert-text">{m["fetch.question"]()}</p>
      <Button
        variant="ghost"
        size="sm"
        className="song-fetch-btn"
        onClick={onDownload}
      >
        <Download className="size-4" /> {m["fetch.download"]()}
      </Button>
      <Button
        variant="ghost"
        size="sm"
        className="song-fetch-btn"
        onClick={pick}
      >
        <Upload className="size-4" /> {m["fetch.upload"]()}
      </Button>
      {input}
      <Button
        variant="ghost"
        size="sm"
        className="song-fetch-btn"
        onClick={onIgnore}
      >
        <X className="size-4" /> {m["fetch.ignore"]()}
      </Button>
    </div>
  );
}
