// ClipContent.tsx — a clip's inner detail, drawn inside its lane block when the
// timeline is EXPANDED (the header's expand toggle). A MIDI clip shows a mini
// piano-roll of the notes it already carries; an audio clip shows its waveform, fetched
// once per clip WINDOW and cached (src/clipEnvelope.ts). Both fill the box the caller
// gives them (absolute inset-0), so the lane row sizes it and this just paints.

import { memo, useEffect, useState } from "react";
import { api } from "../api";
import { clipEnvelopeKey, type EnvelopeProject } from "../clipEnvelope";
import type { WebClip, WebNote, WebWaveform } from "../types";

/**
 * Memoised, because the timeline re-renders for reasons no clip cares about — the caret
 * moving, a hover, a poll landing — and this is the most numerous thing on the surface once
 * the lanes are expanded. Both props settle it by shallow compare: `clip` comes off the
 * project doc and keeps its identity until the doc is refetched, and `spanBeats` is a number.
 * Below here a waveform is fetched per clip, so a needless re-render is not free.
 */
export const ClipContent = memo(function ClipContent({
  clip,
  spanBeats,
  project,
}: {
  clip: WebClip;
  // The beats the block spans on screen — notes lay out against this, so the mini-roll lines up with the arrangement.
  spanBeats: number;
  // Tempo and time signature: they decide how much of the source the region shows, so they are
  // part of the envelope's identity rather than of its drawing.
  project: EnvelopeProject;
}) {
  return clip.type === "midi" ? (
    <ClipMidi
      notes={clip.notes}
      spanBeats={spanBeats}
      loopStart={clip.loopStart}
      loopEnd={clip.loopEnd}
    />
  ) : (
    <ClipWaveform clip={clip} project={project} />
  );
});

// The notes as a mini piano-roll, y scaled to the clip's own note range. A looping clip tiles its window's notes
// exactly as the engine repeats them, so a short pattern reads as the repeats it plays.
function ClipMidi({
  notes,
  spanBeats,
  loopStart = 0,
  loopEnd = 0,
}: {
  notes: WebNote[];
  spanBeats: number;
  loopStart?: number;
  loopEnd?: number;
}) {
  if (!notes.length || spanBeats <= 0) return null;
  const loopLen = loopEnd > loopStart ? loopEnd - loopStart : 0;
  const placed: WebNote[] =
    loopLen > 0
      ? (() => {
          // Notes inside the loop window, re-timed to clip-space and repeated until the span is filled.
          const win = notes.filter(
            (n) => n.time >= loopStart && n.time < loopEnd,
          );
          const out: WebNote[] = [];
          for (let k = 0; k * loopLen < spanBeats; k++)
            for (const n of win)
              out.push({ ...n, time: n.time - loopStart + k * loopLen });
          return out;
        })()
      : notes;
  if (!placed.length) return null;
  let lo = Infinity;
  let hi = -Infinity;
  for (const n of placed) {
    if (n.key < lo) lo = n.key;
    if (n.key > hi) hi = n.key;
  }
  const rows = hi - lo + 1; // pitch rows to stack
  return (
    <div className="absolute inset-0 text-foreground">
      {placed.map((n, i) => (
        <div
          key={i}
          className="absolute rounded-[1px] bg-current opacity-80"
          style={{
            left: `${Math.min(100, (n.time / spanBeats) * 100)}%`,
            width: `${Math.max(0.8, Math.min(100, (n.duration / spanBeats) * 100))}%`,
            top: `${((hi - n.key) / rows) * 100}%`,
            height: `${Math.max(9, 100 / rows)}%`,
          }}
        />
      ))}
    </div>
  );
}

// A modest bucket count — the lane block is small, so more would just be thrown away by the polygon's linear stretch.
const BUCKETS = 160;

/**
 * ONE entry per clip, holding the key it was fetched under — the same shape (and the same
 * reason) as the file service's own `WfEntry`: a changed key misses, and replacing the entry
 * rather than adding one keeps this bounded by the clip count however many times a clip is
 * trimmed or moved. `data: null` means tried and failed, so it isn't retried each mount.
 */
const wfCache = new Map<string, { key: string; data: WebWaveform | null }>();

/**
 * The clip's envelope, fetched once and shared: the expanded lane's waveform and the block's
 * activity mask read the SAME entry, so opening the lanes up costs no second decode. Pass
 * null to ask for nothing (a MIDI clip has no envelope, and hooks cannot be conditional).
 *
 * It is keyed by `clipEnvelopeKey` and not by the id, because a trim changes what the clip
 * plays without changing anything the id can see — see src/clipEnvelope.ts.
 */
export function useClipWaveform(
  clip: WebClip | null,
  project: EnvelopeProject,
): WebWaveform | null {
  const key = clip ? clipEnvelopeKey(clip, project, BUCKETS) : null;
  const id = clip?.id ?? null;
  const [wf, setWf] = useState<WebWaveform | null>(() => {
    const hit = id ? wfCache.get(id) : undefined;
    return hit && hit.key === key ? hit.data : null;
  });
  useEffect(() => {
    if (!id || !key) return;
    const hit = wfCache.get(id);
    if (hit && hit.key === key) {
      setWf(hit.data);
      return;
    }
    let cancelled = false;
    api
      .waveform(id, BUCKETS)
      .then((w) => {
        wfCache.set(id, { key, data: w });
        if (!cancelled) setWf(w);
      })
      .catch(() => wfCache.set(id, { key, data: null }));
    return () => {
      cancelled = true;
    };
  }, [id, key]);
  return id ? wf : null;
}

function ClipWaveform({
  clip,
  project,
}: {
  clip: WebClip;
  project: EnvelopeProject;
}) {
  const wf = useClipWaveform(clip, project);

  const peak = wf?.peak;
  if (!peak || !peak.length) return null;
  const n = peak.length;
  // One filled polygon rather than a rect per bucket — cheap DOM with many clips on screen.
  const pts: string[] = [];
  for (let i = 0; i < n; i++) pts.push(`${i},${50 - peak[i] * 48}`);
  for (let i = n - 1; i >= 0; i--) pts.push(`${i},${50 + peak[i] * 48}`);
  return (
    <svg
      className="absolute inset-0 h-full w-full text-foreground"
      viewBox={`0 0 ${n} 100`}
      preserveAspectRatio="none"
    >
      <polygon points={pts.join(" ")} className="fill-current opacity-70" />
      {wf!.transients.map((t, i) => {
        const x = Math.max(0, Math.min(n, (t / wf!.seconds) * n));
        return (
          <line
            key={i}
            x1={x}
            y1={0}
            x2={x}
            y2={100}
            stroke="#facc15" // yellow-400
            strokeWidth={0.6}
            strokeDasharray="2 2"
            strokeOpacity={0.3}
          />
        );
      })}
    </svg>
  );
}
