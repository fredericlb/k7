// engineOutput.test.ts — an engine that says nobody hears its device is listened to through its
// broadcast, and only that one: the client learns the flag from `whoami`, and the page subscribes
// when it is raised and lets go when it is lowered or the page leaves.

import { describe, expect, it } from "vitest";
import { EngineClient } from "./engine";
import { playEngineOutput } from "./engineOutput";

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
