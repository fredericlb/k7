// useOutputRecording.ts — the bar's record button on a project with no timeline: what OUT plays, through the hidden
// recorder the compile puts on the master run, and what RENDER draws, captured off an off-screen copy of the frame.
// Stopping files them — joined into one video when there are both — in the médiathèque's recordings.
// What reads wrong: the engine's take is cleared only once filed, so a refused save loses nothing.
// See packages/song/docs/outputRecording.md.

import type { EngineStore } from "@studio/engine-browser/store";
import { OUTPUT_RECORDER_ID } from "@studio/song-schema/moduleTypes";
import { useUnsavedGuard } from "@studio/ui-editor/unsaved";
import type { RealtimeDriver } from "@studio/ui-eyes/realtime";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { api } from "../api";
import { downloadBlob } from "../downloadBlob";
import { m } from "../paraglide/messages.js";
import { projectDir } from "../projectPaths";
import { openSpool, type Spool } from "../takeSpool";
import { extForMime, fileStamp, pickVideoMime } from "../videoTake";

/** The frame rate the picture is captured at: the viewport's own would be the compositor's, which follows the screen. */
const CAPTURE_FPS = 30;
/** How long the engine may take to close the take once told to stop. */
const TAKE_WAIT_MS = 10_000;

type Engine = {
  recorder(node: string, action: "record" | "clear", on?: boolean): void;
};

export interface OutputRecording {
  /** Whether this project records its output at all: its graph reaches OUT, or it draws a picture. */
  available: boolean;
  recording: boolean;
  /** The take is being filed. */
  filing: boolean;
  /** Mounted while true: the off-screen frame the picture is captured from. */
  drawPicture: boolean;
  /** What the off-screen frame hands over once it draws. */
  onPictureDriver: (driver: RealtimeDriver | null) => void;
  toggle: () => void;
}

/** The picture as one file, its duration written in, as a picture lane's take is. */
async function pictureOf(
  media: MediaRecorder,
  spool: Spool,
  from: number,
): Promise<Blob | null> {
  const stopped = new Promise<void>((ok) => {
    media.onstop = () => ok();
  });
  if (media.state !== "inactive") media.stop();
  await stopped;
  const blob = await spool.finish(media.mimeType || "video/webm");
  if (!blob.size) return null;
  const ms = performance.now() - from;
  return blob.type.includes("webm")
    ? import("fix-webm-duration")
        .then((x) => x.default(blob, ms, { logger: false }))
        .catch(() => blob)
    : blob;
}

export function useOutputRecording(opts: {
  store: EngineStore;
  engine: () => Engine | null;
  /** The workspace-relative project folder, where the picture is uploaded beside the takes. */
  project: string | null;
  /** Whether the project draws a picture through RENDER. */
  hasPicture: boolean;
  setStatus: (s: string) => void;
}): OutputRecording {
  const { store, engine, project, hasPicture, setStatus } = opts;
  // Present once the engine runs a document carrying the hidden recorder (packages/song/src/outputRecorder.ts).
  const hasAudio = useSyncExternalStore(store.subscribe, () =>
    Boolean(store.getSnapshot().recorders?.[OUTPUT_RECORDER_ID]),
  );
  const [recording, setRecording] = useState(false);
  const [filing, setFiling] = useState(false);
  const [drawPicture, setDrawPicture] = useState(false);
  useUnsavedGuard(recording || filing);
  const rec = useRef<{
    media: MediaRecorder | null;
    spool: Spool | null;
    takes: number;
    from: number;
  } | null>(null);
  const live = useRef({ engine, project, setStatus, hasAudio, hasPicture });
  live.current = { engine, project, setStatus, hasAudio, hasPicture };

  /** The off-screen frame is drawing: its canvas becomes the take's picture. */
  const onPictureDriver = useCallback((driver: RealtimeDriver | null) => {
    const take = rec.current;
    if (!driver || !take || take.media) return;
    const stream = driver.captureStream(CAPTURE_FPS);
    if (!stream) return live.current.setStatus(m["record.noPicture"]());
    const mimeType = pickVideoMime((t) => MediaRecorder.isTypeSupported(t));
    void openSpool(extForMime(mimeType || undefined)).then((spool) => {
      // Stopped while the spool was opening: nothing to record, nothing to recover.
      if (rec.current !== take) return spool.discard();
      const media = new MediaRecorder(stream, {
        ...(mimeType ? { mimeType } : {}),
        videoBitsPerSecond: 4_000_000,
      });
      media.ondataavailable = (e) => {
        if (e.data.size) spool.add(e.data);
      };
      take.media = media;
      take.spool = spool;
      media.start(1000);
    });
  }, []);

  /** The engine's take once it is closed: the newest one, past the count there was at the start. */
  const closedTake = useCallback(
    async (before: number): Promise<string | null> => {
      const until = Date.now() + TAKE_WAIT_MS;
      while (Date.now() < until) {
        const r = store.getSnapshot().recorders?.[OUTPUT_RECORDER_ID];
        if (r && !r.recording && r.takes.length > before)
          return r.takes[r.takes.length - 1]?.file ?? null;
        await new Promise((ok) => setTimeout(ok, 100));
      }
      return null;
    },
    [store],
  );

  const stop = useCallback(async () => {
    const take = rec.current;
    rec.current = null;
    setRecording(false);
    if (!take) return;
    const {
      engine: eng,
      project: dir,
      setStatus: say,
      hasAudio: audio,
    } = live.current;
    if (audio) eng()?.recorder(OUTPUT_RECORDER_ID, "record", false);
    setFiling(true);
    try {
      const picture =
        take.media && take.spool
          ? await pictureOf(take.media, take.spool, take.from)
          : null;
      setDrawPicture(false);
      const wav = audio ? await closedTake(take.takes) : null;
      if (!wav && !picture) return say(m["record.nothing"]());
      let video: string | null = null;
      if (picture) {
        const name = `output-${fileStamp(new Date())}${extForMime(picture.type || undefined)}`;
        const base = projectDir(dir);
        try {
          await api.uploadWithProgress(
            `${base ? `${base}/` : ""}clips`,
            name,
            picture,
          );
          video = `clips/${name}`;
        } catch (e) {
          // A picture cannot be played again: unfiled, it goes to the disk rather than nowhere.
          downloadBlob(picture, name);
          say(m["record.pictureKept"]({ message: (e as Error).message, name }));
        }
      }
      const line = `project record save ${JSON.stringify(wav ?? "none")}${video ? ` ${JSON.stringify(video)}` : ""}`;
      const { output, refused } = await api.command(line, { want: [] });
      const said = output.join("  ·  ");
      if (refused) return say(said);
      take.spool?.discard();
      // Filed, so the engine's take goes: its bytes are in the médiathèque now.
      if (wav) eng()?.recorder(OUTPUT_RECORDER_ID, "clear");
      say(said || m["record.saved"]());
    } catch (e) {
      say(m["record.failed"]({ message: (e as Error).message }));
    } finally {
      setDrawPicture(false);
      setFiling(false);
    }
  }, [closedTake]);

  const start = useCallback(() => {
    const { engine: eng, hasAudio: audio, hasPicture: picture } = live.current;
    rec.current = {
      media: null,
      spool: null,
      takes:
        store.getSnapshot().recorders?.[OUTPUT_RECORDER_ID]?.takes.length ?? 0,
      from: performance.now(),
    };
    if (audio) eng()?.recorder(OUTPUT_RECORDER_ID, "record", true);
    if (picture) setDrawPicture(true);
    setRecording(true);
  }, [store]);

  // A project closed mid-take still files what it has.
  useEffect(
    () => () => {
      if (rec.current) void stop();
    },
    [stop],
  );

  const toggle = useCallback(() => {
    if (filing) return;
    if (rec.current) void stop();
    else start();
  }, [filing, start, stop]);

  return {
    available: hasAudio || hasPicture,
    recording,
    filing,
    drawPicture,
    onPictureDriver,
    toggle,
  };
}
