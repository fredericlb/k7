// relay.ts — the address of the desktop app's camera signalling socket and the frames that
// travel on it. Both ends live in this folder; this file is what stops them disagreeing.
// Nothing here is needed against a hosted origin: there a second device has https already,
// so it opens its own lens. See apps/st0-desktop/docs/camera.md.

/** The one path the desktop app takes these upgrades on. */
const PATH = "/camera/rtc";

/** No STUN. Both ends are on one LAN, and the case this exists for has no internet to ask. */
export const ICE: RTCConfiguration = { iceServers: [] };

export interface Want {
  type: "want";
  label: string;
  /** Added by the relay on the way to the host; never written by the viewer. */
  from?: string;
}
export interface Offer {
  type: "offer";
  sdp: RTCSessionDescriptionInit;
  to?: string;
  /** The sentence `matchCamera` produced on the machine, carried so the viewer can draw it. */
  problem?: string | null;
}
export interface Answer {
  type: "answer";
  sdp: RTCSessionDescriptionInit;
  from?: string;
}
export interface Ice {
  type: "ice";
  candidate: RTCIceCandidateInit;
  to?: string;
  from?: string;
}
export interface Problem {
  type: "problem";
  text: string;
  /** Set when the HOST is the one refusing; the relay strips it on the way out. */
  to?: string;
}
export interface Gone {
  type: "gone";
  from: string;
}

export type Frame = Want | Offer | Answer | Ice | Problem | Gone;

/** The socket, on the origin this page was served from — which is the machine we want a lens from. */
export function relayUrl(params: Record<string, string>): string {
  const u = new URL(PATH, window.location.origin);
  u.protocol = u.protocol === "https:" ? "wss:" : "ws:";
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  return u.toString();
}

/** Read a frame, or null for anything this end cannot make sense of. */
export function readFrame(data: unknown): Frame | null {
  try {
    const m = JSON.parse(String(data)) as Frame;
    return m && typeof m === "object" && typeof m.type === "string" ? m : null;
  } catch {
    return null;
  }
}

export const sendFrame = (ws: WebSocket, f: Frame): void => {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(f));
};
