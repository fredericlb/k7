// latency.ts — how late a remote camera's picture is, read from WebRTC's own stats, and the jitter
// buffer each one is given so that every remote camera this browser draws is equally late. A
// picture cannot be made EARLIER: aligning means holding the quicker ones back to the slowest.
// The arithmetic is pure, so it is tested without a peer connection. See packages/web-protocol/docs/cameras.md.

/** What one remote lens's stats said: the part a jitter buffer adds, and the part it cannot touch. */
export interface LatencySample {
  /** Half the round trip plus the decode, in ms: the floor of this lens's lateness. */
  baseMs: number;
  /** What the jitter buffer holds a frame for, in ms. */
  bufferMs: number;
}

/** The few stats fields this reads, structurally, so a test hands a plain array. */
export interface StatLike {
  type: string;
  kind?: string;
  state?: string;
  nominated?: boolean;
  currentRoundTripTime?: number;
  jitterBufferDelay?: number;
  jitterBufferEmittedCount?: number;
  totalDecodeTime?: number;
  framesDecoded?: number;
}

/** A capture and an encode on the camera are never reported; one frame at 30 fps stands for them. */
const SENDER_MS = 33;

/** One lens's latency from a stats report, or null before a frame was decoded. */
export function sampleFromStats(
  stats: Iterable<StatLike>,
): LatencySample | null {
  let rtt: number | null = null;
  let video: StatLike | null = null;
  for (const s of stats) {
    if (s.type === "candidate-pair" && s.nominated && s.state === "succeeded")
      rtt = s.currentRoundTripTime ?? rtt;
    if (s.type === "inbound-rtp" && s.kind === "video") video = s;
  }
  if (!video?.framesDecoded || !video.jitterBufferEmittedCount) return null;
  const bufferMs =
    ((video.jitterBufferDelay ?? 0) / video.jitterBufferEmittedCount) * 1000;
  const decodeMs = ((video.totalDecodeTime ?? 0) / video.framesDecoded) * 1000;
  return {
    baseMs: SENDER_MS + ((rtt ?? 0) / 2) * 1000 + decodeMs,
    bufferMs,
  };
}

export const totalMs = (s: LatencySample): number => s.baseMs + s.bufferMs;

/** The longest a jitter buffer is asked to hold: past it, a lens is broken rather than slow. */
export const MAX_TARGET_MS = 2000;

/** Each lens's jitter-buffer target, so all of them land on the slowest one's lateness. */
export function bufferTargets(samples: readonly LatencySample[]): number[] {
  if (samples.length < 2) return samples.map(() => 0);
  // The slowest FLOOR, not the slowest total: a buffer already stretched by us must not ratchet the target up.
  const floor = Math.max(...samples.map((s) => s.baseMs));
  return samples.map((s) =>
    Math.round(Math.min(MAX_TARGET_MS, Math.max(0, floor - s.baseMs))),
  );
}
