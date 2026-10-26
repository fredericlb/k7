// ChainSourcePanel.tsx — the chain source's screen: pick a chain of the library, see k7's bench
// playing it in a frame, choose what feeds its inputs, hear it, then record its output. See ../../docs/chainSource.md.
//
// What reads wrong: the panel is HIDDEN during a take, never unmounted — the frame is k7's open
// bench, and unmounting it would reload k7 and drop its claim on the engine mid-take.

import { Badge } from "@frediverse/ui/badge";
import { Button } from "@frediverse/ui/button";
import {
  ChevronDown,
  Circle,
  Headphones,
  Loader2,
  Workflow,
} from "@frediverse/ui/icons";
import type { LiveChain } from "@studio/web-protocol";
import { useEffect, useRef, useState } from "react";
import {
  benchUrl,
  type ChainInputs,
  type ChainPhase,
  type ChainSource,
  listLiveChains,
  openChainSource,
} from "../chainSource";
import { useFocusTrap } from "../hooks/useFocusTrap";
import { m } from "../paraglide/messages.js";
import { ChainInputsPicker } from "./ChainInputsPicker";

interface Props {
  /** Who k7's session belongs to — the email, else the subject, as k7 spells it. */
  who: string;
  /** A take is running on this chain: Record is spent, and Hide is the only way out. */
  recording: boolean;
  /** Drawn, or kept alive out of sight while the take runs. */
  shown: boolean;
  onRecord: (stream: MediaStream, close: () => void) => Promise<void>;
  onCancel: () => void;
  onHide: () => void;
}

export function ChainSourcePanel({
  who,
  recording,
  shown,
  onRecord,
  onCancel,
  onHide,
}: Props) {
  const [chains, setChains] = useState<LiveChain[] | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [chain, setChain] = useState<string | null>(null);
  const [phase, setPhase] = useState<ChainPhase>({ k: "waiting" });
  const [monitor, setMonitor] = useState(false);
  const [busy, setBusy] = useState(false);
  const [recordError, setRecordError] = useState<string | null>(null);
  const [level, setLevel] = useState(0);
  const [inputs, setInputs] = useState<ChainInputs>({
    devices: null,
    nodes: null,
  });
  const source = useRef<ChainSource | null>(null);
  const dialog = useRef<HTMLDivElement>(null);
  useFocusTrap(shown, dialog);

  useEffect(() => {
    let alive = true;
    listLiveChains()
      .then((c) => alive && setChains(c))
      .catch((e) => alive && setListError((e as Error).message));
    return () => {
      alive = false;
    };
  }, []);

  // One listener per chosen chain; the take's own close() may already have run, which is harmless.
  useEffect(() => {
    if (!chain) return;
    const s = openChainSource(
      chain,
      who,
      (p) => {
        setPhase(p);
        // Heard here by default only when the engine is elsewhere: a local one already plays in the room.
        if (p.k === "live") {
          setMonitor(!p.local);
          s.setMonitor(!p.local);
        }
      },
      setInputs,
    );
    source.current = s;
    return () => {
      s.close();
      source.current = null;
      setInputs({ devices: null, nodes: null });
    };
  }, [chain, who]);

  // The meter, only while there is something to read and someone to see it.
  useEffect(() => {
    if (phase.k !== "live" || !shown) return;
    let raf = 0;
    const tick = () => {
      setLevel(source.current?.level() ?? 0);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [phase.k, shown]);

  const toggleMonitor = () => {
    source.current?.resume();
    source.current?.setMonitor(!monitor);
    setMonitor(!monitor);
  };

  const record = async () => {
    const s = source.current;
    if (phase.k !== "live" || !s) return;
    s.resume();
    setBusy(true);
    setRecordError(null);
    try {
      await onRecord(phase.stream, () => s.close());
    } catch (e) {
      setRecordError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const status = (() => {
    switch (phase.k) {
      case "waiting":
        return m["chain.waiting"]();
      case "connecting":
        return m["chain.connecting"]();
      case "live":
        return phase.local ? m["chain.liveLocal"]() : m["chain.live"]();
      case "error":
        return phase.message;
    }
  })();

  return (
    <div
      className={`chain-panel-backdrop${shown ? "" : " is-hidden"}`}
      aria-hidden={!shown || undefined}
    >
      <div
        ref={dialog}
        className="chain-panel"
        role="dialog"
        aria-modal={shown || undefined}
        aria-label={m["chain.title"]()}
      >
        <div className="chain-panel-head">
          <h2>
            <Workflow className="size-4" /> {m["chain.title"]()}
            {chain && <span className="muted"> — {chain}</span>}
          </h2>
          {recording ? (
            <Button variant="ghost" size="sm" onClick={onHide}>
              <ChevronDown className="size-4" /> {m["rec.hide"]()}
            </Button>
          ) : (
            <Button variant="ghost" size="sm" onClick={onCancel}>
              {m["chain.cancel"]()}
            </Button>
          )}
        </div>

        {!chain && (
          <>
            <p className="muted small">{m["chain.pick"]()}</p>
            {listError && <p className="error">{listError}</p>}
            {!chains && !listError && (
              <p className="muted">
                <Loader2 className="size-4 animate-spin" />{" "}
                {m["chain.loading"]()}
              </p>
            )}
            {chains?.length === 0 && (
              <p className="muted">{m["chain.none"]()}</p>
            )}
            <ul className="chain-list">
              {chains?.map((c) => (
                <li key={c.ref}>
                  <button
                    type="button"
                    className="chain-row"
                    disabled={c.unavailable != null}
                    title={c.unavailable ?? undefined}
                    onClick={() => setChain(c.ref)}
                  >
                    <span>{c.ref}</span>
                    {c.unavailable && (
                      <span className="muted small">{c.unavailable}</span>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}

        {chain && (
          <>
            <iframe
              className="chain-frame"
              src={benchUrl(chain)}
              title={m["chain.frameTitle"]()}
              allow="autoplay; microphone; midi"
            />
            <div className="chain-status">
              {phase.k === "live" ? (
                <Badge variant={recording ? "rec" : "tag"}>
                  <Circle className="size-2.5 fill-current" />{" "}
                  {recording ? m["chain.recording"]() : m["chain.onAir"]()}
                </Badge>
              ) : phase.k !== "error" ? (
                <Loader2 className="size-4 animate-spin" />
              ) : null}
              <span className={phase.k === "error" ? "error" : "muted small"}>
                {status}
              </span>
            </div>
            {phase.k !== "waiting" && phase.k !== "error" && (
              <ChainInputsPicker
                inputs={inputs}
                disabled={!source.current}
                onPick={(node, chs) =>
                  source.current?.setChannel(node, chs) ?? Promise.resolve()
                }
              />
            )}
            <div className="meter">
              <div
                className="meter-fill"
                style={{
                  width: `${Math.min(100, level * 100)}%`,
                  background: level > 0.92 ? "var(--red)" : "var(--accent)",
                }}
              />
            </div>
            {recordError && <p className="error">{recordError}</p>}
            <div className="row" style={{ marginTop: 10 }}>
              {!recording && (
                <Button disabled={phase.k !== "live" || busy} onClick={record}>
                  <Circle className="size-2.5 fill-current" />{" "}
                  {m["chain.record"]()}
                </Button>
              )}
              <Button
                variant={monitor ? "default" : "outline"}
                disabled={phase.k !== "live"}
                aria-pressed={monitor}
                onClick={toggleMonitor}
                title={m["chain.monitorTitle"]()}
              >
                <Headphones className="size-4" /> {m["chain.monitor"]()}
              </Button>
              {!recording && (
                <Button
                  variant="ghost"
                  disabled={busy}
                  onClick={() => {
                    setChain(null);
                    setPhase({ k: "waiting" });
                  }}
                >
                  {m["chain.other"]()}
                </Button>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
