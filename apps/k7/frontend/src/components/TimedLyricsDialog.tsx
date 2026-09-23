// Timed lyrics, in one popin: get an LRC (a file, or LRCLIB's versions of this song), and its lyrics
// become the song's. A song with none takes them as they are; a song with a sheet gets them MERGED —
// its chords, sections and tablature moved onto the fetched lines (`mergeLrc`) — shown side by side
// with the sheet before anything is replaced — ../../../docs/lyricsTiming.md.

import { Button } from "@frediverse/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@frediverse/ui/dialog";
import { importLrc, type MergeReport, mergeLrc } from "@k7/lyrics";
import { useRef, useState } from "react";
import { m } from "../paraglide/messages.js";
import type { LrcCandidate, LyricTiming } from "../types";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The song's lyrics: empty means the LRC becomes them, filled means it is merged into them. */
  lyrics: string;
  onFindLrc: (duration?: number) => Promise<LrcCandidate[]>;
  /** The reference track's length, for ranking what LRCLIB offers. */
  trackSeconds: () => number | undefined;
  onSave: (lyrics: string | null, timings: LyricTiming[]) => Promise<void>;
}

/** A merge waiting to be accepted: the new document, its timings, what it did, and where the LRC came from. */
interface Preview {
  lyrics: string;
  timings: LyricTiming[];
  report: MergeReport;
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

  /** A file or a found version: saved outright on a song with no lyrics, else merged and shown. `from` names it. */
  const take = async (lrc: string, from: string) => {
    // No lyrics yet: the file IS them, so there is nothing to merge into.
    if (lyrics.trim() === "") {
      const result = importLrc("", lrc);
      if (!result.ok) throw new Error(m["lrc.noTimings"]());
      await onSave(result.lyrics, result.timings);
      close();
      return;
    }
    const merged = mergeLrc(lyrics, lrc);
    if (!merged.ok) throw new Error(m["lrc.noTimings"]());
    setCandidates(null);
    setPreview({ ...merged, source: from });
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
      await onSave(preview.lyrics, preview.timings);
      close();
    });

  /** What the merge did, in one sentence — the thing to read before replacing a sheet. */
  const summary = (r: MergeReport) =>
    r.replaced
      ? m["lrc.merge.replaced"]()
      : m["lrc.merge.summary"]({
          matched: r.matched,
          total: r.total,
          chords: r.chords,
          other: r.other,
        });

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => (o ? onOpenChange(true) : close())}
    >
      <DialogContent className="max-w-4xl">
        <DialogHeader>
          <DialogTitle>{m["lrc.title"]()}</DialogTitle>
          <DialogDescription>
            {preview ? summary(preview.report) : m["lrc.intro"]()}
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
            {/* Which side is which, kept in view while the lines scroll: the sheet as it is, and what it would become. */}
            <div className="lrc-column">
              <div className="lrc-column-head">{m["lrc.side.song"]()}</div>
              <pre className="lrc-preview">{lyrics}</pre>
            </div>
            <div className="lrc-column">
              <div className="lrc-column-head" title={preview.source}>
                {m["lrc.side.merged"]({ source: preview.source })}
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
