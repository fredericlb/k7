// Playhead.tsx — the parts of a session page that follow playback: the waveform's playhead and the clock.
// They read a store the page sets every frame, so playing re-renders them and never the page (../../docs/recordings.md).

import { type LiveValue, useLiveValue, Waveform } from "@studio/recorder";
import type { ComponentProps } from "react";
import { fmtTime } from "../format";

/** The waveform with its playhead, the one part of the page drawn at frame rate. */
export function PlayheadWaveform({
  clock,
  ...rest
}: Omit<ComponentProps<typeof Waveform>, "currentTime"> & {
  clock: LiveValue<number>;
}) {
  return <Waveform {...rest} currentTime={useLiveValue(clock)} />;
}

/** The position as text, re-rendered once a second. */
export function PlaybackTime({ clock }: { clock: LiveValue<number> }) {
  return <>{fmtTime(useLiveValue(clock, Math.floor))}</>;
}
