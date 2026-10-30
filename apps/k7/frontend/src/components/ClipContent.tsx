// ClipContent.tsx — a clip's inner detail, drawn inside its lane block when the
// timeline is EXPANDED (the header's expand toggle). A MIDI clip shows a mini
// piano-roll of the notes it already carries; an audio clip shows its waveform, fetched
// once per clip WINDOW and cached (src/clipEnvelope.ts). Both fill the box the caller
// gives them (absolute inset-0), so the lane row sizes it and this just paints.

import { bandsAt, spectrumColumns } from "@studio/ui-waveform/spectrum";
import { memo, useEffect, useRef, useState } from "react";
import { api } from "../api";
import { clipEnvelopeKey, type EnvelopeProject } from "../clipEnvelope";
import { onLeave } from "../scopeLeave";
import type { WebClip, WebWaveform } from "../types";
import { ClipMiniRoll } from "./ClipMiniRoll";

/** Memoised: this is the most numerous thing on the surface once the lanes are expanded, and below here a waveform is fetched per clip. */
export const ClipContent = memo(function ClipContent({
  clip,
  spanBeats,
  project,
  overlay,
}: {
  clip: WebClip;
  // The beats the block spans on screen — notes lay out against this, so the mini-roll lines up with the arrangement.
  spanBeats: number;
  // Tempo and time signature decide how much of the source the region shows, so they are part of the envelope's identity.
  project: EnvelopeProject;
  // A frozen lane's authored clips, whose notes are drawn over the render they became (packages/song/docs/freeze.md).
  overlay?: WebClip[];
}) {
  if (overlay?.length && clip.type === "audio")
    return (
      <>
        <ClipWaveform clip={clip} project={project} />
        <NotesOver clip={clip} spanBeats={spanBeats} overlay={overlay} />
      </>
    );
  return clip.type === "midi" ? (
    <ClipMiniRoll
      notes={clip.notes}
      spanBeats={spanBeats}
      loopStart={clip.loopStart}
      loopEnd={clip.loopEnd}
    />
  ) : (
    <ClipWaveform clip={clip} project={project} />
  );
});

// Each authored MIDI clip as a mini-roll at its own place inside the render's block, so a note sits over the sound it made.
function NotesOver({
  clip,
  spanBeats,
  overlay,
}: {
  clip: WebClip;
  spanBeats: number;
  overlay: WebClip[];
}) {
  if (spanBeats <= 0) return null;
  return (
    <div className="pointer-events-none absolute inset-0">
      {overlay.map((m, i) => {
        if (m.type !== "midi") return null;
        const span =
          m.length > 0 ? m.length : spanBeats - (m.start - clip.start);
        return (
          <div
            key={`${m.id}-${i}`}
            className="absolute inset-y-0"
            style={{
              left: `${((m.start - clip.start) / spanBeats) * 100}%`,
              width: `${(span / spanBeats) * 100}%`,
            }}
          >
            <ClipMiniRoll
              notes={m.notes}
              spanBeats={span}
              loopStart={m.loopStart}
              loopEnd={m.loopEnd}
              tone="text-sky-300"
            />
          </div>
        );
      })}
    </div>
  );
}

// A modest bucket count — the lane block is small, so more would just be thrown away by the canvas's stretch.
const BUCKETS = 160;
/** The backing height a block's waveform is painted at before CSS stretches it to the lane. */
const WAVE_H = 100;

/** ONE entry per clip, holding the key it was fetched under — so this stays bounded by the clip count however often one is trimmed. */
const wfCache = new Map<string, { key: string; data: WebWaveform | null }>();

// Forgotten with the project: a clip id can name a clip in the next one too.
onLeave(() => wfCache.clear());

/** The clip's envelope, fetched once and shared, keyed by `clipEnvelopeKey` — a trim changes what plays without changing the id. */
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
      // A failure is NOT cached: during a prewarm or a blip, the clip would stay blank until a reload; its next mount asks again.
      .catch(() => undefined);
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
  const canvas = useRef<HTMLCanvasElement>(null);

  // One column per bucket at a fixed 100 px, stretched by CSS — no observer per clip, many clips on screen.
  useEffect(() => {
    // A software canvas, so it is not a composited layer of its own: see docs/timeline.md, "The page keeps few composited layers".
    const ctx = canvas.current?.getContext("2d", { willReadFrequently: true });
    if (!ctx || !wf?.peak.length) return;
    ctx.clearRect(0, 0, wf.peak.length, WAVE_H);
    spectrumColumns(ctx, wf.peak.length, WAVE_H, (i) => ({
      amp: wf.peak[i],
      bands: bandsAt(wf, i),
    }));
  }, [wf]);

  const peak = wf?.peak;
  if (!peak || !peak.length) return null;
  const n = peak.length;
  return (
    <>
      <canvas
        ref={canvas}
        width={n}
        height={WAVE_H}
        className="absolute inset-0 h-full w-full opacity-90"
      />
      <svg
        className="absolute inset-0 h-full w-full"
        viewBox={`0 0 ${n} 100`}
        preserveAspectRatio="none"
      >
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
    </>
  );
}
