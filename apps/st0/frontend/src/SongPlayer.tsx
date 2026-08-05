// SongPlayer.tsx — the right half of a song's screen: its master played in the browser,
// scrubbed on the shared waveform. The shape comes from the `.cache` sidecar the engine wrote
// beside the audio, never from decoding here. See ../docs/songPlayer.md.

import { Button } from "@frediverse/ui/button";
import type { MediatekEntry } from "@studio/mediatek/types";
import { Waveform } from "@studio/ui-waveform";
import { AudioLines, Loader2, Pause, Play, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { engineMachine, library } from "./api";
import { readSongShape, type SongShape } from "./songWaveform";

/** mm:ss — the only format a transport needs, and the one the tree's captures already use. */
function clock(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return "0:00";
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function SongPlayer({
  entry,
  fileBase,
  engineToken,
}: {
  entry: MediatekEntry;
  /** The chosen machine's file service, for the analysis this pane may have to ask for. Its
   *  engine is the only thing in the repo that decodes audio — this service has none. */
  fileBase?: string | null;
  engineToken?: string | null;
}) {
  // `meta` is deliberately loose (a listing is family-agnostic), so the master is narrowed here.
  // Absent means the folder holds a sidecar and no audio, which the scan allows on purpose.
  const master = entry.meta?.master ? String(entry.meta.master) : null;
  const path = master ? `${entry.path}/${master}` : null;

  const audioRef = useRef<HTMLAudioElement>(null);
  const [shape, setShape] = useState<SongShape | null>(null);
  // Distinguished from "no shape yet": the pane says which of the two it is, because the
  // answers differ — one is a wait, the other is a machine that has to be turned on.
  const [analysing, setAnalysing] = useState(false);
  const [status, setStatus] = useState("");
  const [playing, setPlaying] = useState(false);
  const [current, setCurrent] = useState(0);
  // The audio element's own duration, which arrives before any analysis and covers the case
  // where none ever does — a song still plays without a waveform.
  const [duration, setDuration] = useState(0);
  // The master this pane has already asked to have analysed. One attempt per song, so a moving
  // engine choice cannot start the job twice; the button below is what asks for another.
  const attempted = useRef<string | null>(null);
  const [retry, setRetry] = useState(0);

  /**
   * The shape, and the analysis that produces one when it is missing.
   *
   * Asked for automatically rather than behind a button: a `.cache` is derived, and the upload
   * that files a song already fires this same call — best effort, "and the first surface that
   * needs the cache computes it then" (AddSong.tsx). This is that surface.
   *
   * ASKED ONCE, and cancelled when you leave. An analysis is minutes of somebody else's machine
   * — it downloads the master and runs the engine over it — so it must not be re-fired because
   * this effect re-ran, and it must not outlive the pane that wanted it. `attempted` is what
   * makes the first true: the engine choice arrives asynchronously, so `fileBase`/`engineToken`
   * legitimately move under us, and without it every move would start the job again.
   */
  // `retry` is a TRIGGER, not a value this reads: the button clears `attempted` and bumps it,
  // which is the only thing that can ask for a second analysis. Removing it would make the
  // button do nothing at all.
  // biome-ignore lint/correctness/useExhaustiveDependencies: see above
  useEffect(() => {
    if (!path) return;
    let alive = true;
    const stop = new AbortController();
    setShape(null);
    setStatus("");
    void (async () => {
      const found = await readSongShape(path);
      if (!alive) return;
      if (found) return setShape(found);
      if (!fileBase || !engineToken)
        return setStatus("pas encore analysé — aucun moteur joignable");
      if (attempted.current === path)
        return setStatus("analyse déjà demandée pour ce master");
      attempted.current = path;
      setStatus("");
      setAnalysing(true);
      try {
        await engineMachine.analyse(fileBase, engineToken, path, stop.signal);
        const made = await readSongShape(path);
        if (!alive) return;
        if (made) setShape(made);
        else setStatus("analysé, mais le cache n'est pas revenu");
      } catch (e) {
        // Our own cancellation is not a failure and has nobody left to tell.
        if (alive && !stop.signal.aborted)
          setStatus(`analyse impossible : ${(e as Error).message}`);
      } finally {
        if (alive) setAnalysing(false);
      }
    })();
    return () => {
      alive = false;
      stop.abort();
    };
  }, [path, fileBase, engineToken, retry]);

  // Follow the playhead smoothly while playing — `timeupdate` fires ~4×/s, which reads as a
  // playhead that stutters across a canvas this wide.
  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    const loop = () => {
      if (audioRef.current) setCurrent(audioRef.current.currentTime);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [playing]);

  const toggle = useCallback(() => {
    const el = audioRef.current;
    if (!el) return;
    if (el.paused) void el.play().catch((e: Error) => setStatus(e.message));
    else el.pause();
  }, []);

  const seek = useCallback((sec: number) => {
    const el = audioRef.current;
    if (el) el.currentTime = sec;
    setCurrent(sec);
  }, []);

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

  if (!path)
    return (
      <div className="flex h-full items-center justify-center p-6 text-sm text-muted-foreground">
        Ce morceau n'a pas de master : le dossier porte un sidecar et pas
        d'audio.
      </div>
    );

  // The sidecar's duration when there is one — it comes from the decode and is the truth;
  // the element's own is what covers the wait, and a format it can play but not measure.
  const total = shape?.duration || duration;

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Ours, not `controls`: the waveform IS the scrubber, and two of them disagree the
          moment one is dragged. */}
      <audio
        ref={audioRef}
        src={library.fileUrl(path)}
        preload="metadata"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
        onLoadedMetadata={(e) => setDuration(e.currentTarget.duration)}
        onTimeUpdate={(e) => {
          if (!playing) setCurrent(e.currentTarget.currentTime);
        }}
        onError={() => setStatus("lecture impossible")}
      />

      <header className="flex shrink-0 items-center gap-3 border-b border-border px-3 py-2">
        <Button size="sm" variant="secondary" onClick={toggle}>
          {playing ? (
            <Pause className="h-4 w-4" />
          ) : (
            <Play className="h-4 w-4" />
          )}
        </Button>
        <span className="font-mono text-xs tabular-nums text-muted-foreground">
          {clock(current)} / {clock(total)}
        </span>
        <span className="ml-auto min-w-0 truncate font-mono text-xs text-muted-foreground">
          {master}
        </span>
      </header>

      <div ref={bodyRef} className="min-h-0 flex-1 overflow-hidden p-3">
        {shape ? (
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
                <Loader2 className="h-4 w-4 animate-spin" /> analyse en cours —
                le moteur décode le master, cela prend un moment
              </span>
            ) : (
              <>
                <span className="flex items-center gap-2">
                  <AudioLines className="h-4 w-4" />
                  {status || "chargement…"}
                </span>
                {/* One attempt happens by itself; a second is asked for. An analysis is minutes
                    of another machine's time, so a failure that retried on its own would be a
                    loop nobody started. */}
                {status && fileBase && engineToken ? (
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => {
                      attempted.current = null;
                      setRetry((n) => n + 1);
                    }}
                  >
                    <RefreshCw className="mr-1 h-3.5 w-3.5" /> Analyser
                  </Button>
                ) : null}
              </>
            )}
          </div>
        )}
      </div>

      {/* What the analysis found beyond the shape. The tempo is the reason it is worth
          saying: it is what `song.yaml` gets seeded with, and the editor is right there. */}
      <footer className="flex shrink-0 items-center gap-3 border-t px-3 py-1 text-xs text-muted-foreground">
        {shape?.bpm ? (
          <span className="tabular-nums">{shape.bpm} bpm</span>
        ) : null}
        {shape?.transients.length ? (
          <span className="tabular-nums">{shape.transients.length} onsets</span>
        ) : null}
        <span className="min-w-0 flex-1 truncate text-right">
          {shape ? status : ""}
        </span>
      </footer>
    </div>
  );
}
