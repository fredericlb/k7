// laneGains.ts — mute and solo resolved to one gain per lane, for the shared snapshot's player.
// The shell's own mute/solo are WRITES resolved by the engine; on a snapshot there is neither,
// so the same two flags have to be turned into audio here. See docs/shared.md.

/**
 * What a lane's controls say, of the two fields that decide whether it sounds.
 *
 * `number` and not `0 | 1`, because that is what `TrackControlValues` carries and narrowing here
 * would only mean a cast at the one call site — which is the assertion this file exists to avoid
 * making. Read for truth, so anything a control could hold means the same thing it means there.
 */
export interface LaneState {
  mute: number;
  solo: number;
}

/**
 * One gain per lane id: 1 if it sounds, 0 if it does not.
 *
 * **Solo is a fact about the whole set**, which is why this takes all the lanes at once and not
 * one: a single soloed lane silences every other, so no lane's answer can be worked out from its
 * own two flags. That is also the rule the engine applies to `project.yaml`'s root `soloed:`
 * list, and this is the same rule stated where there is no engine to apply it.
 *
 * Mute wins over solo on the same lane. Soloing something and then muting it is a thing people
 * do while listening, and the reading that makes it silent is the one where the last gesture
 * did something.
 */
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

/**
 * Does what should sound match what the MIXDOWN already sounds like?
 *
 * The crossing rule, and the one that was wrong. A snapshot's mixdown is rendered FROM the
 * document, so a lane the document itself mutes is already absent from it — there is nothing to
 * do, and the mixdown is the one file whose timing cannot be wrong because it is one file.
 * Reading "this lane is silent" as "the visitor silenced it" put every project that mutes
 * anything onto a set of unsynchronised stems before a single click, which is the loudest
 * possible way to be wrong.
 *
 * Compared over the LANES WE HAVE, not over the mixdown's keys: a lane the render knew nothing
 * about defaults to sounding, which is what an unmentioned lane does in a mix.
 */
export function matchesMixdown(
  want: Record<string, number>,
  mixdown: Record<string, number>,
): boolean {
  return Object.keys(want).every((id) => want[id] === (mixdown[id] ?? 1));
}
