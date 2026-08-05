// Client-side WebRTC signaling for remote-microphone recording.
//
// The signaling messages travel over a WebSocket to the backend relay (see
// backend/src/rtc.ts); the audio itself is a direct peer-to-peer WebRTC stream
// between this device (the recorder) and the device at /remote (the mic). Once
// connected, the resulting MediaStream is handed to the normal recorder, so the
// waveform / highlights / upload pipeline is identical to a local mic.
import { api, BASE } from "./api";

export function rtcSocketUrl(
  role: "recorder" | "remote",
  ticket: string,
): string {
  // Single-origin: the backend is always on this same host, so the signaling
  // socket is too. It carries the service prefix like every other backend call —
  // the edge only routes /k7/rtc* here and strips the prefix before the server,
  // which is why the handler upstream still matches a bare /rtc.
  const ws = window.location.origin.replace(/^http/, "ws"); // http→ws, https→wss
  return `${ws}${BASE}/rtc?role=${role}&ticket=${encodeURIComponent(ticket)}`;
}

// A public STUN server is enough for same-network devices (and many NATs);
// symmetric-NAT cases would need a TURN server, which is out of scope here.
export const ICE_CONFIG: RTCConfiguration = {
  iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
};

export interface RemoteMicConnection {
  stream: MediaStream;
  /** Tear down the peer connection and signaling socket. */
  close: () => void;
}

// Recorder side: open signaling, ask the remote device to offer its mic, and
// resolve with the received audio stream. Rejects (with a user-facing message)
// if no remote is connected or the connection can't be established.
export async function connectRemoteMic(): Promise<RemoteMicConnection> {
  // The bridge AudioContext (see pc.ontrack) must be *running* or its output is
  // silence. Autoplay policy only lets us resume it from a user gesture, and by
  // the time ontrack fires we're long past the click — so create and resume it
  // now, as the first synchronous step, while the click that called us is still
  // the active gesture.
  let audioCtx: AudioContext | null = null;
  try {
    audioCtx = new AudioContext();
    audioCtx.resume().catch(() => {});
  } catch {
    audioCtx = null; // no Web Audio — we'll fall back to the raw remote stream
  }

  const { ticket } = await api.rtcTicket();
  const ws = new WebSocket(rtcSocketUrl("recorder", ticket));
  const pc = new RTCPeerConnection(ICE_CONFIG);

  // Nodes/elements kept referenced so they aren't garbage-collected mid-take.
  let bridgeNode: MediaStreamAudioSourceNode | null = null;
  // A muted sink element: some Chrome builds only run the WebRTC receive
  // pipeline for a remote track once it's attached to an HTMLMediaElement.
  let sink: HTMLAudioElement | null = null;

  const close = () => {
    try {
      bridgeNode?.disconnect();
    } catch {
      /* ignore */
    }
    try {
      audioCtx?.close();
    } catch {
      /* ignore */
    }
    if (sink) {
      sink.srcObject = null;
      sink = null;
    }
    try {
      pc.close();
    } catch {
      /* ignore */
    }
    try {
      ws.close();
    } catch {
      /* ignore */
    }
  };

  return new Promise<RemoteMicConnection>((resolve, reject) => {
    let settled = false;
    const fail = (msg: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      close();
      reject(new Error(msg));
    };
    const timer = window.setTimeout(
      () => fail("Timed out connecting to the remote microphone."),
      20_000,
    );

    pc.onicecandidate = (e) => {
      if (e.candidate)
        ws.send(JSON.stringify({ type: "ice", candidate: e.candidate }));
    };
    pc.ontrack = (e) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const remote = e.streams[0];
      // Attach the remote stream to a muted sink so Chrome definitely runs its
      // receive pipeline for the track.
      try {
        sink = new Audio();
        sink.muted = true;
        sink.autoplay = true;
        sink.srcObject = remote;
        sink.play().catch(() => {});
      } catch {
        /* sink is best-effort */
      }
      // MediaRecorder can't reliably record a *remote* WebRTC track directly —
      // it often yields empty/silent output even while the live meter (a Web
      // Audio analyser) shows signal. Re-route the remote audio through the
      // (already-running) local AudioContext into a fresh MediaStreamDestination
      // and hand the recorder that locally-generated stream, which records
      // reliably.
      if (audioCtx) {
        try {
          audioCtx.resume().catch(() => {});
          bridgeNode = audioCtx.createMediaStreamSource(remote);
          const dest = audioCtx.createMediaStreamDestination();
          bridgeNode.connect(dest);
          resolve({ stream: dest.stream, close });
          return;
        } catch {
          /* fall through to the raw stream below */
        }
      }
      // Web Audio unavailable — fall back to the raw remote stream.
      resolve({ stream: remote, close });
    };
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === "failed")
        fail("The connection to the remote microphone failed.");
    };

    ws.onmessage = async (ev) => {
      let msg: { type: string; [k: string]: unknown };
      try {
        msg = JSON.parse(ev.data);
      } catch {
        return;
      }
      switch (msg.type) {
        case "peer-present":
          if (!msg.present)
            return fail(
              "No remote device is connected. Open /remote on the other device first.",
            );
          ws.send(JSON.stringify({ type: "want" })); // ask the remote to make an offer
          break;
        case "peer-offline":
          fail("The remote device disconnected.");
          break;
        case "offer":
          await pc.setRemoteDescription(msg.sdp as RTCSessionDescriptionInit);
          await pc.setLocalDescription(await pc.createAnswer());
          ws.send(JSON.stringify({ type: "answer", sdp: pc.localDescription }));
          break;
        case "ice":
          if (msg.candidate)
            await pc
              .addIceCandidate(msg.candidate as RTCIceCandidateInit)
              .catch(() => {});
          break;
      }
    };
    ws.onerror = () => fail("Could not reach the signaling server.");
    ws.onclose = () =>
      fail("Signaling connection closed before the mic connected.");
  });
}
