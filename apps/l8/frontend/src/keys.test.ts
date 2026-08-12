// What Escape backs out of, and in what order. The ladder is the whole behaviour of the key —
// "close the thing in front of me" is one binding list read top to bottom — so it is worth
// pinning here, where it can be read without a browser. See docs/shell.md.

import { describe, expect, it } from "vitest";
import { type ConditionCtx, KEYS, resolveBinding } from "./keys";

const esc = (cond: ConditionCtx) => resolveBinding(KEYS.esc, cond);

describe("the Escape ladder", () => {
  it("closes the overlay in front before anything else", () => {
    expect(
      esc({
        popin: "1",
        graph_slot: "1",
        fullscreen: "1",
        current_view: "global",
      }),
    ).toBe("ui popin close");
  });

  it("puts the graph back when no overlay is up", () => {
    expect(
      esc({ graph_slot: "1", fullscreen: "1", current_view: "global" }),
    ).toBe("ui slot close");
  });

  // The slot sits INSIDE the chains pane, so a fullscreened pane holding an open clip has to
  // give the clip up first — leaving the layout before the thing you were reading is backwards.
  it("leaves a fullscreened pane only once the slot is empty", () => {
    expect(esc({ fullscreen: "1", current_view: "global" })).toBe("ui global");
  });

  it("falls back to the bottom panel", () => {
    expect(esc({ current_view: "global" })).toBe("ui close");
  });
});

describe("the transport keys", () => {
  // Space must name a command that moves the transport and nothing view-shaped: the whole point
  // of the focus rule in App is that this one key survives whatever had focus.
  it("space toggles playback", () => {
    expect(resolveBinding(KEYS.space, {})).toBe("transport toggle");
  });

  it("enter rewinds", () => {
    expect(resolveBinding(KEYS.enter, {})).toBe("transport rewind");
  });
});
