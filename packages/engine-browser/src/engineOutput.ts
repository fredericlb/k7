// engineOutput.ts — hearing an engine here: the server's own engine plays into a null sink and says so
// in `whoami` (`audioToBrowser`), and a page driving it plays its master broadcast instead; a page
// may also ASK to listen here (`setHere`), whatever the engine has. Its speakers play on. See docs/streaming.md.
// What reads wrong: the context is built on the FIRST frame, since it must match the engine's rate.

import { decodeStreamFrame } from "@studio/engine-protocol/stream";
import type { EngineClient } from "./engine.ts";
import { StreamPlayer } from "./streamPlayer.ts";
import { createWorkletSink } from "./streamSink.ts";

const formatKey = (sampleRate: number, channels: number): string =>
  `${sampleRate}/${channels}`;

/** What a page needs of the client: the flag, the frames, the subscription. */
type OutputClient = Pick<
  EngineClient,
  "onAudioToBrowser" | "onStreamFrame" | "broadcast"
>;

/** Play `client`'s engine here while it says nobody hears its device; the returned function stops it. */
export function playEngineOutput(client: OutputClient): () => void {
  return engineOutput(client).stop;
}

/** The same, with the page's own wish to listen here on top of the engine's flag. */
export function engineOutput(
  client: OutputClient,
  here = false,
  /** Told once per stream format this page cannot play — no AudioWorklet on a plain-http page, a channel count it refuses. */
  onFail?: (e: unknown) => void,
): { setHere: (on: boolean) => void; stop: () => void } {
  let ctx: AudioContext | null = null;
  let player: StreamPlayer | null = null;
  let building = false;
  // The format that failed to build, latched: ~100 frames a second would each build another context otherwise.
  let failed: string | null = null;
  let on = false;
  let unheard = false;
  let wanted = here;

  // A context built without a click starts suspended; the next gesture on the page is what lets it sound.
  const resume = () => {
    if (ctx?.state === "suspended") ctx.resume().catch(() => {});
  };
  const gestures = ["pointerdown", "keydown"] as const;
  // Absent outside a page — a test, a worker — where there is no gesture to wait for.
  const page = typeof window === "undefined" ? null : window;

  const teardown = () => {
    player = null;
    const c = ctx;
    ctx = null;
    c?.close().catch(() => {});
  };

  const build = async (sampleRate: number, channels: number) => {
    building = true;
    let c: AudioContext | null = null;
    try {
      c = new AudioContext({ sampleRate, latencyHint: "interactive" });
      // Capped: playback over a relay gathers every stall as latency it never gives back (docs/streaming.md).
      const sink = await createWorkletSink(c, {
        channels,
        maxFrames: Math.round(sampleRate * 0.3),
        holdFrames: Math.round(sampleRate * 0.5),
      });
      if (!on) {
        c.close().catch(() => {});
        return;
      }
      sink.node.connect(c.destination);
      ctx = c;
      player = new StreamPlayer(sink);
      resume();
    } catch (e) {
      // A context left open is an audio thread for nothing: closed here, and the format not tried again.
      c?.close().catch(() => {});
      failed = formatKey(sampleRate, channels);
      console.warn("engine output: cannot play here", e);
      onFail?.(e);
    } finally {
      building = false;
    }
  };

  const offFrame = client.onStreamFrame((data, owned) => {
    if (!on) return;
    if (player) {
      player.handle(data, owned);
      // The sink does not resample: a new rate needs a context of its own.
      const f = player.snapshot().format;
      if (f && ctx && f.sampleRate !== ctx.sampleRate) teardown();
      return;
    }
    if (building) return;
    const frame = decodeStreamFrame(data);
    if (!frame || failed === formatKey(frame.sampleRate, frame.channels))
      return;
    void build(frame.sampleRate, frame.channels);
  });

  // One decision for both reasons to listen here: the broadcast is subscribed once, and let go once.
  const settle = () => {
    const next = unheard || wanted;
    if (next === on) return;
    on = next;
    // Listening again is asking again: the failure is forgotten with the subscription.
    failed = null;
    client.broadcast(on);
    if (!on) teardown();
  };
  const offFlag = client.onAudioToBrowser((toBrowser) => {
    unheard = toBrowser;
    settle();
  });
  settle();

  for (const g of gestures) page?.addEventListener(g, resume, true);

  return {
    setHere: (next) => {
      wanted = next;
      settle();
    },
    stop: () => {
      for (const g of gestures) page?.removeEventListener(g, resume, true);
      offFlag();
      offFrame();
      if (on) client.broadcast(false);
      on = false;
      teardown();
    },
  };
}
