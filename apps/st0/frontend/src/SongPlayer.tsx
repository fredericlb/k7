// SongPlayer.tsx — the right half of a song's screen: its master played, and scrubbed on the
// shared waveform. WHERE it plays is the account's choice — this browser, or the moteur on the
// chosen machine — behind one transport. See ../docs/songPlayer.md and ../docs/playbackTarget.md.

import { Button } from "@frediverse/ui/button";
import type { MediatekEntry } from "@studio/mediatek/types";
import { Waveform } from "@studio/ui-waveform";
import { AudioLines, Loader2, Pause, Play, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { currentUser, engineMachine, library } from "./api";
import {
  cachedOnMachine,
  cacheRoot,
  chainPreviewDoc,
  playablePath,
} from "./engine/chainPreview";
import type { ModuleEngine } from "./engine/useModuleEngine";
import {
  effectiveTarget,
  type PlaybackTarget,
  playbackTargetInfo,
} from "./playback/targets";
import { readSongShape, type SongShape } from "./songWaveform";

// The two ways the engine branch has nothing to open. Kept apart because the answers differ:
// one is a machine that keeps no médiathèque cache at all, the other a cache this song was
// never copied into — songs are not pulled automatically, only modules are.
const ENGINE_NO_CACHE =
  "cette machine ne tient pas de cache de la médiathèque — lecture ici, ou choisissez-en une autre";
const ENGINE_NOT_HERE =
  "cette machine n'a pas ce morceau en cache — l'analyse l'y rapatrie, sinon jouez ici";

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
  target,
  engine,
}: {
  entry: MediatekEntry;
  /** The chosen machine's file service, for the analysis this pane may have to ask for. Its
   *  engine is the only thing in the repo that decodes audio — this service has none. */
  fileBase?: string | null;
  engineToken?: string | null;
  /** Where the account wants sound to come out. */
  target: PlaybackTarget;
  /** The screen's engine, opened once by SongEditor. Held whatever the destination is: it is
   *  what ANALYSES the master, which the waveform needs even when this browser is the one
   *  playing. */
  engine: ModuleEngine;
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
  const [browserPlaying, setBrowserPlaying] = useState(false);
  const [browserAt, setBrowserAt] = useState(0);
  // The audio element's own duration, which arrives before any analysis and covers the case
  // where none ever does — a song still plays without a waveform.
  const [duration, setDuration] = useState(0);
  // The master this pane has already asked to have analysed. One attempt per song, so a moving
  // engine choice cannot start the job twice; the button below is what asks for another.
  const attempted = useRef<string | null>(null);
  const [retry, setRetry] = useState(0);

  /**
   * Which destination is actually in play.
   *
   * A remembered "le moteur" pointing at a machine that is off falls back to this browser
   * rather than to silence — the bytes are on the hosted library either way. The footer says
   * so when it happens: sound coming out of the wrong machine unannounced is worse than the
   * fallback itself.
   */
  const engineReady = engine.phase.k === "ready";
  const actual = effectiveTarget(target, engineReady);
  const viaEngine = actual === "engine";
  const fellBack = actual !== target;

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

  /**
   * The master as a path on the ENGINE's machine, when that is where it will play.
   *
   * Two disks, and conflating them is the whole trap: the médiathèque this browser talks to is
   * hosted, while the moteur opens paths on its own. So the engine branch plays the copy in
   * that machine's cache — the same route SongVariants takes for a chain, and m9 for a deck.
   *
   * Only looked up when it is needed. The cache root costs a request to another machine, and
   * the browser branch has no use for it.
   */
  // `undefined` is "not looked yet" and `null` is "that machine keeps no cache" — two states a
  // single nullable would merge, and merging them greys the Play button out for the moment
  // every song spends waiting for the answer, which reads as a fault rather than as a wait.
  const [root, setRoot] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    if (!viaEngine || !engine.fileBase) return setRoot(undefined);
    let alive = true;
    void cacheRoot(engine.fileBase, currentUser(), engineToken).then((r) => {
      if (alive) setRoot(r);
    });
    return () => {
      alive = false;
    };
    // The token is in here too: it arrives with the engine probe, so the first run can have
    // none and would otherwise settle on the 401's `null` and never look again.
  }, [viaEngine, engine.fileBase, engineToken]);

  const enginePath = useMemo(
    () => (root ? playablePath(root, entry) : null),
    [root, entry],
  );

  /**
   * …and whether that machine actually has the bytes.
   *
   * A path is not a file. Songs are never pulled automatically, so a machine can hold a
   * médiathèque cache — a root, a manifest, every module — and not this song. Asked BEFORE
   * the click, because the engine's answer to an unopenable clip is silence, and a transport
   * that rolls over nothing is indistinguishable from a broken one.
   *
   * `null` is "not asked yet / not applicable", distinct from `false`.
   */
  const [cached, setCached] = useState<boolean | null>(null);
  useEffect(() => {
    if (!viaEngine || !engine.fileBase || !path) return setCached(null);
    let alive = true;
    void cachedOnMachine(
      engine.fileBase,
      currentUser(),
      path,
      engineToken,
    ).then((ok) => {
      if (alive) setCached(ok);
    });
    return () => {
      alive = false;
    };
  }, [viaEngine, engine.fileBase, engineToken, path]);

  // Follow the playhead smoothly while playing HERE — `timeupdate` fires ~4×/s, which reads as
  // a playhead that stutters across a canvas this wide. The engine's own frame arrives at
  // ~20 Hz and needs no such loop, which is why this one is on the browser branch only.
  useEffect(() => {
    if (viaEngine || !browserPlaying) return;
    let raf = 0;
    const loop = () => {
      if (audioRef.current) setBrowserAt(audioRef.current.currentTime);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [viaEngine, browserPlaying]);

  /**
   * Leaving one destination silences it.
   *
   * Changing the menu while something plays used to be impossible because there was one
   * destination; now the old one has to be told, or the song keeps going on a machine whose
   * transport this pane has stopped drawing.
   *
   * `path` is in here for the same reason in the other axis: the browser's `<audio>` stops on
   * its own when its `src` changes, the engine does not — it holds a document naming a file,
   * and nothing about opening another song would tell it to let go.
   */
  // `path` is a TRIGGER and not a value the body reads, which is why it looks unnecessary:
  // what has to run on a song change is the CLEANUP, and a cleanup only runs when something
  // in the list moves. Same shape as the analysis effect's `retry` above.
  // biome-ignore lint/correctness/useExhaustiveDependencies: see above
  useEffect(() => {
    return () => {
      audioRef.current?.pause();
      if (viaEngine) engine.stop();
    };
  }, [viaEngine, engine.stop, path]);

  /**
   * What this pane put into the engine, and where it is in it.
   *
   * The engine's playhead only means something for the document actually loaded there, and
   * that session is shared with everything else st0 auditions — a module preview, a chain
   * variant. Reading `engine.playhead` unconditionally would draw another document's position
   * on this song's waveform, and, worse, would hand that position back as the point to resume
   * from. `loadedPath` is what makes "ours" a question with an answer.
   */
  const [loadedPath, setLoadedPath] = useState<string | null>(null);
  const ours = viaEngine && loadedPath !== null && loadedPath === enginePath;
  // Where we are in the song, engine-side: what the engine reports while it is playing OUR
  // document, and what we last asked for the rest of the time (including before the first
  // play, so the waveform can be scrubbed before anything rolls).
  const [engineAt, setEngineAt] = useState(0);
  useEffect(() => {
    if (ours && engine.playing) setEngineAt(engine.playhead);
  }, [ours, engine.playing, engine.playhead]);

  // A different song is a different document: neither the position nor "we loaded it" carries.
  // `path` is the TRIGGER and not a value the body reads, which is why it looks unnecessary.
  // biome-ignore lint/correctness/useExhaustiveDependencies: see above
  useEffect(() => {
    setLoadedPath(null);
    setEngineAt(0);
  }, [path]);

  // One transport over two implementations. Everything below the header reads these two
  // values and never asks which side of the wire is playing.
  const playing = viaEngine ? ours && engine.playing : browserPlaying;
  const current = viaEngine ? engineAt : browserAt;

  /**
   * A document was sent and nothing has rolled yet.
   *
   * Worth a state of its own because the failure it covers is SILENCE: the engine takes a
   * document naming a file it cannot open, says so once on the warning channel, and then
   * plays nothing. Without this the screen is identical to a transport that simply has not
   * been asked — a Play button, no sound, and no account of either.
   */
  const [sent, setSent] = useState(false);
  useEffect(() => {
    if (ours && engine.playing) setSent(false);
  }, [ours, engine.playing]);

  const toggle = useCallback(() => {
    if (viaEngine) {
      if (ours && engine.playing) return engine.stop();
      // Still asking that machine. Said as a wait rather than as one of the two refusals
      // below, either of which would be a guess at this point.
      if (root === undefined || cached === null)
        return setStatus("on demande à cette machine si elle a ce morceau…");
      if (!enginePath) return setStatus(ENGINE_NO_CACHE);
      if (!cached) return setStatus(ENGINE_NOT_HERE);
      // The document, then the verb — a transport verb sent first plays whatever the engine
      // still held. No steps: a master is the audio itself, so the chain is empty and this is
      // `chainPreviewDoc`'s degenerate case rather than a second document builder.
      setStatus(`envoyé au moteur : ${enginePath}`);
      setSent(true);
      setLoadedPath(enginePath);
      // Where to start, said rather than left to the engine — which resumes from a playhead
      // this pane did not put there. `engineAt` is 0 for a song not started yet.
      engine.play(chainPreviewDoc(enginePath, entry.name, []), engineAt);
      return;
    }
    const el = audioRef.current;
    if (!el) return;
    if (el.paused) void el.play().catch((e: Error) => setStatus(e.message));
    else el.pause();
  }, [viaEngine, engine, enginePath, root, cached, engineAt, ours, entry.name]);

  const seek = useCallback(
    (sec: number) => {
      if (viaEngine) {
        // Remembered whether or not the engine holds this song yet: scrubbing before pressing
        // play is how you start somewhere other than the top, and the position is then what
        // the next `play` is told to start from.
        setEngineAt(sec);
        if (ours) engine.seek(sec);
        return;
      }
      const el = audioRef.current;
      if (el) el.currentTime = sec;
      setBrowserAt(sec);
    },
    [viaEngine, ours, engine],
  );

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
  const where = playbackTargetInfo(actual);
  const WhereIcon = where.icon;
  // Nothing on that machine to open — said on the button rather than after a click that would
  // look like it did nothing. Only while it is settled: `cached === null` is "still asking",
  // and a button that greys out for a moment on every song reads as a fault.
  const engineBlocked = viaEngine && (root === null || cached === false);
  const blockedWhy = !engineBlocked
    ? ""
    : root === null
      ? ENGINE_NO_CACHE
      : ENGINE_NOT_HERE;

  /**
   * What the footer says, most specific first.
   *
   * The engine's own complaint outranks everything: it is the only account there is of a
   * document that was accepted and made no sound, and it names the file it could not open.
   * `sent` comes next — asked, and nothing rolling — which is the same failure seen from this
   * side before the machine has said anything.
   */
  const engineSaid =
    viaEngine && engine.warning
      ? `le moteur : ${engine.warning.message}`
      : viaEngine && sent
        ? "envoyé, mais le moteur n'a rien démarré — voir le journal de la machine"
        : "";
  // `status` only when there IS a shape: without one it is already the big message in the
  // middle of the pane, and saying it twice reads as two different problems.
  const footer = engineSaid || blockedWhy || (shape ? status : "");

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Ours, not `controls`: the waveform IS the scrubber, and two of them disagree the
          moment one is dragged. Mounted whichever destination is chosen — it is what reports
          the duration for a song with no `.cache` yet, and switching back must not reload. */}
      <audio
        ref={audioRef}
        src={library.fileUrl(path)}
        preload="metadata"
        onPlay={() => setBrowserPlaying(true)}
        onPause={() => setBrowserPlaying(false)}
        onEnded={() => setBrowserPlaying(false)}
        onLoadedMetadata={(e) => setDuration(e.currentTarget.duration)}
        onTimeUpdate={(e) => {
          if (!browserPlaying) setBrowserAt(e.currentTarget.currentTime);
        }}
        onError={() => setStatus("lecture impossible")}
      />

      <header className="flex shrink-0 items-center gap-3 border-b border-border px-3 py-2">
        <Button
          size="sm"
          variant="secondary"
          onClick={toggle}
          disabled={engineBlocked}
          title={blockedWhy}
        >
          {playing ? (
            <Pause className="h-4 w-4" />
          ) : (
            <Play className="h-4 w-4" />
          )}
        </Button>
        <span className="font-mono text-xs tabular-nums text-muted-foreground">
          {clock(current)} / {clock(total)}
        </span>
        {/* Where the sound is, next to the button that starts it. The picker in the header
            changes it; this only ever reports. */}
        <span
          className="flex items-center gap-1 text-xs text-muted-foreground"
          title={
            fellBack
              ? `${playbackTargetInfo(target).label} ne répond pas — lecture ici`
              : where.hint
          }
        >
          <WhereIcon className="h-3.5 w-3.5" />
          {where.label}
          {fellBack ? " (repli)" : ""}
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

      {/* What the analysis found beyond the shape, and why the moteur cannot play this if it
          cannot. The tempo is the reason the footer is worth having: it is what `song.yaml`
          gets seeded with, and the editor is right there. */}
      <footer className="flex shrink-0 items-center gap-3 border-t px-3 py-1 text-xs text-muted-foreground">
        {shape?.bpm ? (
          <span className="tabular-nums">{shape.bpm} bpm</span>
        ) : null}
        {shape?.transients.length ? (
          <span className="tabular-nums">{shape.transients.length} onsets</span>
        ) : null}
        <span className="min-w-0 flex-1 truncate text-right" title={footer}>
          {footer}
        </span>
      </footer>
    </div>
  );
}
