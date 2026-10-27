// SongPlayer.tsx — the song page's Waveform tab: one strip per version — the master, then what
// the sidecar declares — each drawn and scrubbed on the shared waveform. It OWNS no transport:
// what plays is the app's (PlaybackProvider), and which version is open is the page's
// (useSongTransport), whose play button sits in the page header. See ../docs/songPlayer.md,
// ../docs/playbackTarget.md and ../docs/miniPlayer.md.

import { Button } from "@frediverse/ui/button";
import {
  AudioLines,
  Disc3,
  FileQuestion,
  Loader2,
  RefreshCw,
} from "@frediverse/ui/icons";
import type { Take } from "@studio/mediatek/takes";
import type { MediatekEntry } from "@studio/mediatek/types";
import { Waveform } from "@studio/ui-waveform";
import { useEffect, useRef, useState } from "react";
import { library } from "./api";
import { useLabels } from "./host";
import { usePlayback } from "./playback/PlaybackProvider";
import { usePlaybackPosition } from "./playback/position";
import { type PlaybackTarget, playbackTargetInfo } from "./playback/targets";
import { readSongShape, type SongShape } from "./songWaveform";
import type { SongTransport } from "./useSongTransport";

/** The glyph a version wears — the same three the tree draws, so a row and a tab read alike. */
const takeIcon = (kind: Take["kind"]) =>
  kind === "master" ? Disc3 : kind === "file" ? AudioLines : FileQuestion;

export function SongPlayer({
  entry,
  target,
  transport,
}: {
  entry: MediatekEntry;
  /** Where the account WANTS sound to come out; the provider decides what it falls back to. */
  target: PlaybackTarget;
  /** The page's hold on the transport, shared with the header's play button. */
  transport: SongTransport;
}) {
  const playback = usePlayback();
  const labels = useLabels();
  const l = labels.song;
  const targetLabels = labels.playback.targets;
  // Read by the analysis effect when it speaks, so a locale change does not start it again.
  const said = useRef(l);
  said.current = l;

  // `meta` is loose, a listing being family-agnostic; absent means a sidecar with no audio.
  const master = entry.meta?.master ? String(entry.meta.master) : null;
  const { takes, take, file, path, isCurrent, cursor, actual, seek } =
    transport;

  const [shape, setShape] = useState<SongShape | null>(null);
  // Told apart from "no shape yet": one is a wait, the other something that has to be asked for.
  const [analysing, setAnalysing] = useState(false);
  const [status, setStatus] = useState("");
  // The file already asked for — one attempt per file, so a re-render cannot start it twice.
  const attempted = useRef<string | null>(null);
  const [retry, setRetry] = useState(0);

  // Followed only while THIS version plays: another song's playhead must not re-render this pane.
  const position = usePlaybackPosition(isCurrent);
  const current = isCurrent ? position.position : cursor;

  /** The shape, and the analysis that makes one — once per tab, and cancelled on leaving (../docs/songPlayer.md). */
  // biome-ignore lint/correctness/useExhaustiveDependencies: `retry` is the button's trigger, not a value read here
  useEffect(() => {
    // Cleared BEFORE the guard, or the previous version's tempo and onsets would read as this one's.
    setShape(null);
    setStatus("");
    if (!path) return;
    let alive = true;
    const stop = new AbortController();
    void (async () => {
      const found = await readSongShape(path);
      if (!alive) return;
      if (found) return setShape(found);
      if (attempted.current === path)
        return setStatus(said.current.alreadyAsked);
      attempted.current = path;
      setAnalysing(true);
      try {
        await library.analyse(path, stop.signal);
        const made = await readSongShape(path);
        if (!alive) return;
        if (made) setShape(made);
        else setStatus(said.current.analysedNoCache);
      } catch (e) {
        // Our own cancellation is not a failure and has nobody left to tell.
        if (alive && !stop.signal.aborted)
          setStatus(said.current.analyseFailed((e as Error).message));
      } finally {
        if (alive) setAnalysing(false);
      }
    })();
    return () => {
      alive = false;
      stop.abort();
    };
  }, [path, retry]);

  // The waveform fills whatever height is left, so a tall pane is not a 160px strip over a void.
  const bodyRef = useRef<HTMLDivElement>(null);
  const [bodyH, setBodyH] = useState(0);
  useEffect(() => {
    const el = bodyRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setBodyH(el.clientHeight));
    ro.observe(el);
    setBodyH(el.clientHeight);
    return () => ro.disconnect();
  }, []);

  /** Why there is nothing to draw, worded per tab rather than by an early return (../docs/songPlayer.md). */
  const nothingToPlay = path
    ? ""
    : take?.kind === "master"
      ? l.noMaster
      : l.fileNotInLibrary;
  const EmptyIcon = takeIcon(take?.kind ?? "master");

  const where = playbackTargetInfo(actual);
  const WhereIcon = where.icon;
  const fellBack = actual !== target;
  // The transport's own complaint first, then `status` — and that one only when there IS a shape.
  const complaint = (isCurrent && playback.error) || (shape ? status : "");

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* One strip per version, drawn only when the sidecar declares one (../docs/songPlayer.md). */}
      {takes.length > 1 ? (
        <nav className="flex shrink-0 items-center gap-1 overflow-x-auto border-b border-border px-3 py-1">
          {takes.map((t) => {
            const Icon = takeIcon(t.kind);
            return (
              <button
                // The kind is in the key: a sidecar is free to call a variant "Original".
                key={`${t.kind}:${t.name}`}
                type="button"
                onClick={() => transport.choose(t.name)}
                // What the row is, since the icon alone cannot say it.
                title={
                  t.kind === "file"
                    ? `${t.name} — ${t.file}`
                    : t.kind === "missing"
                      ? `${t.name} — ${t.file ?? l.fileMissing}`
                      : `${t.name} — ${master ?? l.noMasterShort}`
                }
                className={`flex shrink-0 items-center gap-1 rounded px-2 py-0.5 text-xs ${
                  take?.name === t.name
                    ? "bg-secondary text-foreground"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <Icon className="h-3.5 w-3.5 shrink-0" />
                {t.name}
              </button>
            );
          })}
        </nav>
      ) : null}

      <div ref={bodyRef} className="min-h-0 flex-1 overflow-hidden p-3">
        {/* No file on this tab at all, said here rather than by an early return that would take the strip. */}
        {nothingToPlay ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center text-sm text-muted-foreground">
            <EmptyIcon className="h-4 w-4" />
            {nothingToPlay}
          </div>
        ) : shape ? (
          <Waveform
            envelope={shape.envelope}
            duration={shape.duration}
            currentTime={current}
            height={Math.max(120, bodyH - 24)}
            onSeek={seek}
          />
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-sm text-muted-foreground">
            {analysing ? (
              <span className="flex items-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin" /> {l.analysing}
              </span>
            ) : (
              <>
                <span className="flex items-center gap-2">
                  <AudioLines className="h-4 w-4" />
                  {status || labels.common.loading}
                </span>
                {/* One attempt happens by itself; a second is ASKED for (../docs/songPlayer.md). */}
                {status ? (
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => {
                      attempted.current = null;
                      setRetry((n) => n + 1);
                    }}
                  >
                    <RefreshCw className="mr-1 h-3.5 w-3.5" /> {l.analyse}
                  </Button>
                ) : null}
              </>
            )}
          </div>
        )}
      </div>

      {/* Where the sound is, the file on screen, and what the analysis found beyond the shape. */}
      <footer className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-t px-3 py-1 text-xs text-muted-foreground">
        <span
          className="flex items-center gap-1"
          title={
            fellBack
              ? l.notAnswering(targetLabels[target].label)
              : targetLabels[where.id].hint
          }
        >
          <WhereIcon className="h-3.5 w-3.5" />
          {targetLabels[where.id].label}
          {fellBack ? ` ${l.fallback}` : ""}
        </span>
        {shape?.bpm ? (
          <span className="tabular-nums">{shape.bpm} bpm</span>
        ) : null}
        {shape?.transients.length ? (
          <span className="tabular-nums">{shape.transients.length} onsets</span>
        ) : null}
        <span className="min-w-0 truncate font-mono">{file}</span>
        <span className="min-w-0 flex-1 truncate text-right" title={complaint}>
          {complaint}
        </span>
      </footer>
    </div>
  );
}
