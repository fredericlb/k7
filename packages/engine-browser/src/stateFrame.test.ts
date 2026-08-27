// The `state` frame's TRANSLATION: what the engine put on the wire, as the store's EngineState.
//
// It exists for one failure only, and that failure is silent: a field the engine sends, the
// protocol declares, and this client forgets to copy. `recorders` was dropped exactly that way —
// the engine wrote the takes and the card lit nothing (packages/song/docs/recorderNode.md).

import type { EngineState } from "@studio/engine-protocol";
import { describe, expect, it } from "vitest";
import { EngineClient } from "./engine";

// `dispatch` is private and the socket is not: a frame is fed straight in, as the socket would.
function feed(msg: object): EngineState {
  const c = new EngineClient("ws://never-opened");
  let seen: EngineState | undefined;
  c.onState((s) => {
    seen = s;
  });
  (c as unknown as { dispatch: (m: object) => void }).dispatch(msg);
  if (!seen) throw new Error("no state emitted");
  return seen;
}

describe("a state frame", () => {
  it("carries every field the engine sends", () => {
    const s = feed({
      type: "state",
      playing: true,
      playhead: 12.5,
      levels: [-6],
      inputLevels: [-12],
      armed: ["drums"],
      recordEnabled: true,
      master: -3,
      masterClipped: true,
      waveform: { "MIX:comp:output": [{ min: -0.5, max: 0.5 }] },
      platters: { "deckA:platter": 4 },
      recorders: {
        "MIX:rec": {
          recording: true,
          seconds: 2,
          takes: [{ file: "/takes/a.wav", seconds: 9 }],
          envelope: [{ min: -1, max: 1 }],
          from: 118,
        },
      },
    });
    expect(s).toEqual({
      playing: true,
      playhead: 12.5,
      levels: [-6],
      inputLevels: [-12],
      armed: ["drums"],
      recordEnabled: true,
      master: -3,
      masterClipped: true,
      waveform: { "MIX:comp:output": [{ min: -0.5, max: 0.5 }] },
      platters: { "deckA:platter": 4 },
      recorders: {
        "MIX:rec": {
          recording: true,
          seconds: 2,
          takes: [{ file: "/takes/a.wav", seconds: 9 }],
          envelope: [{ min: -1, max: 1 }],
          from: 118,
        },
      },
    });
  });

  it("reads a frame that declares no recorder as none, not as absent", () => {
    // The card asks `recorders?.[id]` every frame: {} answers it, undefined would too, and the
    // point is that neither is ever a stale take left on screen.
    expect(feed({ type: "state" }).recorders).toEqual({});
  });
});
