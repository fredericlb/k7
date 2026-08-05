// SongPlayer.tsx — the right half of a song's screen: its master scrubbed on the shared
// waveform. It OWNS no transport: what plays is the app's (PlaybackProvider), so a song
// outlives this pane and the bar at the bottom shows the same one thing.
// See ../docs/songPlayer.md, ../docs/playbackTarget.md and ../docs/miniPlayer.md.

import { Button } from "@frediverse/ui/button";
import type { MediatekEntry } from "@studio/mediatek/types";
import { Waveform } from "@studio/ui-waveform";
import { AudioLines, Loader2, Pause, Play, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { currentUser, engineMachine } from "./api";
import {
  cachedOnMachine,
  cacheRoot,
  playablePath,
} from "./engine/chainPreview";
import { useEngine, usePlayback } from "./playback/PlaybackProvider";
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
}: {
  entry: MediatekEntry;
  /** The chosen machine's file service, for the analysis this pane may have to ask for. Its
   *  engine is the only thing in the repo that decodes audio — this service has none. */
  fileBase?: string | null;
  engineToken?: string | null;
  /** Where the account wants sound to come out. */
  target: PlaybackTarget;
}) {
  const engine = useEngine();
  const playback = usePlayback();

  // `meta` is deliberately loose (a listing is family-agnostic), so the master is narrowed here.
  // Absent means the folder holds a sidecar and no audio, which the scan allows on purpose.
  const master = entry.meta?.master ? String(entry.meta.master) : null;
  const path = master ? `${entry.path}/${master}` : null;

  const [shape, setShape] = useState<SongShape | null>(null);
  // Distinguished from "no shape yet": the pane says which of the two it is, because the
  // answers differ — one is a wait, the other is a machine that has to be turned on.
  const [analysing, setAnalysing] = useState(false);
  const [status, setStatus] = useState("");
  // The master this pane has already asked to have analysed. One attempt per song, so a moving
  // engine choice cannot start the job twice; the button below is what asks for another.
  const attempted = useRef<string | null>(null);
  const [retry, setRetry] = useState(0);

  /**
   * Whether the song on this screen is the song that is playing.
   *
   * They part company the moment a bar at the bottom exists: you start one song and open
   * another, and this pane must then show a transport at rest rather than borrow the other's
   * position. `path` is the identity — two songs can share a name.
   */
  const isCurrent = !!path && playback.now?.path === path;
  // Where the waveform's cursor sits before this song is the one playing. Pressing play starts
  // from here, which is what makes clicking into a song and hitting play do the obvious thing.
  const [cursor, setCursor] = useState(0);
  // biome-ignore lint/correctness/useExhaustiveDependencies: the trigger is the song changing
  useEffect(() => setCursor(0), [path]);

  const engineReady = engine.phase.k === "ready";
  const actual = effectiveTarget(target, engineReady);
  const viaEngine = actual === "engine";

  /**
   * The shape, and the analysis that produces one when it is missing.
   *
   * Asked for automatically rather than behind a button: a `.cache` is derived, and the upload
   * that files a song already fires this same call — best effort, "and the first surface that
   * needs the cache computes it then" (AddSong.tsx). This is that surface.
   *
   * ASKED ONCE, and cancelled when you leave. An analysis is minutes of somebody else's machine
   * — it downloads the master and runs the engine over it — so it must not be re-fired because
   * this effect re-ran, and it must not outlive the pane that wanted it.
   */
  // `retry` is a TRIGGER, not a value this reads: the button clears `attempted` and bumps it,
  // which is the only thing that can ask for a second analysis.
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
   * The master as a path on the ENGINE's machine, when that is where it would play.
   *
   * Two disks, and conflating them is the whole trap: the médiathèque this browser talks to is
   * hosted, while the moteur opens paths on its own. Resolved HERE rather than in the provider
   * because this is the screen that knows about caches; the provider is handed the answer.
   */
  // `undefined` is "not looked yet" and `null` is "that machine keeps no cache" — two states a
  // single nullable would merge, greying the Play button out for the moment every song spends
  // waiting for the answer, which reads as a fault rather than as a wait.
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
   * médiathèque cache — a root, a manifest, every module — and not this song. Asked BEFORE the
   * click, because the engine's answer to an unopenable clip is silence.
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

  // The two readings of one transport: this pane's, and the bar's. Identical while this song
  // is the one playing, and at rest otherwise.
  const playing = isCurrent && playback.playing;
  const current = isCurrent ? playback.position : cursor;

  const toggle = useCallback(() => {
    if (!path) return;
    if (isCurrent) return playback.toggle();
    playback.start(
      {
        entry,
        path,
        target: actual,
        enginePath: viaEngine ? enginePath : null,
      },
      cursor,
    );
  }, [path, isCurrent, playback, entry, actual, viaEngine, enginePath, cursor]);

  const seek = useCallback(
    (sec: number) => {
      if (isCurrent) return playback.seek(sec);
      setCursor(Math.max(0, sec));
    },
    [isCurrent, playback],
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

  // The sidecar's duration when there is one — it comes from the decode and is the truth; the
  // element's own, which only exists for what is playing, is what covers the wait.
  const total = shape?.duration || (isCurrent ? playback.duration : 0);
  const where = playbackTargetInfo(actual);
  const WhereIcon = where.icon;
  const fellBack = actual !== target;
  // Nothing on that machine to open — said on the button rather than after a click that would
  // look like it did nothing. Only while it is settled: `cached === null` is "still asking".
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
   */
  const engineSaid =
    isCurrent && viaEngine && engine.warning
      ? `le moteur : ${engine.warning.message}`
      : "";
  // `status` only when there IS a shape: without one it is already the big message in the
  // middle of the pane, and saying it twice reads as two different problems.
  const footer = engineSaid || blockedWhy || (shape ? status : "");

  return (
    <div className="flex h-full min-h-0 flex-col">
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
