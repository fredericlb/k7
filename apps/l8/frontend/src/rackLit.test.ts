// Which rack sound is firing, derived from the arrangement and the playhead. The engine reports
// no notes (see packages/song/docs/racks.md), so this is the whole of what lights a pad — and the
// only part of the feature a test can reach without a browser.

import { describe, expect, it } from "vitest";
import { LiveRackLit, litAt, MIN_FLASH_BEATS, rackHits } from "./rackLit";
import type { WebGraph, WebProject } from "./types";

/** A lane holding one MIDI clip, and a chain running it through a rack. */
const project = (
  notes: { time: number; duration: number; key: number }[],
  clipStart = 0,
): WebProject =>
  ({
    tempo: 120,
    tracks: [
      {
        id: "beat",
        clips: [{ id: "c", type: "midi", start: clipStart, notes }],
      },
    ],
  }) as unknown as WebProject;

const graph = (): WebGraph =>
  ({
    chains: {
      beat: {
        from: "beat",
        use: [
          {
            module: "kit",
            rack: [
              { symbol: "BD", note: 36 },
              { symbol: "SN", note: 38 },
            ],
          },
        ],
        out: [],
      },
    },
  }) as unknown as WebGraph;

describe("rackHits", () => {
  it("gives a rack the notes of the lane feeding its chain, in arrangement beats", () => {
    const hits = rackHits(
      project([{ time: 1, duration: 2, key: 36 }], 4),
      graph(),
    );
    // The clip starts at beat 4 and the note one beat into it: beat 5, for two beats.
    expect(hits.kit).toEqual([{ from: 5, to: 7, key: 36 }]);
  });

  it("floors a very short note, so a drum hit does not flash between two frames", () => {
    const hits = rackHits(
      project([{ time: 0, duration: 0.05, key: 36 }]),
      graph(),
    );
    expect(hits.kit?.[0].to).toBe(MIN_FLASH_BEATS);
  });

  it("gives nothing to a chain with no rack, and nothing for a lane with no notes", () => {
    expect(rackHits(project([]), graph())).toEqual({});
    const noRack = {
      chains: { beat: { from: "beat", use: [{ module: "amp" }], out: [] } },
    } as unknown as WebGraph;
    expect(
      rackHits(project([{ time: 0, duration: 1, key: 36 }]), noRack),
    ).toEqual({});
  });

  it("answers an empty map before the project or the graph has landed", () => {
    expect(rackHits(null, graph())).toEqual({});
    expect(rackHits(project([]), null)).toEqual({});
  });
});

describe("litAt", () => {
  const hits = [
    { from: 0, to: 1, key: 36 },
    { from: 1, to: 3, key: 38 },
    { from: 2, to: 4, key: 36 },
  ];

  it("holds a note from its start up to — but not including — its end", () => {
    expect([...litAt(hits, 0)]).toEqual([36]);
    expect([...litAt(hits, 0.99)]).toEqual([36]);
    // At exactly 1 the first has stopped and the second has started.
    expect([...litAt(hits, 1)]).toEqual([38]);
  });

  it("lights two pads at once when two notes overlap", () => {
    expect([...litAt(hits, 2.5)].sort()).toEqual([36, 38]);
  });

  it("is empty before the first note and after the last", () => {
    expect(litAt(hits, -1).size).toBe(0);
    expect(litAt(hits, 99).size).toBe(0);
  });
});

describe("LiveRackLit", () => {
  it("tells a module's listeners only when ITS set moved", () => {
    const store = new LiveRackLit();
    let kit = 0;
    let other = 0;
    store.subscribeTo("kit", () => kit++);
    store.subscribeTo("other", () => other++);

    store.set({ kit: new Set([36]) });
    expect([kit, other]).toEqual([1, 0]);
    // The same picture again: nobody is woken. This is what keeps a playhead moving through
    // silence from re-rendering pads twenty times a second.
    store.set({ kit: new Set([36]) });
    expect([kit, other]).toEqual([1, 0]);
    store.set({ kit: new Set([36, 38]) });
    expect([kit, other]).toEqual([2, 0]);
    // …and going quiet is a change like any other.
    store.set({});
    expect([kit, other]).toEqual([3, 0]);
  });

  it("answers a pad by its NOTE, which is what the pad knows about itself", () => {
    const store = new LiveRackLit();
    store.set({ kit: new Set([36]) });
    expect(store.isLit("kit", 36)).toBe(true);
    expect(store.isLit("kit", 38)).toBe(false);
    expect(store.isLit("nobody", 36)).toBe(false);
  });

  it("stops telling a listener once it has unsubscribed", () => {
    const store = new LiveRackLit();
    let n = 0;
    const off = store.subscribeTo("kit", () => n++);
    store.set({ kit: new Set([36]) });
    off();
    store.set({ kit: new Set([38]) });
    expect(n).toBe(1);
  });
});
