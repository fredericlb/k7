// TakeRow.tsx — one row of the takes view: a take's whole material drawn on the song's time axis,
// bright where the comp plays it and dim where it does not. An SVG whose viewBox is in BEATS, so
// every row of the view shares one axis without measuring anything. Audio is its RMS envelope,
// MIDI its notes; both are fetched here, since a take is not in the compiled project until comped.

import { seqWindowFromText, windowSpan } from "@studio/song-schema/seqWindow";
import { memo, useEffect, useId, useMemo, useState } from "react";
import { parse } from "yaml";
import { api } from "../api";
import { envelopePath, type TakeRow as Row } from "../takes";

/** How many times, and how far apart, a row asks again for a take it could not read yet. */
const RETRIES = 6;
const RETRY_MS = 1000;

/** What a row draws, in beats from its own start: an envelope, or notes. */
type Material =
  | { kind: "audio"; length: number; rms: number[] }
  | {
      kind: "midi";
      length: number;
      notes: { t: number; d: number; k: number }[];
    };

/** Read a take's material: the file's envelope, or the sequence's notes and window. */
function useMaterial(
  row: Row,
  kind: "audio" | "midi",
  tempo: number,
  prefix: string,
  reloadKey: number,
  num: number,
  den: number,
): Material | null {
  const [mat, setMat] = useState<Material | null>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: `reloadKey` is the re-read signal, not a value read here.
  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const done = (m: Material) => alive && setMat(m);
    // A take just recorded may not be readable yet — its file still being closed: try again, a few times.
    let tries = 0;
    const retry = (load: () => void) => {
      if (!alive || ++tries > RETRIES) return;
      timer = setTimeout(load, RETRY_MS);
    };
    const loadAudio = (): void =>
      void api
        .waveform(row.ref, 600)
        .then((w) =>
          w.rms.length
            ? done({
                kind: "audio",
                length: (w.seconds * tempo) / 60,
                rms: w.rms,
              })
            : retry(loadAudio),
        )
        .catch(() => retry(loadAudio));
    const loadMidi = (): void =>
      void api
        .read(`${prefix}sequences/${row.ref}.yaml`)
        .then(({ content }) => {
          const seq = (parse(content) ?? {}) as {
            notes?: { t: number; d: number; k: number }[];
          };
          const notes = Array.isArray(seq.notes) ? seq.notes : [];
          const extent = notes.reduce((m, n) => Math.max(m, n.t + n.d), 0);
          // An unreadable window reads as none: the notes' own extent frames the row.
          const win = seqWindowFromText(content, num, den);
          const stated = win ? (windowSpan(win, extent)?.to ?? 0) : 0;
          done({ kind: "midi", length: Math.max(stated, extent), notes });
        })
        .catch(() => retry(loadMidi));
    if (kind === "audio") loadAudio();
    else loadMidi();
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [row.ref, kind, tempo, prefix, reloadKey, num, den]);
  return mat;
}

/** One row, memoised: the view re-renders on every pointer move of a drag, and a row's paths do not move with it. */
export const TakeRow = memo(function TakeRow({
  row,
  kind,
  label,
  view,
  heard,
  tempo,
  prefix,
  reloadKey,
  num,
  den,
  color,
  onLength,
}: {
  row: Row;
  kind: "audio" | "midi";
  label: string;
  /** The beats the view spans, shared by every row. */
  view: { from: number; to: number };
  /** Where the comp plays this row, song beats. */
  heard: { from: number; to: number }[];
  tempo: number;
  /** The project's folder, workspace-relative, ending in a slash — where its sequences are read from. */
  prefix: string;
  reloadKey: number;
  num: number;
  den: number;
  /** The take's colour — the comp strip's for the same take. */
  color: string;
  /** How long the row's material is, beats — reported up so the view frames every take. */
  onLength?: (ref: string, beats: number) => void;
}) {
  const mat = useMaterial(row, kind, tempo, prefix, reloadKey, num, den);
  const clip = useId();
  useEffect(() => {
    if (mat) onLength?.(row.ref, mat.length);
  }, [mat, row.ref, onLength]);
  const span = view.to - view.from;
  // The envelope's path, built once per material and row start rather than per render.
  const envelope = useMemo(
    () =>
      mat?.kind === "audio" ? envelopePath(mat.rms, mat.length, row.start) : "",
    [mat, row.start],
  );
  if (span <= 0) return null;
  const body = (() => {
    if (!mat) return null;
    if (mat.kind === "audio") return <path d={envelope} fill="currentColor" />;
    const keys = mat.notes.map((n) => n.k);
    const lo = Math.min(...keys, 60) - 1;
    const hi = Math.max(...keys, 72) + 1;
    return mat.notes.map((n) => (
      <rect
        key={`${n.t}:${n.k}`}
        x={row.start + n.t}
        y={1 - (n.k - lo + 1) / (hi - lo + 1)}
        width={Math.max(n.d, 0.05)}
        height={0.8 / (hi - lo + 1)}
        fill="currentColor"
      />
    ));
  })();
  return (
    <div className="relative h-full min-h-0">
      <svg
        viewBox={`${view.from} 0 ${span} 1`}
        preserveAspectRatio="none"
        className="absolute inset-0 h-full w-full"
        style={{ color }}
        role="img"
        aria-label={label}
      >
        <defs>
          <clipPath id={clip}>
            {heard.map((h) => (
              <rect
                key={`${h.from}`}
                x={h.from}
                y={0}
                width={h.to - h.from}
                height={1}
              />
            ))}
          </clipPath>
        </defs>
        {/* Where the comp plays this take: a tint under it, so a row that is heard nowhere reads as such. */}
        {heard.map((h) => (
          <rect
            key={`bg${h.from}`}
            x={h.from}
            y={0}
            width={h.to - h.from}
            height={1}
            fill="currentColor"
            opacity={0.12}
          />
        ))}
        <g opacity={0.3}>{body}</g>
        <g clipPath={`url(#${clip})`}>{body}</g>
      </svg>
    </div>
  );
});
