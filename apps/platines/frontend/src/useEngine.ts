// useEngine.ts — the engine this ACCOUNT chose, and optionally listening to what it plays.
// The gate picks it from platines' own registry; this hook only connects. See
// docs/plumbing.md.

import { EngineClient } from "@studio/engine-browser";
import type { RankedEngine } from "@studio/engine-browser/probe";
import { StreamPlayer } from "@studio/engine-browser/stream";
import { createWorkletSink } from "@studio/engine-browser/stream-sink";
import { SESSIONS, sessionFor } from "@studio/engine-protocol/sessions";
import type { PublicEngine } from "@studio/web-protocol";
import { useCallback, useEffect, useRef, useState } from "react";
import { currentUser, engines } from "./api";

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

export function useEngine(chosen: RankedEngine<PublicEngine>): Deck {
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
      // Chosen by the gate, not probed here: the deck plays on the machine the ACCOUNT
      // picked, which is not always the one the browser is running on.
      const wsUrl = chosen.wsUrl;
      if (!wsUrl) return setPhase({ k: "absent" });
      if (cancelled) return;
      const found = chosen;
      // The lease, as every other surface takes it. A miss is not fatal — it marks the
      // engine in use, it does not grant the connection.
      engines.select(found.engine.id, found.token!, found.tier).catch(() => {});
      // Its own session, per SERVICE and per PERSON: a deck runs safely beside pistes on one
      // engine — loading a track no longer replaces whatever song is open there — and two
      // DJs on one machine hold two decks rather than fighting over one.
      const client = new EngineClient(
        wsUrl,
        undefined,
        sessionFor(SESSIONS.platines, currentUser()),
      );
      engine.current = client;
      // The engine's own transport is the truth about whether sound is happening — never a
      // flag set hopefully when a play was sent. A file that failed to load leaves it
      // stopped, and the deck has to show that.
      client.onState((s) => setPlaying(s.playing));
      client.connect();
      setPhase({ k: "ready", id: found.engine.id });
    })();
    return () => {
      cancelled = true;
      engine.current?.dispose();
      engine.current = null;
    };
  }, [attempt, chosen]);

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
