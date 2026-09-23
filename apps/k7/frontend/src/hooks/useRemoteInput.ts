import { describeMicError } from "@k7/recorder";
import { useCallback, useEffect, useRef, useState } from "react";
import { micErrors } from "../recorderLabels";

// "mix" sums every channel to mono; a number picks one 0-based input channel.
export type ChannelSel = "mix" | number;

export interface RemoteInput {
  /** Available audio input devices (labels populate once mic permission is granted). */
  devices: MediaDeviceInfo[];
  deviceId: string | null;
  /** Channel count of the currently captured device (1 = mono). */
  channelCount: number;
  channel: ChannelSel;
  level: number; // 0..1 meter of the selected output
  /** The processed mono stream to send / record. Stable for the hook's life. */
  outputStream: MediaStream | null;
  error: string | null;
  setDevice: (id: string) => void;
  setChannel: (ch: ChannelSel) => void;
}

// Capture RAW and many-channelled so single channels survive, then fall back progressively.
async function acquireInput(deviceId?: string): Promise<MediaStream> {
  const id = deviceId ? { deviceId: { exact: deviceId } } : {};
  const raw = {
    echoCancellation: false,
    noiseSuppression: false,
    autoGainControl: false,
  };
  const attempts: MediaStreamConstraints[] = [
    { audio: { ...id, ...raw, channelCount: { ideal: 8 } } },
    { audio: { ...id, ...raw } },
    { audio: deviceId ? { deviceId: { exact: deviceId } } : true },
  ];
  let lastErr: unknown;
  for (const constraints of attempts) {
    try {
      return await navigator.mediaDevices.getUserMedia(constraints);
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr;
}

/** The remote device's input — device, channel, and a STABLE stream (../../../docs/audio.md). */
export function useRemoteInput(): RemoteInput {
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [deviceId, setDeviceId] = useState<string | null>(null);
  const [channelCount, setChannelCount] = useState(1);
  const [channel, setChannelState] = useState<ChannelSel>("mix");
  const [level, setLevel] = useState(0);
  const [outputStream, setOutputStream] = useState<MediaStream | null>(null);
  const [error, setError] = useState<string | null>(null);

  const ctxRef = useRef<AudioContext | null>(null);
  const rawRef = useRef<MediaStream | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const splitterRef = useRef<ChannelSplitterNode | null>(null);
  const gainRef = useRef<GainNode | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const rafRef = useRef(0);

  // Rewire UPSTREAM of the fixed gain bus, leaving the gain→destination→analyser tail alone.
  const route = useCallback((ch: ChannelSel, count: number) => {
    const ctx = ctxRef.current;
    const raw = rawRef.current;
    const gain = gainRef.current;
    if (!ctx || !raw || !gain) return;
    try {
      sourceRef.current?.disconnect();
    } catch {
      /* ignore */
    }
    try {
      splitterRef.current?.disconnect();
    } catch {
      /* ignore */
    }
    const source = ctx.createMediaStreamSource(raw);
    sourceRef.current = source;
    if (ch === "mix" || count <= 1) {
      source.connect(gain); // gain is mono → downmixes to a mono sum
    } else {
      const splitter = ctx.createChannelSplitter(Math.min(32, count));
      splitterRef.current = splitter;
      source.connect(splitter);
      splitter.connect(gain, Math.min(ch, count - 1), 0);
    }
  }, []);

  const openDevice = useCallback(
    async (id?: string) => {
      const stream = await acquireInput(id);
      // Release the previously-held device.
      rawRef.current?.getTracks().forEach((t) => t.stop());
      rawRef.current = stream;

      const track = stream.getAudioTracks()[0];
      const settings = track.getSettings();
      const count = Number(settings.channelCount) || 1;

      const ctx = ctxRef.current!;
      setChannelState("mix");
      setChannelCount(count);
      setDeviceId(settings.deviceId || id || null);
      route("mix", count);
      await ctx.resume().catch(() => {});

      // Labels are only exposed after permission — (re)enumerate now.
      const list = await navigator.mediaDevices.enumerateDevices();
      setDevices(list.filter((d) => d.kind === "audioinput"));
    },
    [route],
  );

  // Mount: build the fixed output graph, open the default device, run the meter.
  useEffect(() => {
    let cancelled = false;
    const ctx = new AudioContext();
    ctxRef.current = ctx;

    const gain = ctx.createGain();
    gain.channelCountMode = "explicit";
    gain.channelCount = 1; // force a mono output bus
    gainRef.current = gain;
    const dest = ctx.createMediaStreamDestination();
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 1024;
    analyserRef.current = analyser;
    gain.connect(dest);
    gain.connect(analyser);

    const buf = new Float32Array(analyser.fftSize);
    const tick = () => {
      analyser.getFloatTimeDomainData(buf);
      let sum = 0;
      for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
      setLevel(Math.min(1, Math.sqrt(sum / buf.length) * 4));
      rafRef.current = requestAnimationFrame(tick);
    };

    (async () => {
      try {
        await openDevice();
        if (cancelled) return;
        setOutputStream(dest.stream);
        rafRef.current = requestAnimationFrame(tick);
      } catch (err) {
        if (!cancelled) setError(describeMicError(err, micErrors()));
      }
    })();

    return () => {
      cancelled = true;
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rawRef.current?.getTracks().forEach((t) => t.stop());
      ctx.close().catch(() => {});
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const setDevice = useCallback(
    (id: string) => {
      setError(null);
      openDevice(id).catch((err) =>
        setError(describeMicError(err, micErrors())),
      );
    },
    [openDevice],
  );

  const setChannel = useCallback(
    (ch: ChannelSel) => {
      setChannelState(ch);
      route(ch, channelCount);
    },
    [route, channelCount],
  );

  return {
    devices,
    deviceId,
    channelCount,
    channel,
    level,
    outputStream,
    error,
    setDevice,
    setChannel,
  };
}
