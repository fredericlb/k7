// RecordingOverlay.tsx — what a running take DRAWS, loaded only once one starts: the start dialog, the
// rehearsal chain's hidden bench and the recorder, which is a pop-in or the bottom bar by two class swaps.
// Its own `.rehearsal-root`, since the host's other pages are not inside the rehearsal wrapper.

import { ChevronDown } from "@frediverse/ui/icons";
import {
  acquireMicrophone,
  describeMicError,
  RecorderView,
} from "@studio/recorder";
import {
  type ComponentProps,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { rehearsalChain } from "../chainSource";
import { RehearsalChainSource } from "../components/RehearsalChainSource";
import { SessionStartDialog } from "../components/SessionStartDialog";
import { useFocusTrap } from "../hooks/useFocusTrap";
import { useRehearsalHost } from "../host";
import { m } from "../paraglide/messages.js";
import { micErrors, recorderLabels } from "../recorderLabels";
import type { RecordingCtx, SessionSource } from "./context";
import "../styles/index.css";

type Close = { close: () => void };

interface Props {
  recording: RecordingCtx | null;
  recOpen: boolean;
  setRecOpen: (open: boolean) => void;
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
  recOpen,
  setRecOpen,
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

  // Each opening of the dialog is one start.
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

  const minimized = recording != null && !recOpen;
  const popin = useRef<HTMLDivElement>(null);
  useFocusTrap(recording != null && recOpen, popin);

  return (
    <div className="rehearsal-root rehearsal-overlay">
      {/* At a STABLE position: the pop-in is two class swaps, never a re-parent — ../../docs/audio.md. */}
      {recording && (
        <div
          className={recOpen ? "rec-popin-backdrop" : "rec-dock"}
          onClick={(e) => {
            if (recOpen && e.target === e.currentTarget) setRecOpen(false);
          }}
        >
          <div
            ref={popin}
            className={recOpen ? "rec-popin" : "rec-dock"}
            role={recOpen ? "dialog" : undefined}
            aria-modal={recOpen || undefined}
            aria-label={recOpen ? m["rec.dialog"]() : undefined}
          >
            <RecorderView
              key="active-recorder"
              labels={recorderLabels()}
              session={recording.session}
              stream={recording.stream}
              allTags={tags}
              baseEnvelope={recording.baseEnvelope}
              minimized={minimized}
              onExpand={() => setRecOpen(true)}
              headerActions={
                recOpen && (
                  <button
                    type="button"
                    className="rec-popin-hide"
                    onClick={() => setRecOpen(false)}
                    title={m["rec.hideTitle"]()}
                  >
                    <ChevronDown className="size-4" /> {m["rec.hide"]()}
                  </button>
                )
              }
              onSave={onSave}
              onDiscard={onDiscard}
            />
          </div>
        </div>
      )}

      <SessionStartDialog
        open={sourceOpen}
        status={status}
        error={sourceError}
        onRetry={() => void startSession()}
        onClose={cancel}
      />

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
        />
      )}
    </div>
  );
}
