// useSnapshotPlayer.ts — playback for a SHARED snapshot: the rendered mixdown, or its stems once
// the visitor changes what sounds, through Web Audio elements rather than the engine. It feeds
// the same EngineStore the engine feeds, so the playhead, the clock and the timeline are
// untouched. See docs/shared.md.

import type { EngineStore } from "@studio/engine-browser/store";
import type { TransportAction } from "@studio/engine-protocol";
import { useCallback, useEffect, useRef, useState } from "react";
import type { OpenShare } from "../components/SharedGate";
import { matchesMixdown } from "../laneGains";

/** Beyond this a follower is lost rather than late, and only a seek gets it back. Seconds. */
const RESEEK_S = 0.5;
/** Below this, leave it alone: correcting a millisecond costs more than it buys. */
const SLACK_S = 0.01;
/** How hard to pull on a late follower, and the ceiling — ±4 % is inaudible on a full mix. */
const PULL = 0.5;
const MAX_TRIM = 0.04;
/** How often to look. Often enough that a nudge is small, rarely enough to cost nothing. */
const TRIM_MS = 250;
/** A stem that will not become playable must not hold up the others for ever. */
const READY_TIMEOUT_MS = 8000;

export interface SnapshotPlayer {
  transport: (a: TransportAction) => void;
  seek: (seconds: number) => void;
  /**
   * What should sound, 0 or 1 per TRACK id, and what the MIXDOWN already sounds like.
   *
   * The second argument is the whole of the crossing rule. A snapshot's mixdown was rendered
   * from the document, so a lane the document itself mutes is ALREADY absent from it — treating
   * that as "the visitor silenced something" put every project with a muted lane onto the stems
   * before anyone touched anything, which is the loudest possible way to be wrong.
   */
  setLaneGains: (
    gains: Record<string, number>,
    mixdown: Record<string, number>,
  ) => void;
  /** What went wrong, in a sentence, or "" — the status line's, not a dialog's. */
  fault: string;
}

/** One playable file: the element that streams it and the gain it lands on. */
interface Voice {
  el: HTMLAudioElement;
  gain: GainNode;
}

/** Seek an element and wait until it can actually play from there — or give up. */
function ready(el: HTMLAudioElement, at: number): Promise<void> {
  if (Math.abs(el.currentTime - at) > SLACK_S) el.currentTime = at;
  if (el.readyState >= 3 /* HAVE_FUTURE_DATA */) return Promise.resolve();
  el.preload = "auto";
  el.load();
  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(timer);
      el.removeEventListener("canplay", done);
      resolve();
    };
    const timer = setTimeout(done, READY_TIMEOUT_MS);
    el.addEventListener("canplay", done, { once: true });
  });
}

/**
 * A browser transport over rendered audio.
 *
 * **A media element per file, not a decoded buffer**, and the number is why: twelve stems of four
 * minutes decode to something over a gigabyte of float32, which no phone has. An element streams,
 * makes Range requests — exactly what pl8's `streamFile` serves — and carries the `currentTime`
 * this hook publishes as the playhead.
 *
 * The price is that media elements have **no scheduling**. `AudioBufferSourceNode.start(when)` is
 * sample-accurate and `el.play()` is "soon", so several elements told to play in one tick begin
 * whenever each has buffered — hundreds of milliseconds apart, which on a set of stems is not
 * drift but cacophony. Two rules pay for it:
 *
 * 1. **Nothing starts until every voice in the group can play**, from the same position. One
 *    late stem delays the group by its own buffering instead of arriving late for ever.
 * 2. **Drift is corrected by `playbackRate`, not by `currentTime`.** A seek on a playing element
 *    re-buffers, which drops it further behind and makes the next correction bigger — the
 *    stutter feeds itself. A ±4 % nudge pulls it in silently. A seek is kept for the one case a
 *    nudge cannot answer: half a second out, which is lost rather than late.
 *
 * Only the group that SOUNDS is playing at all — one stream for the mixdown, and the stems only
 * once someone asks for them. Thirteen concurrent streams for a visitor who never mutes anything
 * would be the bandwidth of the whole snapshot to hear one file.
 */
export function useSnapshotPlayer(
  snapshot: OpenShare | undefined,
  store: EngineStore,
): SnapshotPlayer {
  const [fault, setFault] = useState("");
  const ctxRef = useRef<AudioContext | null>(null);
  const mixRef = useRef<Voice | null>(null);
  // By TRACK id. A stem whose render matched no lane (`track: ""`) is deliberately absent: it
  // sounds, and no mute button addresses it — which is honest, where hanging it off a made-up
  // id would light the wrong lane's button.
  const stemsRef = useRef<Map<string, Voice>>(new Map());
  const onStemsRef = useRef(false);
  const playingRef = useRef(false);
  const rafRef = useRef(0);
  // Bumped by anything that changes what should be playing, so a start still in flight when the
  // next one begins knows it has been overtaken and drops its own `play()`.
  const genRef = useRef(0);

  /** The voices that sound right now — one file, or the stems. Never both. */
  const group = useCallback((): Voice[] => {
    if (!onStemsRef.current) return mixRef.current ? [mixRef.current] : [];
    return [...stemsRef.current.values()];
  }, []);

  /** Whichever element the others follow. The mixdown while it is what sounds, then stem one. */
  const clock = useCallback(
    (): HTMLAudioElement | null => group()[0]?.el ?? null,
    [group],
  );

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
      // …and the same about the master, said the way a scalar can say it: -100 is what the engine
      // itself returns when there is no meter to ask (EngineHost::masterState), so it already
      // means "no reading" here rather than "measured, and silent". Nothing draws it anyway — the
      // header's meter is not mounted on a snapshot, for exactly this reason.
      master: -100,
      masterClipped: false,
      armed: [],
      recordEnabled: false,
      waveform: {},
    });
  }, [store, clock]);

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
      const voice = (file: string): Voice => {
        const el = new Audio(`${snapshot.base}/audio/${file.split("/").pop()}`);
        // `metadata`, not `auto`: the duration is wanted at once (the ruler asks), the bytes are
        // not — a stem is fetched when it is about to be needed, in `ready` above.
        el.preload = "metadata";
        const gain = ctx.createGain();
        ctx.createMediaElementSource(el).connect(gain).connect(ctx.destination);
        return { el, gain };
      };
      mixRef.current = voice(snapshot.manifest.media.mix.file);
      for (const s of snapshot.manifest.media.stems)
        if (s.track) stemsRef.current.set(s.track, voice(s.file));
      ctxRef.current = ctx;
      return ctx;
    } catch (e) {
      setFault(
        `this browser refused to play the snapshot: ${(e as Error).message}`,
      );
      return null;
    }
  }, [snapshot]);

  /** Everything that is not sounding, stopped — so a crossing leaves nothing behind it. */
  const hushOthers = useCallback(() => {
    const sounding = new Set(group().map((v) => v.el));
    for (const v of [mixRef.current, ...stemsRef.current.values()])
      if (v && !sounding.has(v.el)) v.el.pause();
  }, [group]);

  /** Start the sounding group together, from `at`. Async by necessity — see the header. */
  const startTogether = useCallback(
    async (ctx: AudioContext, at: number) => {
      const mine = ++genRef.current;
      playingRef.current = true;
      hushOthers();
      const voices = group();
      await Promise.all(voices.map((v) => ready(v.el, at)));
      // Overtaken while we were waiting — by a stop, a seek, or the crossing to the stems.
      if (genRef.current !== mine) return;
      void ctx.resume();
      for (const v of voices) {
        v.el.playbackRate = 1;
        v.el.play().catch((e: Error) => setFault(e.message));
      }
    },
    [group, hushOthers],
  );

  const transport = useCallback(
    (action: TransportAction) => {
      const ctx = ensure();
      if (!ctx) return;
      const at = clock()?.currentTime ?? 0;
      const stop = () => {
        genRef.current++; // cancel a start still waiting on a slow stem
        playingRef.current = false;
        for (const v of group()) v.el.pause();
      };
      if (action === "play") void startTogether(ctx, at);
      else if (action === "stop") stop();
      else if (action === "toggle") {
        if (playingRef.current) stop();
        else void startTogether(ctx, at);
      } else if (action === "rewind") {
        for (const v of group()) v.el.currentTime = 0;
      }
      publish();
    },
    [ensure, clock, group, startTogether, publish],
  );

  const seek = useCallback(
    (seconds: number) => {
      const ctx = ensure();
      if (!ctx) return;
      const at = Math.max(0, seconds);
      // Through the same door as a play, so a seek WHILE rolling re-groups rather than leaving
      // each voice to land on its own. Stopped, it is just the position.
      if (playingRef.current) void startTogether(ctx, at);
      else {
        genRef.current++;
        for (const v of group()) v.el.currentTime = at;
      }
      publish();
    },
    [ensure, group, startTogether, publish],
  );

  const setLaneGains = useCallback(
    (gains: Record<string, number>, mixdown: Record<string, number>) => {
      // What the MIXDOWN already says. A document that mutes a lane rendered without it, so
      // matching that is not a reason to touch anything — and treating it as one is what put a
      // whole song onto unsynchronised stems before the visitor had clicked at all.
      if (matchesMixdown(gains, mixdown) && !onStemsRef.current) return;
      const ctx = ensure();
      if (!ctx) return;
      // The one-way crossing. Coming BACK to the mixdown when the visitor undoes their change
      // would be a second seam mid-play, and the stems sum to the same song — so once they are
      // what sounds, they stay it.
      if (!onStemsRef.current) {
        const at = mixRef.current?.el.currentTime ?? 0;
        onStemsRef.current = true;
        if (playingRef.current) void startTogether(ctx, at);
        else {
          genRef.current++;
          mixRef.current?.el.pause();
          for (const v of stemsRef.current.values()) v.el.currentTime = at;
        }
      }
      for (const [id, v] of stemsRef.current)
        v.gain.gain.value = gains[id] ?? 1;
    },
    [ensure, startTogether],
  );

  /**
   * Pull the followers onto the clock, by RATE.
   *
   * Writing `currentTime` on a playing element re-buffers it, which drops it further behind and
   * makes the next correction bigger — the stutter feeds itself, and that is what a set of stems
   * sounded like. A rate nudge changes nothing audible and closes the gap over a second or two.
   * A hard seek is kept for half a second out, where no survivable rate would catch up.
   */
  useEffect(() => {
    const t = setInterval(() => {
      if (!playingRef.current || !onStemsRef.current) return;
      const lead = clock();
      if (!lead) return;
      for (const v of stemsRef.current.values()) {
        if (v.el === lead || v.el.paused) continue;
        const diff = v.el.currentTime - lead.currentTime;
        if (Math.abs(diff) > RESEEK_S) {
          v.el.currentTime = lead.currentTime;
          v.el.playbackRate = 1;
        } else if (Math.abs(diff) > SLACK_S) {
          // Behind (diff < 0) means faster. Clamped, so a stalled stem cannot run away.
          const trim = Math.max(-MAX_TRIM, Math.min(MAX_TRIM, diff * PULL));
          v.el.playbackRate = 1 - trim;
        } else v.el.playbackRate = 1;
      }
    }, TRIM_MS);
    return () => clearInterval(t);
  }, [clock]);

  useEffect(() => {
    if (!snapshot) return;
    rafRef.current = requestAnimationFrame(pump);
    const mix = mixRef;
    const stems = stemsRef;
    const ctx = ctxRef;
    return () => {
      cancelAnimationFrame(rafRef.current);
      for (const v of [mix.current, ...stems.current.values()]) {
        if (!v) continue;
        v.el.pause();
        // Dropped explicitly: an element left with a `src` keeps its buffer and, in Firefox, its
        // network connection — and this tab may sit open on a snapshot for hours.
        v.el.removeAttribute("src");
        v.el.load();
      }
      stems.current.clear();
      mix.current = null;
      void ctx.current?.close();
      ctx.current = null;
    };
  }, [snapshot, pump]);

  return { transport, seek, setLaneGains, fault };
}
