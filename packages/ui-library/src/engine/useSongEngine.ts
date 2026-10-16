// useSongEngine.ts — the account's engine, seen from the médiathèque: whether one ANSWERS, which
// is what puts the moteur in the destinations menu, and — only while that destination is the
// chosen one — the single socket this tab drives it through. Looking costs no socket; playing
// somewhere else must not hold one. See ../../docs/playbackTarget.md.

import { EngineClient, type EngineWarning } from "@studio/engine-browser";
import { playEngineOutput } from "@studio/engine-browser/engine-output";
import type { RankedEngine } from "@studio/engine-browser/probe";
import { useRelook } from "@studio/engine-browser/relook";
import type { ProjectDoc } from "@studio/engine-protocol/project";
import { SESSIONS, sessionFor } from "@studio/engine-protocol/sessions";
import type { PublicEngine } from "@studio/web-protocol";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { engines } from "../api";
import { useLibraryHost } from "../host";

export interface SongEngine {
  /** An engine answered: the menu row is offerable, whether or not anything is connected to it. */
  available: boolean;
  /** Which engine answered: what the server is asked about when a song must reach its machine. */
  engineId: string | null;
  /** Whether the engine says it is playing; its playhead goes to `onFrame`, not into React state. */
  playing: boolean;
  /** The last thing it complained about, which is the only account of silence. */
  warning: EngineWarning | null;
  /** Send a document and start the transport; leaving `fromSeconds` out plays silence. */
  play: (doc: ProjectDoc, fromSeconds?: number) => void;
  /** Throw this session's edit away, since an apply is a DIFF — ../../docs/playbackTarget.md. */
  reset: () => void;
  stop: () => void;
  /** Scrub to an absolute position: its own verb, since a document would restart the transport. */
  seek: (seconds: number) => void;
}

/** Every state frame's transport, ~20 Hz: handed out rather than held, so it re-renders nothing by itself. */
export type EngineFrame = (playing: boolean, playhead: number) => void;

/** @param connected whether the account's destination IS the engine — see ../../docs/playbackTarget.md. */
export function useSongEngine(
  connected: boolean,
  onFrame?: EngineFrame,
): SongEngine {
  const [chosenId, setChosenId] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  // In a ref: the socket's subscription must call the latest one without being reopened.
  const frame = useRef(onFrame);
  frame.current = onFrame;
  const [warning, setWarning] = useState<EngineWarning | null>(null);
  const relook = useRelook();
  const { user } = useLibraryHost();
  // The measured engine itself, in a REF: re-measuring must not reopen a socket on the same machine.
  const pick = useRef<RankedEngine<PublicEngine> | null>(null);
  const client = useRef<EngineClient | undefined>(undefined);
  // Stops the renew loop and says goodbye, in a ref because the lease is taken async.
  const lease = useRef<(() => void) | null>(null);

  // Looking, always: the menu has to say whether the moteur is offerable before anything is chosen.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `relook` is a trigger, not a value read here — a probe is a snapshot.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const { chosen } = await engines().find();
      if (cancelled) return;
      pick.current = chosen;
      setChosenId(chosen?.engine.id ?? null);
    })();
    return () => {
      cancelled = true;
    };
  }, [relook]);

  useEffect(() => {
    const found = pick.current;
    if (!connected || !chosenId || !found) return;
    // `project: null`: pl8 opens no project, so it must not compete for one.
    lease.current = engines().hold(found, { project: null });
    // Per SERVICE and per PERSON — two people may choose one machine, and k7 must keep its slot.
    const c = new EngineClient(
      // Re-measured before every reconnect: a relayed URL's ticket outlives nothing.
      engines().linkUrl(found),
      undefined,
      sessionFor(SESSIONS.pl8, user),
    );
    client.current = c;
    // The transport as the engine reports it: a session can already be rolling when this tab opens.
    c.onState((s) => {
      setPlaying(s.playing);
      frame.current?.(s.playing, s.playhead);
    });
    // Kept rather than dropped: this is how the engine says a clip could not be opened.
    c.onWarning(setWarning);
    // An engine nobody hears — the server's own — is heard in this tab, through its broadcast.
    const offOutput = playEngineOutput(c);
    c.connect();
    // No unsubscribe of our own: dispose() drops the client and its callbacks together.
    return () => {
      offOutput();
      lease.current?.();
      lease.current = null;
      c.dispose();
      client.current = undefined;
      setPlaying(false);
    };
  }, [connected, chosenId, user]);

  // The document first, THEN the verb, or a second of the wrong sound comes out.
  const play = useCallback<SongEngine["play"]>((doc, fromSeconds) => {
    const c = client.current;
    if (!c) return;
    // Cleared on SEND rather than on stop, so a complaint raised by this send survives to be read.
    setWarning(null);
    c.sendProject(doc);
    // Between the document and the verb: after `play` it would be heard as a jump.
    if (fromSeconds !== undefined) c.seek(fromSeconds);
    c.transport("play");
  }, []);

  const stop = useCallback(() => client.current?.transport("stop"), []);
  const reset = useCallback(() => client.current?.dropSession(), []);

  // The caller moves its own cursor optimistically; the next frame is the engine's word.
  const seek = useCallback((seconds: number) => {
    client.current?.seek(seconds);
  }, []);

  // One object per change that matters, so a consumer's callbacks stay put between frames.
  return useMemo(
    () => ({
      available: !!chosenId,
      engineId: chosenId,
      playing,
      warning,
      play,
      reset,
      stop,
      seek,
    }),
    [chosenId, playing, warning, play, reset, stop, seek],
  );
}
