// Timed lyrics, in one popin: get an LRC (a file, or LRCLIB's versions of this song), then pair its
// lines with the song's own. Nothing is refused — what the automatic pass misses is paired by a
// hand here, which is why this replaced two menu entries — ../../../docs/lyricsTiming.md.

import { Button } from "@frediverse/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@frediverse/ui/dialog";
import {
  alignLrc,
  importLrc,
  type LrcAlignment,
  timingsFrom,
} from "@k7/lyrics";
import { useRef, useState } from "react";
import type { LrcCandidate, LyricTiming } from "../types";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The song's lyrics: empty means the file becomes them, filled means the lines are paired. */
  lyrics: string;
  onFindLrc: (duration?: number) => Promise<LrcCandidate[]>;
  /** The reference track's length, for ranking what LRCLIB offers. */
  trackSeconds: () => number | undefined;
  onSave: (lyrics: string | null, timings: LyricTiming[]) => Promise<void>;
}

const clock = (seconds: number) =>
  `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}.${String(Math.round((seconds % 1) * 100)).padStart(2, "0")}`;

export function TimedLyricsDialog({
  open,
  onOpenChange,
  lyrics,
  onFindLrc,
  trackSeconds,
  onSave,
}: Props) {
  const file = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [candidates, setCandidates] = useState<LrcCandidate[] | null>(null);
  const [alignment, setAlignment] = useState<LrcAlignment | null>(null);
  // Which lyric line is waiting for its LRC line; the second click makes the pair.
  const [picked, setPicked] = useState<number | null>(null);

  const reset = () => {
    setBusy(null);
    setError(null);
    setCandidates(null);
    setAlignment(null);
    setPicked(null);
  };

  const close = () => {
    reset();
    onOpenChange(false);
  };

  const run = async (what: string, act: () => Promise<void>) => {
    setBusy(what);
    setError(null);
    try {
      await act();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  };

  /** A file or a found version, taken as far as it goes: saved outright, or opened for pairing. */
  const take = async (source: string) => {
    // No lyrics yet: the file IS them, so there is nothing to pair.
    if (lyrics.trim() === "") {
      const result = importLrc("", source);
      if (!result.ok) throw new Error("This file has no timed lyrics.");
      await onSave(result.lyrics, result.timings);
      close();
      return;
    }
    const next = alignLrc(lyrics, source);
    if (next.lrc.length === 0)
      throw new Error("This file has no timed lyrics.");
    setCandidates(null);
    setPicked(null);
    setAlignment(next);
  };

  const search = () =>
    run("Searching LRCLIB…", async () => {
      setCandidates(null);
      const found = await onFindLrc(trackSeconds());
      if (found.length === 0)
        throw new Error("No timed lyrics found on LRCLIB for this song.");
      if (found.length === 1) return take(found[0].syncedLyrics);
      setCandidates(found);
    });

  /** Click a paired line to undo it, an unpaired one to arm it; then a line on the right. */
  const clickLyric = (i: number) => {
    if (!alignment) return;
    if (alignment.pairs.has(i)) {
      const pairs = new Map(alignment.pairs);
      pairs.delete(i);
      setAlignment({ ...alignment, pairs, matched: pairs.size });
      setPicked(null);
      return;
    }
    setPicked(i === picked ? null : i);
  };

  const clickLrc = (j: number) => {
    if (!alignment || picked === null) return;
    const pairs = new Map(alignment.pairs);
    // One LRC line answers for one lyric line: taking it gives it up wherever it was.
    for (const [line, at] of pairs) if (at === j) pairs.delete(line);
    pairs.set(picked, j);
    setAlignment({ ...alignment, pairs, matched: pairs.size });
    setPicked(null);
  };

  const save = () =>
    run("Saving…", async () => {
      if (!alignment) return;
      await onSave(
        null,
        timingsFrom(alignment.lines, alignment.lrc, alignment.pairs),
      );
      close();
    });

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => (o ? onOpenChange(true) : close())}
    >
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Timed lyrics</DialogTitle>
          <DialogDescription>
            {alignment
              ? `${alignment.matched} of ${alignment.total} lines paired — click a line, then its line on the right; click a paired line to undo it.`
              : "Add an LRC file, or find one for this song on LRCLIB."}
          </DialogDescription>
        </DialogHeader>

        {!alignment && (
          <div className="row" style={{ gap: 8 }}>
            <Button
              variant="outline"
              disabled={busy !== null}
              onClick={() => file.current?.click()}
            >
              Add an LRC file…
            </Button>
            <Button variant="outline" disabled={busy !== null} onClick={search}>
              Find timed lyrics
            </Button>
          </div>
        )}

        {candidates && (
          <div className="lrc-candidates">
            <span className="muted small">Pick a version:</span>
            {candidates.map((c) => (
              <Button
                key={c.id}
                variant="outline"
                size="sm"
                disabled={busy !== null}
                title={`${c.artistName} — ${c.trackName}`}
                onClick={() => void run("Reading…", () => take(c.syncedLyrics))}
              >
                {c.albumName || c.trackName} · {clock(c.duration).slice(0, -3)}
              </Button>
            ))}
          </div>
        )}

        {alignment && (
          <div className="lrc-match">
            <div className="lrc-column">
              {alignment.lines.map((line, i) => {
                const at = alignment.pairs.get(i);
                return (
                  <button
                    type="button"
                    key={line.line}
                    className={`lrc-row${at !== undefined ? " paired" : ""}${picked === i ? " picked" : ""}`}
                    onClick={() => clickLyric(i)}
                  >
                    <span className="lrc-row-time">
                      {at !== undefined ? clock(alignment.lrc[at].t) : "—"}
                    </span>
                    <span className="lrc-row-text">{line.text}</span>
                  </button>
                );
              })}
            </div>
            <div className="lrc-column">
              {alignment.lrc.map((line, j) => (
                <button
                  type="button"
                  key={`${line.t}:${line.text}`}
                  className={`lrc-row${[...alignment.pairs.values()].includes(j) ? " paired" : ""}`}
                  disabled={picked === null}
                  onClick={() => clickLrc(j)}
                >
                  <span className="lrc-row-time">{clock(line.t)}</span>
                  <span className="lrc-row-text">{line.text}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {busy && <p className="muted small">{busy}</p>}
        {error && <p className="error small">{error}</p>}

        <input
          ref={file}
          type="file"
          accept=".lrc"
          hidden
          onChange={(e) => {
            const chosen = e.target.files?.[0];
            e.target.value = "";
            if (chosen)
              void run("Reading…", async () => take(await chosen.text()));
          }}
        />

        <DialogFooter>
          <Button variant="secondary" onClick={close}>
            Cancel
          </Button>
          {alignment && (
            <Button disabled={busy !== null} onClick={save}>
              Save {alignment.matched} timecode
              {alignment.matched === 1 ? "" : "s"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
