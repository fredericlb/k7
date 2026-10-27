// CameraMode.tsx — the home page turned into a camera: the whole screen shows what the lens sees,
// and the same picture is offered to the account's projects as `remote:<name>` (./cameraMode.ts).
// It keeps the screen awake, since a phone on a stand that dims is a camera that stops.
// See packages/web-protocol/docs/cameras.md.

import { SwitchCamera, X } from "@frediverse/ui/icons";
import { useEffect, useRef, useState } from "react";
import { m } from "../paraglide/messages.js";
import {
  type CameraModeHandle,
  type CameraModeState,
  startCameraMode,
} from "./cameraMode";

/** What a phone or a webcam gives without being pushed: enough for a lane, light enough to send. */
const CONSTRAINTS: MediaTrackConstraints = {
  width: { ideal: 1280 },
  height: { ideal: 720 },
  frameRate: { ideal: 30 },
};

async function openLens(deviceId: string | null): Promise<MediaStream> {
  return navigator.mediaDevices.getUserMedia({
    video: deviceId
      ? { ...CONSTRAINTS, deviceId: { exact: deviceId } }
      : CONSTRAINTS,
    audio: false,
  });
}

/** Hold the screen awake while this is up, and take the lock again when the page comes back in front. */
function useWakeLock(): void {
  useEffect(() => {
    let lock: { release(): Promise<void> } | null = null;
    const wake = (
      navigator as Navigator & {
        wakeLock?: {
          request(t: "screen"): Promise<{ release(): Promise<void> }>;
        };
      }
    ).wakeLock;
    if (!wake) return;
    const take = () => {
      if (document.visibilityState === "visible")
        void wake.request("screen").then(
          (l) => {
            lock = l;
          },
          () => undefined,
        );
    };
    take();
    document.addEventListener("visibilitychange", take);
    return () => {
      document.removeEventListener("visibilitychange", take);
      void lock?.release().catch(() => undefined);
    };
  }, []);
}

export function CameraMode({
  name,
  onStop,
}: {
  name: string;
  onStop: () => void;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const handle = useRef<CameraModeHandle | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [state, setState] = useState<CameraModeState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lenses, setLenses] = useState<string[]>([]);
  useWakeLock();

  useEffect(() => {
    let alive = true;
    void openLens(null)
      .then(async (stream) => {
        if (!alive) {
          for (const t of stream.getTracks()) t.stop();
          return;
        }
        streamRef.current = stream;
        if (video.current) video.current.srcObject = stream;
        handle.current = startCameraMode({ name, stream, onState: setState });
        // Labels and ids are only complete once a permission was granted, which is now.
        const all = await navigator.mediaDevices.enumerateDevices();
        if (alive)
          setLenses(
            all.filter((d) => d.kind === "videoinput").map((d) => d.deviceId),
          );
      })
      .catch(
        (e: Error) =>
          alive && setError(m["cameraMode.noCamera"]({ error: e.message })),
      );
    return () => {
      alive = false;
      handle.current?.stop();
      handle.current = null;
      // A stream left running keeps the lamp lit until the tab closes.
      for (const t of streamRef.current?.getTracks() ?? []) t.stop();
      streamRef.current = null;
    };
  }, [name]);

  /** The next lens this device has — front to back on a phone. */
  const switchLens = async () => {
    const current = streamRef.current
      ?.getVideoTracks()[0]
      ?.getSettings().deviceId;
    const at = lenses.indexOf(current ?? "");
    const next = lenses[(at + 1) % lenses.length];
    if (!next || next === current) return;
    // The old one first: a phone often refuses two cameras open at once.
    for (const t of streamRef.current?.getTracks() ?? []) t.stop();
    try {
      const stream = await openLens(next);
      streamRef.current = stream;
      if (video.current) video.current.srcObject = stream;
      handle.current?.setStream(stream);
    } catch (e) {
      setError(m["cameraMode.noCamera"]({ error: (e as Error).message }));
    }
  };

  const status = error
    ? error
    : !state || state.status === "connecting"
      ? m["cameraMode.connecting"]()
      : state.status === "retrying"
        ? m["cameraMode.retrying"]({ error: state.error ?? "" })
        : m["cameraMode.on"]({
            name: state.name ?? name,
            count: state.viewers,
          });

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black text-white">
      <video
        ref={video}
        autoPlay
        muted
        playsInline
        className="min-h-0 flex-1 object-contain"
      />
      <div className="flex items-center gap-2 bg-black/70 px-3 py-2 text-sm">
        <span
          className={`h-2.5 w-2.5 shrink-0 rounded-full ${
            state?.status === "on" && !error ? "bg-red-500" : "bg-neutral-500"
          }`}
        />
        <p className="min-w-0 flex-1 truncate" title={status}>
          {status}
        </p>
        {lenses.length > 1 && (
          <button
            type="button"
            onClick={() => void switchLens()}
            className="flex items-center gap-1 rounded px-2 py-1 hover:bg-white/15"
          >
            <SwitchCamera className="h-4 w-4" />
            {m["cameraMode.switch"]()}
          </button>
        )}
        <button
          type="button"
          onClick={onStop}
          className="flex items-center gap-1 rounded px-2 py-1 hover:bg-white/15"
        >
          <X className="h-4 w-4" />
          {m["cameraMode.stop"]()}
        </button>
      </div>
    </div>
  );
}
