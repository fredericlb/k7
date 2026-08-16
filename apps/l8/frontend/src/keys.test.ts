// What Escape backs out of, and in what order. The ladder is the whole behaviour of the key —
// "close the thing in front of me" is one binding list read top to bottom — so it is worth
// pinning here, where it can be read without a browser. See docs/shell.md.

import { describe, expect, it } from "vitest";
import {
  type ConditionCtx,
  effectiveKeys,
  KEY_NONE,
  KEYS,
  keyForCommand,
  resolveBinding,
  resolveToken,
} from "./keys";

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

  // Same survival rule as space: the shifted pair must also get through a focused control,
  // which is why App's listener names both tokens.
  it("shift+space replays from where playback last started", () => {
    expect(resolveBinding(KEYS["shift+space"], {})).toBe("transport replay");
  });

  it("enter rewinds", () => {
    expect(resolveBinding(KEYS.enter, {})).toBe("transport rewind");
  });
});

// The person's own keymap (the settings page's shortcut cells): assignments move a shortcut
// rather than doubling it, steals are total, and the conditional bindings stay the app's.
describe("effectiveKeys / resolveToken", () => {
  it("an assignment moves the command — the new token runs it, the default goes dead", () => {
    const eff = effectiveKeys({ "transport toggle": { key: "p" } });
    expect(resolveToken("p", {}, eff)).toBe("transport toggle");
    expect(resolveToken("space", {}, eff)).toBeNull();
  });

  it("an assignment steals a taken token — the loser has no key at all afterwards", () => {
    const prefs = { "ui help": { key: "v" } }; // v is `ui select`'s by default
    const eff = effectiveKeys(prefs);
    expect(resolveToken("v", {}, eff)).toBe("ui help");
    expect(keyForCommand("ui select", prefs)).toBeUndefined();
  });

  it("KEY_NONE takes a default away without giving another", () => {
    const eff = effectiveKeys({ "transport rewind": { key: KEY_NONE } });
    expect(resolveToken("enter", {}, eff)).toBeNull();
  });

  it("the conditional bindings stay the app's — the esc ladder resolves as ever", () => {
    const eff = effectiveKeys({ "transport toggle": { key: "p" } });
    expect(resolveToken("esc", { current_view: "global" }, eff)).toBe(
      "ui close",
    );
  });

  it("keyForCommand reads the person's key first, and the default without prefs", () => {
    expect(
      keyForCommand("transport toggle", { "transport toggle": { key: "p" } }),
    ).toBe("p");
    expect(keyForCommand("transport toggle")).toBe("space");
  });
});
