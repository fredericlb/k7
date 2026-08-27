// takeClock.ts — what a RECORDER's card says over its waveform, and what it says instead of one.
//
// Two states and no third: a node either has a take to show — being written or finished — or it
// has nothing, and a card drawing an empty waveform for "nothing" reads as a broken meter rather
// than as an idle machine. See packages/song/docs/recorderNode.md.

/** The fields of a state frame's recorder this decision reads. */
export interface TakeState {
  recording: boolean;
  /** The take being WRITTEN, in seconds; the engine sends 0 when it is not rolling. */
  seconds: number;
  takes: { seconds: number }[];
}

/** What the card draws: a message INSTEAD of the waveform, or a time OVER it. Never both. */
export interface TakeReadout {
  /** Shown alone, with no waveform beside it — the node holds nothing at all. */
  message?: string;
  /** …else the clock: counting up while rolling, the take's length once it has stopped. */
  elapsed?: string;
}

/** What an idle recorder says. Lower case, as every other word on a card is. */
export const NO_RECORD = "no record";

const BLANK: TakeReadout = { message: NO_RECORD };

/**
 * `m:ss.t` — tenths, because a take is often a few seconds and "0:02" hides the difference
 * between a stab and a bar. Minutes never pad: a clock reading `0:03.4` is what a tape machine
 * shows, and `00:03.4` buys nothing on a card this size.
 */
export function formatTake(seconds: number): string {
  const s = Number.isFinite(seconds) && seconds > 0 ? seconds : 0;
  // Truncated rather than rounded: a clock that reads 0:03.0 before three seconds have passed is
  // wrong in the direction that matters while you are watching it count. Done in TENTHS, and with
  // an epsilon, because truncation magnifies a float: 605.9 is 6058.999… tenths and would read
  // 10:05.8 — subtracting minutes first makes it worse, not better.
  const tenths = Math.floor(s * 10 + 1e-6);
  const m = Math.floor(tenths / 600);
  const rest = tenths - m * 600;
  return `${m}:${String(Math.floor(rest / 10)).padStart(2, "0")}.${rest % 10}`;
}

/**
 * What to draw for one recorder node.
 *
 * Rolling wins over a finished take: the clock counts the take being MADE, not the one before it.
 * With neither, the message stands alone — `message` and `elapsed` are never both set, which is
 * what lets the card decide "waveform or not" on one field.
 */
export function takeReadout(rec: TakeState | undefined): TakeReadout {
  if (!rec) return BLANK;
  if (rec.recording) return { elapsed: formatTake(rec.seconds) };
  const last = rec.takes[rec.takes.length - 1];
  if (!last) return BLANK;
  return { elapsed: formatTake(last.seconds) };
}
