// SongPlayer.tsx — the right half of a song's screen: one tab per version — the master, then
// what the sidecar declares — each drawn and scrubbed on the shared waveform. It OWNS no
// transport: what plays is the app's (PlaybackProvider), so a version outlives this pane and
// the bar at the bottom shows the same one thing. See ../docs/songPlayer.md,
// ../docs/playbackTarget.md and ../docs/miniPlayer.md.

import { Button } from "@frediverse/ui/button";
import { ORIGINAL, type Take, takesOf } from "@studio/mediatek/takes";
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
import { readSongShape, type SongShape } from "./songWaveform";

// The two ways the engine branch has nothing to open, kept apart because they are repaired differently.
const ENGINE_NO_CACHE =
  "cette machine ne tient pas de cache de la médiathèque — lecture ici, ou choisissez-en une autre";
const ENGINE_NOT_HERE =
  "cette machine n'a pas ce morceau en cache — l'analyse l'y rapatrie, sinon jouez ici";

/** The glyph a version wears — the same three the tree draws, so a row and a tab read alike. */
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
  /** The chosen machine's file service: its engine is the only thing here that decodes audio. */
  fileBase?: string | null;
  engineToken?: string | null;
  /** Where the account wants sound to come out. */
  target: PlaybackTarget;
}) {
  const engine = useEngine();
  const playback = usePlayback();

  // `meta` is loose, a listing being family-agnostic; absent means a sidecar with no audio.
  const master = entry.meta?.master ? String(entry.meta.master) : null;

  // The tabs: the master, then every version the sidecar declares — the shape is in @studio/mediatek/takes.
  const takes = useMemo<Take[]>(() => takesOf(entry), [entry]);

  // Which tab is open, by NAME: the listing is re-polled, so an index would come to mean another version.
  const [tab, setTab] = useState(ORIGINAL);
  const take = takes.find((t) => t.name === tab) ?? takes[0];
  // Another song opens on ITS master, since a tab name is only unique within one sidecar.

  // biome-ignore lint/correctness/useExhaustiveDependencies: `entry.path` is the trigger, not a value read here
  useEffect(() => setTab(ORIGINAL), [entry.path]);

  // The audio on screen and its médiathèque path; a `rendered` lookup for chain variants stood above.
  const file = take?.file ?? null;
  const path = file ? `${entry.path}/${file}` : null;

  const [shape, setShape] = useState<SongShape | null>(null);
  // Told apart from "no shape yet": one is a wait, the other a machine that has to be turned on.
  const [analysing, setAnalysing] = useState(false);
  const [status, setStatus] = useState("");
  // The file already asked for — one attempt per file, so a moving engine choice cannot start it twice.
  const attempted = useRef<string | null>(null);
  const [retry, setRetry] = useState(0);

  /** Whether the song on screen is the song PLAYING; `path` is the identity, since names repeat. */
  const isCurrent = !!path && playback.now?.path === path;
  // Where the cursor sits before this song is the one playing, and where pressing play starts from.
  const [cursor, setCursor] = useState(0);
  // biome-ignore lint/correctness/useExhaustiveDependencies: the trigger is the song changing
  useEffect(() => setCursor(0), [path]);

  const engineReady = engine.phase.k === "ready";
  const actual = effectiveTarget(target, engineReady);
  const viaEngine = actual === "engine";

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

  /** The master's path on the ENGINE's machine — two disks, and `undefined` is not `null` (../docs/playback.md). */
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
    // The token is in here too: it arrives with the probe, so the first run would settle on a 401's null.
  }, [viaEngine, engine.fileBase, engineToken]);

  // The TAB's own file on that machine, not the song's master: playing the wrong one is audible.
  const enginePath = useMemo(
    () => (root && file ? playablePath(root, entry, file) : null),
    [root, entry, file],
  );

  /** …and whether that machine has the bytes, asked BEFORE the click: an unopenable clip is silence. */
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

  // The two readings of one transport: identical while this version plays, at rest otherwise.
  const playing = isCurrent && playback.playing;
  const current = isCurrent ? playback.position : cursor;

  /** Start this version, or work the transport it is already on — see ../docs/songPlayer.md. */
  const toggle = useCallback(() => {
    if (!path) return;
    if (isCurrent) return playback.toggle();
    if (viaEngine) {
      // Still asking: said as a wait, since either refusal below would be a guess at this point.
      if (root === undefined || cached === null)
        return setStatus("on demande à cette machine si elle a ce morceau…");
      if (!enginePath) return setStatus(ENGINE_NO_CACHE);
      if (!cached) return setStatus(ENGINE_NOT_HERE);
      setStatus(`envoyé au moteur : ${enginePath}`);
    }
    // From the cursor, so pressing play starts where the eye already is.
    playback.start(
      {
        entry,
        path,
        target: actual,
        enginePath: viaEngine ? enginePath : null,
        // The master's document is the song; every other tab names its version (../docs/songPlayer.md).
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

  /** Why there is nothing to draw, worded per tab rather than by an early return (../docs/songPlayer.md). */
  const nothingToPlay = path
    ? ""
    : take?.kind === "master"
      ? "Ce morceau n'a pas de master : le dossier porte un sidecar et pas d'audio."
      : "le sidecar déclare ce fichier et la médiathèque ne l'a pas";
  const EmptyIcon = takeIcon(take?.kind ?? "master");

  // The sidecar's duration when there is one: it comes from the decode, and the element's covers the wait.
  const total = shape?.duration || (isCurrent ? playback.duration : 0);
  const where = playbackTargetInfo(actual);
  const WhereIcon = where.icon;
  const fellBack = actual !== target;
  // Nothing on that machine to open, said on the BUTTON — and only once settled, since null is "still asking".
  const engineBlocked = viaEngine && (root === null || cached === false);
  const blockedWhy = !engineBlocked
    ? ""
    : root === null
      ? ENGINE_NO_CACHE
      : ENGINE_NOT_HERE;

  /** What the footer says, most specific first: the engine's own complaint outranks everything. */
  const engineSaid =
    isCurrent && viaEngine && engine.warning
      ? `le moteur : ${engine.warning.message}`
      : "";
  // `status` only when there IS a shape, or it would be the pane's big message said twice.
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
        {/* Where the sound is, beside the button that starts it — the header's picker changes it. */}
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

      {/* One tab per version, drawn only when the sidecar declares one (../docs/songPlayer.md). */}
      {takes.length > 1 ? (
        <nav className="flex shrink-0 items-center gap-1 overflow-x-auto border-b border-border px-3 py-1">
          {takes.map((t) => {
            const Icon = takeIcon(t.kind);
            return (
              <button
                // The kind is in the key: a sidecar is free to call a variant "Original".
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
                <Loader2 className="h-4 w-4 animate-spin" /> analyse en cours —
                le moteur décode ce fichier, cela prend un moment
              </span>
            ) : (
              <>
                <span className="flex items-center gap-2">
                  <AudioLines className="h-4 w-4" />
                  {status || "chargement…"}
                </span>
                {/* One attempt happens by itself; a second is ASKED for (../docs/songPlayer.md). */}
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

      {/* What the analysis found beyond the shape — the tempo is what `song.yaml` gets seeded with. */}
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
