// laneGains.ts — mute and solo resolved to one gain per lane, for the shared snapshot's player.
// The shell's own mute/solo are WRITES resolved by the engine; on a snapshot there is neither,
// so the same two flags have to be turned into audio here. See docs/shared.md.

/** What a lane's controls say, of the two fields that decide whether it sounds — `number`, as `TrackControlValues` carries it. */
export interface LaneState {
  mute: number;
  solo: number;
}

/** One gain per lane id: SOLO is a fact about the whole set, so this takes them all at once, and mute wins over solo on the same lane. */
export function laneGains(
  lanes: Record<string, LaneState>,
): Record<string, number> {
  const ids = Object.keys(lanes);
  const soloing = ids.some((id) => lanes[id].solo);
  return Object.fromEntries(
    ids.map((id) => {
      const l = lanes[id];
      return [id, l.mute || (soloing && !l.solo) ? 0 : 1];
    }),
  );
}

/** Does what should sound match what the MIXDOWN already sounds like? Compared over the LANES WE HAVE, an unmentioned one sounding (docs/shared.md). */
export function matchesMixdown(
  want: Record<string, number>,
  mixdown: Record<string, number>,
): boolean {
  return Object.keys(want).every((id) => want[id] === (mixdown[id] ?? 1));
}
