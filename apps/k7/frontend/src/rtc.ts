// Client-side WebRTC signaling for remote-microphone recording.
//
// The signaling messages travel over a WebSocket to the backend relay (see
// backend/src/rtc.ts); the audio itself is a direct peer-to-peer WebRTC stream
// between this device (the recorder) and the device at /remote (the mic). Once
// connected, the resulting MediaStream is handed to the normal recorder, so the
// waveform / highlights / upload pipeline is identical to a local mic.
import { api, BASE } from "./api";
import { m } from "./paraglide/messages.js";

export function rtcSocketUrl(
  role: "recorder" | "remote",
  ticket: string,
): string {
  // Same host, and the service prefix like every other call — see ../../docs/routing.md.
  const ws = window.location.origin.replace(/^http/, "ws"); // http→ws, https→wss
  return `${ws}${BASE}/rtc?role=${role}&ticket=${encodeURIComponent(ticket)}`;
}

// A public STUN server is enough here; a symmetric NAT would need TURN, which is out of scope.
export const ICE_CONFIG: RTCConfiguration = {
  iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
};

export interface RemoteMicConnection {
  stream: MediaStream;
  /** Tear down the peer connection and signaling socket. */
  close: () => void;
}

// Recorder side: open signaling, ask for the remote mic, resolve with its stream.
export async function connectRemoteMic(): Promise<RemoteMicConnection> {
  // FIRST, while the click is still the active gesture: the bridge context — ../../docs/audio.md.
  let audioCtx: AudioContext | null = null;
  try {
    audioCtx = new AudioContext();
    audioCtx.resume().catch(() => {});
  } catch {
    audioCtx = null; // no Web Audio — we'll fall back to the raw remote stream
  }

  let ticket: string;
  try {
    ({ ticket } = await api.rtcTicket());
  } catch (err) {
    // Nothing else holds the context yet: closed here, or every failed attempt leaks one against the browser's cap.
    audioCtx?.close().catch(() => {});
    throw err;
  }
  const ws = new WebSocket(rtcSocketUrl("recorder", ticket));
  const pc = new RTCPeerConnection(ICE_CONFIG);

  // Nodes/elements kept referenced so they aren't garbage-collected mid-take.
  let bridgeNode: MediaStreamAudioSourceNode | null = null;
  // A muted sink: some Chrome builds only run their receive pipeline for an attached track.
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
    // The stream handed to the recorder, once there is one: a failure AFTER that must reach it.
    let live: MediaStream | null = null;
    const fail = (msg: string) => {
      if (settled) {
        // Too late to reject — the take has started. An `ended` on its tracks is what the recorder listens for (useRecorder.ts).
        for (const t of live?.getAudioTracks() ?? [])
          t.dispatchEvent(new Event("ended"));
        live = null;
        return;
      }
      settled = true;
      clearTimeout(timer);
      close();
      reject(new Error(msg));
    };
    const timer = window.setTimeout(() => fail(m["rtc.timeout"]()), 20_000);

    pc.onicecandidate = (e) => {
      if (e.candidate)
        ws.send(JSON.stringify({ type: "ice", candidate: e.candidate }));
    };
    pc.ontrack = (e) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const remote = e.streams[0];
      // Attach to that sink, so Chrome definitely runs its receive pipeline.
      try {
        sink = new Audio();
        sink.muted = true;
        sink.autoplay = true;
        sink.srcObject = remote;
        sink.play().catch(() => {});
      } catch {
        /* sink is best-effort */
      }
      // MediaRecorder cannot reliably record a REMOTE track, so bridge it — ../../docs/audio.md.
      if (audioCtx) {
        try {
          audioCtx.resume().catch(() => {});
          bridgeNode = audioCtx.createMediaStreamSource(remote);
          const dest = audioCtx.createMediaStreamDestination();
          bridgeNode.connect(dest);
          live = dest.stream;
          resolve({ stream: dest.stream, close });
          return;
        } catch {
          /* fall through to the raw stream below */
        }
      }
      // Web Audio unavailable — fall back to the raw remote stream.
      live = remote;
      resolve({ stream: remote, close });
    };
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === "failed") fail(m["rtc.failed"]());
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
          if (!msg.present) return fail(m["rtc.noDevice"]());
          ws.send(JSON.stringify({ type: "want" })); // ask the remote to make an offer
          break;
        case "peer-offline":
          fail(m["rtc.disconnected"]());
          break;
        case "offer":
          try {
            await pc.setRemoteDescription(msg.sdp as RTCSessionDescriptionInit);
            await pc.setLocalDescription(await pc.createAnswer());
            ws.send(
              JSON.stringify({ type: "answer", sdp: pc.localDescription }),
            );
          } catch {
            // A refused offer is a failed connection now, not a 20-second wait for the timeout.
            fail(m["rtc.failed"]());
          }
          break;
        case "ice":
          if (msg.candidate)
            await pc
              .addIceCandidate(msg.candidate as RTCIceCandidateInit)
              .catch(() => {});
          break;
      }
    };
    ws.onerror = () => fail(m["rtc.noSignaling"]());
    ws.onclose = () => fail(m["rtc.signalingClosed"]());
  });
}
