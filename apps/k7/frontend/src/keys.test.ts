// What Escape backs out of, and in what order. The ladder is the whole behaviour of the key —
// "close the thing in front of me" is one binding list read top to bottom — so it is worth
// pinning here, where it can be read without a browser. See docs/shell.md.

import { describe, expect, it } from "vitest";
import {
  type ConditionCtx,
  commandKeyMap,
  effectiveKeys,
  KEY_NONE,
  KEYS,
  keyForCommand,
  keyToken,
  resolveBinding,
  resolveToken,
  shortcutsByCommand,
} from "./keys";
import type { Pane } from "./routes";
import { ringStep } from "./ui/commands/views";

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

  // The slot sits INSIDE the chains pane, so a fullscreened pane has to give the clip up first — leaving the layout first is backwards.
  it("leaves a fullscreened pane only once the slot is empty", () => {
    expect(esc({ fullscreen: "1" })).toBe("ui global");
  });

  it("falls back to the bottom panel", () => {
    expect(esc({})).toBe("ui close");
  });

  // A pending learn is the outermost layer: Esc cancels it and closes nothing behind it.
  it("cancels a pending MIDI learn before anything else", () => {
    expect(esc({ midi_learning: "1", popin: "1", fullscreen: "1" })).toBe(
      "ui midi learn cancel",
    );
  });
});

describe("the r key", () => {
  // `rec` is the A button's own toggle, so a MIDI lane arms in the browser rather than in the engine.
  it("arms the caret's lane the way its A button does", () => {
    expect(resolveBinding(KEYS.r, { caret_track: "bass" })).toBe("rec bass");
  });

  it("arms a picture lane with its own verb", () => {
    expect(resolveBinding(KEYS.r, { caret_picture: "cam" })).toBe(
      "ui picture arm cam",
    );
  });
});

describe("the transport keys", () => {
  // Space must name a command that moves the transport and nothing view-shaped: this one key survives whatever had focus.
  it("space toggles playback", () => {
    expect(resolveBinding(KEYS.space, {})).toBe("transport toggle");
  });

  // Same survival rule as space: the shifted pair must get through a focused control, which is why App names both tokens.
  it("shift+space replays from where playback last started", () => {
    expect(resolveBinding(KEYS["shift+space"], {})).toBe("transport replay");
  });

  it("enter rewinds", () => {
    expect(resolveBinding(KEYS.enter, {})).toBe("transport rewind");
  });
});

// The clipboard chords, the only two this shell takes off the browser — the four tokens must keep resolving to the same two commands.
describe("the clipboard keys", () => {
  // UNCONDITIONAL, and the regression it is pinned against: conditional on a rectangle, copying a clicked event did nothing and said nothing.
  it("⌃C and c copy whatever the state, so the key is never silent", () => {
    expect(resolveBinding(KEYS["ctrl+c"], {})).toBe("selection copy");
    expect(resolveBinding(KEYS.c, {})).toBe("selection copy");
  });

  it("⌃V and p paste whatever the state — an empty clipboard is the command's to say", () => {
    expect(resolveBinding(KEYS["ctrl+v"], {})).toBe("selection paste");
    expect(resolveBinding(KEYS.p, {})).toBe("selection paste");
  });

  // The chord is listed first in KEYS, which is what makes it the one advertised — `shortcutsByCommand` takes the first token.
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

  it("Backspace deletes, on a clip grid and on the timeline in front, and nowhere else", () => {
    const ev = (init: Partial<KeyboardEvent>) => init as KeyboardEvent;
    expect(keyToken(ev({ key: "Backspace" }))).toBe("backspace");
    expect(
      resolveToken("backspace", { clip_grid: "1" }, effectiveKeys({})),
    ).toBe("selection delete");
    expect(
      resolveToken("backspace", { timeline_active: "1" }, effectiveKeys({})),
    ).toBe("selection delete");
    expect(resolveToken("backspace", {}, effectiveKeys({}))).toBeFalsy();
    expect(shortcutsByCommand()["selection delete"]).toBe("Backspace");
  });
});

// Tab and Shift+Tab are the browser's focus order, so a keyboard reaches every control; F6 walks the pages instead.
describe("the page walk", () => {
  const ev = (init: Partial<KeyboardEvent>) => init as KeyboardEvent;

  it("never makes a token of Tab, nor binds one", () => {
    expect(keyToken(ev({ key: "Tab" }))).toBeNull();
    expect(keyToken(ev({ key: "Tab", shiftKey: true }))).toBeNull();
    expect(KEYS.tab).toBeUndefined();
    expect(effectiveKeys({}).tab).toBeUndefined();
  });

  it("F6 walks forward and Shift+F6 back", () => {
    expect(keyToken(ev({ key: "F6" }))).toBe("f6");
    expect(keyToken(ev({ key: "F6", shiftKey: true }))).toBe("shift+f6");
    const eff = effectiveKeys({});
    expect(resolveToken("f6", {}, eff)).toBe("ui focus next");
    expect(resolveToken("shift+f6", {}, eff)).toBe("ui focus prev");
    expect(shortcutsByCommand()["ui focus next"]).toBe("F6");
  });

  it("ignores a stored Tab assignment rather than leaving the command keyless", () => {
    const eff = effectiveKeys({ "ui focus next": { key: "tab" } });
    expect(eff.tab).toBeUndefined();
    expect(resolveToken("f6", {}, eff)).toBe("ui focus next");
  });

  it("steps round the ring both ways, and onto it from the editor", () => {
    const ring: Pane[] = ["timeline", "chains", "turntables"];
    expect(ringStep(ring, "timeline", 1)).toBe("chains");
    expect(ringStep(ring, "turntables", 1)).toBe("timeline");
    expect(ringStep(ring, "timeline", -1)).toBe("turntables");
    expect(ringStep(ring, "editor", 1)).toBe("timeline");
    expect(ringStep(ring, "editor", -1)).toBe("turntables");
  });
});

// The person's own keymap: assignments move a shortcut rather than doubling it, steals are total, and the conditional bindings stay the app's.
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

  it("commandKeyMap answers every plain command as a per-command scan of the table would", () => {
    const prefs = { "ui help": { key: "v" } };
    const map = commandKeyMap(prefs);
    for (const [, b] of Object.entries(KEYS))
      if (typeof b === "string")
        expect(map.get(b)).toBe(keyForCommandByScan(b, prefs));
  });
});

/** The scan `commandKeyMap` replaced, kept here as its oracle. */
function keyForCommandByScan(
  command: string,
  prefs: Parameters<typeof effectiveKeys>[0],
): string | undefined {
  const eff = effectiveKeys(prefs);
  return Object.keys(eff).find((k) => eff[k] === command);
}

/** The tools: three keys and one rung of the ladder, all conditional on the timeline OWNING the keys. */
describe("the timeline's tools", () => {
  const eff = effectiveKeys({});

  it("picks a tool up only while the timeline is active", () => {
    const on = { timeline_active: "1" };
    expect(resolveToken("b", on, eff)).toBe("ui tool cut");
    expect(resolveToken("d", on, eff)).toBe("ui tool erase");
    expect(resolveToken("a", on, eff)).toBe("ui tool pointer");
  });

  it("goes quiet elsewhere, rather than changing a surface you are not looking at", () => {
    for (const t of ["a", "b", "d"])
      expect(resolveToken(t, {}, eff)).toBeNull();
  });

  it("puts the tool down on Escape, under the two overlays and OVER the fullscreen rung", () => {
    expect(esc({ tool_held: "1", fullscreen: "1" })).toBe("ui tool pointer");
    expect(esc({ popin: "1", tool_held: "1" })).toBe("ui popin close");
    expect(esc({ graph_slot: "1", tool_held: "1" })).toBe("ui slot close");
  });

  it("leaves the ladder alone with no tool in hand", () => {
    expect(esc({ fullscreen: "1" })).toBe("ui global");
  });

  /** They are the app's, like every other conditional binding — but the HELP page must still find their keys. */
  it("advertises all three, so the legend and the help page can name them", () => {
    const by = shortcutsByCommand();
    expect(by["ui tool cut"]).toBe("b");
    expect(by["ui tool erase"]).toBe("d");
    // Two keys put the tool down and the table keeps the FIRST — Esc, the app's way out of everything; `a` still works.
    expect(by["ui tool pointer"]).toBe("Esc");
  });
});

/** The waveform: three views that are also three gestures, so one verb sets both (waveMode.ts). */
describe("the waveform's views", () => {
  const eff = effectiveKeys({});
  const open = { wave_open: "1" };

  it("reaches all three only while an audio clip is open", () => {
    expect(resolveToken("o", open, eff)).toBe("ui wave onsets");
    expect(resolveToken("w", open, eff)).toBe("ui wave warp");
    expect(resolveToken("a", open, eff)).toBe("ui wave standard");
  });

  it("goes quiet with no waveform on screen", () => {
    for (const t of ["o", "w"]) expect(resolveToken(t, {}, eff)).toBeNull();
  });

  /** `a` is shared: the clip pane in front wins, which is the rule its other verbs already follow. */
  it("gives `a` to the waveform over the timeline's arrow", () => {
    expect(resolveToken("a", { ...open, timeline_active: "1" }, eff)).toBe(
      "ui wave standard",
    );
    expect(resolveToken("a", { timeline_active: "1" }, eff)).toBe(
      "ui tool pointer",
    );
  });

  it("backs out to standard on Escape, above the timeline's tool rung", () => {
    expect(esc({ wave_marks: "1", tool_held: "1", fullscreen: "1" })).toBe(
      "ui wave standard",
    );
  });

  it("has no rung in standard — there is no mark there to back out of", () => {
    expect(esc({ wave_open: "1", fullscreen: "1" })).toBe("ui global");
  });
});

/** The piano roll: three modes, and the two letters it SHARES with the surfaces behind it. */
describe("the piano roll's modes", () => {
  const eff = effectiveKeys({});
  const open = { roll_open: "1" };

  it("reaches all three only while a roll is open", () => {
    expect(resolveToken("a", open, eff)).toBe("ui roll select");
    expect(resolveToken("n", open, eff)).toBe("ui roll create");
    expect(resolveToken("d", open, eff)).toBe("ui roll remove");
  });

  it("goes quiet with no roll on screen", () => {
    expect(resolveToken("n", {}, eff)).toBeNull();
  });

  /** `a` is the neutral one on all three surfaces and `d` takes something away on two — the pane in FRONT wins. */
  it("takes `a` and `d` from the timeline, and `a` from the waveform", () => {
    const all = { ...open, wave_open: "1", timeline_active: "1" };
    expect(resolveToken("a", all, eff)).toBe("ui roll select");
    expect(resolveToken("d", all, eff)).toBe("ui roll remove");
    // …and hands them back when no roll is drawn.
    expect(resolveToken("d", { timeline_active: "1" }, eff)).toBe(
      "ui tool erase",
    );
  });

  it("backs out to select on Escape, above every other mode rung", () => {
    expect(esc({ roll_armed: "1", wave_marks: "1", tool_held: "1" })).toBe(
      "ui roll select",
    );
  });

  it("has no rung in select — there is nothing armed to back out of", () => {
    expect(esc({ roll_open: "1", fullscreen: "1" })).toBe("ui global");
  });
});
