// SongPlayer.tsx — the right half of a song's screen: one tab per version — the master, then
// what the sidecar declares — each drawn and scrubbed on the shared waveform. It OWNS no
// transport: what plays is the app's (PlaybackProvider), so a version outlives this pane and
// the bar at the bottom shows the same one thing. See ../docs/songPlayer.md,
// ../docs/playbackTarget.md and ../docs/miniPlayer.md.

import { Button } from "@frediverse/ui/button";
import type { MediatekEntry } from "@studio/mediatek/types";
import { Waveform } from "@studio/ui-waveform";
import {
  AudioLines,
  Disc3,
  FileQuestion,
  Loader2,
  Pause,
  Play,
  RefreshCw,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { currentUser, engineMachine } from "./api";
import { cachedOnMachine, cacheRoot, playablePath } from "./engine/songPreview";
import { useEngine, usePlayback } from "./playback/PlaybackProvider";
import {
  effectiveTarget,
  type PlaybackTarget,
  playbackTargetInfo,
} from "./playback/targets";
import { ORIGINAL, type Take, takesOf } from "./songTakes";
import { readSongShape, type SongShape } from "./songWaveform";

// The two ways the engine branch has nothing to open. Kept apart because the answers differ:
// one is a machine that keeps no médiathèque cache at all, the other a cache this song was
// never copied into — songs are not pulled automatically, only modules are.
const ENGINE_NO_CACHE =
  "cette machine ne tient pas de cache de la médiathèque — lecture ici, ou choisissez-en une autre";
const ENGINE_NOT_HERE =
  "cette machine n'a pas ce morceau en cache — l'analyse l'y rapatrie, sinon jouez ici";

/** The glyph a version wears — the same three the médiathèque's tree draws for a song, a file
 *  variant and one it cannot find, so a row there and a tab here read as the same thing. */
const takeIcon = (kind: Take["kind"]) =>
  kind === "master" ? Disc3 : kind === "file" ? AudioLines : FileQuestion;

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

  // The tabs: the master, then every version the sidecar declares. See songTakes.ts — the shape
  // is worth a module of its own because it is answerable without a screen, and tested there.
  const takes = useMemo<Take[]>(() => takesOf(entry), [entry]);

  // Which tab is open, by NAME: the listing is re-polled every three seconds, so an index would
  // silently come to mean another version the moment a line is added to the sidecar.
  const [tab, setTab] = useState(ORIGINAL);
  const take = takes.find((t) => t.name === tab) ?? takes[0];
  // Another song opens on ITS master. A tab name is only unique within one sidecar, so carrying
  // it across would land on a version that happens to share a name — or on nothing at all.
  // `entry.path` is the TRIGGER and not a value the body reads, which is why it looks unused.
  // biome-ignore lint/correctness/useExhaustiveDependencies: see above
  useEffect(() => setTab(ORIGINAL), [entry.path]);

  /**
   * What a CHAIN variant has to play: the render "Process" wrote beside the master.
   *
   * Looked for rather than listed. A song's catalogue entry carries no file list — the scan
   * stops at the song folder (scan.ts) — and the render is not in the sidecar either: the
   * variant still names its chain, and `<variante>.mp3` is a file that appeared next to it. So
   * the two candidate names are asked for, one byte each.
   *
   * `undefined` is "still looking" and `null` is "nothing has been rendered", which the body
   * words differently: one is a wait, the other is a button to press in the pane below.
   */
  // The audio on screen, and its path in the médiathèque. Everything below reads these two and
  // never asks which tab produced them.
  //
  // A `rendered` lookup stood above this: a chain variant named a treatment rather than a file,
  // so the player asked the library whether its bounce was sitting beside the master. Chains
  // left the catalogue, and a variant now IS its file or is missing.
  const file = take?.file ?? null;
  const path = file ? `${entry.path}/${file}` : null;

  const [shape, setShape] = useState<SongShape | null>(null);
  // Distinguished from "no shape yet": the pane says which of the two it is, because the
  // answers differ — one is a wait, the other is a machine that has to be turned on.
  const [analysing, setAnalysing] = useState(false);
  const [status, setStatus] = useState("");
  // The file this pane has already asked to have analysed — the master, or whichever version is
  // on screen. One attempt per file, so a moving engine choice cannot start the job twice; the
  // button below is what asks for another.
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
   * ASKED ONCE PER TAB, and cancelled when you leave. An analysis is minutes of somebody else's
   * machine — it downloads the audio and runs the engine over it — so it must not be re-fired
   * because this effect re-ran, and it must not outlive the pane that wanted it. `attempted` is
   * what makes the first true: the engine choice arrives asynchronously, so
   * `fileBase`/`engineToken` legitimately move under us, and without it every move would start
   * the job again. It holds a PATH, so each version is asked for at most once and switching
   * back to one already analysed costs nothing.
   */
  // `retry` is a TRIGGER, not a value this reads: the button clears `attempted` and bumps it,
  // which is the only thing that can ask for a second analysis.
  // biome-ignore lint/correctness/useExhaustiveDependencies: see above
  useEffect(() => {
    // Cleared BEFORE the guard: switching to a tab with no file at all must not leave the
    // previous version's shape on screen, where its tempo and its onsets would read as this
    // one's.
    setShape(null);
    setStatus("");
    if (!path) return;
    let alive = true;
    const stop = new AbortController();
    void (async () => {
      const found = await readSongShape(path);
      if (!alive) return;
      if (found) return setShape(found);
      if (!fileBase || !engineToken)
        return setStatus("pas encore analysé — aucun moteur joignable");
      if (attempted.current === path)
        return setStatus("analyse déjà demandée pour ce fichier");
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

  // The tab's own file on that machine, not the song's master: a variant is a sibling of it,
  // and playing the master while the strip says otherwise would be the same failure as drawing
  // the wrong waveform, only audible.
  const enginePath = useMemo(
    () => (root && file ? playablePath(root, entry, file) : null),
    [root, entry, file],
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

  // The two readings of one transport: this pane's, and the bar's. Identical while this
  // version is the one playing, and at rest otherwise.
  const playing = isCurrent && playback.playing;
  const current = isCurrent ? playback.position : cursor;

  /**
   * Start this version, or work the transport it is already on.
   *
   * The pane holds nothing: what plays belongs to the app, so pressing play here is handing
   * the provider a version to load. The three engine checks stay because they are the only
   * account of a click that would otherwise do nothing — `engineBlocked` greys the button for
   * the two settled refusals, and the first of these covers the moment before it is settled.
   */
  const toggle = useCallback(() => {
    if (!path) return;
    if (isCurrent) return playback.toggle();
    if (viaEngine) {
      // Still asking that machine. Said as a wait rather than as one of the two refusals
      // below, either of which would be a guess at this point.
      if (root === undefined || cached === null)
        return setStatus("on demande à cette machine si elle a ce morceau…");
      if (!enginePath) return setStatus(ENGINE_NO_CACHE);
      if (!cached) return setStatus(ENGINE_NOT_HERE);
      setStatus(`envoyé au moteur : ${enginePath}`);
    }
    // From the cursor, which is where the waveform was last scrubbed to — so clicking into a
    // song and pressing play starts where the eye already is.
    playback.start(
      {
        entry,
        path,
        target: actual,
        enginePath: viaEngine ? enginePath : null,
        // The master's document is the song itself; every other tab names its version, which
        // is what keeps two of them apart in the engine's shared session.
        version: take?.kind === "master" ? undefined : take?.name,
      },
      cursor,
    );
  }, [
    path,
    isCurrent,
    playback,
    entry,
    actual,
    viaEngine,
    enginePath,
    root,
    cached,
    cursor,
    take?.kind,
    take?.name,
  ]);

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

  /**
   * Why there is nothing to draw, when there is nothing — worded per tab, because the three
   * cases have three different answers.
   *
   * It replaces what used to be an early return on a song with no master. That return would now
   * take the tab strip with it, leaving no way back to a version that DOES play — and the
   * commonest of these three states is a chain variant, which is one button away from being
   * playable.
   */
  const nothingToPlay = path
    ? ""
    : take?.kind === "master"
      ? "Ce morceau n'a pas de master : le dossier porte un sidecar et pas d'audio."
      : "le sidecar déclare ce fichier et la médiathèque ne l'a pas";
  const EmptyIcon = takeIcon(take?.kind ?? "master");

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
          disabled={engineBlocked || !path}
          title={blockedWhy || nothingToPlay}
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
        {/* The file actually on screen, which is the master only on the first tab. */}
        <span className="ml-auto min-w-0 truncate font-mono text-xs text-muted-foreground">
          {file}
        </span>
      </header>

      {/* One tab per version, in the sidecar's order — the same buttons the module builder
          switches its files with, because this is the same gesture on the same screen.
          Drawn only when the sidecar declares something: a lone "Original" is a control that
          cannot be used for anything. */}
      {takes.length > 1 ? (
        <nav className="flex shrink-0 items-center gap-1 overflow-x-auto border-b border-border px-3 py-1">
          {takes.map((t) => {
            const Icon = takeIcon(t.kind);
            return (
              <button
                // The kind is in the key and not just the name: a sidecar is free to call a
                // variant "Original", and two rows keyed alike is a React warning plus a strip
                // that redraws wrong.
                key={`${t.kind}:${t.name}`}
                type="button"
                onClick={() => setTab(t.name)}
                // What the row is, since the icon alone cannot say it.
                title={
                  t.kind === "file"
                    ? `${t.name} — ${t.file}`
                    : t.kind === "missing"
                      ? `${t.name} — ${t.file ?? "fichier introuvable"}`
                      : `${t.name} — ${master ?? "aucun master"}`
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
        {/* No file on this tab at all — said here rather than by an early return, which would
            have taken the strip with it and left no way back to a version that plays. */}
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
                <Loader2 className="h-4 w-4 animate-spin" /> analyse en cours —
                le moteur décode ce fichier, cela prend un moment
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
