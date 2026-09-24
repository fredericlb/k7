// rtcFrames.ts — the engine's frames over a WebRTC data channel. A browser refuses a message
// past its channel's size limit, and a whole project document passes it, so every frame is cut
// into FRAGMENTS, each opening with one byte saying text or binary and whether more follow.
// Browser-safe and dependency-free: the browser and the supervisor share it.

/** Small enough for every browser's data channel, large enough that a document is a handful. */
export const RTC_FRAGMENT_BYTES = 16 * 1024;

const TEXT_LAST = 0;
const BINARY_LAST = 1;
const TEXT_MORE = 2;
const BINARY_MORE = 3;

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/** One frame as the fragments to send, in order. */
export function toFragments(data: string | Uint8Array): Uint8Array[] {
  const text = typeof data === "string";
  const bytes = text ? encoder.encode(data) : data;
  const room = RTC_FRAGMENT_BYTES - 1;
  const out: Uint8Array[] = [];
  for (let at = 0; at === 0 || at < bytes.length; at += room) {
    const piece = bytes.subarray(at, at + room);
    const last = at + room >= bytes.length;
    const frag = new Uint8Array(piece.length + 1);
    frag[0] = text
      ? last
        ? TEXT_LAST
        : TEXT_MORE
      : last
        ? BINARY_LAST
        : BINARY_MORE;
    frag.set(piece, 1);
    out.push(frag);
  }
  return out;
}

/** Collects fragments back into frames; `push` answers a whole frame once its last piece is in. */
export class FragmentJoiner {
  private parts: Uint8Array[] = [];
  private size = 0;

  push(fragment: Uint8Array): { text: string } | { binary: Uint8Array } | null {
    if (!fragment.length) return null;
    const kind = fragment[0];
    this.parts.push(fragment.subarray(1));
    this.size += fragment.length - 1;
    if (kind === TEXT_MORE || kind === BINARY_MORE) return null;
    const whole = new Uint8Array(this.size);
    let at = 0;
    for (const p of this.parts) {
      whole.set(p, at);
      at += p.length;
    }
    this.parts = [];
    this.size = 0;
    return kind === TEXT_LAST
      ? { text: decoder.decode(whole) }
      : { binary: whole };
  }
}
