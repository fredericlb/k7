// remoteLens.ts — a lens opened on the MACHINE and received here. This is what a surface on a
// second device draws with: over the LAN the page is not a secure context, so getUserMedia is
// not there at all — but RTCPeerConnection is, being gated on nothing, and a peer connection is
// exempt from the mixed-content rule that stops every other way of reaching this machine.
// One socket and one peer connection per live lane. See apps/studio-desktop/docs/camera.md.

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
    const done = (l: Lens) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(l);
    };
    const timer = window.setTimeout(
      () => done({ stream: null, problem: "the machine did not answer" }),
      WAIT_MS,
    );

    let ws: WebSocket;
    try {
      const c = cfg();
      ws = new WebSocket(
        relayUrl({ role: "viewer", engine: c.engineId, token: c.engineToken }),
      );
    } catch (e) {
      return done({ stream: null, problem: (e as Error).message });
    }

    const pc = new RTCPeerConnection(ICE);
    /** The sentence the machine sent with its offer, kept for whichever resolves first. */
    let problem: string | null = null;
    pc.onicecandidate = (e) => {
      if (e.candidate)
        sendFrame(ws, { type: "ice", candidate: e.candidate.toJSON() });
    };
    pc.ontrack = (e) =>
      done({ stream: e.streams[0] ?? new MediaStream([e.track]), problem });

    const handle = async (f: Frame) => {
      if (f.type === "problem") return done({ stream: null, problem: f.text });
      if (f.type === "offer") {
        problem = f.problem ?? null;
        await pc.setRemoteDescription(f.sdp);
        const sdp = await pc.createAnswer();
        await pc.setLocalDescription(sdp);
        sendFrame(ws, { type: "answer", sdp: pc.localDescription ?? sdp });
        return;
      }
      if (f.type === "ice")
        await pc.addIceCandidate(f.candidate).catch(() => undefined);
    };

    ws.onopen = () => sendFrame(ws, { type: "want", label });
    ws.onmessage = (e) => {
      const f = readFrame(e.data);
      // A negotiation that throws leaves a lane with no picture, which is a sentence and not a crash.
      if (f)
        void handle(f).catch((err: Error) =>
          done({ stream: null, problem: `camera link failed: ${err.message}` }),
        );
    };
    // A socket that closes before a track arrived is a lane that will never draw; say so.
    ws.onclose = () =>
      done({ stream: null, problem: "the link to the machine closed" });
    ws.onerror = () =>
      done({ stream: null, problem: "no camera relay on this machine" });
    // The socket stays open for the connection's life: ICE trickles after the first frame.
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === "closed" || pc.connectionState === "failed")
        ws.close();
    };
  });
