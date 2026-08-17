// useSnapshotPlayer.ts — playback for a SHARED snapshot: the rendered mixdown, or its stems once
// a lane is muted, through Web Audio elements rather than the engine. It feeds the same
// EngineStore the engine feeds, so the playhead, the clock and the timeline are untouched.
// See docs/shared.md.

import type { EngineStore } from "@studio/engine-browser/store";
import type { TransportAction } from "@studio/engine-protocol";
import { useCallback, useEffect, useRef, useState } from "react";
import type { OpenShare } from "../components/SharedGate";

/** Past this much, a stem is audibly late against the clock and gets put back. Seconds. */
const DRIFT_S = 0.08;
/** How often to check for it. Cheap, and a resync is inaudible at this distance. */
const RESYNC_MS = 1000;

export interface SnapshotPlayer {
  transport: (a: TransportAction) => void;
  seek: (seconds: number) => void;
  /**
   * The lane gains, 0 or 1 per TRACK id — mute and solo already resolved by the caller.
   *
   * Passing anything but all-ones is what switches this player from the mixdown to the stems,
   * once and for the session: crossing back mid-play would be a second audible seam for a
   * visitor who is only exploring.
   */
  setLaneGains: (gains: Record<string, number>) => void;
  /** What went wrong, in a sentence, or "" — the status line's, not a dialog's. */
  fault: string;
}

/** One playable file: the element that streams it and the gain it lands on. */
interface Voice {
  el: HTMLAudioElement;
  gain: GainNode;
}

/**
 * A browser transport over rendered audio.
 *
 * **A media element per file, not a decoded buffer**, and the number is why: twelve stems of four
 * minutes are ~58 MB of mp3 to fetch and **~340 MB decoded**, which a phone does not have. An
 * element streams, makes Range requests — exactly what st0's `streamFile` serves — and carries
 * the `currentTime` this hook publishes as the playhead.
 *
 * What it costs is that several elements do not share a clock. So they are not asked to: one of
 * them IS the clock and the others are put back against it whenever they drift, which is a
 * correction you cannot hear at 80 ms and a design you can replace with decoded buffers for the
 * few stems someone actually unmutes, without undoing any of this.
 */
export function useSnapshotPlayer(
  snapshot: OpenShare | undefined,
  store: EngineStore,
): SnapshotPlayer {
  const [fault, setFault] = useState("");
  const ctxRef = useRef<AudioContext | null>(null);
  const mixRef = useRef<Voice | null>(null);
  // By TRACK id. A stem whose render matched no lane (`track: ""`) is deliberately absent: it
  // plays, and no mute button addresses it — which is honest, where hanging it off a made-up
  // id would light the wrong lane's button.
  const stemsRef = useRef<Map<string, Voice>>(new Map());
  // Every voice in creation order, for the operations that are about all of them at once.
  const allRef = useRef<Voice[]>([]);
  const onStemsRef = useRef(false);
  const playingRef = useRef(false);
  const rafRef = useRef(0);

  /** Whichever element the others follow. The mixdown while it is what sounds, then stem one. */
  const clock = useCallback((): HTMLAudioElement | null => {
    if (!onStemsRef.current) return mixRef.current?.el ?? null;
    return stemsRef.current.values().next().value?.el ?? null;
  }, []);

  /** Publish a frame in the shape the engine publishes, so nothing downstream can tell. */
  const publish = useCallback(() => {
    const el = clock();
    store.set({
      playing: playingRef.current,
      playhead: el?.currentTime ?? 0,
      // Empty rather than zeroed: a meter with no engine behind it has NO reading, and a row of
      // -inf bars would be a claim about silence that nothing measured.
      levels: [],
      inputLevels: [],
      armed: [],
      recordEnabled: false,
      waveform: {},
    });
  }, [store, clock]);

  // The playhead, at the frame rate rather than on a timer: this is the same 20 Hz-ish feed the
  // engine's state frames give the shell, and `EngineStore.set` already drops one that says
  // nothing new — so a paused transport costs one comparison per frame and no re-render.
  const pump = useCallback(() => {
    publish();
    rafRef.current = requestAnimationFrame(pump);
  }, [publish]);

  /**
   * Build the graph on the first transport verb — never on mount.
   *
   * An AudioContext made outside a user gesture starts suspended, and elements told to preload
   * would pull megabytes for a visitor who is reading the graph and never presses play.
   */
  const ensure = useCallback((): AudioContext | null => {
    if (!snapshot) return null;
    if (ctxRef.current) return ctxRef.current;
    try {
      const ctx = new AudioContext();
      const voice = (file: string, gainValue: number): Voice => {
        const el = new Audio(`${snapshot.base}/audio/${file.split("/").pop()}`);
        // `metadata`, not `auto`: the duration is wanted at once (the ruler asks), the bytes are
        // not — the element fetches them when it is told to play.
        el.preload = "metadata";
        const gain = ctx.createGain();
        gain.gain.value = gainValue;
        ctx.createMediaElementSource(el).connect(gain).connect(ctx.destination);
        const v = { el, gain };
        allRef.current.push(v);
        return v;
      };
      mixRef.current = voice(snapshot.manifest.media.mix.file, 1);
      // The stems are built now and silent, so that the first mute is a gain change rather than
      // a load: made on demand, muting a lane would cost a round trip and a decode mid-song.
      for (const s of snapshot.manifest.media.stems)
        if (s.track) stemsRef.current.set(s.track, voice(s.file, 0));
      ctxRef.current = ctx;
      return ctx;
    } catch (e) {
      setFault(
        `this browser refused to play the snapshot: ${(e as Error).message}`,
      );
      return null;
    }
  }, [snapshot]);

  const transport = useCallback(
    (action: TransportAction) => {
      const ctx = ensure();
      if (!ctx) return;
      const at = clock()?.currentTime ?? 0;
      const start = () => {
        void ctx.resume();
        for (const v of allRef.current) {
          // Every element is put on the clock's time before it starts, so a stem that was
          // switched on mid-song does not begin at zero.
          if (Math.abs(v.el.currentTime - at) > DRIFT_S) v.el.currentTime = at;
          void v.el.play().catch((e: Error) => setFault(e.message));
        }
        playingRef.current = true;
      };
      const stop = () => {
        for (const v of allRef.current) v.el.pause();
        playingRef.current = false;
      };
      if (action === "play") start();
      else if (action === "stop") stop();
      else if (action === "toggle") playingRef.current ? stop() : start();
      else if (action === "rewind") {
        for (const v of allRef.current) v.el.currentTime = 0;
      }
      publish();
    },
    [ensure, clock, publish],
  );

  const seek = useCallback(
    (seconds: number) => {
      if (!ensure()) return;
      for (const v of allRef.current) v.el.currentTime = Math.max(0, seconds);
      publish();
    },
    [ensure, publish],
  );

  const setLaneGains = useCallback(
    (gains: Record<string, number>) => {
      const silenced = Object.values(gains).some((g) => g < 1);
      if (!silenced && !onStemsRef.current) return; // still the mixdown, and nothing to do
      if (!ensure()) return;
      // The one-way crossing. Coming BACK to the mixdown when every lane is on again would be a
      // second seam mid-play for someone who is only exploring, and the stems sum to the same
      // song — so once they are what sounds, they stay it.
      if (!onStemsRef.current) {
        onStemsRef.current = true;
        const at = mixRef.current?.el.currentTime ?? 0;
        if (mixRef.current) mixRef.current.gain.gain.value = 0;
        for (const v of stemsRef.current.values()) v.el.currentTime = at;
      }
      for (const [id, v] of stemsRef.current)
        v.gain.gain.value = gains[id] ?? 1;
    },
    [ensure],
  );

  // Put the followers back on the clock. Only while rolling: a paused transport drifts nowhere,
  // and setting `currentTime` on a paused element is a seek the browser may take its time over.
  useEffect(() => {
    const t = setInterval(() => {
      if (!playingRef.current || !onStemsRef.current) return;
      const at = clock()?.currentTime;
      if (at === undefined) return;
      for (const v of stemsRef.current.values())
        if (Math.abs(v.el.currentTime - at) > DRIFT_S) v.el.currentTime = at;
    }, RESYNC_MS);
    return () => clearInterval(t);
  }, [clock]);

  useEffect(() => {
    if (!snapshot) return;
    rafRef.current = requestAnimationFrame(pump);
    return () => {
      cancelAnimationFrame(rafRef.current);
      for (const v of allRef.current) {
        v.el.pause();
        // Dropped explicitly: an element left with a `src` keeps its buffer and, in Firefox, its
        // network connection — and this tab may sit open on a snapshot for hours.
        v.el.removeAttribute("src");
        v.el.load();
      }
      allRef.current = [];
      stemsRef.current.clear();
      mixRef.current = null;
      void ctxRef.current?.close();
      ctxRef.current = null;
    };
  }, [snapshot, pump]);

  return { transport, seek, setLaneGains, fault };
}
