// useEngine.ts — the engine on THIS machine, and optionally listening to what it plays.
// Same probe mediatek's module preview uses: no registry and no picker, because a deck
// plays out of the interface in front of you. See docs/plumbing.md.

import { EngineClient } from "@studio/engine-browser";
import { probeLocalEngine } from "@studio/engine-browser/probe";
import { StreamPlayer } from "@studio/engine-browser/stream";
import { createWorkletSink } from "@studio/engine-browser/stream-sink";
import { useCallback, useEffect, useRef, useState } from "react";

export type Phase =
  | { k: "looking" }
  | { k: "absent" }
  | { k: "ready"; id: string };

export interface Deck {
  phase: Phase;
  playing: boolean;
  engine: EngineClient | null;
  retry: () => void;
  /** Hear in this browser what the engine's interface is putting out. Off by default: the
   *  sound is already coming out of the machine, so the tab would double it. */
  listening: boolean;
  setListening: (on: boolean) => void;
  /** Underruns and buffer depth, once listening — the numbers étape 7 exists to expose. */
  listenStats: { depth: number; underruns: number };
}

export function useEngine(): Deck {
  const [phase, setPhase] = useState<Phase>({ k: "looking" });
  const [playing, setPlaying] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [listening, setListen] = useState(false);
  const [listenStats, setStats] = useState({ depth: 0, underruns: 0 });
  const engine = useRef<EngineClient | null>(null);

  useEffect(() => {
    let cancelled = false;
    setPhase({ k: "looking" });
    void (async () => {
      const found = await probeLocalEngine();
      if (cancelled) return;
      if (!found) return setPhase({ k: "absent" });
      const client = new EngineClient(found.wsUrl);
      engine.current = client;
      // The engine's own transport is the truth about whether sound is happening — never a
      // flag set hopefully when a play was sent. A file that failed to load leaves it
      // stopped, and the deck has to show that.
      client.onState((s) => setPlaying(s.playing));
      client.connect();
      setPhase({ k: "ready", id: found.id });
    })();
    return () => {
      cancelled = true;
      engine.current?.dispose();
      engine.current = null;
    };
  }, [attempt]);

  // Listening is a whole audio pipeline, so it is built on demand and torn down when the
  // toggle goes off rather than sitting idle behind a muted gain.
  useEffect(() => {
    const client = engine.current;
    if (!listening || !client) return;
    let ctx: AudioContext | null = null;
    let off: (() => void) | undefined;
    let stop = false;

    void (async () => {
      // The first frame's header says the rate; the sink does not resample, so the context
      // has to be built at it. Playing 44.1 kHz material into a 48 kHz context is a pitch
      // shift — inaudible as a FAULT while being obvious as "the engine sounds wrong".
      const rate = await new Promise<number>((res) => {
        const first = client.onStreamFrame((buf) => {
          first();
          res(new DataView(buf).getUint32(8, true));
        });
        client.broadcast(true);
      });
      if (stop) return;
      ctx = new AudioContext({ sampleRate: rate });
      await ctx.resume();
      const sink = await createWorkletSink(ctx, { channels: 2 });
      sink.node.connect(ctx.destination);
      const player = new StreamPlayer(sink);
      off = client.onStreamFrame((buf) => player.handle(buf));
      const t = setInterval(() => setStats(sink.stats()), 500);
      off = ((prev) => () => {
        prev?.();
        clearInterval(t);
      })(off);
    })();

    return () => {
      stop = true;
      off?.();
      client.broadcast(false);
      void ctx?.close();
      setStats({ depth: 0, underruns: 0 });
    };
  }, [listening]);

  return {
    phase,
    playing,
    engine: engine.current,
    retry: useCallback(() => setAttempt((n) => n + 1), []),
    listening,
    setListening: setListen,
    listenStats,
  };
}
