// RecordingOverlay.tsx — what a running take DRAWS, loaded only once one starts: the start bar, the
// rehearsal chain's hidden bench and the recorder, all in one bar at the foot of the page — never a
// dialog, so the pages stay usable. Its own `.rehearsal-root`, the host's other pages being outside it.

import {
  acquireMicrophone,
  describeMicError,
  RecorderView,
} from "@studio/recorder";
import { type ComponentProps, useCallback, useEffect, useState } from "react";
import { rehearsalChain } from "../chainSource";
import { RehearsalChainSource } from "../components/RehearsalChainSource";
import { SessionStartBar } from "../components/SessionStartBar";
import { useRehearsalHost } from "../host";
import { m } from "../paraglide/messages.js";
import { micErrors, recorderLabels } from "../recorderLabels";
import type { RecordingCtx, SessionSource } from "./context";
import "../styles/index.css";

type Close = { close: () => void };

interface Props {
  recording: RecordingCtx | null;
  tags: string[];
  /** What the session's button menu picked. */
  source: SessionSource;
  sourceOpen: boolean;
  setSourceOpen: (open: boolean) => void;
  chainOpen: boolean;
  setChainOpen: (open: boolean) => void;
  begin: (
    stream: MediaStream,
    release?: Close,
    chain?: boolean,
  ) => Promise<void>;
  onSave: ComponentProps<typeof RecorderView>["onSave"];
  onDiscard: () => void;
}

export default function RecordingOverlay({
  recording,
  tags,
  source,
  sourceOpen,
  setSourceOpen,
  chainOpen,
  setChainOpen,
  begin,
  onSave,
  onDiscard,
}: Props) {
  const { user } = useRehearsalHost();
  const [status, setStatus] = useState("");
  const [sourceError, setSourceError] = useState<string | null>(null);
  // The rehearsal chain the take goes through, read when the session starts.
  const [chainRef, setChainRef] = useState<string | null>(null);
  // One per start, as the bench's key: a retry opens a fresh bench rather than the failed one.
  const [attempt, setAttempt] = useState(0);
  // The chain asking for an input holds the bar; the start bar steps aside meanwhile.
  const [asking, setAsking] = useState(false);

  const startLocal = useCallback(async () => {
    setStatus(m["source.openingMic"]());
    try {
      const stream = await acquireMicrophone();
      try {
        await begin(stream);
      } catch (err) {
        for (const t of stream.getTracks()) t.stop();
        throw err;
      }
    } catch (err) {
      setSourceError(describeMicError(err, micErrors()));
    }
  }, [begin]);

  // The source the button's menu picked: this device's microphone, or the account's rehearsal chain.
  const startSession = useCallback(async () => {
    setSourceError(null);
    if (source === "local") return startLocal();
    setStatus(m["source.starting"]());
    let ref: string | null = null;
    try {
      ref = await rehearsalChain();
    } catch (err) {
      setSourceError((err as Error).message);
      return;
    }
    // The menu offers the chain only when one is chosen; another tab may have let it go since.
    if (!ref) {
      setSourceError(m["source.noChain"]());
      return;
    }
    setStatus(m["source.openingChain"]({ ref }));
    setChainRef(ref);
    setAttempt((n) => n + 1);
    setChainOpen(true);
  }, [source, startLocal, setChainOpen]);

  // Each opening of the start bar is one start.
  useEffect(() => {
    if (sourceOpen) void startSession();
  }, [sourceOpen, startSession]);

  const cancel = () => {
    setSourceOpen(false);
    setChainOpen(false);
  };

  // Record the chain's output; ending the take closes the listener AND the hidden bench.
  const recordChain = async (stream: MediaStream, close: () => void) => {
    const release = {
      close: () => {
        close();
        setChainOpen(false);
      },
    };
    await begin(stream, release, true);
  };

  return (
    <div className="rehearsal-root rehearsal-overlay">
      {recording && (
        <RecorderView
          key="active-recorder"
          labels={recorderLabels()}
          session={recording.session}
          stream={recording.stream}
          allTags={tags}
          baseEnvelope={recording.baseEnvelope}
          onSave={onSave}
          onDiscard={onDiscard}
        />
      )}

      {sourceOpen && !recording && !(asking && chainOpen) && (
        <SessionStartBar
          status={status}
          error={sourceError}
          onRetry={() => void startSession()}
          onClose={cancel}
        />
      )}

      {chainOpen && chainRef && (
        <RehearsalChainSource
          key={attempt}
          chainRef={chainRef}
          who={user}
          recording={!!recording?.chain}
          onStatus={setStatus}
          onRecord={recordChain}
          onFail={setSourceError}
          onCancel={cancel}
          onAsking={setAsking}
        />
      )}
    </div>
  );
}
