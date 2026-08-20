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
  keyToken,
  resolveBinding,
  resolveToken,
  shortcutsByCommand,
} from "./keys";

const esc = (cond: ConditionCtx) => resolveBinding(KEYS.esc, cond);

describe("the Escape ladder", () => {
  it("closes the overlay in front before anything else", () => {
    expect(
      esc({
        popin: "1",
        graph_slot: "1",
        fullscreen: "1",
      }),
    ).toBe("ui popin close");
  });

  it("puts the graph back when no overlay is up", () => {
    expect(esc({ graph_slot: "1", fullscreen: "1" })).toBe("ui slot close");
  });

  // The slot sits INSIDE the chains pane, so a fullscreened pane holding an open clip has to
  // give the clip up first — leaving the layout before the thing you were reading is backwards.
  it("leaves a fullscreened pane only once the slot is empty", () => {
    expect(esc({ fullscreen: "1" })).toBe("ui global");
  });

  it("falls back to the bottom panel", () => {
    expect(esc({})).toBe("ui close");
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

// The clipboard chords — the only two this shell takes off the browser. Pinned here because
// "⌃C copies the rectangle" is a promise about a key the browser also has a use for, and the
// four tokens have to keep resolving to the same two commands. See docs/clipEditors.md.
describe("the clipboard keys", () => {
  // UNCONDITIONAL, and this is the regression the pair is pinned against: they were conditional
  // on a `v` rectangle being drawn, so copying an event you had SELECTED BY CLICKING did nothing
  // and said nothing — and the paste then reported an empty clipboard. Both commands answer in
  // every state now (the caret is a one-cell rectangle), so neither key may go quiet again.
  it("⌃C and c copy whatever the state, so the key is never silent", () => {
    expect(resolveBinding(KEYS["ctrl+c"], {})).toBe("selection copy");
    expect(resolveBinding(KEYS.c, {})).toBe("selection copy");
  });

  it("⌃V and p paste whatever the state — an empty clipboard is the command's to say", () => {
    expect(resolveBinding(KEYS["ctrl+v"], {})).toBe("selection paste");
    expect(resolveBinding(KEYS.p, {})).toBe("selection paste");
  });

  // The chord is listed first in KEYS, which is what makes it the one the help legend and the
  // settings page advertise — `shortcutsByCommand` takes the first token naming a command.
  it("the legend advertises the chord, not the plain letter", () => {
    const by = shortcutsByCommand();
    expect(by["selection copy"]).toBe("Ctrl+C");
    expect(by["selection paste"]).toBe("Ctrl+V");
  });

  // keyToken is what decides a chord is ours at all: two letters, and no others.
  it("keyToken takes ⌃C and ⌃V — and no other chord", () => {
    const ev = (init: Partial<KeyboardEvent>) => init as KeyboardEvent;
    expect(keyToken(ev({ key: "c", ctrlKey: true }))).toBe("ctrl+c");
    expect(keyToken(ev({ key: "V", metaKey: true }))).toBe("ctrl+v"); // ⌘ is the same token
    expect(keyToken(ev({ key: "x", ctrlKey: true }))).toBeNull();
    expect(keyToken(ev({ key: "1", metaKey: true }))).toBeNull(); // the browser's tab switching
    expect(
      keyToken(ev({ key: "c", ctrlKey: true, shiftKey: true })),
    ).toBeNull();
    expect(keyToken(ev({ key: "c", ctrlKey: true, altKey: true }))).toBeNull();
    expect(keyToken(ev({ key: "c" }))).toBe("c"); // and the bare letter is untouched
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
    expect(resolveToken("esc", {}, eff)).toBe("ui close");
  });

  it("keyForCommand reads the person's key first, and the default without prefs", () => {
    expect(
      keyForCommand("transport toggle", { "transport toggle": { key: "p" } }),
    ).toBe("p");
    expect(keyForCommand("transport toggle")).toBe("space");
  });
});
