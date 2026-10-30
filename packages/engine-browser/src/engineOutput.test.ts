// engineOutput.test.ts — an engine that says nobody hears its device is listened to through its
// broadcast, and only that one: the client learns the flag from `whoami`, and the page subscribes
// when it is raised and lets go when it is lowered or the page leaves.

import {
  encodeStreamFrame,
  STREAM_CODEC_PCM_F32,
  STREAM_VERSION,
} from "@studio/engine-protocol/stream";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EngineClient } from "./engine";
import { engineOutput, playEngineOutput } from "./engineOutput";

/** A client whose inbound messages the test writes, and whose broadcast calls it reads. */
function client() {
  const c = new EngineClient("ws://never-opened");
  const asked: boolean[] = [];
  const real = c.broadcast.bind(c);
  c.broadcast = (on: boolean) => {
    asked.push(on);
    real(on);
  };
  const feed = (m: object) =>
    (c as unknown as { dispatch: (m: object) => void }).dispatch(m);
  return { c, feed, asked };
}

describe("an engine's audioToBrowser flag", () => {
  it("is read from whoami and told only when it changes", () => {
    const { c, feed } = client();
    const seen: boolean[] = [];
    c.onAudioToBrowser((on) => seen.push(on));
    feed({ type: "whoami", id: "e1", boot: "1", audioToBrowser: true });
    feed({ type: "whoami", id: "e1", boot: "1", audioToBrowser: true });
    feed({ type: "whoami", id: "e1", boot: "1" });
    expect(seen).toEqual([false, true, false]);
  });
});

describe("playing an engine's output here", () => {
  it("asks for nothing from an engine that has speakers", () => {
    const { c, feed, asked } = client();
    const stop = playEngineOutput(c);
    feed({ type: "whoami", id: "e1", boot: "1" });
    stop();
    expect(asked).toEqual([]);
  });

  it("subscribes when the engine says nobody hears it, and lets go when the page leaves", () => {
    const { c, feed, asked } = client();
    const stop = playEngineOutput(c);
    feed({ type: "whoami", id: "e1", boot: "1", audioToBrowser: true });
    expect(asked).toEqual([true]);
    stop();
    expect(asked).toEqual([true, false]);
  });

  it("lets go when the engine says it is heard again", () => {
    const { c, feed, asked } = client();
    const stop = playEngineOutput(c);
    feed({ type: "whoami", id: "e1", boot: "1", audioToBrowser: true });
    feed({ type: "whoami", id: "e1", boot: "2" });
    expect(asked).toEqual([true, false]);
    stop();
    expect(asked).toEqual([true, false]);
  });
});

describe("a page that cannot play the stream", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("closes the context it built, tries the format once, and says so once", async () => {
    let built = 0;
    let closed = 0;
    // No `audioWorklet`, as on a plain-http LAN page: building the sink throws.
    vi.stubGlobal(
      "AudioContext",
      class {
        sampleRate = 48000;
        constructor() {
          built++;
        }
        close() {
          closed++;
          return Promise.resolve();
        }
      },
    );
    const { c, feed } = client();
    const told: unknown[] = [];
    const out = engineOutput(c, false, (e) => told.push(e));
    feed({ type: "whoami", id: "e1", boot: "1", audioToBrowser: true });
    const frame = encodeStreamFrame({
      version: STREAM_VERSION,
      channels: 2,
      sampleRate: 48000,
      frames: 480,
      seq: 0,
      codec: STREAM_CODEC_PCM_F32,
      captureMs: 0,
      samples: new Float32Array(960),
    });
    const cbs = (c as unknown as { streamCbs: Set<(f: ArrayBuffer) => void> })
      .streamCbs;
    for (let i = 0; i < 5; i++) {
      for (const cb of cbs) cb(frame.slice(0));
      await Promise.resolve();
      await new Promise((r) => setTimeout(r, 0));
    }
    expect(built).toBe(1);
    expect(closed).toBe(1);
    expect(told).toHaveLength(1);
    out.stop();
  });
});

describe("listening here by choice", () => {
  it("subscribes on an engine that has speakers, and lets go when the page changes its mind", () => {
    const { c, feed, asked } = client();
    const out = engineOutput(c, true);
    feed({ type: "whoami", id: "e1", boot: "1" });
    expect(asked).toEqual([true]);
    out.setHere(false);
    expect(asked).toEqual([true, false]);
    out.stop();
    expect(asked).toEqual([true, false]);
  });

  it("keeps the broadcast while either reason holds", () => {
    const { c, feed, asked } = client();
    const out = engineOutput(c);
    feed({ type: "whoami", id: "e1", boot: "1", audioToBrowser: true });
    out.setHere(true);
    out.setHere(false);
    expect(asked).toEqual([true]);
    out.stop();
    expect(asked).toEqual([true, false]);
  });
});
