import { Card } from "@frediverse/ui/card";
import { Circle, Mic, MicOff } from "@frediverse/ui/icons";
import { Label } from "@frediverse/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@frediverse/ui/select";
import { useEffect, useRef, useState } from "react";
import { api } from "../api";
import { useRemoteInput } from "../hooks/useRemoteInput";
import { m } from "../paraglide/messages.js";
import { ICE_CONFIG, rtcSocketUrl } from "../rtc";

type Status =
  | "starting" // acquiring the microphone
  | "connecting" // opening / reopening the signaling socket
  | "waiting" // registered with the server, no recorder yet
  | "streaming" // sending audio to the recorder
  | "replaced" // another device took over the remote role
  | "error";

// The /remote device: this machine's mic, streamed on demand — ../../docs/audio.md.
// Radix allows no empty value: the browser's default input stands for "no device chosen".
const DEFAULT_DEVICE = "__default__";

export function RemoteMicView() {
  const input = useRemoteInput();
  const [status, setStatus] = useState<Status>("starting");

  const wsRef = useRef<WebSocket | null>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  // Latest output track, read by makeOffer so it always sends the current one.
  const streamRef = useRef<MediaStream | null>(null);
  streamRef.current = input.outputStream;

  // Signaling reopens itself when it drops, so the remote never goes silently undiscoverable.
  useEffect(() => {
    if (!input.outputStream) return;
    let stopped = false; // component unmounting — don't reconnect
    let replaced = false; // taken over by another device — don't reconnect
    let retryTimer: number | undefined;

    const teardownPc = () => {
      pcRef.current?.close();
      pcRef.current = null;
    };

    // The recorder asked: a peer connection, the processed track on it, and an offer.
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
        <h2>
          <Mic className="size-5" /> {m["remote.title"]()}
        </h2>
        <p className="error">
          <MicOff className="size-3.5" /> {input.error}
        </p>
      </Card>
    );
  }

  const view: Status = input.outputStream ? status : "starting";

  return (
    <Card className="remote-mic">
      <h2>
        <Mic className="size-5" /> {m["remote.title"]()}
      </h2>

      {view === "replaced" ? (
        <p className="muted">{m["remote.replaced"]()}</p>
      ) : (
        <>
          <p className="muted">
            {view === "starting" && m["remote.starting"]()}
            {view === "connecting" && m["remote.connecting"]()}
            {view === "waiting" && m["remote.waiting"]()}
            {view === "streaming" && (
              <>
                <Circle className="size-2.5 fill-current text-destructive" />{" "}
                {m["remote.streaming"]()}
              </>
            )}
          </p>

          <div className="remote-inputs">
            <div className="remote-field">
              <Label htmlFor="remote-device">{m["remote.device"]()}</Label>
              <Select
                value={input.deviceId || DEFAULT_DEVICE}
                disabled={!input.outputStream}
                onValueChange={(v) =>
                  input.setDevice(v === DEFAULT_DEVICE ? "" : v)
                }
              >
                <SelectTrigger id="remote-device">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="rehearsal-root">
                  {input.devices.length === 0 && (
                    <SelectItem value={DEFAULT_DEVICE}>
                      {m["remote.defaultMic"]()}
                    </SelectItem>
                  )}
                  {input.devices.map((d, i) => (
                    <SelectItem
                      key={d.deviceId || i}
                      value={d.deviceId || DEFAULT_DEVICE}
                    >
                      {d.label || m["remote.inputN"]({ n: i + 1 })}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {input.channelCount > 1 && (
              <div className="remote-field">
                <Label htmlFor="remote-channel">{m["remote.channel"]()}</Label>
                <Select
                  value={
                    input.channel === "mix" ? "mix" : String(input.channel)
                  }
                  onValueChange={(v) =>
                    input.setChannel(v === "mix" ? "mix" : Number(v))
                  }
                >
                  <SelectTrigger id="remote-channel">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="rehearsal-root">
                    <SelectItem value="mix">
                      {m["remote.mix"]({ n: input.channelCount })}
                    </SelectItem>
                    {Array.from({ length: input.channelCount }, (_, i) => (
                      // biome-ignore lint/suspicious/noArrayIndexKey: a channel IS its index
                      <SelectItem key={i} value={String(i)}>
                        {m["remote.channelN"]({ n: i + 1 })}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
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
              ? m["remote.controlsElsewhere"]()
              : m["remote.captureOnly"]()}
          </p>
        </>
      )}
    </Card>
  );
}
