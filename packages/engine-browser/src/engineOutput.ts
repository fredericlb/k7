// engineOutput.ts — hearing an engine whose device nobody listens to: the server's own engine plays
// into a null sink, says so in `whoami` (`audioToBrowser`), and a page driving it plays its master
// broadcast here instead. Nothing happens for an engine that has speakers of its own. See docs/streaming.md.
// What reads wrong: the context is built on the FIRST frame, since it must match the engine's rate.

import { decodeStreamFrame } from "@studio/engine-protocol/stream";
import type { EngineClient } from "./engine.ts";
import { StreamPlayer } from "./streamPlayer.ts";
import { createWorkletSink } from "./streamSink.ts";

/** What a page needs of the client: the flag, the frames, the subscription. */
type OutputClient = Pick<
  EngineClient,
  "onAudioToBrowser" | "onStreamFrame" | "broadcast"
>;

/** Play `client`'s engine here while it says nobody hears its device; the returned function stops it. */
export function playEngineOutput(client: OutputClient): () => void {
  let ctx: AudioContext | null = null;
  let player: StreamPlayer | null = null;
  let building = false;
  let on = false;

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
    try {
      const c = new AudioContext({ sampleRate, latencyHint: "interactive" });
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
      console.warn("engine output: cannot play here", e);
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
    if (frame) void build(frame.sampleRate, frame.channels);
  });

  const offFlag = client.onAudioToBrowser((toBrowser) => {
    if (toBrowser === on) return;
    on = toBrowser;
    client.broadcast(on);
    if (!on) teardown();
  });

  for (const g of gestures) page?.addEventListener(g, resume, true);

  return () => {
    for (const g of gestures) page?.removeEventListener(g, resume, true);
    offFlag();
    offFrame();
    if (on) client.broadcast(false);
    on = false;
    teardown();
  };
}
