// serveLenses.ts — this machine's window, offering the cameras it may open to a second device
// that may not. It runs on the LOOPBACK origin only, which is both the secure context that makes
// getUserMedia possible and the proof we are the machine rather than a guest on its LAN.
// One peer connection per viewer, one stream per LABEL: two tablets on one lens open it once.
// See apps/studio-desktop/docs/camera.md.

import { type Lens, localLens } from "@studio/ui-eyes/camera";
import { type Frame, ICE, readFrame, relayUrl, sendFrame } from "./relay";

/** Reconnect delay after the socket drops, doubling to this — the app restarting is the usual cause. */
const RETRY_MS = 1000;
const RETRY_MAX_MS = 30_000;

/** Is this browser the machine's own window? Loopback is a secure context and nothing else is. */
export function canServeLenses(): boolean {
  const h = window.location.hostname;
  return (
    (h === "localhost" || h === "127.0.0.1" || h === "[::1]" || h === "::1") &&
    !!navigator.mediaDevices?.getUserMedia
  );
}

/** Open a lens at most once per label, since a second getUserMedia on one device may be refused. */
function lensCache(): (label: string) => Promise<Lens> {
  const open = new Map<string, Promise<Lens>>();
  return (label) => {
    const held = open.get(label);
    if (held) return held;
    const fresh = localLens(label);
    open.set(label, fresh);
    // An ended track is not a lens any more, and a refusal must not be cached as one either.
    void fresh.then((l) => {
      for (const t of l.stream?.getTracks() ?? [])
        t.addEventListener("ended", () => open.delete(label));
      if (!l.stream) open.delete(label);
    });
    return fresh;
  };
}

/** Answer every viewer this relay sends us, until the returned function is called. */
export function serveLenses(): () => void {
  let ws: WebSocket | null = null;
  let timer = 0;
  let wait = RETRY_MS;
  let stopped = false;
  const peers = new Map<string, RTCPeerConnection>();
  const lensFor = lensCache();

  const drop = (id: string) => {
    peers.get(id)?.close();
    peers.delete(id);
  };

  const answer = async (socket: WebSocket, id: string, label: string) => {
    drop(id);
    const lens = await lensFor(label);
    // A sentence and not a negotiation: an offer with no track never fires `ontrack` (docs/camera.md).
    const stream = lens.stream;
    if (!stream)
      return sendFrame(socket, {
        type: "problem",
        to: id,
        text: lens.problem ?? "this machine opened no camera",
      });
    const pc = new RTCPeerConnection(ICE);
    peers.set(id, pc);
    for (const t of stream.getTracks()) pc.addTrack(t, stream);
    pc.onicecandidate = (e) => {
      if (e.candidate)
        sendFrame(socket, {
          type: "ice",
          to: id,
          candidate: e.candidate.toJSON(),
        });
    };
    // A viewer that leaves without closing its socket is only noticed here.
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === "failed" || pc.connectionState === "closed")
        drop(id);
    };
    const sdp = await pc.createOffer();
    await pc.setLocalDescription(sdp);
    sendFrame(socket, {
      type: "offer",
      to: id,
      sdp: pc.localDescription ?? sdp,
      problem: lens.problem,
    });
  };

  const onFrame = (socket: WebSocket, f: Frame) => {
    if (f.type === "want" && f.from) {
      const id = f.from;
      // Carried rather than thrown: one viewer's refused camera must not close the socket.
      void answer(socket, id, f.label).catch((e: Error) =>
        sendFrame(socket, { type: "problem", to: id, text: e.message }),
      );
      return;
    }
    if (f.type === "answer" && f.from)
      void peers
        .get(f.from)
        ?.setRemoteDescription(f.sdp)
        .catch(() => undefined);
    if (f.type === "ice" && f.from)
      void peers
        .get(f.from)
        ?.addIceCandidate(f.candidate)
        .catch(() => undefined);
    if (f.type === "gone") drop(f.from);
  };

  const connect = () => {
    if (stopped) return;
    const socket = new WebSocket(relayUrl({ role: "host" }));
    ws = socket;
    socket.onopen = () => {
      wait = RETRY_MS;
    };
    socket.onmessage = (e) => {
      const f = readFrame(e.data);
      if (f) onFrame(socket, f);
    };
    socket.onclose = () => {
      for (const id of [...peers.keys()]) drop(id);
      if (stopped) return;
      timer = window.setTimeout(connect, wait);
      wait = Math.min(wait * 2, RETRY_MAX_MS);
    };
    // An error is followed by a close, which is where the retry lives.
    socket.onerror = () => undefined;
  };

  connect();
  return () => {
    stopped = true;
    clearTimeout(timer);
    for (const id of [...peers.keys()]) drop(id);
    ws?.close();
  };
}
