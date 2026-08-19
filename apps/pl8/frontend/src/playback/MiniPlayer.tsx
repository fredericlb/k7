// MiniPlayer.tsx — the bar at the bottom: what is playing, how far in, and where the sound is
// coming out. It appears when a song starts and goes only when it is closed — including after
// the song ends. See ../../docs/miniPlayer.md.

import { Button } from "@frediverse/ui/button";
import { Disc3, ListVideo, Pause, Play, X } from "lucide-react";
import { usePlayback } from "./PlaybackProvider";
import { QueueButton } from "./QueueButton";
import { playbackTargetInfo } from "./targets";

/** mm:ss — the same clock the song pane uses, so two readings of one transport agree. */
function clock(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return "0:00";
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

/** The album, which no field carries: a song lives at `songs/<artiste>/<album>/<titre>`, so the
 *  second-to-last segment IS the album. Empty when the path is shorter than that shape. */
function albumOf(path: string): string {
  const parts = path.split("/");
  return parts.length >= 4 ? parts[parts.length - 2] : "";
}

/** La barre réduite à ce qu'elle a à dire quand rien ne joue mais que la file attend : ce
 *  qu'il y a dedans, et de quoi l'ouvrir. */
function QueueOnly() {
  const { queue } = usePlayback();
  return (
    <section
      aria-label="Liste de lecture"
      className="flex shrink-0 items-center gap-3 border-t bg-card px-3 py-2"
    >
      <ListVideo className="h-4 w-4 shrink-0 text-muted-foreground" />
      <span className="min-w-0 flex-1 truncate text-sm text-muted-foreground">
        {queue.length} morceau{queue.length === 1 ? "" : "x"} en attente — le
        premier part dès qu'une machine peut le jouer.
      </span>
      <QueueButton />
    </section>
  );
}

export function MiniPlayer() {
  const {
    now,
    playing,
    position,
    duration,
    error,
    toggle,
    seek,
    close,
    queue,
  } = usePlayback();

  /**
   * La barre apparaît aussi pour une file NON VIDE, pas seulement pour un morceau chargé.
   *
   * Sinon le bouton qui montre la file vivrait dans une barre que la file elle-même ne suffit
   * pas à faire apparaître : on ajouterait un morceau et il n'y aurait nulle part où le voir.
   * Le cas se produit quand rien n'a encore été lu, ou quand la barre a été fermée.
   */
  if (!now) return queue.length ? <QueueOnly /> : null;

  const { entry, target, version } = now;
  const artist =
    typeof entry.meta?.artist === "string" ? entry.meta.artist : "";
  // The entry's folder, not the master's file path: the master is the last segment of `path`.
  const album = albumOf(entry.path);
  const where = playbackTargetInfo(target);
  const WhereIcon = where.icon;
  const done = duration > 0 && position >= duration - 0.25 && !playing;
  const pct = duration > 0 ? Math.min(100, (position / duration) * 100) : 0;

  return (
    <section
      aria-label="Lecture en cours"
      className="relative flex shrink-0 items-center gap-3 border-t bg-card px-3 py-2"
    >
      <Button
        size="icon"
        variant="secondary"
        className="shrink-0"
        onClick={toggle}
        aria-label={playing ? "Pause" : "Lire"}
      >
        {playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
      </Button>

      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-baseline gap-2">
          <Disc3 className="h-3.5 w-3.5 shrink-0 self-center text-muted-foreground" />
          <span className="min-w-0 truncate text-sm font-medium">
            {entry.name}
          </span>
          {/* Which version, when it is not the master — the bar sits under a screen whose
              strip may point somewhere else entirely, and "the song" is then two files. */}
          {version ? (
            <span className="shrink-0 rounded bg-secondary px-1.5 py-0.5 text-[10px] text-muted-foreground">
              {version}
            </span>
          ) : null}
          {/* Artist and album on one line, each only when there is one — a placeholder dash
              for an unfiled song is noise where the title already says everything known. */}
          {artist ? (
            <span className="min-w-0 truncate text-xs text-muted-foreground">
              {artist}
            </span>
          ) : null}
          {album ? (
            <span className="hidden min-w-0 truncate text-xs text-muted-foreground sm:inline">
              · {album}
            </span>
          ) : null}
          {/* A failure outranks "terminé": both mean no sound, and only one of them is fine. */}
          {error ? (
            <span className="min-w-0 truncate text-xs text-destructive">
              {error}
            </span>
          ) : done ? (
            <span className="shrink-0 text-xs text-muted-foreground">
              terminé
            </span>
          ) : null}
        </div>

        <div className="mt-1 flex items-center gap-2">
          <span className="w-10 shrink-0 text-right font-mono text-[11px] tabular-nums text-muted-foreground">
            {clock(position)}
          </span>
          {/* A range rather than a div with a click handler: dragging, the keyboard and the
              accessible name all come with it, and a progress bar you cannot scrub is a
              progress bar people try to scrub anyway. */}
          <input
            type="range"
            min={0}
            max={duration || 0}
            step={0.1}
            value={Math.min(position, duration || 0)}
            disabled={!duration}
            onChange={(e) => seek(Number(e.currentTarget.value))}
            aria-label="Position dans le morceau"
            className="h-1 min-w-0 flex-1 cursor-pointer appearance-none rounded bg-muted accent-foreground"
            style={{
              background: `linear-gradient(to right, hsl(var(--foreground)) ${pct}%, hsl(var(--muted)) ${pct}%)`,
            }}
          />
          <span className="w-10 shrink-0 font-mono text-[11px] tabular-nums text-muted-foreground">
            {clock(duration)}
          </span>
        </div>
      </div>

      {/* Where the sound is. The header's picker changes it; this only reports, and only for
          what is playing — which may not be what the destination says any more. */}
      <span
        className="hidden shrink-0 items-center gap-1 text-xs text-muted-foreground sm:flex"
        title={where.hint}
      >
        <WhereIcon className="h-3.5 w-3.5" />
        {where.label}
      </span>

      {/* Ce qui passera ensuite. À droite, avant la fermeture : c'est une commande de lecture,
          pas une commande de la barre. */}
      <QueueButton />

      {/* Top right, and it is the ONLY thing that clears the bar: a song that ends stays, so
          that "what was that" survives the last sample. */}
      <Button
        size="icon"
        variant="ghost"
        onClick={close}
        aria-label="Fermer le lecteur"
        className="absolute right-1 top-1 h-6 w-6"
      >
        <X className="h-3.5 w-3.5" />
      </Button>
    </section>
  );
}
