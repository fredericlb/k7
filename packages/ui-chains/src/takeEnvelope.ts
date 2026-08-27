// takeEnvelope.ts — the take's picture, ACCUMULATED. The engine sends the points it made since
// the last frame and nothing else (engine/moteur/docs/recorder.md), so somebody has to keep the
// running total — and has to know when to throw it away.
//
// Pure, and its own file, because that second half is the whole difficulty: a rule that decides
// wrong shows a take drawn on top of the last one, which reads as a rendering bug for ever.
//
// Every frame says WHERE its points start, which is what makes a reload work: the engine resends
// the whole picture to a socket that just connected, and `from` is what tells that resend apart
// from an append. See packages/song/docs/recorderNode.md.

/** One min/max point, the shape the engine's tap emits. */
export interface EnvPoint {
  min: number;
  max: number;
}

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

/**
 * Down to `width` points, min and max kept apart — a five-minute take is 3500 points and a card
 * is 120 pixels wide. Decimating by AVERAGING would flatten every peak into the mean and draw a
 * quiet take; a waveform's whole job is the extremes.
 */
export function decimate(
  points: readonly EnvPoint[],
  width: number,
): EnvPoint[] {
  if (width <= 0) return [];
  if (points.length <= width) return [...points];
  const out: EnvPoint[] = [];
  for (let i = 0; i < width; i++) {
    const from = Math.floor((i * points.length) / width);
    const to = Math.max(
      from + 1,
      Math.floor(((i + 1) * points.length) / width),
    );
    let lo = points[from].min;
    let hi = points[from].max;
    for (let j = from + 1; j < to; j++) {
      if (points[j].min < lo) lo = points[j].min;
      if (points[j].max > hi) hi = points[j].max;
    }
    out.push({ min: lo, max: hi });
  }
  return out;
}
