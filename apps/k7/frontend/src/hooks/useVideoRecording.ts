// useVideoRecording.ts — a picture lane's own recording. Armed lane + record + play opens the
// lane's INPUT (a webcam, the only one there is for now) and captures it; on stop the take lands in
// `clips/` and is placed where the playhead was. Browser-side, top to bottom, for the reason the
// lens itself is: the engine never hears about a camera (packages/song/docs/camera.md).
// The MIDI capture beside it is the same shape — see useMidiRecording.ts.

import type { EngineStore } from "@studio/engine-browser/store";
import { useUnsavedGuard } from "@studio/ui-editor/unsaved";
import { cameraConstraint, matchCamera } from "@studio/ui-eyes/camera";
import fixWebmDuration from "fix-webm-duration";
import { useCallback, useEffect, useRef, useState } from "react";
import { fileClip } from "../clipFiles";
import { downloadBlob } from "../downloadBlob";
import { m } from "../paraglide/messages.js";
import { dropSpool, openSpool, recoverSpools, type Spool } from "../takeSpool";
import {
  extForMime,
  fileStamp,
  pickVideoMime,
  placeLine,
  takeId,
} from "../videoTake";

export function useVideoRecording(opts: {
  store: EngineStore;
  /** The workspace-relative project folder, for the two writes — as `useTimelineDrop` takes it. */
  project: string;
  /** The picture lane armed, or null. One at a time: there is one camera and one take. */
  armed: string | null;
  /** The label that lane names, if it names one — `""` and absent both mean the machine's default. */
  camera?: string;
  recordEnabled: boolean;
  playing: boolean;
  runCommand: (line: string) => Promise<void>;
  setStatus: (s: string) => void;
  bumpReload: () => void;
}): { recording: boolean } {
  const {
    store,
    project,
    armed,
    camera,
    recordEnabled,
    playing,
    runCommand,
    setStatus,
    bumpReload,
  } = opts;

  const [recording, setRecording] = useState(false);
  // Guards the effect, which fires on every dependency change while one capture is already running.
  const activeRef = useRef(false);
  const recRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  // Takes stopped but not yet filed: the page must not be left while one is, or it is lost with the tab.
  const [filing, setFiling] = useState(0);
  useUnsavedGuard(recording || filing > 0);
  // Read inside the async start, which must not re-bind the whole effect on a status change.
  const live = useRef({ store, project, runCommand, setStatus, bumpReload });
  live.current = { store, project, runCommand, setStatus, bumpReload };

  /** Let the lens go. A stream left running keeps the indicator lit and the device held until the tab closes. */
  const release = useCallback(() => {
    for (const t of streamRef.current?.getTracks() ?? []) t.stop();
    streamRef.current = null;
    recRef.current = null;
  }, []);

  const finish = useCallback(
    async (
      blob: Blob,
      take: { lane: string; at: number; from: number },
      spool: Spool,
    ) => {
      const { project: dir, runCommand: run, setStatus: say } = live.current;
      const seconds = (performance.now() - take.from) / 1000;
      let bytes: Blob = blob;
      // MediaRecorder leaves the duration out of a WebM, and an unseekable file is one the frame cannot scrub.
      if (blob.type.includes("webm"))
        bytes = await fixWebmDuration(blob, seconds * 1000, {
          logger: false,
        }).catch(() => blob);
      const id = takeId(take.lane, fileStamp(new Date()));
      const upload = `${id}${extForMime(blob.type || undefined)}`;
      let filedId = id;
      try {
        filedId = (
          await fileClip(dir, { id, upload }, await bytes.arrayBuffer())
        ).id;
      } catch (e) {
        // A camera take cannot be played again: unfiled, it goes to the disk rather than nowhere (../../docs/audit.md).
        downloadBlob(bytes, upload);
        spool.discard();
        say(
          `take not filed: ${(e as Error).message} — saved to your downloads as ${upload}, drop it on the lane to file it`,
        );
        return;
      }
      spool.discard();
      live.current.bumpReload();
      await run(placeLine(take.lane, filedId, take.at, seconds));
    },
    [],
  );

  const begin = useCallback(
    async (lane: string, label: string) => {
      const { setStatus: say } = live.current;
      let stream: MediaStream;
      try {
        // The label is matched against what this machine enumerates, exactly as the lens itself is.
        const devices = await navigator.mediaDevices.enumerateDevices();
        const m = matchCamera(label, devices);
        if (m.problem) say(m.problem);
        stream = await navigator.mediaDevices.getUserMedia(cameraConstraint(m));
      } catch (e) {
        say(`no camera to record: ${(e as Error).message}`);
        activeRef.current = false;
        setRecording(false);
        return;
      }
      // Stopped while the camera was opening: a permission prompt outlives a short take.
      if (!activeRef.current) {
        for (const t of stream.getTracks()) t.stop();
        return;
      }
      streamRef.current = stream;
      const mimeType = pickVideoMime((m) => MediaRecorder.isTypeSupported(m));
      // Chunks go to disk as they come (../takeSpool.ts): an hour of camera is gigabytes the tab need not hold.
      const spool = await openSpool(extForMime(mimeType || undefined));
      // This take's own state, in this closure: a stop and a quick re-record must not share a buffer or a stream.
      let take: { lane: string; at: number; from: number } | null = null;
      const rec = new MediaRecorder(stream, {
        ...(mimeType ? { mimeType } : {}),
        // Capped, so an hour is a known size rather than whatever the encoder fancies.
        videoBitsPerSecond: 4_000_000,
      });
      recRef.current = rec;
      rec.ondataavailable = (e) => {
        if (e.data.size) spool.add(e.data);
      };
      rec.onstop = () => {
        for (const t of stream.getTracks()) t.stop();
        if (streamRef.current === stream) streamRef.current = null;
        if (recRef.current === rec) recRef.current = null;
        setRecording(false);
        const landed = take;
        if (!landed) return spool.discard();
        setFiling((n) => n + 1);
        void spool
          .finish(rec.mimeType || "video/webm")
          .then((blob) => {
            // A take with no bytes is a camera that never delivered a frame — nothing to file and nothing to place.
            if (blob.size) return finish(blob, landed, spool);
            spool.discard();
            live.current.setStatus(m["status.video.emptyTake"]());
          })
          .finally(() => setFiling((n) => n - 1));
      };
      rec.onstart = () => {
        // The playhead at the moment the CAMERA started, not when the key was pressed: opening a lens takes time.
        take = {
          lane,
          at: live.current.store.getSnapshot().playhead,
          from: performance.now(),
        };
        setRecording(true);
      };
      rec.start(1000); // a chunk a second, each on disk as it comes
    },
    [finish, release],
  );

  const rolling = recordEnabled && playing && !!armed;
  useEffect(() => {
    if (rolling && !activeRef.current && armed) {
      activeRef.current = true;
      void begin(armed, camera ?? "");
    } else if (!rolling && activeRef.current) {
      activeRef.current = false;
      const rec = recRef.current;
      // `onstop` does the filing; with no recorder yet the lens is simply let go.
      if (rec && rec.state !== "inactive") rec.stop();
      else {
        release();
        setRecording(false);
      }
    }
  }, [rolling, armed, camera, begin, release]);

  // Leaving the app mid-take must not leave the lamp on.
  useEffect(() => release, [release]);

  // What a crash or a closed tab left mid-take is on disk: handed back once, as a download, then removed.
  useEffect(() => {
    void recoverSpools().then(async (left) => {
      for (const { name, blob } of left) {
        const file = name.replace(/^k7-take-/, "recovered-take-");
        downloadBlob(blob, file);
        await dropSpool(name);
        live.current.setStatus(m["status.video.recovered"]({ file }));
      }
    });
  }, []);

  return { recording };
}
