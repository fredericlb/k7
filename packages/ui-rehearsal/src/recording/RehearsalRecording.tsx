// RehearsalRecording.tsx — the running take, held ABOVE the host's routes so it survives moving
// between pages: the source chooser, the chain panel and the recorder's pop-in or bottom bar.
// It holds nothing until a take starts; what it draws then is a lazy chunk (RecordingOverlay).

import type { ComponentProps } from "react";
import {
  lazy,
  type ReactNode,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import { useLocation } from "react-router-dom";
import { api } from "../api";
import { fmtStamp } from "../format";
import { useRehearsalNav } from "../host";
import { m } from "../paraglide/messages.js";
import { micErrors } from "../recorderLabels";
import { isSongPage } from "../sections";
import type { Session } from "../types";
import { RecordingContext, type RecordingCtx } from "./context";

const RecordingOverlay = lazy(() => import("./RecordingOverlay"));

type SaveResult = Parameters<
  ComponentProps<typeof RecordingOverlay>["onSave"]
>[0];

/** Every track of a stream nothing will record — what turns the microphone light off. */
function stopTracks(stream: MediaStream): void {
  for (const t of stream.getTracks()) t.stop();
}

export function RehearsalRecording({ children }: { children: ReactNode }) {
  const { go, prefix } = useRehearsalNav();
  const { pathname } = useLocation();
  const [recording, setRecording] = useState<RecordingCtx | null>(null);
  // The running take drawn in its pop-in; false collapses it to the bottom bar.
  const [recOpen, setRecOpen] = useState(false);
  const [sourceOpen, setSourceOpen] = useState(false);
  // The rehearsal chain's hidden bench: mounted from the session's start to the end of its take.
  const [chainOpen, setChainOpen] = useState(false);
  const [changed, setChanged] = useState(0);
  const [tags, setTags] = useState<string[]>([]);
  const bump = useCallback(() => setChanged((n) => n + 1), []);

  useEffect(() => {
    if (!recOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !e.defaultPrevented) setRecOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [recOpen]);

  // The tags the recorder suggests, read once per take: the pages that list moments are not mounted here.
  const loadTags = useCallback(() => {
    api
      .listMoments()
      .then((ms) => setTags([...new Set(ms.flatMap((x) => x.tags))].sort()))
      .catch(() => {});
  }, []);

  const start = useCallback(async () => {
    // Only one recording at a time — bring the user back to the active one.
    if (recording) {
      setRecOpen(true);
      throw new Error(m["rec.finishFirst"]());
    }
    setSourceOpen(true);
  }, [recording]);

  // Create the session once there is a stream, and open the recorder unless a song holds the page.
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
      // A take started on a song stays there, collapsed to the bar — ../../docs/audio.md.
      setRecOpen(!isSongPage(pathname, prefix));
    },
    [bump, loadTags, pathname, prefix],
  );

  const resume = useCallback(
    async (session: Session) => {
      if (recording) {
        setRecOpen(true);
        throw new Error(m["rec.finishFirst"]());
      }
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
      setRecOpen(true);
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
    for (const a of result.annotations) {
      await api
        .addAnnotation(session.id, {
          ...a,
          startSec: a.startSec + offset,
          endSec: a.endSec + offset,
        })
        .catch((err: unknown) => console.error("annotation not saved", err));
    }
    // Pin the seam where the resumed take begins so it's easy to find later.
    if (resumeFrom != null) {
      await api
        .addMarker(session.id, {
          atSec: offset,
          comment: m["rec.resumedOn"]({ at: fmtStamp() }),
        })
        .catch(() => {});
    }
    recording.release?.close();
    setRecording(null);
    bump();
    go(`/sessions/${updated.id}`);
  };

  const discard = () => {
    recording?.release?.close();
    setRecording(null);
    bump();
    go("/sessions");
  };

  const minimized = recording != null && !recOpen;
  const value = useMemo(
    () => ({ recording, minimized, start, resume, changed }),
    [recording, minimized, start, resume, changed],
  );

  const active = recording != null || sourceOpen || chainOpen;
  return (
    <RecordingContext.Provider value={value}>
      {children}
      {active && (
        <Suspense fallback={null}>
          <RecordingOverlay
            recording={recording}
            recOpen={recOpen}
            setRecOpen={setRecOpen}
            tags={tags}
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
