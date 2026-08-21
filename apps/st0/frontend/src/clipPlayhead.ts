// Where the transport is, ON A CLIP'S OWN PICTURE — the conversion between the two axes a clip
// panel holds at once. See components/AudioClipPanel.tsx's LiveWaveform.

/** The slice of the file an event plays, in file seconds. */
export interface ActWindow {
  from: number;
  to: number;
}

/**
 * The transport's position as a second of THIS FILE, or null when it is not inside the event.
 *
 * Two axes meet in a clip panel and this is the only place they touch. The transport speaks SONG
 * seconds; the picture is FILE seconds, because a waveform is a file and a window into it. What
 * joins them is the pair the panel is opened with: `placedAt`, the beat the event's window opens
 * at in the arrangement, and `act.from`, the second it opens at in the file. Beats elapsed since
 * the first land as seconds after the second.
 *
 * Null — rather than a clamp — while the transport is elsewhere: a mark held at an edge would say
 * "the playhead is here" about a moment this event does not play, and the caller has something
 * truer to draw (the head of the window). Null too for a clip nothing places, which has no
 * position in the song at all, and for a tempo of zero, which has no conversion.
 *
 * Warped clips are a known approximation, the same one the panel's ruler states: a stretch map
 * bends time INSIDE the clip, and this reads the placement's grid — the frame, not the warp.
 */
export function clipPlayhead(
  songSeconds: number,
  placedAt: number | null,
  act: ActWindow,
  tempo: number,
): number | null {
  if (placedAt == null || !(tempo > 0)) return null;
  const beatsIn = (songSeconds * tempo) / 60 - placedAt;
  if (beatsIn < 0) return null;
  const at = act.from + (beatsIn * 60) / tempo;
  // Inclusive of the far edge by a hair: the last frame of a clip that ends exactly on a beat
  // arrives at `act.to`, and dropping it makes the mark vanish a frame before the sound does.
  return at <= act.to + 1e-6 ? at : null;
}
