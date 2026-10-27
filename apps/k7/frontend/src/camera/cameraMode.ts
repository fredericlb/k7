// cameraMode.ts — this device AS a camera: it holds the account's camera socket on k7's backend,
// listed under its device name, and answers each viewer that asks with a peer connection carrying
// the one stream it shows on screen. The server only relays signalling; the picture goes peer to
// peer. A socket that drops is dialled again with a fresh ticket. See packages/web-protocol/docs/cameras.md.

import {
  camerasSocketUrl,
  cameraTicket,
  sendCameraFrame,
} from "@studio/k7-plugins/video/camera/remoteCamera";
import {
  type CameraFrame,
  readCameraFrame,
} from "@studio/web-protocol/cameras";

/** Reconnect delay after the socket drops, doubling to the cap. */
const RETRY_MS = 1000;
const RETRY_MAX_MS = 30_000;

export interface CameraModeState {
  /** Connected and listed, or still dialling. */
  status: "connecting" | "on" | "retrying";
  /** The name the server listed it under — the one asked for, made unique within the account. */
  name: string | null;
  viewers: number;
  error: string | null;
}

export interface CameraModeHandle {
  /** Another lens, front to back: every viewer's track is replaced in place, no renegotiation. */
  setStream(stream: MediaStream): void;
  stop(): void;
}

export function startCameraMode(opts: {
  name: string;
  stream: MediaStream;
  onState: (s: CameraModeState) => void;
}): CameraModeHandle {
  let stream = opts.stream;
  let ws: WebSocket | null = null;
  let stopped = false;
  let timer = 0;
  let wait = RETRY_MS;
  let ice: RTCIceServer[] = [];
  const peers = new Map<string, RTCPeerConnection>();
  const state: CameraModeState = {
    status: "connecting",
    name: null,
    viewers: 0,
    error: null,
  };
  const emit = (patch: Partial<CameraModeState>) => {
    Object.assign(state, patch);
    opts.onState({ ...state });
  };

  const drop = (id: string) => {
    peers.get(id)?.close();
    peers.delete(id);
  };

  const answer = async (socket: WebSocket, id: string) => {
    drop(id);
    const pc = new RTCPeerConnection({ iceServers: ice });
    peers.set(id, pc);
    for (const t of stream.getVideoTracks()) pc.addTrack(t, stream);
    pc.onicecandidate = (e) => {
      if (e.candidate)
        sendCameraFrame(socket, {
          type: "ice",
          to: id,
          candidate: e.candidate.toJSON(),
        });
    };
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === "failed" || pc.connectionState === "closed")
        drop(id);
    };
    const sdp = await pc.createOffer();
    await pc.setLocalDescription(sdp);
    const local = pc.localDescription ?? sdp;
    sendCameraFrame(socket, {
      type: "offer",
      to: id,
      sdp: { type: local.type, sdp: local.sdp },
    });
  };

  const onFrame = (socket: WebSocket, f: CameraFrame) => {
    if (f.type === "hello")
      return emit({ status: "on", name: f.name, error: null });
    if (f.type === "viewers") return emit({ viewers: f.count });
    if (f.type === "want" && f.from) {
      const id = f.from;
      // Carried rather than thrown: one viewer's failed negotiation must not close the socket.
      void answer(socket, id).catch((e: Error) =>
        sendCameraFrame(socket, { type: "problem", to: id, text: e.message }),
      );
      return;
    }
    if (f.type === "answer" && f.from)
      void peers
        .get(f.from)
        ?.setRemoteDescription(f.sdp as RTCSessionDescriptionInit)
        .catch(() => undefined);
    if (f.type === "ice" && f.from)
      void peers
        .get(f.from)
        ?.addIceCandidate(f.candidate)
        .catch(() => undefined);
    if (f.type === "gone") drop(f.from);
  };

  const retry = (error: string | null) => {
    if (stopped) return;
    emit({ status: "retrying", error, viewers: 0 });
    timer = window.setTimeout(connect, wait);
    wait = Math.min(wait * 2, RETRY_MAX_MS);
  };

  const connect = async () => {
    if (stopped) return;
    let ticket: string;
    try {
      const t = await cameraTicket();
      ticket = t.ticket;
      ice = t.iceServers as RTCIceServer[];
    } catch (e) {
      return retry((e as Error).message);
    }
    if (stopped) return;
    const socket = new WebSocket(
      camerasSocketUrl({ ticket, role: "camera", name: opts.name }),
    );
    ws = socket;
    socket.onopen = () => {
      wait = RETRY_MS;
    };
    socket.onmessage = (e) => {
      if (socket !== ws) return;
      const f = readCameraFrame(e.data);
      if (f) onFrame(socket, f);
    };
    socket.onclose = () => {
      if (socket !== ws) return;
      ws = null;
      for (const id of [...peers.keys()]) drop(id);
      retry(null);
    };
    // An error is followed by a close, which is where the retry lives.
    socket.onerror = () => undefined;
  };

  void connect();

  return {
    setStream(next) {
      stream = next;
      const track = next.getVideoTracks()[0] ?? null;
      for (const pc of peers.values())
        for (const s of pc.getSenders())
          if (s.track?.kind === "video" || s.track === null)
            void s.replaceTrack(track).catch(() => undefined);
    },
    stop() {
      stopped = true;
      clearTimeout(timer);
      for (const id of [...peers.keys()]) drop(id);
      const closing = ws;
      ws = null;
      closing?.close();
    },
  };
}
