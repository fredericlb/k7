// rtcSocket.ts — a WebSocket-shaped handle over a WebRTC data channel to the engine's
// supervisor: the one direct path an HTTPS page has to an engine on another machine. The offer
// goes to the registry's `/engine/<id>/rtc`, and the frames are cut into fragments both ways
// (@studio/web-protocol/rtc-frames). An address `rtc:<signal url>` is how a caller asks for one.
// See packages/engine-tunnel/docs/rtc.md.

import { ENGINE_CONNECT_DEADLINE_MS } from "@studio/web-protocol";
import { FragmentJoiner, toFragments } from "@studio/web-protocol/rtc-frames";

export const RTC_SCHEME = "rtc:";

/** How long ICE gathering may take before the offer goes with the candidates it has. */
const GATHER_MS = 1500;

const CONNECTING = 0;
const OPEN = 1;
const CLOSED = 3;

function gathered(pc: RTCPeerConnection, ms: number): Promise<void> {
  if (pc.iceGatheringState === "complete") return Promise.resolve();
  return new Promise((res) => {
    const timer = setTimeout(res, ms);
    pc.addEventListener("icegatheringstatechange", () => {
      if (pc.iceGatheringState !== "complete") return;
      clearTimeout(timer);
      res();
    });
  });
}

/** The slice of a WebSocket the engine client and the probe use, and nothing more. */
class RtcSocket {
  binaryType: BinaryType = "arraybuffer";
  readyState = CONNECTING;
  onopen: ((ev: Event) => void) | null = null;
  onclose: ((ev: Event) => void) | null = null;
  onerror: ((ev: Event) => void) | null = null;
  onmessage: ((ev: MessageEvent) => void) | null = null;
  private pc: RTCPeerConnection | null = null;
  private dc: RTCDataChannel | null = null;
  private readonly joiner = new FragmentJoiner();

  constructor(private readonly signalUrl: string) {
    void this.start().catch(() => this.end());
  }

  private async start(): Promise<void> {
    const pc = new RTCPeerConnection({ iceServers: [] });
    this.pc = pc;
    const dc = pc.createDataChannel("engine", { ordered: true });
    this.dc = dc;
    dc.binaryType = "arraybuffer";
    dc.onopen = () => {
      if (this.readyState !== CONNECTING) return;
      this.readyState = OPEN;
      this.onopen?.(new Event("open"));
    };
    dc.onmessage = (ev) => {
      const frame = this.joiner.push(new Uint8Array(ev.data as ArrayBuffer));
      if (!frame) return;
      const data = "text" in frame ? frame.text : frame.binary.buffer;
      this.onmessage?.(new MessageEvent("message", { data }));
    };
    dc.onclose = () => this.end();
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === "failed" || pc.connectionState === "closed")
        this.end();
    };
    await pc.setLocalDescription(await pc.createOffer());
    await gathered(pc, GATHER_MS);
    const r = await fetch(this.signalUrl, {
      method: "POST",
      credentials: "include",
      // A signalling answer that never comes is no path: the client's connect deadline is the same length.
      signal: AbortSignal.timeout(ENGINE_CONNECT_DEADLINE_MS),
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sdp: pc.localDescription?.sdp ?? "" }),
    });
    if (!r.ok) throw new Error(`no WebRTC path (${r.status})`);
    const { sdp } = (await r.json()) as { sdp: string };
    if (this.readyState === CLOSED) return;
    await pc.setRemoteDescription({ type: "answer", sdp });
  }

  send(data: string | ArrayBufferLike | ArrayBufferView): void {
    if (this.readyState !== OPEN || !this.dc)
      throw new DOMException(
        "the data channel is not open",
        "InvalidStateError",
      );
    const bytes =
      typeof data === "string"
        ? data
        : ArrayBuffer.isView(data)
          ? new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
          : new Uint8Array(data);
    for (const f of toFragments(bytes))
      this.dc.send(f as Uint8Array<ArrayBuffer>);
  }

  close(): void {
    this.end();
  }

  private end(): void {
    if (this.readyState === CLOSED) return;
    const wasOpen = this.readyState === OPEN;
    this.readyState = CLOSED;
    try {
      this.dc?.close();
      this.pc?.close();
    } catch {
      /* already closed */
    }
    // A handshake that never opened is an error first, as a refused WebSocket is.
    if (!wasOpen) this.onerror?.(new Event("error"));
    this.onclose?.(new Event("close"));
  }
}

/** A WebSocket for a `ws(s):` address, a data channel for an `rtc:` one — typed as the former, which is all its callers use. */
export function openSocket(url: string): WebSocket {
  if (url.startsWith(RTC_SCHEME))
    return new RtcSocket(url.slice(RTC_SCHEME.length)) as unknown as WebSocket;
  return new WebSocket(url);
}
