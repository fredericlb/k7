// TrackPanel.tsx — one track's window: the address it plays, its start and end, and a waveform
// to set them against. The two numbers ARE the feature — a blindtest plays an extract, and
// picking it by ear is what this panel is for. See docs/editing.md.

import { Button } from "@frediverse/ui/button";
import { Loader2, Pause, Play, SkipForward } from "@frediverse/ui/icons";
import { Input } from "@frediverse/ui/input";
import { useCallback, useEffect, useRef, useState } from "react";
import { type Preview, usePreview } from "./audio";
import type { Category, Song, Track } from "./format";
import { setTrackField } from "./format";
import { audioPath, audioUrl, type Catalogue, label } from "./mediatek";
import type { Store } from "./store";

function TrackField({
  label: text,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string | undefined;
  onChange: (v: string | undefined) => void;
  placeholder?: string;
}) {
  return (
    <label className="block">
      <span className="text-xs text-muted-foreground">{text}</span>
      <Input
        className="text-xs"
        value={value ?? ""}
        placeholder={placeholder}
        onChange={(e) =>
          onChange(e.target.value === "" ? undefined : e.target.value)
        }
      />
    </label>
  );
}

/** mm:ss.d — a blindtest extract is minutes long, so raw seconds are hard to compare. */
function clock(s: number): string {
  if (!Number.isFinite(s) || s < 0) return "0:00.0";
  const m = Math.floor(s / 60);
  return `${m}:${(s - m * 60).toFixed(1).padStart(4, "0")}`;
}

export function TrackPanel({
  store,
  category,
  song,
  songIndex,
  track,
  trackIndex,
  catalogue,
  preview,
}: {
  store: Store;
  category: Category;
  song: Song;
  songIndex: number;
  track: Track;
  trackIndex: number;
  catalogue: Catalogue;
  preview: Preview;
}) {
  const audio = usePreview(preview);
  const [status, setStatus] = useState<"none" | "loading" | "ready" | "error">(
    "none",
  );
  const [error, setError] = useState("");
  const barsRef = useRef<HTMLDivElement>(null);

  const rel = audioPath(track.song, category.variant, catalogue);
  // The category decides the direction: `a-l-envers` is a whole round played backwards.
  const backwards = category.mode === "reversed";

  useEffect(() => {
    if (!rel) {
      setStatus("none");
      return;
    }
    if (preview.loaded === rel) {
      setStatus("ready");
      return;
    }
    let stale = false;
    setStatus("loading");
    setError("");
    preview
      .load(audioUrl(rel), rel)
      .then(() => {
        if (!stale) setStatus("ready");
      })
      .catch((e: Error) => {
        if (stale) return;
        setError(e.message);
        setStatus("error");
      });
    return () => {
      stale = true;
      preview.stop();
    };
  }, [rel, preview]);

  useEffect(() => {
    preview.setSpeed(song.speed ?? 1);
  }, [song.speed, preview]);

  const write = useCallback(
    (key: string, value: string | number | undefined) => {
      store.editCategory(category.slug, (doc) =>
        setTrackField(doc, song, songIndex, trackIndex, key, value),
      );
    },
    [store, category.slug, song, songIndex, trackIndex],
  );

  const start = track.start ?? 0;
  const end = track.end ?? 0;
  const hasRange = end > start;
  const dur = Math.max(audio.duration, 0.001);

  const seekFromBar = (e: React.MouseEvent<HTMLDivElement>): void => {
    const box = barsRef.current?.getBoundingClientRect();
    if (!box || !audio.duration) return;
    preview.seek(((e.clientX - box.left) / box.width) * audio.duration);
  };

  return (
    <div className="flex flex-col gap-3 p-3">
      <div>
        <p className="text-sm font-medium">
          {label(track.song, catalogue) ||
            track.file ||
            track.youtube ||
            "Piste sans adresse"}
        </p>
        <p
          className="truncate text-xs text-muted-foreground"
          title={track.song}
        >
          {track.song ?? track.file ?? track.youtube}
          {category.variant && (
            <span className="ml-2 rounded bg-muted px-1">
              {category.variant}
            </span>
          )}
        </p>
      </div>

      <div className="flex gap-3">
        <label className="flex-1">
          <span className="text-xs text-muted-foreground">Début (s)</span>
          <Input
            type="number"
            step="0.01"
            min="0"
            value={track.start ?? ""}
            placeholder="0"
            onChange={(e) =>
              write(
                "start",
                e.target.value === "" ? undefined : Number(e.target.value),
              )
            }
          />
        </label>
        <label className="flex-1">
          <span className="text-xs text-muted-foreground">Fin (s)</span>
          <Input
            type="number"
            step="0.01"
            min="0"
            value={track.end ?? ""}
            placeholder="jusqu'au bout"
            onChange={(e) =>
              write(
                "end",
                e.target.value === "" ? undefined : Number(e.target.value),
              )
            }
          />
        </label>
      </div>

      {/* The escape hatches: eleven migrated tracks have no médiathèque entry at all. */}
      <details>
        <summary className="cursor-pointer text-xs text-muted-foreground">
          Adresse et dérogations
        </summary>
        <div className="mt-2 grid gap-2 md:grid-cols-2">
          <TrackField
            label="Morceau (médiathèque)"
            value={track.song}
            onChange={(v) => write("song", v)}
            placeholder="songs/Artiste/Album/Titre"
          />
          <TrackField
            label="Fichier du projet"
            value={track.file}
            onChange={(v) => write("file", v)}
            placeholder="extraits/…"
          />
          <TrackField
            label="YouTube"
            value={track.youtube}
            onChange={(v) => write("youtube", v)}
            placeholder="identifiant de la vidéo"
          />
          <div />
          <TrackField
            label="Artiste (dérogation)"
            value={track.artist}
            onChange={(v) => write("artist", v)}
            placeholder="celui du sidecar"
          />
          <TrackField
            label="Titre (dérogation)"
            value={track.title}
            onChange={(v) => write("title", v)}
            placeholder="celui du sidecar"
          />
        </div>
      </details>

      {status === "none" && (
        <p className="text-xs text-muted-foreground">
          {track.song
            ? "Pas d'audio pour ce morceau dans cette médiathèque."
            : "Cette piste ne nomme pas la médiathèque : pas d'aperçu."}
        </p>
      )}
      {status === "loading" && (
        <p className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="h-3 w-3 animate-spin" /> Chargement de l'audio…
        </p>
      )}
      {status === "error" && (
        <p className="text-xs text-destructive">Audio : {error}</p>
      )}

      {status === "ready" && (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              variant="secondary"
              onClick={() => preview.play(0, undefined, backwards)}
            >
              <Play className="mr-1 h-3 w-3" /> Tout
            </Button>
            <Button
              size="sm"
              disabled={!hasRange}
              onClick={() => preview.play(start, end, backwards)}
            >
              <Play className="mr-1 h-3 w-3" /> L'extrait
            </Button>
            <Button
              size="sm"
              variant="secondary"
              disabled={!audio.isPlaying}
              onClick={preview.stop}
            >
              <Pause className="mr-1 h-3 w-3" /> Stop
            </Button>
            <span className="ml-auto font-mono text-xs text-muted-foreground">
              {clock(audio.currentTime)} / {clock(audio.duration)}
            </span>
          </div>

          {/* Setting the bounds from where you are LISTENING, which is why the waveform is clickable. */}
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="secondary"
              className="flex-1 text-xs"
              onClick={() =>
                write("start", Number(audio.currentTime.toFixed(2)))
              }
            >
              <SkipForward className="mr-1 h-3 w-3" /> Début ici
            </Button>
            <Button
              size="sm"
              variant="secondary"
              className="flex-1 text-xs"
              onClick={() => write("end", Number(audio.currentTime.toFixed(2)))}
            >
              <SkipForward className="mr-1 h-3 w-3" /> Fin ici
            </Button>
          </div>

          {/* biome-ignore lint/a11y/noStaticElementInteractions: the strip is a seek surface;
              the two buttons above give the same reach without a pointer. */}
          <div
            ref={barsRef}
            onClick={seekFromBar}
            className="relative flex h-20 cursor-pointer items-end gap-px overflow-hidden rounded border bg-muted/30"
          >
            {audio.peaks.map((p, i) => {
              const played =
                (i / audio.peaks.length) * audio.duration < audio.currentTime;
              return (
                <div
                  key={i}
                  style={{ height: `${Math.max(2, p * 100)}%` }}
                  className={`flex-1 ${played ? "bg-primary" : "bg-muted-foreground/40"}`}
                />
              );
            })}
            {(start > 0 || hasRange) && (
              <div
                className="pointer-events-none absolute inset-y-0 border-x-2 border-primary bg-primary/15"
                style={{
                  left: `${Math.min(100, (start / dur) * 100)}%`,
                  width: `${Math.max(0.5, (((hasRange ? end : dur) - start) / dur) * 100)}%`,
                }}
              />
            )}
          </div>
        </>
      )}
    </div>
  );
}
