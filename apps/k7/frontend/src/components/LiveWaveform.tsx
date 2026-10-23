// LiveWaveform.tsx — the clip panel's LEAVES: the parts that re-render at a frame or a take's rate,
// split out so the panel around them does not. See ../../docs/playhead.md.

import { Waveform, type WaveformHandle } from "@studio/ui-waveform";
import { type ComponentProps, useCallback, useMemo, useRef } from "react";
import { clipPlayhead } from "../clipPlayhead";
import { type LiveTake, useLiveSamples } from "../hooks/useLiveEnvelope";
import { usePlayheadFrames } from "../hooks/usePlayheadFrames";

/** The canvas with the TRANSPORT on it — a LEAF, so the frame it watches reaches nothing else, and where SONG seconds become FILE seconds. */
export function LiveWaveform({
  placedAt,
  act,
  tempo,
  ...rest
}: Omit<ComponentProps<typeof Waveform>, "currentTime" | "ref"> & {
  /** The beat this event's window starts playing at, or null for a clip nothing places. */
  placedAt: number | null;
  /** The slice of the file the event plays, in file seconds. */
  act: { from: number; to: number };
  tempo: number;
}) {
  const wave = useRef<WaveformHandle>(null);
  // Steered per animation frame through the handle: the canvas is not redrawn, only its played clip and line move (docs/playhead.md).
  usePlayheadFrames(
    useCallback(
      (playhead: number) => {
        const at = clipPlayhead(playhead, placedAt, act, tempo);
        wave.current?.setTime(at ?? act.from);
      },
      [placedAt, act, tempo],
    ),
  );
  return <Waveform ref={wave} {...rest} />;
}

/** How long the growing take runs, a leaf re-rendering at the take's published rate and nothing around it. */
export function LiveSeconds({ live }: { live: LiveTake }) {
  const samples = useLiveSamples(live);
  return <>{((samples.length * live.intervalMs) / 1000).toFixed(1)} s</>;
}

/** The growing take, drawn in a LEAF: the panel does not render for its samples, only this does. */
export function LiveTakeWave({
  live,
  height,
}: {
  live: LiveTake;
  height: number;
}) {
  const samples = useLiveSamples(live);
  const envelope = useMemo(
    () => ({ intervalMs: live.intervalMs, samples }),
    [live.intervalMs, samples],
  );
  const seconds = (samples.length * live.intervalMs) / 1000;
  return (
    <Waveform
      envelope={envelope}
      duration={seconds}
      height={height}
      currentTime={seconds}
    />
  );
}
