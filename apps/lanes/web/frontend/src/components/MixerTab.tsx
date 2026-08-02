// MixerTab.tsx — one vertical channel strip per track: a live VU meter, a gain fader, a
// pan slider, mute/solo. Edits run the shared mixer commands, which persist to the track's
// file and re-send to the engine. OPTIMISTIC for responsiveness — local state updates at
// once and the reload key is NOT bumped; faders commit on release, so a drag is one command.

import { Button } from "@frediverse/ui/button";
import { cn } from "@frediverse/ui/lib/utils";
import { useEffect, useMemo, useState } from "react";
import { api } from "../api";
import { arrayEq, useEngineState } from "../engineStore";
import { blurOnClick } from "../keys";
import { m } from "../paraglide/messages.js";
import { TrackIcon, trackIcon } from "../trackIcons";
import type { WebPreferences, WebProject, WebTrack } from "../types";

const METER_MIN = -60; // dB at the meter floor
const METER_MAX = 6; // dB at the top (headroom above unity)
const GAIN_MIN = -60; // fader floor (dB) — treated as silence
// Fader ceiling +6 dB, where Tracktion's volume plugin actually stops — a taller fader wrote a bigger number
// and still played +6. Keep in step with MAX_GAIN_DB in @lanes/song/trackMix, which can't be bundled here.
const GAIN_MAX = 6;

// The strip's numbers come from the track's MIXER MODULE and are already in the units a fader speaks: dB for
// the level, -1..+1 for the pan. A track carries none of this itself any more, so a track with no mixer has no
// strip to draw — see WebMixer.
const panToLabel = (pan: number) => {
  const off = Math.round(pan * 100);
  return off === 0 ? "C" : off < 0 ? `L${-off}` : `R${off}`;
};
const meterColor = (db: number) =>
  db >= 0 ? "bg-red-500" : db >= -6 ? "bg-amber-400" : "bg-emerald-500";

function Strip({
  track,
  level,
  anySolo,
  act,
}: {
  track: WebTrack;
  level: number;
  anySolo: boolean;
  act: (id: string, patch: Partial<WebTrack>, line: string) => void;
}) {
  // A drag shows the local value and commits on release, so it is one command rather than dozens.
  const [gainDrag, setGainDrag] = useState<number | null>(null);
  const [panDrag, setPanDrag] = useState<number | null>(null);

  const mix = track.mixer;
  const gDb = Math.max(GAIN_MIN, Math.min(GAIN_MAX, mix?.volume ?? 0));
  const gainVal = gainDrag ?? gDb;
  const panPos = panDrag ?? mix?.pan ?? 0;
  const effMute = track.mute || (anySolo && !track.solo);

  const norm = Math.max(
    0,
    Math.min(1, (level - METER_MIN) / (METER_MAX - METER_MIN)),
  );
  const fillPct = Number.isFinite(level) ? norm * 100 : 0;

  const commitGain = () => {
    if (gainDrag === null) return;
    act(
      track.id,
      { mixer: mix ? { ...mix, volume: gainDrag } : undefined },
      `track gain ${track.id} ${gainDrag.toFixed(1)}`,
    );
    setGainDrag(null);
  };
  const commitPan = () => {
    if (panDrag === null) return;
    act(
      track.id,
      { mixer: mix ? { ...mix, pan: panDrag } : undefined },
      `track pan ${track.id} ${panDrag.toFixed(2)}`,
    );
    setPanDrag(null);
  };

  return (
    <div className="flex h-full min-h-0 w-[76px] shrink-0 flex-col items-center gap-1 rounded border border-border bg-card/40 px-1.5 py-2">
      {/* The strip is 76px wide, so the name truncates fast — the instrument glyph its
          prefix asks for often survives where the words don't. */}
      <div
        className="flex w-full shrink-0 items-center justify-center gap-1 text-xs font-medium"
        title={
          trackIcon(track.name)
            ? `${track.name} — ${trackIcon(track.name)?.label}`
            : track.name
        }
      >
        <TrackIcon
          name={track.name}
          color={track.color || undefined}
          className={cn("shrink-0", !track.color && "opacity-70")}
        />
        <span className="truncate">{track.name}</span>
      </div>

      {/* Meter + fader share the strip's leftover height, so the mixer fits whatever
          height the bottom panel is dragged to (the rest of the strip is fixed). */}
      <div className="flex min-h-0 flex-1 items-stretch justify-center gap-1.5">
        {/* VU meter — a vertical bar filled from the bottom by the live level.
            Dimmed when the track is muted (directly, or by another track's solo). */}
        <div
          className={cn(
            "relative w-3 overflow-hidden rounded bg-muted",
            effMute && "opacity-30",
          )}
        >
          <div
            className={cn(
              "absolute inset-x-0 bottom-0 transition-[height] duration-75",
              meterColor(level),
            )}
            style={{ height: `${fillPct}%` }}
          />
        </div>

        {/* Gain fader (dB). Vertical range via native slider-vertical / writing-mode. */}
        <input
          type="range"
          min={GAIN_MIN}
          max={GAIN_MAX}
          step={0.5}
          value={gainVal}
          onChange={(e) => setGainDrag(Number(e.target.value))}
          onPointerUp={commitGain}
          onKeyUp={commitGain}
          className="h-full cursor-pointer accent-primary [writing-mode:vertical-lr] [direction:rtl] [-webkit-appearance:slider-vertical]"
          title={`gain ${gainVal.toFixed(1)} dB`}
        />
      </div>
      <div className="shrink-0 text-[10px] tabular-nums text-muted-foreground">
        {gainVal <= GAIN_MIN ? "-inf" : `${gainVal.toFixed(1)}`} dB
      </div>

      {/* Pan (-1..1). */}
      <input
        type="range"
        min={-1}
        max={1}
        step={0.02}
        value={panPos}
        onChange={(e) => setPanDrag(Number(e.target.value))}
        onPointerUp={commitPan}
        onKeyUp={commitPan}
        className="w-full shrink-0 cursor-pointer accent-primary"
        title={`pan ${panToLabel((panPos + 1) / 2)}`}
      />
      <div className="shrink-0 text-[10px] tabular-nums text-muted-foreground">
        {panToLabel((panPos + 1) / 2)}
      </div>

      <div className="mt-0.5 flex w-full shrink-0 gap-1">
        <Button
          size="xs"
          variant={track.mute ? "destructive" : "outline"}
          className="flex-1 px-0"
          onClick={(e) => {
            act(track.id, { mute: !track.mute }, `track mute ${track.id}`);
            blurOnClick(e); // else the next Space re-toggles M instead of playing
          }}
          title={m["mixer.mute"]()}
        >
          M
        </Button>
        <Button
          size="xs"
          variant={track.solo ? "default" : "outline"}
          className={cn(
            "flex-1 px-0",
            track.solo && "bg-amber-400 text-black hover:bg-amber-400/90",
          )}
          onClick={(e) => {
            act(track.id, { solo: !track.solo }, `track solo ${track.id}`);
            blurOnClick(e);
          }}
          title={m["mixer.solo"]()}
        >
          S
        </Button>
      </div>
    </div>
  );
}

export function MixerTab({
  reloadKey,
  command,
}: {
  reloadKey: number;
  command: (line: string) => void | Promise<void>;
}) {
  // Meter levels from the store with array equality: the mixer re-renders on a moving level, and not when idle.
  const levels = useEngineState((s) => s.levels, arrayEq);
  const [proj, setProj] = useState<WebProject | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [prefs, setPrefs] = useState<WebPreferences | null>(null);

  useEffect(() => {
    api
      .projectDoc()
      .then((p) => {
        setProj(p);
        setError(null);
      })
      .catch((e) => setError((e as Error).message));
    // Global channel labels (edited via the `channel` command, which bumps reloadKey).
    void api
      .preferences()
      .then(setPrefs)
      .catch(() => {});
  }, [reloadKey]);

  // Optimistic: reflect locally at once, then fire the command in the background. No reloadKey bump.
  const act = (id: string, patch: Partial<WebTrack>, line: string) => {
    setProj((p) =>
      p
        ? {
            ...p,
            tracks: p.tracks.map((t) => (t.id === id ? { ...t, ...patch } : t)),
          }
        : p,
    );
    void command(line);
  };

  const anySolo = useMemo(() => !!proj?.tracks.some((t) => t.solo), [proj]);

  if (error) return <div className="p-4 text-sm text-red-500">{error}</div>;
  if (!proj)
    return (
      <div className="p-4 text-sm text-muted-foreground">
        {m["common.loading"]()}
      </div>
    );
  if (proj.tracks.length === 0)
    return (
      <div className="p-4 text-sm text-muted-foreground">
        {m["mixer.noTracks"]()}
      </div>
    );

  return (
    // h-full: fill the bottom panel's (resizable) height, so the strips flex to it rather than overflowing a short panel.
    <div className="flex h-full min-h-0 w-full flex-col">
      <div className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-1.5 text-xs text-muted-foreground">
        <span className="font-medium text-foreground">Mixer</span>
        <span>· drag faders to set gain · sliders pan · M mute · S solo</span>
      </div>
      {prefs && (prefs.channels.in || prefs.channels.out) && (
        <div className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-0.5 border-b border-border px-3 py-1 text-[11px] text-muted-foreground">
          {prefs.channels.in && (
            <span>
              <span className="font-medium text-foreground">in</span>{" "}
              {prefs.channels.in}
            </span>
          )}
          {prefs.channels.out && (
            <span>
              <span className="font-medium text-foreground">out</span>{" "}
              {prefs.channels.out}
            </span>
          )}
        </div>
      )}
      <div className="flex min-h-0 flex-1 gap-2 overflow-x-auto p-3">
        {proj.tracks.map((t, i) => (
          <Strip
            key={t.id}
            track={t}
            level={levels[i] ?? -Infinity}
            anySolo={anySolo}
            act={act}
          />
        ))}
      </div>
    </div>
  );
}
