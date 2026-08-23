// useModuleEngine.ts — the ONE socket to the engine this account chose. It carries the
// transport for anything the moteur plays for the médiathèque: a chain variant, a song, a
// playlist. It used to load MODULES too — that left with the builder, which is in st0 now,
// where a plugin can be loaded into a real project. See docs/engine.md, docs/playbackTarget.md.

import { EngineClient, type EngineWarning } from "@studio/engine-browser";
import type { ProjectDoc } from "@studio/engine-protocol/project";
import { SESSIONS, sessionFor } from "@studio/engine-protocol/sessions";
import { useCallback, useEffect, useRef, useState } from "react";
import { currentUser, engines } from "../api";

export type EnginePhase =
  | { k: "looking" }
  | { k: "absent" }
  | { k: "ready"; id: string };

export interface ModuleEngine {
  phase: EnginePhase;
  /** The socket itself, for a screen whose questions are the MACHINE's — see ../../docs/engine.md. */
  client: EngineClient | null;
  /** Whether that socket is OPEN, which `phase: ready` does not say (../../docs/engine.md). */
  connected: boolean;
  /** Whether the engine says it is playing, and where its playhead is (../../docs/engine.md). */
  playing: boolean;
  playhead: number;
  /** The last thing the engine complained about, which is the only account of silence (../../docs/engine.md). */
  warning: EngineWarning | null;
  /** The chosen machine's file service, as its probe reported it — null when none answered (../../docs/playback.md). */
  fileBase: string | null;
  /** What leaves whatever is playing, in dB. -100 is nothing. */
  outputLevel: number;
  /** Send a document and start the transport; leaving `fromSeconds` out plays silence (../../docs/engine.md). */
  play: (doc: ProjectDoc, fromSeconds?: number) => void;
  /** Throw this session's edit away, since an apply is a DIFF — see ../../docs/engine.md. */
  reset: () => void;
  stop: () => void;
  /** Scrub to an absolute position: its own verb, since a document would restart the transport. */
  seek: (seconds: number) => void;
  retry: () => void;
}

/** The engine this ACCOUNT plays through; `engineId` is the pick, handed DOWN (../../docs/engine.md). */
export function useModuleEngine(engineId?: string): ModuleEngine {
  const [phase, setPhase] = useState<EnginePhase>({ k: "looking" });
  const [fileBase, setFileBase] = useState<string | null>(null);
  // What leaves whatever is playing, in dB, from the engine's own frame (../../docs/engine.md).
  const [outputLevel, setOutputLevel] = useState(-100);
  const [playing, setPlaying] = useState(false);
  const [playhead, setPlayhead] = useState(0);
  const [warning, setWarning] = useState<EngineWarning | null>(null);
  const [client, setClient] = useState<EngineClient | null>(null);
  const [connected, setConnected] = useState(false);
  const engine = useRef<EngineClient | undefined>(undefined);
  const [attempt, setAttempt] = useState(0);
  // Stops the renew loop and says goodbye, in a REF because the lease is taken async (../../docs/engine.md).
  const lease = useRef<(() => void) | null>(null);

  useEffect(() => {
    let cancelled = false;
    setPhase({ k: "looking" });
    void (async () => {
      // The caller's pick wins over the stored one, which arrives a moment stale (../../docs/engine.md).
      const { chosen } = await engines.find(engineId);
      if (cancelled) return;
      if (!chosen) return setPhase({ k: "absent" });
      const found = chosen;
      setFileBase(found.fileBase ?? null);
      // The lease, exactly as st0' EngineGate holds it — a miss marks nothing and grants nothing.
      lease.current?.(); // a previous one, if this effect re-ran on a new choice
      // `project: null`: pl8 opens no project, so it must not compete for one (../../docs/engine.md).
      lease.current = engines.hold(found, { project: null });

      // Per SERVICE and per PERSON — see ../../docs/engine.md.
      const client = new EngineClient(
        // Re-measured before every reconnect: the relayed URL's ticket outlives nothing.
        engines.linkUrl(found),
        undefined,
        sessionFor(SESSIONS.pl8, currentUser()),
      );
      engine.current = client;
      // The transport as the engine reports it, subscribed ALWAYS (../../docs/engine.md).
      client.onState((s) => {
        setPlaying(s.playing);
        setPlayhead(s.playhead);
        // One track at a time here, so the level is the first of the list; -100 is "nothing".
        setOutputLevel(s.levels?.[0] ?? -100);
      });
      // Kept rather than dropped: this is how the engine says a clip could not be opened.
      client.onWarning(setWarning);
      client.onConnected(setConnected);
      setClient(client);
      client.connect();
      setPhase({ k: "ready", id: found.engine.id });
    })();
    // No unsubscribe of our own: dispose() drops the client and its callbacks together.
    return () => {
      cancelled = true;
      lease.current?.();
      lease.current = null;
      engine.current?.dispose();
      engine.current = undefined;
      setClient(null);
      setConnected(false);
    };
  }, [attempt, engineId]);

  // The document first, THEN the verb, or a second of the wrong sound (../../docs/engine.md).
  const play = useCallback<ModuleEngine["play"]>((doc, fromSeconds) => {
    const client = engine.current;
    if (!client) return;
    // Cleared on SEND rather than on stop, so a complaint raised by this send survives to be read.
    setWarning(null);
    client.sendProject(doc);
    // Between the document and the verb: after `play` it would be heard as a jump.
    if (fromSeconds !== undefined) {
      client.seek(fromSeconds);
      setPlayhead(Math.max(0, fromSeconds));
    }
    client.transport("play");
  }, []);

  const stop = useCallback(() => engine.current?.transport("stop"), []);

  const reset = useCallback(() => {
    engine.current?.dropSession();
  }, []);

  // Moved LOCALLY as well as sent, since the ~20 Hz frame lags a drag (../../docs/engine.md).
  const seek = useCallback((seconds: number) => {
    engine.current?.seek(seconds);
    setPlayhead(Math.max(0, seconds));
  }, []);

  return {
    phase,
    client,
    connected,
    fileBase,
    playing,
    playhead,
    warning,
    outputLevel,
    play,
    stop,
    seek,
    reset,
    retry: () => setAttempt((n) => n + 1),
  };
}
