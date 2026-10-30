// RehearsalRecording.tsx — the running take, held ABOVE the host's routes so it survives moving
// between pages: the start dialog, the rehearsal chain's hidden bench and the recorder's bar.
// It holds nothing until a take starts; what it draws then is a lazy chunk (RecordingOverlay).

import type { ComponentProps } from "react";
import {
  lazy,
  type ReactNode,
  Suspense,
  useCallback,
  useMemo,
  useState,
} from "react";
import { api } from "../api";
import { fmtStamp } from "../format";
import { useRehearsalNav } from "../host";
import { m } from "../paraglide/messages.js";
import { micErrors } from "../recorderLabels";
import type { Session } from "../types";
import {
  RecordingContext,
  type RecordingCtx,
  type SessionSource,
} from "./context";

const RecordingOverlay = lazy(() => import("./RecordingOverlay"));

type SaveResult = Parameters<
  ComponentProps<typeof RecordingOverlay>["onSave"]
>[0];

/** Every track of a stream nothing will record — what turns the microphone light off. */
function stopTracks(stream: MediaStream): void {
  for (const t of stream.getTracks()) t.stop();
}

export function RehearsalRecording({ children }: { children: ReactNode }) {
  const { go } = useRehearsalNav();
  const [recording, setRecording] = useState<RecordingCtx | null>(null);
  const [sourceOpen, setSourceOpen] = useState(false);
  // What the session's button menu picked, read by the start dialog.
  const [source, setSource] = useState<SessionSource>("local");
  // The rehearsal chain's hidden bench: mounted from the session's start to the end of its take.
  const [chainOpen, setChainOpen] = useState(false);
  const [changed, setChanged] = useState(0);
  const [tags, setTags] = useState<string[]>([]);
  const bump = useCallback(() => setChanged((n) => n + 1), []);

  // The tags the recorder suggests, read once per take: the pages that list moments are not mounted here.
  const loadTags = useCallback(() => {
    api
      .listMoments()
      .then((ms) => setTags([...new Set(ms.flatMap((x) => x.tags))].sort()))
      .catch(() => {});
  }, []);

  const start = useCallback(
    async (from: SessionSource) => {
      // Only one recording at a time: the running one is in the bar.
      if (recording) throw new Error(m["rec.finishFirst"]());
      setSource(from);
      setSourceOpen(true);
    },
    [recording],
  );

  // Create the session once there is a stream; the recorder is the bar, so the page stays as it is.
  const begin = useCallback(
    async (
      stream: MediaStream,
      release?: { close: () => void },
      chain?: boolean,
    ) => {
      const s = await api.createSession();
      bump();
      loadTags();
      setRecording({ session: s, stream, release, chain });
      setSourceOpen(false);
    },
    [bump, loadTags],
  );

  const resume = useCallback(
    async (session: Session) => {
      if (recording) throw new Error(m["rec.finishFirst"]());
      const { acquireMicrophone, describeMicError } = await import(
        "@studio/recorder"
      );
      let stream: MediaStream;
      try {
        stream = await acquireMicrophone();
      } catch (err) {
        throw new Error(describeMicError(err, micErrors()));
      }
      let fresh: Session;
      let baseEnvelope: Awaited<ReturnType<typeof api.getEnvelope>> | undefined;
      try {
        // Refetch, so the offset is the latest saved duration and the envelope the stored one.
        fresh = await api.getSession(session.id);
        baseEnvelope = fresh.hasRecording
          ? await api.getEnvelope(session.id).catch(() => undefined)
          : undefined;
      } catch (err) {
        stopTracks(stream);
        throw err;
      }
      loadTags();
      setRecording({
        session: fresh,
        stream,
        resumeFrom: fresh.duration,
        baseEnvelope,
      });
    },
    [recording, loadTags],
  );

  const save = async (
    result: SaveResult,
    onProgress?: (fraction: number) => void,
  ) => {
    if (!recording) return;
    const { session, resumeFrom } = recording;
    const args = [
      session.id,
      result.blob,
      result.envelope,
      result.duration,
      result.gain,
      onProgress,
    ] as const;
    const updated =
      resumeFrom != null
        ? await api.appendRecording(...args)
        : await api.uploadRecording(...args);
    // An appended take's annotations are relative to it, so shift onto the whole timeline.
    const offset = resumeFrom ?? 0;
    // The take is SAVED from here on: nothing below may fail the save, or Retry would upload it twice (../../docs/recordings.md).
    // The moments are the recording's: a save that filed none leaves them nowhere to go.
    const recordingPath = updated.recordingPath;
    for (const a of result.annotations) {
      if (!recordingPath) break;
      await api
        .addMoment(recordingPath, {
          ...a,
          startSec: a.startSec + offset,
          endSec: a.endSec + offset,
        })
        .catch((err: unknown) => console.error("annotation not saved", err));
    }
    // Pin the seam where the resumed take begins so it's easy to find later.
    if (resumeFrom != null && recordingPath) {
      await api
        .addRecordingMarker(recordingPath, {
          atSec: offset,
          comment: m["rec.resumedOn"]({ at: fmtStamp() }),
        })
        .catch(() => {});
    }
    recording.release?.close();
    setRecording(null);
    bump();
    // The take is a recording now: its page, by its path (../../docs/recordings.md).
    go(
      recordingPath
        ? `/recording?${new URLSearchParams({ path: recordingPath })}`
        : `/sessions/${updated.id}`,
    );
  };

  const discard = () => {
    recording?.release?.close();
    setRecording(null);
    bump();
    go("/sessions");
  };

  const barShown = recording != null;
  const value = useMemo(
    () => ({ recording, barShown, start, resume, changed }),
    [recording, barShown, start, resume, changed],
  );

  const active = recording != null || sourceOpen || chainOpen;
  return (
    <RecordingContext.Provider value={value}>
      {children}
      {active && (
        <Suspense fallback={null}>
          <RecordingOverlay
            recording={recording}
            tags={tags}
            source={source}
            sourceOpen={sourceOpen}
            setSourceOpen={setSourceOpen}
            chainOpen={chainOpen}
            setChainOpen={setChainOpen}
            begin={begin}
            onSave={save}
            onDiscard={discard}
          />
        </Suspense>
      )}
    </RecordingContext.Provider>
  );
}
