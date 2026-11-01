// useOutputRecording.ts — the bar's record button on a project with no timeline: what OUT plays, through the hidden
// recorder the compile puts on the master run, and what RENDER draws, captured off an off-screen copy of the frame.
// Stopping files them — joined into one video when there are both — in the médiathèque's recordings.
// What reads wrong: the engine's take is cleared only once filed, so a refused save loses nothing.
// See packages/song/docs/outputRecording.md.

import type { EngineStore } from "@studio/engine-browser/store";
import { mediaUrl } from "@studio/project-shell/fileApi";
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
import { openScratch, openSpool, type Spool } from "../takeSpool";
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

/** The picture with the engine's take joined under it, written to disk as it is made; null when this browser cannot. */
async function joinedTake(
  picture: Blob,
  wav: string,
  project: string | null,
): Promise<{ blob: Blob; discard: () => void } | null> {
  // Fetched at the stop, with the muxer: the one moment it is needed.
  const { canJoinTake, joinTake } = await import("@studio/ui-eyes/joinTake");
  if (!(await canJoinTake())) return null;
  const base = projectDir(project);
  // The take is in the project's `clips/`, its record directory, under the name the engine gave it.
  const name = wav.split(/[\\/]/).pop() ?? "";
  const scratch = await openScratch();
  try {
    await joinTake({
      picture,
      sound: mediaUrl(`${base ? `${base}/` : ""}clips/${name}`),
      writable: scratch.writable,
    });
    return { blob: await scratch.file("video/webm"), discard: scratch.discard };
  } catch {
    scratch.discard();
    return null;
  }
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
    /** The engine's recorder was started: with a picture, only once the picture's recorder has. */
    sounding: boolean;
  } | null>(null);
  const live = useRef({ engine, project, setStatus, hasAudio, hasPicture });
  live.current = { engine, project, setStatus, hasAudio, hasPicture };

  /** The sound starts with the picture, so the two begin together in the file they are joined into. */
  const startSound = useCallback((take: NonNullable<typeof rec.current>) => {
    const { engine: eng, hasAudio: audio } = live.current;
    take.from = performance.now();
    if (!audio || take.sounding) return;
    eng()?.recorder(OUTPUT_RECORDER_ID, "record", true);
    take.sounding = true;
  }, []);

  /** The off-screen frame is drawing: its canvas becomes the take's picture. */
  const onPictureDriver = useCallback(
    (driver: RealtimeDriver | null) => {
      const take = rec.current;
      if (!driver || !take || take.media) return;
      const stream = driver.captureStream(CAPTURE_FPS);
      if (!stream) {
        live.current.setStatus(m["record.noPicture"]());
        return startSound(take);
      }
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
        media.onstart = () => startSound(take);
        media.start(1000);
      });
    },
    [startSound],
  );

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
    if (take.sounding) eng()?.recorder(OUTPUT_RECORDER_ID, "record", false);
    setFiling(true);
    try {
      const picture =
        take.media && take.spool
          ? await pictureOf(take.media, take.spool, take.from)
          : null;
      setDrawPicture(false);
      const wav = audio && take.sounding ? await closedTake(take.takes) : null;
      if (!wav && !picture) return say(m["record.nothing"]());
      // Joined here, in the browser: the file service files one video, and needs no ffmpeg to.
      const joined =
        picture && wav ? await joinedTake(picture, wav, dir) : null;
      if (picture && wav && !joined) say(m["record.apart"]());
      const filed = joined?.blob ?? picture;
      let video: string | null = null;
      if (filed) {
        const name = `output-${fileStamp(new Date())}${extForMime(filed.type || undefined)}`;
        const base = projectDir(dir);
        try {
          await api.uploadWithProgress(
            `${base ? `${base}/` : ""}clips`,
            name,
            filed,
          );
          video = `clips/${name}`;
        } catch (e) {
          // A picture cannot be played again: unfiled, it goes to the disk rather than nowhere.
          downloadBlob(filed, name);
          say(m["record.pictureKept"]({ message: (e as Error).message, name }));
        }
      }
      // The take rides along only when it was not joined into the picture.
      const sound = joined ? null : wav;
      if (!sound && !video) return say(m["record.nothing"]());
      const line = `project record save ${JSON.stringify(sound ?? "none")}${video ? ` ${JSON.stringify(video)}` : ""}`;
      const { output, refused } = await api.command(line, { want: [] });
      joined?.discard();
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
    const take = {
      media: null,
      spool: null,
      takes:
        store.getSnapshot().recorders?.[OUTPUT_RECORDER_ID]?.takes.length ?? 0,
      from: performance.now(),
      sounding: false,
    };
    rec.current = take;
    // With a picture the sound waits for it (`startSound`); without one it starts now.
    if (live.current.hasPicture) setDrawPicture(true);
    else startSound(take);
    setRecording(true);
  }, [store, startSound]);

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
