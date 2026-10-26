// RecordingOverlay.tsx — what a running take DRAWS, loaded only once one starts: the source
// chooser, the chain panel and the recorder, which is a pop-in or the bottom bar by two class swaps.
// Its own `.rehearsal-root`, since the host's other pages are not inside the rehearsal wrapper.

import { ChevronDown, Workflow } from "@frediverse/ui/icons";
import {
  acquireMicrophone,
  describeMicError,
  RecorderView,
} from "@studio/recorder";
import { type ComponentProps, useEffect, useRef, useState } from "react";
import { ChainSourcePanel } from "../components/ChainSourcePanel";
import { SessionSourceDialog } from "../components/SessionSourceDialog";
import { useFocusTrap } from "../hooks/useFocusTrap";
import { useRehearsalHost } from "../host";
import { m } from "../paraglide/messages.js";
import { micErrors, recorderLabels } from "../recorderLabels";
import type { RecordingCtx } from "./context";
import "../styles/index.css";

type Close = { close: () => void };

interface Props {
  recording: RecordingCtx | null;
  recOpen: boolean;
  setRecOpen: (open: boolean) => void;
  tags: string[];
  sourceOpen: boolean;
  setSourceOpen: (open: boolean) => void;
  chainOpen: boolean;
  setChainOpen: (open: boolean) => void;
  chainShown: boolean;
  setChainShown: (shown: boolean) => void;
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
  sourceOpen,
  setSourceOpen,
  chainOpen,
  setChainOpen,
  chainShown,
  setChainShown,
  begin,
  onSave,
  onDiscard,
}: Props) {
  const { user } = useRehearsalHost();
  const [sourceBusy, setSourceBusy] = useState(false);
  const [sourceError, setSourceError] = useState<string | null>(null);

  // A fresh chooser says nothing of the last attempt's failure.
  useEffect(() => {
    if (sourceOpen) setSourceError(null);
  }, [sourceOpen]);

  const startLocal = async () => {
    setSourceBusy(true);
    setSourceError(null);
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
    } finally {
      setSourceBusy(false);
    }
  };

  // The other source: the chooser gives way to the chain panel — ../../docs/chainSource.md.
  const startChain = () => {
    setSourceOpen(false);
    setChainShown(true);
    setChainOpen(true);
  };

  // Record the chain's output; ending the take closes the listener AND the panel with its frame.
  const recordChain = async (stream: MediaStream, close: () => void) => {
    const release = {
      close: () => {
        close();
        setChainOpen(false);
        setChainShown(false);
      },
    };
    await begin(stream, release, true);
    setChainShown(false);
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
                  <>
                    {recording.chain && (
                      <button
                        type="button"
                        className="rec-popin-hide"
                        onClick={() => setChainShown(true)}
                        title={m["chain.showTitle"]()}
                      >
                        <Workflow className="size-4" /> {m["chain.show"]()}
                      </button>
                    )}
                    <button
                      type="button"
                      className="rec-popin-hide"
                      onClick={() => setRecOpen(false)}
                      title={m["rec.hideTitle"]()}
                    >
                      <ChevronDown className="size-4" /> {m["rec.hide"]()}
                    </button>
                  </>
                )
              }
              onSave={onSave}
              onDiscard={onDiscard}
            />
          </div>
        </div>
      )}

      <SessionSourceDialog
        open={sourceOpen}
        busy={sourceBusy}
        error={sourceError}
        onLocal={startLocal}
        onChain={startChain}
        onClose={() => setSourceOpen(false)}
      />

      {chainOpen && (
        <ChainSourcePanel
          who={user}
          recording={!!recording?.chain}
          shown={chainShown}
          onRecord={recordChain}
          onCancel={() => {
            setChainOpen(false);
            setChainShown(false);
          }}
          onHide={() => setChainShown(false)}
        />
      )}
    </div>
  );
}
