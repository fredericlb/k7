// takeEnvelope.ts — the take's picture, ACCUMULATED. The engine sends the points it made since
// the last frame and nothing else (engine/st0-engine/docs/recorder.md), so somebody has to keep the
// running total — and has to know when to throw it away.
//
// Pure, and its own file, because that second half is the whole difficulty: a rule that decides
// wrong shows a take drawn on top of the last one, which reads as a rendering bug for ever.
//
// It lives beside the STORE and not beside the canvas that draws it, which is the fix for a
// reload showing nothing: the whole picture is resent in ONE frame when the socket connects, and
// the card that draws it does not exist for another second. Only something living as long as the
// connection can catch that frame. See packages/song/docs/recorderNode.md.

import type { WaveformEnvelope } from "@studio/engine-protocol";

/** One min/max point — the protocol's own shape, aliased so a reader here needs no second name. */
export type EnvPoint = WaveformEnvelope;

/** What the state frame says about one recorder node — the fields this decision reads. */
export interface TakeFrame {
  recording: boolean;
  takes: { seconds: number }[];
  envelope: EnvPoint[];
  /** Where `envelope` starts in the take. Absent from an engine older than the field, which is
   *  read as "these are an append" — the behaviour before it existed. */
  from?: number;
}

/** A node's accumulated picture, plus what it was accumulated AGAINST. */
export interface TakeView {
  points: EnvPoint[];
  /** How many takes existed when these points started — a change means a different picture. */
  takeCount: number;
  recording: boolean;
}

export const EMPTY_TAKE: TakeView = {
  points: [],
  takeCount: 0,
  recording: false,
};

/**
 * Fold one frame into the running picture.
 *
 * It STARTS OVER on either of two edges, and each is a real thing that happens:
 *
 * - **record turned on** — a new take begins, and the last one's points are not part of it;
 * - **the take count MOVED with no record edge** — `clear` popped one. What is on screen is the
 *   take that was cleared, and keeping it would draw audio that no longer exists.
 *
 * Everything else is `from`: the frame is authoritative for the stretch it covers, so what the
 * view keeps is whatever sits BEFORE that stretch. Which makes one expression cover the three
 * cases separately — an ordinary append (`from` is what we hold), a resend to a client that just
 * connected (`from` is 0, so the whole picture replaces nothing), and the overlap between the
 * two, where only the tail is new.
 *
 * A frame with no points and no edge changes nothing, and returns the SAME object: that is the
 * case which runs 20 times a second, and a new array each time would repaint the card for ever.
 */
export function foldTake(view: TakeView, frame: TakeFrame): TakeView {
  const started = frame.recording && !view.recording;
  const cleared =
    !frame.recording &&
    !view.recording &&
    frame.takes.length !== view.takeCount;
  if (started || cleared)
    return {
      points: frame.envelope.length ? [...frame.envelope] : [],
      takeCount: frame.takes.length,
      recording: frame.recording,
    };
  // An engine that says nothing is appending, which is what it did before it said anything.
  const from = frame.from ?? view.points.length;
  if (
    frame.envelope.length === 0 &&
    from === view.points.length &&
    frame.recording === view.recording &&
    frame.takes.length === view.takeCount
  )
    return view;
  return {
    // `slice` clamps, so a frame starting past the end simply keeps everything and appends.
    points: [...view.points.slice(0, from), ...frame.envelope],
    takeCount: frame.takes.length,
    recording: frame.recording,
  };
}
