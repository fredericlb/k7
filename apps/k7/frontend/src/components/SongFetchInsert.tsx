// Under the title: what a song with no track yet can become, and what the auto-fetch pipeline
// is doing about it. song.fetchStatus is server-side, so a reload finds it where it left off
// rather than an empty choice — ../../../docs/audio.md.

import { Button } from "@frediverse/ui/button";
import { useRef } from "react";
import type { FetchStatus, Song } from "../types";

interface Props {
  song: Song;
  onDownload: () => void;
  onUpload: (file: File) => void;
  onFixLyrics: () => void;
}

const LABEL: Record<Exclude<FetchStatus["phase"], "" | "failed">, string> = {
  searching: "Searching Soulseek…",
  downloading: "Downloading from Soulseek…",
  stemming: "Making the instrumental…",
  "matching-lyrics": "Looking for lyrics…",
};

function StatusRow({ phase, progress }: FetchStatus) {
  if (phase === "" || phase === "failed") return null;
  const determinate = phase === "stemming" && progress !== null;
  return (
    <div className="song-fetch-status">
      <span className="muted small">{LABEL[phase]}</span>
      <div
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={determinate ? Math.round(progress as number) : undefined}
        className={`song-fetch-bar${determinate ? "" : " indeterminate"}`}
      >
        <div
          className="song-fetch-bar-fill"
          style={
            determinate
              ? { width: `${Math.round(progress as number)}%` }
              : undefined
          }
        />
      </div>
    </div>
  );
}

export function SongFetchInsert({
  song,
  onDownload,
  onUpload,
  onFixLyrics,
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
    // running in the background, or once lyrics need a human's eye.
    if (running) return <StatusRow {...song.fetchStatus} />;
    if (song.lyricsMatch === "unmatched")
      return (
        <div className="song-fetch-insert">
          <Button variant="outline" size="sm" onClick={onFixLyrics}>
            Fix the lyrics
          </Button>
        </div>
      );
    return null;
  }

  if (running) return <StatusRow {...song.fetchStatus} />;

  return (
    <div className="song-fetch-insert">
      {phase === "failed" && error && <p className="error small">{error}</p>}
      <Button size="sm" onClick={onDownload}>
        Download the song
      </Button>
      <Button variant="outline" size="sm" onClick={pick}>
        Upload a file…
      </Button>
      {input}
    </div>
  );
}
