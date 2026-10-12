// remoteLens.ts — a lens opened on the MACHINE and received here. This is what a surface on a
// second device draws with: over the LAN the page is not a secure context, so getUserMedia is
// not there at all — but RTCPeerConnection is, being gated on nothing, and a peer connection is
// exempt from the mixed-content rule that stops every other way of reaching this machine.
// One socket and one peer connection per live lane. See packages/song/docs/camera.md.

import { cfg } from "@studio/project-shell/fileApi";
import type { Lens, LensOpener } from "@studio/ui-eyes/camera";
import { type Frame, ICE, readFrame, relayUrl, sendFrame } from "./relay";

/** Long enough for a permission prompt on the machine, short enough that a lane says something. */
const WAIT_MS = 20_000;

/** Can a lens be asked for at all — i.e. is there an engine whose token opens the relay? */
export function canAskForLens(): boolean {
  try {
    return !!cfg().engineId && !!cfg().engineToken;
  } catch {
    return false; // no project open, so no machine chosen and nothing to ask
  }
}

/** Ask the machine's window for the lens a layer names. Resolves once, with a picture or a sentence. */
export const remoteLens: LensOpener = (label) =>
  new Promise<Lens>((resolve) => {
    let settled = false;
    // Both ends of the link, closed together — on a failure here, and by the driver when the lane goes.
    const close = () => {
      pc?.close();
      if (ws && ws.readyState <= WebSocket.OPEN) ws.close();
    };
    const done = (l: Lens) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      // No picture: nothing will ever be drawn from this link, so it is not kept open.
      if (!l.stream) close();
      resolve(l.stream ? { ...l, close } : l);
    };
    const timer = window.setTimeout(
      () => done({ stream: null, problem: "the machine did not answer" }),
      WAIT_MS,
    );

    let ws: WebSocket | undefined;
    let pc: RTCPeerConnection | undefined;
    try {
      const c = cfg();
      ws = new WebSocket(
        relayUrl({ role: "viewer", engine: c.engineId, token: c.engineToken }),
      );
    } catch (e) {
      return done({ stream: null, problem: (e as Error).message });
    }

    // Opened above, or this already returned: `sock` and `peer` are the two ends, typed as present.
    if (!ws) return;
    const sock = ws;
    pc = new RTCPeerConnection(ICE);
    const peer = pc;
    /** The sentence the machine sent with its offer, kept for whichever resolves first. */
    let problem: string | null = null;
    peer.onicecandidate = (e) => {
      if (e.candidate)
        sendFrame(sock, { type: "ice", candidate: e.candidate.toJSON() });
    };
    peer.ontrack = (e) =>
      done({ stream: e.streams[0] ?? new MediaStream([e.track]), problem });

    const handle = async (f: Frame) => {
      if (f.type === "problem") return done({ stream: null, problem: f.text });
      if (f.type === "offer") {
        problem = f.problem ?? null;
        await peer.setRemoteDescription(f.sdp);
        const sdp = await peer.createAnswer();
        await peer.setLocalDescription(sdp);
        sendFrame(sock, { type: "answer", sdp: peer.localDescription ?? sdp });
        return;
      }
      if (f.type === "ice")
        await peer.addIceCandidate(f.candidate).catch(() => undefined);
    };

    sock.onopen = () => sendFrame(sock, { type: "want", label });
    sock.onmessage = (e) => {
      const f = readFrame(e.data);
      // A negotiation that throws leaves a lane with no picture, which is a sentence and not a crash.
      if (f)
        void handle(f).catch((err: Error) =>
          done({ stream: null, problem: `camera link failed: ${err.message}` }),
        );
    };
    // A socket that closes before a track arrived is a lane that will never draw; say so.
    sock.onclose = () =>
      done({ stream: null, problem: "the link to the machine closed" });
    sock.onerror = () =>
      done({ stream: null, problem: "no camera relay on this machine" });
    // The socket stays open for the connection's life: ICE trickles after the first frame.
    peer.onconnectionstatechange = () => {
      if (peer.connectionState === "closed" || peer.connectionState === "failed")
        sock.close();
    };
  });
