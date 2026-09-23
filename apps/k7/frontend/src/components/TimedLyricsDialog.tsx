// Timed lyrics, in one popin: get an LRC (a file, or LRCLIB's versions of this song), and its times
// go INTO the sheet as `{{MM:SS}}`, at the end of the closest line (`timeLyrics`) — not a word of it
// changes. The timed sheet is shown beside the sheet before it is saved. A song with no lyrics takes
// the fetched lines themselves, timed — ../../../docs/lyricsTiming.md.

import { Button } from "@frediverse/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@frediverse/ui/dialog";
import { timeLyrics } from "@k7/lyrics";
import { useRef, useState } from "react";
import { m } from "../paraglide/messages.js";
import type { LrcCandidate } from "../types";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The song's lyrics: empty means the LRC's lines become them, filled means they get its timecodes. */
  lyrics: string;
  onFindLrc: (duration?: number) => Promise<LrcCandidate[]>;
  /** The reference track's length, for ranking what LRCLIB offers. */
  trackSeconds: () => number | undefined;
  /** The sheet with its timecodes, and how many fetched lines found a line of it. */
  onSave: (lyrics: string, placed: number) => Promise<void>;
}

/** A timing waiting to be accepted: the timed sheet, how much it placed, and where the LRC came from. */
interface Preview {
  lyrics: string;
  placed: number;
  total: number;
  source: string;
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
  const [preview, setPreview] = useState<Preview | null>(null);

  const reset = () => {
    setBusy(null);
    setError(null);
    setCandidates(null);
    setPreview(null);
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

  /** A file or a found version: saved outright on a song with no lyrics, else timed and shown. `from` names it. */
  const take = async (lrc: string, from: string) => {
    const timed = timeLyrics(lyrics, lrc);
    if (!timed.ok) throw new Error(m["lrc.noTimings"]());
    // No lyrics yet: the file's lines ARE them, so there is no sheet to compare with.
    if (lyrics.trim() === "") {
      await onSave(timed.lyrics, timed.placed);
      close();
      return;
    }
    setCandidates(null);
    setPreview({ ...timed, source: from });
  };

  /** How a found version is named on its column: the service, then the album it is from. */
  const fromLrclib = (c: LrcCandidate) =>
    `LRCLIB · ${c.albumName || c.trackName}`;

  const search = () =>
    run(m["lrc.searching"](), async () => {
      setCandidates(null);
      const found = await onFindLrc(trackSeconds());
      if (found.length === 0) throw new Error(m["lrc.notFound"]());
      if (found.length === 1)
        return take(found[0].syncedLyrics, fromLrclib(found[0]));
      setCandidates(found);
    });

  const save = () =>
    run(m["common.saving"](), async () => {
      if (!preview) return;
      await onSave(preview.lyrics, preview.placed);
      close();
    });

  /** How much of the LRC found a place, in one sentence — read before the sheet is saved. */
  const summary = (p: Preview) =>
    m["lrc.timed.summary"]({ placed: p.placed, total: p.total });

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => (o ? onOpenChange(true) : close())}
    >
      <DialogContent className="max-w-4xl">
        <DialogHeader>
          <DialogTitle>{m["lrc.title"]()}</DialogTitle>
          <DialogDescription>
            {preview ? summary(preview) : m["lrc.intro"]({ code: "{{MM:SS}}" })}
          </DialogDescription>
        </DialogHeader>

        {!preview && (
          <div className="row" style={{ gap: 8 }}>
            <Button
              variant="outline"
              disabled={busy !== null}
              onClick={() => file.current?.click()}
            >
              {m["lrc.addFile"]()}
            </Button>
            <Button variant="outline" disabled={busy !== null} onClick={search}>
              {m["lrc.find"]()}
            </Button>
          </div>
        )}

        {candidates && (
          <div className="lrc-candidates">
            <span className="muted small">{m["lrc.pick"]()}</span>
            {candidates.map((c) => (
              <Button
                key={c.id}
                variant="outline"
                size="sm"
                disabled={busy !== null}
                title={`${c.artistName} — ${c.trackName}`}
                onClick={() =>
                  void run(m["lrc.reading"](), () =>
                    take(c.syncedLyrics, fromLrclib(c)),
                  )
                }
              >
                {c.albumName || c.trackName} · {clock(c.duration).slice(0, -3)}
              </Button>
            ))}
          </div>
        )}

        {preview && (
          <div className="lrc-match">
            {/* Which side is which, kept in view while the lines scroll: the sheet as it is, and with its timecodes. */}
            <div className="lrc-column">
              <div className="lrc-column-head">{m["lrc.side.song"]()}</div>
              <pre className="lrc-preview">{lyrics}</pre>
            </div>
            <div className="lrc-column">
              <div className="lrc-column-head" title={preview.source}>
                {m["lrc.side.timed"]({ source: preview.source })}
              </div>
              <pre className="lrc-preview">{preview.lyrics}</pre>
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
              void run(m["lrc.reading"](), async () =>
                take(await chosen.text(), chosen.name),
              );
          }}
        />

        <DialogFooter>
          <Button variant="secondary" onClick={close}>
            {m["common.cancel"]()}
          </Button>
          {preview && (
            <Button
              variant="outline"
              disabled={busy !== null}
              onClick={() => setPreview(null)}
            >
              {m["lrc.back"]()}
            </Button>
          )}
          {preview && (
            <Button disabled={busy !== null} onClick={save}>
              {m["lrc.apply"]()}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
