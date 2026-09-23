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
import { isOne } from "../i18n";
import { m } from "../paraglide/messages.js";
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
  // Where the fetched side came from — a file's name, or LRCLIB's version — for its column's heading.
  const [source, setSource] = useState("");

  const reset = () => {
    setBusy(null);
    setError(null);
    setCandidates(null);
    setAlignment(null);
    setPicked(null);
    setSource("");
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

  /** A file or a found version, taken as far as it goes: saved outright, or opened for pairing. `from` names it. */
  const take = async (lrc: string, from: string) => {
    // No lyrics yet: the file IS them, so there is nothing to pair.
    if (lyrics.trim() === "") {
      const result = importLrc("", lrc);
      if (!result.ok) throw new Error(m["lrc.noTimings"]());
      await onSave(result.lyrics, result.timings);
      close();
      return;
    }
    const next = alignLrc(lyrics, lrc);
    if (next.lrc.length === 0) throw new Error(m["lrc.noTimings"]());
    setCandidates(null);
    setPicked(null);
    setSource(from);
    setAlignment(next);
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
    run(m["common.saving"](), async () => {
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
          <DialogTitle>{m["lrc.title"]()}</DialogTitle>
          <DialogDescription>
            {alignment
              ? m["lrc.paired"]({
                  matched: alignment.matched,
                  total: alignment.total,
                })
              : m["lrc.intro"]()}
          </DialogDescription>
        </DialogHeader>

        {!alignment && (
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

        {alignment && (
          <div className="lrc-match">
            <div className="lrc-column">
              {/* Which side is which, kept in view while the lines scroll: the song's own, then what was fetched. */}
              <div className="lrc-column-head">{m["lrc.side.song"]()}</div>
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
              <div className="lrc-column-head" title={source}>
                {source
                  ? m["lrc.side.fetchedFrom"]({ source })
                  : m["lrc.side.fetched"]()}
              </div>
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
              void run(m["lrc.reading"](), async () =>
                take(await chosen.text(), chosen.name),
              );
          }}
        />

        <DialogFooter>
          <Button variant="secondary" onClick={close}>
            {m["common.cancel"]()}
          </Button>
          {alignment && (
            <Button disabled={busy !== null} onClick={save}>
              {isOne(alignment.matched)
                ? m["lrc.save.one"]({ n: alignment.matched })
                : m["lrc.save.other"]({ n: alignment.matched })}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
