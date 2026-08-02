import { Card } from "@frediverse/ui/card";
import { Label } from "@frediverse/ui/label";
import { useEffect, useRef, useState } from "react";
import { api } from "../api";
import { useRemoteInput } from "../hooks/useRemoteInput";
import { ICE_CONFIG, rtcSocketUrl } from "../rtc";

type Status =
  | "starting" // acquiring the microphone
  | "connecting" // opening / reopening the signaling socket
  | "waiting" // registered with the server, no recorder yet
  | "streaming" // sending audio to the recorder
  | "replaced" // another device took over the remote role
  | "error";

// The /remote device: it captures this device's microphone and streams it over
// WebRTC to the recorder device on demand. The audio input device and (for
// multi-channel interfaces) the input channel can be chosen here; the choice is
// applied live without interrupting an in-progress stream. Exactly one remote is
// active per user — opening /remote elsewhere takes over (this one shows
// "replaced").
export function RemoteMicView() {
  const input = useRemoteInput();
  const [status, setStatus] = useState<Status>("starting");

  const wsRef = useRef<WebSocket | null>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  // Latest output track, read by makeOffer so it always sends the current one.
  const streamRef = useRef<MediaStream | null>(null);
  streamRef.current = input.outputStream;

  // Signaling starts once the microphone graph is ready (output stream exists),
  // and keeps itself connected: the socket is reopened automatically if it drops
  // (dev server restart, network blip, proxy idle timeout), so the remote stays
  // registered and discoverable instead of silently going dead.
  useEffect(() => {
    if (!input.outputStream) return;
    let stopped = false; // component unmounting — don't reconnect
    let replaced = false; // taken over by another device — don't reconnect
    let retryTimer: number | undefined;

    const teardownPc = () => {
      pcRef.current?.close();
      pcRef.current = null;
    };

    // The recorder asked us to start: create the peer connection, attach the
    // processed output track, and send an offer.
    const makeOffer = async (ws: WebSocket) => {
      const stream = streamRef.current;
      if (!stream) return;
      teardownPc();
      const pc = new RTCPeerConnection(ICE_CONFIG);
      pcRef.current = pc;
      stream.getAudioTracks().forEach((t) => pc.addTrack(t, stream));
      pc.onicecandidate = (e) => {
        if (e.candidate)
          ws.send(JSON.stringify({ type: "ice", candidate: e.candidate }));
      };
      pc.onconnectionstatechange = () => {
        if (stopped) return;
        if (pc.connectionState === "connected") setStatus("streaming");
        else if (
          pc.connectionState === "failed" ||
          pc.connectionState === "disconnected" ||
          pc.connectionState === "closed"
        ) {
          teardownPc();
          if (!stopped && !replaced) setStatus("waiting");
        }
      };
      await pc.setLocalDescription(await pc.createOffer());
      ws.send(JSON.stringify({ type: "offer", sdp: pc.localDescription }));
    };

    const scheduleReconnect = () => {
      if (stopped || replaced) return;
      setStatus("connecting");
      retryTimer = window.setTimeout(connect, 1500);
    };

    const connect = async () => {
      if (stopped || replaced) return;
      setStatus("connecting");
      let ticket: string;
      try {
        ({ ticket } = await api.rtcTicket());
      } catch {
        return scheduleReconnect(); // couldn't even get a ticket — back off
      }
      if (stopped || replaced) return;

      const ws = new WebSocket(rtcSocketUrl("remote", ticket));
      wsRef.current = ws;

      ws.onopen = () => {
        if (!stopped && !replaced) setStatus("waiting");
      };
      ws.onmessage = async (ev) => {
        let msg: { type: string; [k: string]: unknown };
        try {
          msg = JSON.parse(ev.data);
        } catch {
          return;
        }
        switch (msg.type) {
          case "want": // recorder wants to connect → offer our mic
            await makeOffer(ws);
            break;
          case "answer":
            await pcRef.current
              ?.setRemoteDescription(msg.sdp as RTCSessionDescriptionInit)
              .catch(() => {});
            break;
          case "ice":
            if (msg.candidate)
              await pcRef.current
                ?.addIceCandidate(msg.candidate as RTCIceCandidateInit)
                .catch(() => {});
            break;
          case "peer-offline": // recorder left → wait for the next one
            teardownPc();
            if (!stopped && !replaced) setStatus("waiting");
            break;
          case "replaced": // another device took over the remote role
            replaced = true;
            setStatus("replaced");
            break;
        }
      };
      ws.onclose = () => {
        wsRef.current = null;
        teardownPc();
        // Reconnect unless we're unmounting or were deliberately replaced.
        scheduleReconnect();
      };
      // onerror is followed by onclose, which handles the reconnect.
    };

    connect();

    return () => {
      stopped = true;
      if (retryTimer) clearTimeout(retryTimer);
      pcRef.current?.close();
      pcRef.current = null;
      wsRef.current?.close();
      wsRef.current = null;
    };
  }, [input.outputStream]);

  if (input.error) {
    return (
      <Card className="remote-mic">
        <h2>🎙 Remote microphone</h2>
        <p className="error">🎤 {input.error}</p>
      </Card>
    );
  }

  const view: Status = input.outputStream ? status : "starting";

  return (
    <Card className="remote-mic">
      <h2>🎙 Remote microphone</h2>

      {view === "replaced" ? (
        <p className="muted">
          This device was replaced by another remote microphone. Reload this
          page to take over again.
        </p>
      ) : (
        <>
          <p className="muted">
            {view === "starting" &&
              "Starting the microphone… allow access if prompted."}
            {view === "connecting" && "Connecting to the recording server…"}
            {view === "waiting" &&
              "Ready. Keep this page open — start a remote session on your other device to begin recording."}
            {view === "streaming" &&
              "● Streaming this microphone to the recorder."}
          </p>

          <div className="remote-inputs">
            <div className="remote-field">
              <Label htmlFor="remote-device">Input device</Label>
              <select
                id="remote-device"
                value={input.deviceId ?? ""}
                disabled={!input.outputStream}
                onChange={(e) => input.setDevice(e.target.value)}
              >
                {input.devices.length === 0 && (
                  <option value="">Default microphone</option>
                )}
                {input.devices.map((d, i) => (
                  <option key={d.deviceId || i} value={d.deviceId}>
                    {d.label || `Input ${i + 1}`}
                  </option>
                ))}
              </select>
            </div>

            {input.channelCount > 1 && (
              <div className="remote-field">
                <Label htmlFor="remote-channel">Input channel</Label>
                <select
                  id="remote-channel"
                  value={
                    input.channel === "mix" ? "mix" : String(input.channel)
                  }
                  onChange={(e) =>
                    input.setChannel(
                      e.target.value === "mix" ? "mix" : Number(e.target.value),
                    )
                  }
                >
                  <option value="mix">
                    Mix ({input.channelCount} ch → mono)
                  </option>
                  {Array.from({ length: input.channelCount }, (_, i) => (
                    <option key={i} value={i}>
                      Channel {i + 1}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>

          <div className="meter" aria-hidden>
            <div
              className="meter-fill"
              style={{
                width: `${Math.min(100, input.level * 100)}%`,
                background:
                  view === "streaming" ? "var(--red)" : "var(--accent)",
              }}
            />
          </div>

          <p className="muted small">
            {view === "streaming"
              ? "Recording controls (waveform, highlights, stop) are on the other device."
              : "This device only captures audio — no recording happens here."}
          </p>
        </>
      )}
    </Card>
  );
}
