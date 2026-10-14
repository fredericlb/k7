// Where the transport is, ON A CLIP'S OWN PICTURE — the conversion between the two axes a clip
// panel holds at once. See components/AudioClipPanel.tsx's LiveWaveform.

/** The slice of the file an event plays, in file seconds. */
export interface ActWindow {
  from: number;
  to: number;
}

/** The transport's position as a second of THIS FILE, or null when it is outside the event — the two axes meet here and nowhere else. */
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
  // Inclusive of the far edge by a hair: the last frame of a clip ending on a beat arrives at `act.to`, and dropping it hides the mark.
  return at <= act.to + 1e-6 ? at : null;
}
