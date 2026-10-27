// RehearsalChainSource.tsx — a take recorded through the account's rehearsal chain: k7's bench plays it in
// a frame nobody sees, and the take starts by itself once the chain is live and every input is fed. Only a
// missing input channel is ever asked, since a take cannot start without one. See ../../docs/chainSource.md.
//
// What reads wrong: the frame is HIDDEN, never unmounted — it is k7's open bench, and unmounting it would
// reload k7 and drop its claim on the engine mid-take.

import { Button } from "@frediverse/ui/button";
import { Workflow } from "@frediverse/ui/icons";
import { useEffect, useRef, useState } from "react";
import {
  benchUrl,
  type ChainInputs,
  type ChainPhase,
  type ChainSource,
  openChainSource,
} from "../chainSource";
import { m } from "../paraglide/messages.js";
import { ChainInputsPicker } from "./ChainInputsPicker";

interface Props {
  /** The rehearsal chain, `@account/<name>`. */
  chainRef: string;
  /** Who k7's session belongs to — the email, else the subject, as k7 spells it. */
  who: string;
  /** A take is running through it: nothing is asked any more. */
  recording: boolean;
  /** Where the chain stands, in words, for the start bar. */
  onStatus: (text: string) => void;
  onRecord: (stream: MediaStream, close: () => void) => Promise<void>;
  onFail: (message: string) => void;
  onCancel: () => void;
  /** Whether it is asking for an input, which takes the bar's place from the start bar meanwhile. */
  onAsking: (asking: boolean) => void;
}

export function RehearsalChainSource({
  chainRef,
  who,
  recording,
  onStatus,
  onRecord,
  onFail,
  onCancel,
  onAsking,
}: Props) {
  const [phase, setPhase] = useState<ChainPhase>({ k: "waiting" });
  const [inputs, setInputs] = useState<ChainInputs>({
    devices: null,
    nodes: null,
  });
  const source = useRef<ChainSource | null>(null);
  const started = useRef(false);
  const said = useRef({ onStatus, onFail });
  said.current = { onStatus, onFail };

  // One listener for the take; its own close() may already have run when the take ended, which is harmless.
  useEffect(() => {
    const s = openChainSource(
      chainRef,
      who,
      (p) => {
        setPhase(p);
        // Heard here only when the engine is elsewhere: a local one already plays in the room.
        if (p.k === "live") s.setMonitor(!p.local);
        if (p.k === "error") said.current.onFail(p.message);
      },
      setInputs,
    );
    source.current = s;
    return () => {
      s.close();
      source.current = null;
    };
  }, [chainRef, who]);

  useEffect(() => {
    if (phase.k === "waiting") said.current.onStatus(m["chain.waiting"]());
    else if (phase.k === "connecting")
      said.current.onStatus(m["chain.connecting"]());
  }, [phase.k]);

  // Every live input of the bench fed, or the ones that are not; null while the bench is still read.
  const unfed = inputs.nodes?.filter((n) => !n.channel?.length) ?? null;

  useEffect(() => {
    const s = source.current;
    if (recording || started.current || !s) return;
    if (phase.k !== "live" || !unfed || unfed.length) return;
    started.current = true;
    // The click that started the session is what lets the audio context run.
    s.resume();
    onRecord(phase.stream, () => s.close()).catch((e: Error) => {
      started.current = false;
      said.current.onFail(e.message);
    });
  }, [phase, unfed, recording, onRecord]);

  const asking =
    !recording && phase.k === "live" && !!unfed && unfed.length > 0;
  useEffect(() => {
    onAsking(asking);
  }, [asking, onAsking]);

  return (
    <>
      <div className="chain-bench-offstage" aria-hidden>
        <iframe
          className="chain-frame"
          src={benchUrl(chainRef)}
          title={m["chain.frameTitle"]()}
          allow="autoplay; microphone; midi"
          tabIndex={-1}
        />
      </div>
      {/* Asked in the recorder's bar, where the take is about to run: never a dialog. */}
      {asking && (
        <section
          className="rec-bar"
          aria-label={m["chain.inputTitle"]({ ref: chainRef })}
        >
          <div className="rec-bar-main">
            <div className="rec-bar-wave chain-ask">
              <span className="chain-ask-what">
                <Workflow className="size-4" />{" "}
                {m["chain.inputTitle"]({ ref: chainRef })}
              </span>
              <ChainInputsPicker
                inputs={inputs}
                disabled={!source.current}
                onPick={(node, chs) =>
                  source.current?.setChannel(node, chs) ?? Promise.resolve()
                }
              />
            </div>
            <div className="rec-bar-actions">
              <Button variant="ghost" size="sm" onClick={onCancel}>
                {m["chain.cancel"]()}
              </Button>
            </div>
          </div>
        </section>
      )}
    </>
  );
}
